// Content script (isolated world): when an @mention of a person is confirmed in the composer,
// offers the user groups that person belongs to. Picking one swaps the person for the group
// mention.
//
//   - Who is in which group comes from the background service worker (see src/background.js);
//     nothing is shown for a workspace without a registered token.
//   - The swap never writes mention markup itself. It types "@handle" over the person's
//     mention, the same way the keyboard would, and then picks the matching row in Slack's own
//     autocomplete, so the group mention in the message is the one Slack built. When that row
//     cannot be found the typed "@handle" stays and a hint asks to confirm it by hand.
//
// Everything that depends on Slack's DOM lives in SELECTORS.
(async () => {
  if (window.top !== window) {
    return;
  }

  const SELECTORS = {
    // The rich text editor of a composer (channel, thread, edit-message).
    editor: '.ql-editor',
    // A confirmed mention inside the editor; idAttr holds the user (U…/W…) or group (S…) id.
    mention: 'ts-mention',
    idAttr: 'data-id',
    // Rows of Slack's autocomplete menu, which opens while "@…" is being typed.
    autocompleteOption: '[role="listbox"] [role="option"], [data-qa="texty_autocomplete_menu"] [role="option"], .c-texty_autocomplete__result',
  };

  const CLASS = {
    popup: 'tabane-mg-popup',
    title: 'tabane-mg-title',
    option: 'tabane-mg-option',
    handle: 'tabane-mg-handle',
    name: 'tabane-mg-name',
    count: 'tabane-mg-count',
    hint: 'tabane-mg-hint',
  };

  const LOOKUP = 'tabane:mention-groups:lookup';
  const USER_ID = /^[UW][A-Z0-9]+$/;
  const GROUP_ID = /^S[A-Z0-9]+$/;
  // Slack moves the caret after inserting a mention; wait for that before reading it.
  const SETTLE_MS = 60;
  const AUTOCOMPLETE_WAIT_MS = 1500;
  const CONFIRM_WAIT_MS = 800;
  const POLL_MS = 50;
  const HINT_MS = 5000;
  const MARGIN = 6;
  const MAX_GAP = 3;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const url = (path) => chrome.runtime.getURL(path);
  const [{ pickOptionIndex, teamIdFromPath }, { loadSettings, watchSettings }] = await Promise.all([
    import(url('src/lib/usergroups.js')),
    import(url('src/lib/settings.js')),
  ]);

  let enabled = (await loadSettings()).mentionGroups.enabled;
  watchSettings((settings) => {
    enabled = settings.mentionGroups.enabled;
    if (!enabled) {
      closePopup();
    }
  });

  let open = null; // { popup, mention, editor }
  let swapping = false;
  let hintTimer = null;

  // ---- lookup ---------------------------------------------------------------------------

  async function lookup(userId) {
    // The worker answers with no groups for an unknown or missing workspace id.
    const teamId = teamIdFromPath(window.location.pathname);
    try {
      const response = await chrome.runtime.sendMessage({ type: LOOKUP, teamId, userId });
      return Array.isArray(response?.groups) ? response.groups : [];
    } catch {
      return []; // extension reloaded or the service worker is unavailable
    }
  }

  // ---- popup ----------------------------------------------------------------------------

  function element(tag, className, text) {
    const el = document.createElement(tag);
    el.className = className;
    if (text !== undefined) {
      el.textContent = text;
    }
    return el;
  }

  function place(box, anchor) {
    const rect = anchor.getBoundingClientRect();
    const { width, height } = box.getBoundingClientRect();
    // Above the mention when there is room (the composer sits at the bottom), else below.
    const top = rect.top - height - MARGIN >= 0 ? rect.top - height - MARGIN : rect.bottom + MARGIN;
    const left = Math.max(MARGIN, Math.min(rect.left, window.innerWidth - width - MARGIN));
    box.style.top = `${Math.round(top)}px`;
    box.style.left = `${Math.round(left)}px`;
  }

  function closePopup({ refocus = false } = {}) {
    if (!open) {
      return;
    }
    const { popup, editor } = open;
    open = null;
    popup.remove();
    if (refocus) {
      editor.focus();
    }
  }

  function showPopup(mention, editor, groups) {
    closePopup();
    hideHint();
    const popup = element('div', CLASS.popup);
    popup.setAttribute('role', 'group');
    popup.setAttribute('aria-label', '所属グループのメンションに入れ替え');
    popup.append(element('div', CLASS.title, 'グループに入れ替え（Tab で選択・Esc で閉じる）'));
    for (const group of groups) {
      const button = element('button', CLASS.option);
      button.type = 'button';
      button.append(element('span', CLASS.handle, `@${group.handle}`));
      if (group.name && group.name !== group.handle) {
        button.append(element('span', CLASS.name, group.name));
      }
      button.append(element('span', CLASS.count, `${group.userCount}人`));
      // Keep the caret in the editor when the row is clicked with the mouse.
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => swap(mention, editor, group));
      popup.append(button);
    }
    popup.addEventListener('keydown', onPopupKeydown);
    document.body.append(popup);
    place(popup, mention);
    open = { popup, mention, editor };
  }

  function showHint(anchor, text) {
    hideHint();
    const hint = element('div', `${CLASS.popup} ${CLASS.hint}`, text);
    hint.setAttribute('role', 'status');
    document.body.append(hint);
    place(hint, anchor);
    hintTimer = setTimeout(hideHint, HINT_MS);
  }

  function hideHint() {
    clearTimeout(hintTimer);
    document.querySelector(`.${CLASS.hint}`)?.remove();
  }

  function onPopupKeydown(event) {
    const buttons = Array.from(open?.popup.querySelectorAll('button') ?? []);
    const index = buttons.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const step = event.key === 'ArrowDown' ? 1 : -1;
      buttons[(index + step + buttons.length) % buttons.length]?.focus();
      event.preventDefault();
    } else if (event.key === 'Tab') {
      closePopup({ refocus: true });
      event.preventDefault();
    }
    // Enter and Space activate the focused button natively. Nothing typed in the popup
    // should reach Slack's shortcuts.
    event.stopPropagation();
  }

  // While the popup is open: Esc closes it (instead of Slack's "mark as read"), and Tab in the
  // editor moves into the list.
  window.addEventListener(
    'keydown',
    (event) => {
      if (!open || event.isComposing) {
        return;
      }
      if (event.key === 'Escape') {
        closePopup({ refocus: true });
      } else if (event.key === 'Tab' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && open.editor.contains(event.target)) {
        open.popup.querySelector('button')?.focus();
      } else {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );

  // Typing on or clicking elsewhere dismisses the popup; scrolling and resizing move it along.
  document.addEventListener('input', (event) => {
    if (open && !swapping && open.editor.contains(event.target)) {
      closePopup();
    }
  }, true);
  document.addEventListener('pointerdown', (event) => {
    if (open && !open.popup.contains(event.target)) {
      closePopup();
    }
  }, true);
  window.addEventListener('blur', () => closePopup());
  const follow = () => {
    if (open) {
      place(open.popup, open.mention);
    }
  };
  window.addEventListener('resize', follow);
  document.addEventListener('scroll', follow, true);

  // ---- swap -----------------------------------------------------------------------------

  async function waitFor(probe, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = probe();
      if (found || Date.now() >= deadline) {
        return found || null;
      }
      await wait(POLL_MS);
    }
  }

  function findAutocompleteOption(handle) {
    const options = Array.from(document.querySelectorAll(SELECTORS.autocompleteOption)).filter((el) => !el.closest(`.${CLASS.popup}`));
    const described = options.map((el) => ({
      texts: [el, ...el.querySelectorAll('*')].map((node) => node.textContent),
      full: el.textContent,
    }));
    return options[pickOptionIndex(described, handle)] ?? null;
  }

  function click(el) {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      const EventType = type.startsWith('pointer') ? PointerEvent : MouseEvent;
      el.dispatchEvent(new EventType(type, { bubbles: true, cancelable: true, composed: true, view: window, button: 0 }));
      if (!el.isConnected) {
        return; // the menu closed on this event; the rest would go nowhere
      }
    }
  }

  const groupMentions = (editor) =>
    Array.from(editor.querySelectorAll(SELECTORS.mention)).filter((el) => GROUP_ID.test(el.getAttribute(SELECTORS.idAttr) ?? ''));

  async function swap(mention, editor, group) {
    closePopup();
    if (swapping || !mention.isConnected || !editor.contains(mention)) {
      return;
    }
    swapping = true;
    let confirmed = false;
    let typed = false;
    try {
      const before = new Set(groupMentions(editor));
      // Select the person's mention, plus the space Slack put after it (the autocomplete adds
      // its own again).
      const range = document.createRange();
      range.selectNode(mention);
      let next = mention.nextSibling;
      while (next?.nodeType === Node.TEXT_NODE && next.nodeValue === '') {
        next = next.nextSibling;
      }
      if (next?.nodeType === Node.TEXT_NODE && /^[ \u00a0]/.test(next.nodeValue)) {
        range.setEnd(next, 1);
      }
      editor.focus();
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      // Typing over the selection takes the same path as the keyboard, so Slack's editor
      // model follows the change.
      typed = document.execCommand('insertText', false, `@${group.handle}`);
      if (typed) {
        const option = await waitFor(() => findAutocompleteOption(group.handle), AUTOCOMPLETE_WAIT_MS);
        if (option) {
          click(option);
          // Done when a new group mention shows up, or at least when Slack closed its menu.
          confirmed = Boolean(await waitFor(() => groupMentions(editor).some((el) => !before.has(el)) || !option.isConnected, CONFIRM_WAIT_MS));
        }
      }
      if (!confirmed) {
        showHint(
          editor,
          typed
            ? `@${group.handle} を入力しました。Slack の候補から Enter で確定してください。`
            : `@${group.handle} に入れ替えられませんでした。`,
        );
      }
    } finally {
      swapping = false;
      document.dispatchEvent(new CustomEvent('tabane:mention-swapped', { detail: { handle: group.handle, typed, confirmed } }));
    }
  }

  // ---- detection ------------------------------------------------------------------------

  // True when the caret sits right after `mention`, i.e. the mention was just confirmed
  // (a restored draft or an opened edit puts the caret elsewhere). Up to MAX_GAP invisible
  // characters may sit in between: the space Slack appends and the editor's zero-width guards.
  function caretFollows(mention, editor) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed || !editor.contains(selection.anchorNode)) {
      return false;
    }
    if (mention.contains(selection.anchorNode)) {
      return true;
    }
    const caret = selection.getRangeAt(0);
    const gap = document.createRange();
    gap.setStartAfter(mention);
    gap.collapse(true);
    if (caret.compareBoundaryPoints(Range.START_TO_START, gap) < 0) {
      return false; // the caret is before the mention
    }
    gap.setEnd(caret.startContainer, caret.startOffset);
    const between = gap.toString();
    return between.length <= MAX_GAP && between.trim() === '';
  }

  async function offer(mention) {
    await wait(SETTLE_MS);
    const editor = mention.closest(SELECTORS.editor);
    const current = () => enabled && !swapping && editor && mention.isConnected && caretFollows(mention, editor);
    if (!current()) {
      return;
    }
    const groups = await lookup(mention.getAttribute(SELECTORS.idAttr));
    if (groups.length === 0 || !current()) {
      return;
    }
    showPopup(mention, editor, groups);
  }

  function personMentionsIn(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return [];
    }
    const found = node.matches(SELECTORS.mention) ? [node] : Array.from(node.querySelectorAll(SELECTORS.mention));
    return found.filter((el) => USER_ID.test(el.getAttribute(SELECTORS.idAttr) ?? ''));
  }

  const offered = new WeakSet();

  new MutationObserver((mutations) => {
    if (open && !open.mention.isConnected) {
      closePopup(); // sent, deleted or the composer was replaced
    }
    if (!enabled || swapping) {
      return;
    }
    // Only changes made inside an editor count: a composer that appears with its content
    // already in place is a restored draft, not someone confirming a mention.
    const added = mutations
      .filter((mutation) => mutation.target.nodeType === Node.ELEMENT_NODE && mutation.target.closest(SELECTORS.editor))
      .flatMap((mutation) => Array.from(mutation.addedNodes).flatMap(personMentionsIn))
      .filter((mention) => !offered.has(mention));
    // One mention at a time is someone confirming it; several at once is pasted or restored text.
    if (added.length === 1) {
      offered.add(added[0]);
      offer(added[0]);
    }
  }).observe(document.body, { childList: true, subtree: true });
})();

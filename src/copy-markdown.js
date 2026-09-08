// Content script (isolated world): adds a "copy as Markdown" button to the hover toolbar of
// every message. Click copies the message body; Shift+click adds a source line (sender, time,
// channel, permalink) and wraps it in a quote.
//
// The clipboard receives two flavours at once: text/plain holds Markdown (for editors and
// GitHub), text/html holds simple HTML (so pasting back into Slack keeps the formatting).
//
// Everything that depends on Slack's DOM lives in SELECTORS.
(async () => {
  if (window.top !== window) {
    return;
  }

  const SELECTORS = {
    // One message in the pane or a thread.
    message: '[data-qa="message_container"]',
    // The hover toolbar inside a message; appears when the message is hovered.
    actionsGroup: '[data-qa="message-actions"]',
    // One button wrapper in that toolbar; our button gets the same wrapper.
    overflowItem: '.c-message_actions__overflow_item',
    // "More actions" button; our button is inserted before its wrapper.
    moreActions: '[data-qa="more_message_actions"]',
    // Rendered rich text of the message (one or more per message).
    richText: '.p-rich_text_block',
    // Sender name and timestamp link (href = permalink, data-ts = unix seconds).
    sender: '[data-qa="message_sender_name"]',
    timestamp: 'a.c-timestamp',
    // Channel name in the pane header.
    channelName: '[data-qa="channel_name"]',
    // Attachments below the body: forwarded messages carry the original text here.
    attachment: '.c-message_attachment',
    forwardedCard: '[data-qa="forwarded_message_card"]',
    cardByline: '[class^="byline"]', // author + date link
    cardContext: '[class^="context"]', // e.g. "all_自己紹介 内のスレッド"
    // Thread pane on the right and its header; the thread button goes before "more".
    threadPane: '[data-qa="threads_flexpane"]',
    threadHeader: '.p-flexpane_header',
    threadHeaderMore: '[data-qa="secondary-header-more"]',
    threadHeaderClose: '[data-qa="close_flexpane"]',
    // Scroll container of the thread's virtual list.
    threadScroller: '.c-scrollbar__hider',
    // Unix timestamp attribute on a message container (also on a.c-timestamp as data-ts).
    messageTsAttr: 'data-msg-ts',
  };

  const CLASS = {
    item: 'tabane-copy-item',
    button: 'tabane-copy-button',
    done: 'tabane-copy-button--done',
    failed: 'tabane-copy-button--failed',
    threadItem: 'tabane-copy-thread-item',
    threadButton: 'tabane-copy-thread-button',
    busy: 'tabane-copy-thread-button--busy',
    fallback: 'tabane-copy-fallback',
  };

  const THREAD_POLL_MS = 1500;
  // Slack's virtual list re-renders after a scroll event; this is how long that takes.
  const SCROLL_SETTLE_MS = 600;
  const MAX_SCROLL_STEPS = 300;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const url = (path) => chrome.runtime.getURL(path);
  const [{ treeToMarkdown, treeToHtml, formatSourceHeader, sourceLineNode }, { loadSettings, watchSettings }] = await Promise.all([
    import(url('src/lib/markdown.js')),
    import(url('src/lib/settings.js')),
  ]);

  let enabled = (await loadSettings()).copyMarkdown.enabled;
  watchSettings((settings) => {
    enabled = settings.copyMarkdown.enabled;
  });

  // ---- DOM -> plain tree (see src/lib/markdown.js) ----------------------------------------

  function toTree(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return { type: 'text', text: node.nodeValue };
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }
    const attrs = {};
    for (const { name, value } of node.attributes) {
      if (name === 'href' || name === 'alt' || name.startsWith('data-stringify')) {
        attrs[name] = value;
      }
    }
    if (attrs.href !== undefined) {
      attrs.href = node.href; // absolute
    }
    return {
      type: 'el',
      tag: node.tagName.toLowerCase(),
      attrs,
      classes: Array.from(node.classList),
      children: Array.from(node.childNodes, toTree).filter(Boolean),
    };
  }

  function formatTime(unixSeconds) {
    const date = new Date(Number.parseFloat(unixSeconds) * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  // Continuation messages (same sender within a few minutes) carry no sender element.
  function findSender(messageEl) {
    let el = messageEl;
    while (el) {
      const sender = el.querySelector?.(SELECTORS.sender);
      if (sender) {
        return sender.textContent.trim();
      }
      el = el.previousElementSibling ?? el.parentElement?.previousElementSibling ?? null;
      if (el && !el.querySelector?.(SELECTORS.message) && !el.matches?.(SELECTORS.message)) {
        el = el.querySelector?.(SELECTORS.message) ?? el;
      }
    }
    return '';
  }

  const element = (tag, attrs, children, classes = []) => ({ type: 'el', tag, attrs, classes, children });
  const richTextIn = (el) => Array.from(el.querySelectorAll(SELECTORS.richText));

  // True when the blocks contain no text outside links (a forwarded message's own body is
  // just a link to the original, which the attachment quote already carries).
  function isLinkOnly(blocks) {
    for (const block of blocks) {
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (walker.currentNode.nodeValue.trim() !== '' && !walker.currentNode.parentElement.closest('a')) {
          return false;
        }
      }
    }
    return true;
  }

  // An attachment becomes a quote: attribution line (author · date link · context) when it
  // is a forwarded message, then the attached rich text.
  function attachmentToQuote(attachmentEl) {
    const blocks = richTextIn(attachmentEl);
    const card = attachmentEl.querySelector(SELECTORS.forwardedCard);
    if (blocks.length === 0 && !card) {
      return null;
    }
    const children = [];
    if (card) {
      const dateLink = card.querySelector('a[href]');
      const date = dateLink?.textContent.trim() ?? '';
      const byline = card.querySelector(SELECTORS.cardByline)?.textContent.trim() ?? '';
      const author = date && byline.endsWith(date) ? byline.slice(0, -date.length).trim() : byline;
      const context = card.querySelector(SELECTORS.cardContext)?.textContent.trim() ?? '';
      if (author || date || context) {
        children.push(sourceLineNode({ sender: author, timestamp: date, channel: context, permalink: dateLink?.href ?? '' }));
      }
    }
    children.push(...blocks.flatMap((block) => toTree(block).children));
    return element('blockquote', { 'data-stringify-type': 'quote' }, children, ['tabane-attachment']);
  }

  function collect(messageEl) {
    const bodyBlocks = richTextIn(messageEl).filter((block) => !block.closest(SELECTORS.attachment));
    const quotes = Array.from(messageEl.querySelectorAll(SELECTORS.attachment), attachmentToQuote).filter(Boolean);
    const bodyChildren = quotes.length > 0 && isLinkOnly(bodyBlocks) ? [] : bodyBlocks.flatMap((block) => toTree(block).children);
    const root = { type: 'el', tag: 'div', attrs: {}, classes: [], children: [...bodyChildren, ...quotes] };
    const timestamp = messageEl.querySelector(SELECTORS.timestamp);
    const meta = {
      sender: findSender(messageEl),
      timestamp: timestamp?.dataset.ts ? formatTime(timestamp.dataset.ts) : '',
      permalink: timestamp?.href ?? '',
      channel: document.querySelector(SELECTORS.channelName)?.textContent.trim() ?? '',
    };
    return { root, meta };
  }

  // ---- clipboard --------------------------------------------------------------------------

  // Writes through a synthetic copy event. Unlike navigator.clipboard this does not need a
  // recent user gesture: the extension's clipboardWrite permission covers it, which matters
  // for the thread copy, whose scrolling can outlive the click's activation window.
  function writeViaCopyEvent(markdown, html) {
    let handled = false;
    const onCopy = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.clipboardData.setData('text/plain', markdown);
      event.clipboardData.setData('text/html', html);
      handled = true;
    };
    window.addEventListener('copy', onCopy, { capture: true });
    try {
      return document.execCommand('copy') && handled;
    } catch {
      return false;
    } finally {
      window.removeEventListener('copy', onCopy, { capture: true });
    }
  }

  // Returns true when the clipboard accepted the content.
  async function writeClipboard(markdown, html) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([markdown], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ]);
      return true;
    } catch {
      // Refused (no recent gesture, or rich writes unsupported): try the other routes.
    }
    if (writeViaCopyEvent(markdown, html)) {
      return true;
    }
    try {
      await navigator.clipboard.writeText(markdown);
      return true;
    } catch (error) {
      console.warn('[tabane] clipboard write failed:', error?.name, error?.message);
      return false;
    }
  }

  // Resolves to true on success. Always dispatches "tabane:copied" with the generated
  // content, so the conversion can be inspected even where the clipboard is unavailable.
  async function copyMessage(messageEl, withSource) {
    const { root, meta } = collect(messageEl);
    const header = withSource ? formatSourceHeader(meta) : undefined;
    const markdown = treeToMarkdown(root, { header });
    const html = treeToHtml(root, { header });
    const written = await writeClipboard(markdown, html);
    document.dispatchEvent(new CustomEvent('tabane:copied', { detail: { markdown, html, written } }));
    return written;
  }

  // ---- thread copy ------------------------------------------------------------------------

  // The thread pane is a virtual list: only the messages near the viewport exist in the DOM.
  // Walk the scroller from top to bottom, collecting each message once by timestamp, then
  // put the scroll position back. Slack only re-renders on an explicit scroll event.
  async function collectThread(pane) {
    const seen = new Map();
    const gather = () => {
      for (const messageEl of pane.querySelectorAll(SELECTORS.message)) {
        const ts =
          messageEl.getAttribute(SELECTORS.messageTsAttr) ??
          messageEl.querySelector(SELECTORS.timestamp)?.dataset.ts ??
          `unknown-${seen.size}`;
        if (!seen.has(ts)) {
          seen.set(ts, collect(messageEl));
        }
      }
    };

    gather();
    const scroller = pane.querySelector(SELECTORS.threadScroller);
    if (scroller) {
      const original = scroller.scrollTop;
      const scrollTo = async (top) => {
        scroller.scrollTop = top;
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
        await wait(SCROLL_SETTLE_MS);
        gather();
      };
      await scrollTo(0);
      for (let i = 0; i < MAX_SCROLL_STEPS; i += 1) {
        const before = scroller.scrollTop;
        await scrollTo(before + scroller.clientHeight * 0.9);
        if (scroller.scrollTop === before) {
          break;
        }
      }
      await scrollTo(original);
    }

    const entries = Array.from(seen.entries()).sort(([a], [b]) => Number.parseFloat(a) - Number.parseFloat(b));
    const children = entries.flatMap(([, { root, meta }], i) => [
      // The channel is the same for every reply; name it once, on the root message.
      sourceLineNode(i === 0 ? meta : { ...meta, channel: '' }),
      ...root.children,
    ]);
    return { type: 'el', tag: 'div', attrs: {}, classes: [], children, count: entries.length };
  }

  // Shown when the clipboard refuses the write (the user gesture has expired after a long
  // scroll): the Markdown in a textarea, already selected, for a manual Cmd/Ctrl+C.
  function showFallback(markdown) {
    document.querySelector(`.${CLASS.fallback}`)?.remove();
    const overlay = document.createElement('div');
    overlay.className = CLASS.fallback;
    const box = document.createElement('div');
    const note = document.createElement('p');
    note.textContent = 'クリップボードに書き込めなかったので、内容を選択した状態で表示しています。Cmd/Ctrl+C でコピーしてください。';
    const textarea = document.createElement('textarea');
    textarea.value = markdown;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '閉じる';
    close.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        overlay.remove();
      }
    });
    box.append(note, textarea, close);
    overlay.append(box);
    document.body.append(overlay);
    textarea.focus();
    textarea.select();
  }

  async function copyThread(pane) {
    const root = await collectThread(pane);
    const markdown = treeToMarkdown(root);
    const html = treeToHtml(root);
    const written = await writeClipboard(markdown, html);
    if (!written) {
      showFallback(markdown);
    }
    document.dispatchEvent(new CustomEvent('tabane:copied', { detail: { markdown, html, written, thread: true, count: root.count } }));
    return written;
  }

  // ---- toolbar button ---------------------------------------------------------------------

  const ICON =
    '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">' +
    '<rect x="2.25" y="4.25" width="15.5" height="11.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
    '<path fill="currentColor" d="M4.5 13V7h1.6l1.9 2.4L9.9 7h1.6v6H9.9V9.7L8 12.1 6.1 9.7V13z"/>' +
    '<path fill="currentColor" d="M13.4 7h1.6v3.3h1.4L14.2 13l-2.2-2.7h1.4z"/>' +
    '</svg>';

  function makeButton() {
    const item = document.createElement('div');
    item.className = `c-message_actions__overflow_item c-message_actions__overflow_item--button ${CLASS.item}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `c-button-unstyled c-icon_button c-icon_button--size_smedium c-message_actions__button ${CLASS.button}`;
    button.setAttribute('aria-label', 'Markdown でコピー（Shift: 引用元付き）');
    button.title = 'Markdown でコピー（Shift+クリックで引用元付き）';
    button.innerHTML = ICON;
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const messageEl = button.closest(SELECTORS.message);
      if (!messageEl) {
        return;
      }
      const written = await copyMessage(messageEl, event.shiftKey);
      const state = written ? CLASS.done : CLASS.failed;
      button.classList.add(state);
      setTimeout(() => button.classList.remove(state), 1200);
    });
    item.append(button);
    return item;
  }

  function inject(group) {
    if (!enabled || group.querySelector(`.${CLASS.item}`)) {
      return;
    }
    const more = group.querySelector(SELECTORS.moreActions)?.closest(SELECTORS.overflowItem) ?? null;
    group.insertBefore(makeButton(), more);
  }

  function makeThreadButton() {
    const wrapper = document.createElement('span');
    wrapper.className = CLASS.threadItem;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `c-button-unstyled c-icon_button ${CLASS.threadButton}`;
    button.setAttribute('aria-label', 'スレッド全体を Markdown でコピー');
    button.title = 'スレッド全体を Markdown でコピー（自動でスクロールして全件を集めます）';
    button.innerHTML = ICON;
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const pane = button.closest(SELECTORS.threadPane);
      if (!pane || button.classList.contains(CLASS.busy)) {
        return;
      }
      button.classList.add(CLASS.busy);
      let written = false;
      try {
        written = await copyThread(pane);
      } finally {
        button.classList.remove(CLASS.busy);
      }
      const state = written ? CLASS.done : CLASS.failed;
      button.classList.add(state);
      setTimeout(() => button.classList.remove(state), 1200);
    });
    wrapper.append(button);
    return wrapper;
  }

  // The thread pane is created when a thread opens; poll for it like the sidebar list.
  function checkThreadPane() {
    const pane = document.querySelector(SELECTORS.threadPane);
    const existing = pane?.querySelector(`.${CLASS.threadItem}`);
    if (!pane || !enabled) {
      existing?.remove();
      return;
    }
    if (existing) {
      return;
    }
    const header = pane.querySelector(SELECTORS.threadHeader);
    if (!header) {
      return;
    }
    const anchorButton = header.querySelector(SELECTORS.threadHeaderMore) ?? header.querySelector(SELECTORS.threadHeaderClose);
    const anchor = anchorButton?.parentElement?.tagName === 'SPAN' ? anchorButton.parentElement : anchorButton;
    if (!anchor) {
      return;
    }
    anchor.before(makeThreadButton());
  }

  checkThreadPane();
  setInterval(checkThreadPane, THREAD_POLL_MS);

  // The toolbar is rendered on hover, so inject shortly after the pointer enters a message.
  document.addEventListener(
    'mouseover',
    (event) => {
      const messageEl = event.target.closest?.(SELECTORS.message);
      if (!messageEl) {
        return;
      }
      const attempt = () => {
        const group = messageEl.querySelector(SELECTORS.actionsGroup);
        if (group) {
          inject(group);
        }
      };
      requestAnimationFrame(attempt);
      setTimeout(attempt, 150);
    },
    true,
  );
})();

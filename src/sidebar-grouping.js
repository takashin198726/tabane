// Content script (isolated world): reads channel names from the Slack sidebar, asks
// src/lib/grouping.js how to draw them, and rewrites the name elements accordingly.
// Clicking the glyph of a group's first row folds the group; folded keys are remembered per
// workspace in chrome.storage.local.
//
// Everything that depends on Slack's DOM lives in SELECTORS below. When Slack changes
// its markup, this is the only block that should need to change.
(async () => {
  if (window.top !== window) {
    return;
  }

  const SELECTORS = {
    // Container of the channel list. Re-created when switching workspaces.
    list: '.p-channel_sidebar__static_list',
    // One entry per sidebar row (channels, DMs, section headers, buttons). Slack positions
    // them absolutely with an inline `top`, so hidden rows leave a gap unless we shift.
    items: '[role="listitem"], [role="treeitem"]',
    // Element carrying the channel type attribute and the unread state.
    channel: '.p-channel_sidebar__channel',
    channelTypeAttr: 'data-qa-channel-sidebar-channel-type', // channel | private | im | mpim
    unreadClass: 'p-channel_sidebar__channel--unread',
    // Mention count badge inside a row.
    badge: '.p-channel_sidebar__badge',
    // Element whose text is the channel name.
    name: '.p-channel_sidebar__name',
    // Attribute Slack rewrites when a virtual-list row is reused for another channel.
    nameKeyAttr: 'data-qa',
  };

  const CLASS = {
    row: 'tabane-row',
    rowUnread: 'tabane-row--unread',
    label: 'tabane-label',
    hiddenLabel: 'tabane-label--hidden',
    glyph: 'tabane-glyph',
    foldGlyph: 'tabane-glyph--fold',
    leaf: 'tabane-leaf',
    count: 'tabane-count',
    badge: 'tabane-badge',
  };
  const HIDDEN_ATTR = 'data-tabane-hidden';
  const KEY_ATTR = 'data-tabane-key';
  const FOLD_STORAGE_KEY = 'folded'; // { [teamId]: [key, ...] }

  const DEBOUNCE_MS = 100;
  const POLL_MS = 1500;

  const url = (path) => chrome.runtime.getURL(path);
  const [{ groupChannels }, { loadSettings, watchSettings }] = await Promise.all([
    import(url('src/lib/grouping.js')),
    import(url('src/lib/settings.js')),
  ]);

  let settings = await loadSettings();

  // ---- folded state, per workspace --------------------------------------------------------

  const teamId = () => window.location.pathname.match(/\/client\/(T[A-Z0-9]+)/)?.[1] ?? 'default';

  let foldedByTeam = {};
  async function loadFolded() {
    const stored = await chrome.storage.local.get(FOLD_STORAGE_KEY);
    foldedByTeam = stored[FOLD_STORAGE_KEY] ?? {};
  }
  const foldedKeys = () => new Set(settings.grouping.folding ? (foldedByTeam[teamId()] ?? []) : []);

  async function toggleFolded(key) {
    const keys = foldedKeys();
    if (keys.has(key)) {
      keys.delete(key);
    } else {
      keys.add(key);
    }
    foldedByTeam[teamId()] = Array.from(keys);
    await chrome.storage.local.set({ [FOLD_STORAGE_KEY]: foldedByTeam });
    schedule();
  }

  // ---- reading the sidebar ----------------------------------------------------------------

  const hasOwnMarkup = (nameEl) => nameEl.querySelector(`.${CLASS.row}`) !== null;

  // The raw name is what Slack rendered. Once we replaced it with our spans, the
  // original lives in data-tabane-raw. If Slack overwrote our spans again, the text is
  // the new raw name.
  function readRawName(nameEl) {
    if (hasOwnMarkup(nameEl) && nameEl.dataset.tabaneRaw !== undefined) {
      return nameEl.dataset.tabaneRaw;
    }
    return nameEl.textContent.trim();
  }

  function collect(list) {
    return Array.from(list.querySelectorAll(SELECTORS.items), (item) => {
      const nameEl = item.querySelector(SELECTORS.name);
      const channelEl = item.querySelector(SELECTORS.channel);
      const type = channelEl?.getAttribute(SELECTORS.channelTypeAttr) ?? null;
      const unread = channelEl?.classList.contains(SELECTORS.unreadClass) ?? false;
      const mentions = Number.parseInt(item.querySelector(SELECTORS.badge)?.textContent ?? '', 10) || 0;
      return { item, nameEl, name: nameEl ? readRawName(nameEl) : '', type, unread, mentions };
    });
  }

  // ---- rendering --------------------------------------------------------------------------

  function span(className, text) {
    const el = document.createElement('span');
    el.className = className;
    el.textContent = text;
    return el;
  }

  function render(nameEl, row) {
    const signature = JSON.stringify(row);
    if (nameEl.dataset.tabaneSig === signature && hasOwnMarkup(nameEl)) {
      return;
    }

    const rowEl = document.createElement('span');
    rowEl.className = row.foldedUnread ? `${CLASS.row} ${CLASS.rowUnread}` : CLASS.row;
    for (const column of row.columns) {
      const glyph = span(CLASS.glyph, column.glyph);
      if (column.showLabel && settings.grouping.folding) {
        glyph.classList.add(CLASS.foldGlyph);
        glyph.setAttribute(KEY_ATTR, column.key);
        glyph.title = row.foldedAt ? `${column.key} を展開` : `${column.key} を折りたたむ`;
      }
      rowEl.append(span(column.showLabel ? CLASS.label : `${CLASS.label} ${CLASS.hiddenLabel}`, column.label), glyph);
    }
    if (row.foldedAt) {
      rowEl.append(span(CLASS.count, String(row.foldedCount)));
      if (row.foldedMentions > 0) {
        rowEl.append(span(CLASS.badge, String(row.foldedMentions)));
      }
    } else {
      rowEl.append(span(CLASS.leaf, row.leaf));
    }

    nameEl.dataset.tabaneRaw = row.name;
    nameEl.dataset.tabaneSig = signature;
    nameEl.replaceChildren(rowEl);
  }

  function restore(nameEl, name) {
    if (!hasOwnMarkup(nameEl)) {
      return;
    }
    delete nameEl.dataset.tabaneRaw;
    delete nameEl.dataset.tabaneSig;
    nameEl.textContent = name;
  }

  // Slack lays rows out absolutely (inline top/height). Hidden rows keep their slot, so the
  // rows below are shifted up by the height of the hidden rows above them. The container
  // keeps Slack's height: shrinking it would stop Slack from rendering the last rows.
  function reflow(entries) {
    const rows = entries
      .map(({ item }) => ({ item, top: Number.parseFloat(item.style.top) }))
      .filter(({ top }) => !Number.isNaN(top))
      .sort((a, b) => a.top - b.top);
    let shift = 0;
    for (const { item } of rows) {
      if (item.hasAttribute(HIDDEN_ATTR)) {
        shift += Number.parseFloat(item.style.height) || item.getBoundingClientRect().height || 0;
        continue;
      }
      const transform = shift > 0 ? `translateY(-${shift}px)` : '';
      if (item.style.transform !== transform) {
        item.style.transform = transform;
      }
    }
  }

  function apply(list) {
    const entries = collect(list);
    if (!settings.grouping.enabled) {
      for (const { item, nameEl, name } of entries) {
        if (nameEl) {
          restore(nameEl, name);
        }
        item.removeAttribute(HIDDEN_ATTR);
      }
      reflow(entries);
      return;
    }
    const rows = groupChannels(
      entries.map(({ name, type, unread, mentions }) => ({ name, type, unread, mentions })),
      { maxDepth: settings.grouping.maxDepth, folded: foldedKeys() },
    );
    rows.forEach((row, i) => {
      const { item, nameEl } = entries[i];
      item.toggleAttribute(HIDDEN_ATTR, row.hidden);
      if (!nameEl) {
        return;
      }
      if (row.grouped) {
        render(nameEl, row);
      } else {
        restore(nameEl, row.name);
      }
    });
    reflow(entries);
  }

  // ---- observing --------------------------------------------------------------------------

  // Mutations caused by render() itself: every added node is one of our rows.
  const isOwnMutation = (mutation) =>
    mutation.type === 'childList' &&
    mutation.addedNodes.length > 0 &&
    Array.from(mutation.addedNodes).every(
      (node) => node.nodeType === Node.ELEMENT_NODE && node.classList.contains(CLASS.row),
    );

  let currentList = null;
  let timer = null;

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (currentList) {
        apply(currentList);
      }
    }, DEBOUNCE_MS);
  }

  const observer = new MutationObserver((mutations) => {
    if (mutations.every(isOwnMutation)) {
      return;
    }
    schedule();
  });

  // Clicks on a fold glyph toggle the group and must not open the channel underneath.
  function onFoldEvent(event) {
    const glyph = event.target.closest?.(`.${CLASS.foldGlyph}`);
    if (!glyph) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.type === 'click') {
      toggleFolded(glyph.getAttribute(KEY_ATTR));
    }
  }

  function attach(list) {
    currentList = list;
    observer.observe(list, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [SELECTORS.nameKeyAttr],
    });
    for (const type of ['mousedown', 'mouseup', 'click']) {
      list.addEventListener(type, onFoldEvent, true);
    }
    schedule();
  }

  // The list container appears late and is replaced on workspace switch, so poll for
  // identity changes instead of observing the whole document.
  function checkList() {
    const list = document.querySelector(SELECTORS.list);
    if (list === currentList) {
      return;
    }
    observer.disconnect();
    currentList = null;
    if (list) {
      attach(list);
    }
  }

  await loadFolded();
  checkList();
  setInterval(checkList, POLL_MS);

  watchSettings((next) => {
    settings = next;
    schedule();
  });
})();

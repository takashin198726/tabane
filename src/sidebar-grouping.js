// Content script (isolated world): reads channel names from the Slack sidebar, asks
// src/grouping.js how to draw them, and rewrites the name elements accordingly.
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
    // One entry per sidebar row (channels, DMs, section headers, buttons).
    items: '[role="listitem"], [role="treeitem"]',
    // Element carrying the channel type attribute.
    channel: '.p-channel_sidebar__channel',
    channelTypeAttr: 'data-qa-channel-sidebar-channel-type', // channel | private | im | mpim
    // Element whose text is the channel name.
    name: '.p-channel_sidebar__name',
    // Attribute Slack rewrites when a virtual-list row is reused for another channel.
    nameKeyAttr: 'data-qa',
  };

  const CLASS = {
    row: 'tabane-row',
    label: 'tabane-label',
    hiddenLabel: 'tabane-label--hidden',
    glyph: 'tabane-glyph',
    leaf: 'tabane-leaf',
  };

  const MAX_DEPTH = 3;
  const DEBOUNCE_MS = 100;
  const POLL_MS = 1500;

  const { groupChannels } = await import(chrome.runtime.getURL('src/grouping.js'));

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
      const type = item.querySelector(SELECTORS.channel)?.getAttribute(SELECTORS.channelTypeAttr) ?? null;
      return { nameEl, name: nameEl ? readRawName(nameEl) : '', type };
    });
  }

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
    rowEl.className = CLASS.row;
    for (const column of row.columns) {
      rowEl.append(
        span(column.showLabel ? CLASS.label : `${CLASS.label} ${CLASS.hiddenLabel}`, column.label),
        span(CLASS.glyph, column.glyph),
      );
    }
    rowEl.append(span(CLASS.leaf, row.leaf));

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

  function apply(list) {
    const entries = collect(list);
    const rows = groupChannels(
      entries.map(({ name, type }) => ({ name, type })),
      { maxDepth: MAX_DEPTH },
    );
    rows.forEach((row, i) => {
      const { nameEl } = entries[i];
      if (!nameEl) {
        return;
      }
      if (row.grouped) {
        render(nameEl, row);
      } else {
        restore(nameEl, row.name);
      }
    });
  }

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

  function attach(list) {
    currentList = list;
    observer.observe(list, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [SELECTORS.nameKeyAttr],
    });
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

  checkList();
  setInterval(checkList, POLL_MS);
})();

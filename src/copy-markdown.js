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
  };

  const CLASS = {
    item: 'tabane-copy-item',
    button: 'tabane-copy-button',
    done: 'tabane-copy-button--done',
    failed: 'tabane-copy-button--failed',
  };

  const url = (path) => chrome.runtime.getURL(path);
  const [{ treeToMarkdown, treeToHtml, formatSourceHeader }, { loadSettings, watchSettings }] = await Promise.all([
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

  const textNode = (text) => ({ type: 'text', text });
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
      const parts = [];
      if (author) {
        parts.push(element('b', { 'data-stringify-type': 'bold' }, [textNode(author)]));
      }
      if (dateLink) {
        parts.push(element('a', { href: dateLink.href }, [textNode(date)]));
      }
      if (context) {
        parts.push(textNode(context));
      }
      if (parts.length > 0) {
        const line = parts.flatMap((part, i) => (i === 0 ? [part] : [textNode(' · '), part]));
        children.push(element('div', {}, line, ['p-rich_text_section']));
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
      // Older Chrome, or the rich write was refused: fall back to plain Markdown.
    }
    try {
      await navigator.clipboard.writeText(markdown);
      return true;
    } catch (error) {
      console.warn('[tabane] clipboard write failed:', error);
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

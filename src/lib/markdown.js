// Converts a Slack message (as a plain tree, see below) into GitHub-flavoured Markdown and
// into simple HTML. Pure; no DOM access, so it is unit-tested with `node --test`.
//
// Tree nodes, built from the DOM by src/copy-markdown.js:
//   { type: 'text', text }
//   { type: 'el', tag, attrs: { 'data-stringify-type': ..., href: ... }, classes: [], children: [] }
//
// Slack annotates its rendered rich text with data-stringify-* attributes (bold, italic,
// strike, code, pre, quote, emoji, mention, paragraph-break, unordered-list, ordered-list,
// replace). Those are the primary signal; tag names are the fallback.

const stringifyType = (node) => node.attrs?.['data-stringify-type'] ?? null;
const hasClass = (node, name) => node.classes?.includes(name) ?? false;

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Slack shows some links as a "slug": just the domain, or the URL itself. Those read best
// as the bare URL.
function isUrlSlug(text, href) {
  const shown = text.trim();
  if (shown === '') {
    return true;
  }
  const bare = (value) => value.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return bare(href).startsWith(bare(shown));
}

// ---- inline content --------------------------------------------------------------------

function inlineMarkdown(nodes) {
  return nodes.map(inlineNodeMarkdown).join('');
}

function inlineNodeMarkdown(node) {
  if (node.type === 'text') {
    return node.text;
  }
  const inner = () => inlineMarkdown(node.children ?? []);
  switch (stringifyType(node)) {
    case 'bold':
      return `**${inner()}**`;
    case 'italic':
      return `_${inner()}_`;
    case 'strike':
      return `~~${inner()}~~`;
    case 'code':
      return `\`${inner()}\``;
    case 'paragraph-break':
      return '\n\n';
    case 'emoji':
      return node.attrs['data-stringify-emoji'] ?? '';
    case 'mention':
      return node.attrs['data-stringify-label'] ?? inner();
    case 'replace':
      return node.attrs['data-stringify-text'] ?? inner();
    default:
      break;
  }
  switch (node.tag) {
    case 'br':
      return '\n';
    case 'img':
      return node.attrs.alt ?? '';
    case 'a': {
      const href = node.attrs.href ?? node.attrs['data-stringify-link'];
      const text = inner();
      if (!href) {
        return text;
      }
      return isUrlSlug(text, href) ? href : `[${text}](${href})`;
    }
    default:
      return inner();
  }
}

function inlineHtml(nodes) {
  return nodes.map(inlineNodeHtml).join('');
}

function inlineNodeHtml(node) {
  if (node.type === 'text') {
    return escapeHtml(node.text);
  }
  const inner = () => inlineHtml(node.children ?? []);
  switch (stringifyType(node)) {
    case 'bold':
      return `<b>${inner()}</b>`;
    case 'italic':
      return `<i>${inner()}</i>`;
    case 'strike':
      return `<s>${inner()}</s>`;
    case 'code':
      return `<code>${inner()}</code>`;
    case 'paragraph-break':
      return '<br><br>';
    case 'emoji':
      return escapeHtml(node.attrs['data-stringify-emoji'] ?? '');
    case 'mention':
      return escapeHtml(node.attrs['data-stringify-label'] ?? '') || inner();
    case 'replace':
      return escapeHtml(node.attrs['data-stringify-text'] ?? '') || inner();
    default:
      break;
  }
  switch (node.tag) {
    case 'br':
      return '<br>';
    case 'img':
      return escapeHtml(node.attrs.alt ?? '');
    case 'a': {
      const href = node.attrs.href ?? node.attrs['data-stringify-link'];
      if (!href) {
        return inner();
      }
      const text = isUrlSlug(textContent(node), href) ? escapeHtml(href) : inner();
      return `<a href="${escapeHtml(href)}">${text}</a>`;
    }
    default:
      return inner();
  }
}

// ---- blocks ----------------------------------------------------------------------------

function isBlock(node) {
  if (node.type !== 'el') {
    return false;
  }
  const type = stringifyType(node);
  return (
    type === 'pre' || type === 'quote' || type === 'unordered-list' || type === 'ordered-list' ||
    node.tag === 'pre' || node.tag === 'blockquote' || node.tag === 'ul' || node.tag === 'ol' ||
    hasClass(node, 'p-rich_text_section')
  );
}

function textContent(node) {
  if (node.type === 'text') {
    return node.text;
  }
  if (node.tag === 'br') {
    return '\n';
  }
  return (node.children ?? []).map(textContent).join('');
}

function listItems(node) {
  return (node.children ?? [])
    .filter((child) => child.type === 'el' && child.tag === 'li')
    .map((li) => ({ indent: Number.parseInt(li.attrs?.['data-stringify-indent'] ?? '0', 10) || 0, children: li.children ?? [] }));
}

// Splits the root's children into blocks: paragraphs, pre, quote, list.
function toBlocks(root) {
  const blocks = [];
  let paragraph = [];
  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'p', children: paragraph });
      paragraph = [];
    }
  };
  for (const node of root.children ?? []) {
    if (!isBlock(node)) {
      paragraph.push(node);
      continue;
    }
    flush();
    const type = stringifyType(node);
    if (type === 'pre' || node.tag === 'pre') {
      blocks.push({ kind: 'pre', text: textContent(node) });
    } else if (type === 'quote' || node.tag === 'blockquote') {
      blocks.push({ kind: 'quote', children: node.children ?? [] });
    } else if (type === 'ordered-list' || node.tag === 'ol') {
      blocks.push({ kind: 'list', ordered: true, items: listItems(node) });
    } else if (type === 'unordered-list' || node.tag === 'ul') {
      blocks.push({ kind: 'list', ordered: false, items: listItems(node) });
    } else {
      blocks.push({ kind: 'p', children: node.children ?? [] });
    }
  }
  flush();
  return blocks;
}

function blockMarkdown(block) {
  switch (block.kind) {
    case 'pre':
      return `\`\`\`\n${block.text.replace(/\n$/, '')}\n\`\`\``;
    case 'quote':
      return quoteLines(blocksMarkdown({ children: block.children }));
    case 'list': {
      const counters = [];
      return block.items
        .map(({ indent, children }) => {
          counters.length = indent + 1;
          counters[indent] = (counters[indent] ?? 0) + 1;
          const marker = block.ordered ? `${counters[indent]}.` : '-';
          return `${'  '.repeat(indent)}${marker} ${inlineMarkdown(children).trim()}`;
        })
        .join('\n');
    }
    default:
      return inlineMarkdown(block.children).trim();
  }
}

function blockHtml(block) {
  switch (block.kind) {
    case 'pre':
      return `<pre>${escapeHtml(block.text.replace(/\n$/, ''))}</pre>`;
    case 'quote':
      return `<blockquote>${blocksHtml({ children: block.children })}</blockquote>`;
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul';
      return `<${tag}>${block.items.map(({ children }) => `<li>${inlineHtml(children)}</li>`).join('')}</${tag}>`;
    }
    default: {
      const html = inlineHtml(block.children).trim();
      return html === '' ? '' : `<p>${html}</p>`;
    }
  }
}

function blocksMarkdown(root) {
  return toBlocks(root).map(blockMarkdown).filter((text) => text !== '').join('\n\n');
}

function blocksHtml(root) {
  return toBlocks(root).map(blockHtml).join('');
}

function quoteLines(text) {
  return text
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');
}

// ---- public API ------------------------------------------------------------------------

// header: optional { markdown, html } from formatSourceHeader(); when given, the whole
// message is emitted as a quote with the header on top.
export function treeToMarkdown(root, { header } = {}) {
  const body = blocksMarkdown(root);
  if (!header) {
    return body;
  }
  return quoteLines(`${header.markdown}\n\n${body}`);
}

export function treeToHtml(root, { header } = {}) {
  const body = blocksHtml(root);
  if (!header) {
    return body;
  }
  return `<blockquote><p>${header.html}</p>${body}</blockquote>`;
}

export function formatSourceHeader({ sender, timestamp, channel, permalink }) {
  const time = permalink ? { md: `[${timestamp}](${permalink})`, html: `<a href="${escapeHtml(permalink)}">${escapeHtml(timestamp)}</a>` } : { md: timestamp, html: escapeHtml(timestamp) };
  const mdParts = [`**${sender}**`, time.md, channel].filter(Boolean);
  const htmlParts = [`<b>${escapeHtml(sender)}</b>`, time.html, channel ? escapeHtml(channel) : ''].filter(Boolean);
  return { markdown: mdParts.join(' · '), html: htmlParts.join(' · ') };
}

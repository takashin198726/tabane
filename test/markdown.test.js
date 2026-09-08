import { test } from 'node:test';
import assert from 'node:assert/strict';
import { treeToMarkdown, treeToHtml, formatSourceHeader } from '../src/lib/markdown.js';

// Tree nodes mirror what src/copy-markdown.js builds from the DOM:
//   { type: 'text', text }  |  { type: 'el', tag, attrs: {}, classes: [], children: [] }
const t = (text) => ({ type: 'text', text });
const el = (tag, attrs = {}, children = [], classes = []) => ({ type: 'el', tag, attrs, classes, children });
const s = (type, extra = {}) => ({ 'data-stringify-type': type, ...extra });
const section = (...children) => el('div', {}, children, ['p-rich_text_section']);
const block = (...children) => el('div', {}, children, ['p-rich_text_block']);

test('inline formatting maps to GFM', () => {
  const tree = block(section(
    el('b', s('bold'), [t('bold')]), t(' '),
    el('i', s('italic'), [t('italic')]), t(' '),
    el('s', s('strike'), [t('gone')]), t(' '),
    el('code', s('code'), [t('x = 1')]),
  ));
  assert.equal(treeToMarkdown(tree), '**bold** _italic_ ~~gone~~ `x = 1`');
});

test('line breaks and paragraph breaks', () => {
  const tree = block(section(t('one'), el('br'), t('two'), el('span', s('paragraph-break'), [], ['c-mrkdwn__br']), t('three')));
  assert.equal(treeToMarkdown(tree), 'one\ntwo\n\nthree');
});

test('emoji, mentions and replaced timestamps become plain text', () => {
  const tree = block(section(
    el('span', {}, [el('img', s('emoji', { 'data-stringify-emoji': ':trophy:' }))], ['c-emoji']),
    t(' '),
    el('a', s('mention', { 'data-stringify-label': '@William', href: 'https://x.slack.com/team/U1' }), [t('@William')], ['c-link', 'c-member_slug']),
    t(' '),
    el('span', s('replace', { 'data-stringify-text': '2026-09-08' }), [t('Sep 8th')]),
  ));
  assert.equal(treeToMarkdown(tree), ':trophy: @William 2026-09-08');
});

test('links keep their URL; a bare URL stays bare', () => {
  const tree = block(section(
    el('a', { href: 'https://example.com/doc', 'data-stringify-link': 'https://example.com/doc' }, [t('the doc')], ['c-link']),
    t(' '),
    el('a', { href: 'https://example.com/', 'data-stringify-link': 'https://example.com/' }, [t('https://example.com/')], ['c-link']),
  ));
  assert.equal(treeToMarkdown(tree), '[the doc](https://example.com/doc) https://example.com/');
});

test('code blocks become fenced blocks on their own lines', () => {
  const tree = block(section(t('before')), el('pre', s('pre'), [t('retry: 3\ntimeout: 30')], ['c-mrkdwn__pre']), section(t('after')));
  assert.equal(treeToMarkdown(tree), 'before\n\n```\nretry: 3\ntimeout: 30\n```\n\nafter');
});

test('quotes prefix every line', () => {
  const tree = block(el('blockquote', s('quote'), [t('first'), el('br'), t('second')], ['c-mrkdwn__quote']));
  assert.equal(treeToMarkdown(tree), '> first\n> second');
});

test('bullet and numbered lists, with Slack-style flat items carrying an indent', () => {
  const tree = block(
    el('ul', s('unordered-list'), [
      el('li', { 'data-stringify-indent': '0' }, [t('a')]),
      el('li', { 'data-stringify-indent': '1' }, [t('a-1')]),
      el('li', { 'data-stringify-indent': '0' }, [t('b')]),
    ], ['p-rich_text_list']),
    el('ol', s('ordered-list'), [
      el('li', { 'data-stringify-indent': '0' }, [t('one')]),
      el('li', { 'data-stringify-indent': '0' }, [t('two')]),
    ], ['p-rich_text_list']),
  );
  assert.equal(treeToMarkdown(tree), '- a\n  - a-1\n- b\n\n1. one\n2. two');
});

test('unknown wrappers are transparent and surrounding whitespace is trimmed', () => {
  const tree = block(section(el('span', { 'data-sk': 'tooltip_parent' }, [t('  hello  ')]), el('div', {}, [t('world')])));
  assert.equal(treeToMarkdown(tree), 'hello  world');
});

test('HTML output mirrors the structure for pasting back into Slack', () => {
  const tree = block(
    section(el('b', s('bold'), [t('bold')]), t(' & '), el('a', { href: 'https://example.com/?a=1&b=2' }, [t('link')], ['c-link']), el('br'), el('code', s('code'), [t('<x>')])),
    el('pre', s('pre'), [t('a < b')], ['c-mrkdwn__pre']),
    el('blockquote', s('quote'), [t('q')], ['c-mrkdwn__quote']),
    el('ul', s('unordered-list'), [el('li', { 'data-stringify-indent': '0' }, [t('item')])], ['p-rich_text_list']),
  );
  assert.equal(
    treeToHtml(tree),
    '<p><b>bold</b> &amp; <a href="https://example.com/?a=1&amp;b=2">link</a><br><code>&lt;x&gt;</code></p><pre>a &lt; b</pre><blockquote>q</blockquote><ul><li>item</li></ul>',
  );
});

test('the source header quotes sender, time, channel and permalink', () => {
  const header = formatSourceHeader({ sender: 'takashin', timestamp: '2026-09-08 15:04', channel: '#all-dev', permalink: 'https://x.slack.com/archives/C1/p1' });
  assert.equal(header.markdown, '**takashin** · [2026-09-08 15:04](https://x.slack.com/archives/C1/p1) · #all-dev');
  assert.equal(header.html, '<b>takashin</b> · <a href="https://x.slack.com/archives/C1/p1">2026-09-08 15:04</a> · #all-dev');
});

test('quoting a message prefixes every markdown line and wraps the html', () => {
  const tree = block(section(t('a'), el('br'), t('b')));
  const header = formatSourceHeader({ sender: 's', timestamp: 't', channel: '#c', permalink: 'https://p' });
  assert.equal(treeToMarkdown(tree, { header }), '> **s** · [t](https://p) · #c\n>\n> a\n> b');
  assert.equal(treeToHtml(tree, { header }), '<blockquote><p><b>s</b> · <a href="https://p">t</a> · #c</p><p>a<br>b</p></blockquote>');
});

test('whitespace between blocks (DOM indentation) produces no empty paragraphs', () => {
  const tree = block(t('\n  '), section(t('a')), t('\n  '), el('pre', s('pre'), [t('x')], ['c-mrkdwn__pre']), t('\n'));
  assert.equal(treeToMarkdown(tree), 'a\n\n```\nx\n```');
  assert.equal(treeToHtml(tree), '<p>a</p><pre>x</pre>');
});

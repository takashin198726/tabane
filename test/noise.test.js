import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOISE_RULES, classifyNoise } from '../src/lib/noise.js';

test('every fixed rule has an id, a label, a selector and a default', () => {
  for (const rule of NOISE_RULES) {
    assert.match(rule.id, /^[a-z0-9-]+$/);
    assert.ok(rule.label.length > 0);
    assert.ok(rule.selector.length > 0);
    assert.equal(typeof rule.enabledByDefault, 'boolean');
  }
  assert.equal(new Set(NOISE_RULES.map((r) => r.id)).size, NOISE_RULES.length);
});

test('a banner-like element with upsell wording is noise', () => {
  assert.equal(classifyNoise({ className: 'banner__kYRUH', text: 'トライアル期間はあと 3 日です' }), 'upsell');
  assert.equal(classifyNoise({ className: 'p-client__banners', text: '通知を受け取りたい場合には、Slack に許可を与えてください。' }), 'hint');
  assert.equal(classifyNoise({ className: 'p-ia__workspace_banner', text: 'Upgrade to Pro to keep your message history' }), 'upsell');
});

test('a strongly named upsell container is noise regardless of wording', () => {
  assert.equal(classifyNoise({ className: 'p-upsell_banner', text: '' }), 'upsell');
  assert.equal(classifyNoise({ className: 'p-nux_tooltip', text: 'Here is a tip' }), 'upsell');
});

test('upsell wording without a banner-like container is not noise (messages must survive)', () => {
  assert.equal(classifyNoise({ className: 'p-rich_text_section', text: 'we should upgrade to Pro this quarter' }), null);
  assert.equal(classifyNoise({ className: '', text: 'トライアルの結果をまとめました' }), null);
});

test('a banner-like container without upsell wording is not noise (unread banner stays)', () => {
  assert.equal(classifyNoise({ className: 'p-message_pane__unread_banner p-message_pane__banner', text: '20+ new messages' }), null);
});

test('the starred drop-zone hint is noise', () => {
  assert.equal(classifyNoise({ className: 'banner__kYRUH', text: '重要なアイテムをここにドラッグ＆ドロップします' }), 'hint');
  assert.equal(classifyNoise({ className: 'banner__kYRUH', text: 'Drag and drop important stuff here' }), 'hint');
});

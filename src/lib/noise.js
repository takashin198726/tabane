// Noise removal: what to hide and how to recognise it. Pure; no DOM access.
//
// Two layers:
//   1. NOISE_RULES   fixed selectors for known UI parts, each toggled in the options page
//   2. classifyNoise heuristic for banners Slack adds later (trials, upsells, hints), so
//                    that new promotions are caught without a code change

export const NOISE_RULES = Object.freeze([
  { id: 'rail-activity', label: 'レールの「アクティビティ」タブ', selector: '[data-qa="tab_rail_activity_button"]', enabledByDefault: false },
  { id: 'rail-files', label: 'レールの「ファイル」タブ', selector: '[data-qa="tab_rail_files_button"]', enabledByDefault: false },
  { id: 'rail-later', label: 'レールの「後で」タブ', selector: '[data-qa="tab_rail_later_button"]', enabledByDefault: false },
  { id: 'rail-agents', label: 'レールの「エージェントとツール」タブ', selector: '.p-tab_rail__button:has(.p-tab_rail__button__label--agents-tools)', enabledByDefault: false },
  { id: 'shortcut-hints', label: 'レールと切替列のショートカット番号', selector: '.p-tab_rail__shortcut_hint, .p-team_sidebar__shortcut_hint', enabledByDefault: false },
  { id: 'action-later', label: 'ホバーツールバーの「後で保存」', selector: '[data-qa="message-actions"] .c-message_actions__overflow_item:has([data-qa="later"])', enabledByDefault: false },
  { id: 'action-forward', label: 'ホバーツールバーの「転送」', selector: '[data-qa="message-actions"] .c-message_actions__overflow_item:has([data-qa="share_message"])', enabledByDefault: false },
  { id: 'unread-banner', label: '「○件の新着メッセージ」バナー', selector: '.p-message_pane__unread_banner', enabledByDefault: false },
]);

// Containers that are noise whatever they say.
const STRONG_CLASS = /upsell|trial|promo|nux|nudge|marketing|premium/i;
// Containers that are noise only when they also carry noise wording.
const CONTAINER_CLASS = /banner|upsell|trial|promo|nux|nudge|toast|callout|announcement|notice/i;
const UPSELL_TEXT =
  /トライアル|アップグレード|有料プラン|プランを|無料で試|試してみ|Slack AI|Agentforce|Pro プラン|Business\+|upgrade|free trial|try .{0,20}free|premium/i;
const HINT_TEXT = /通知を受け取りたい|通知を有効|ドラッグ＆ドロップします|Drag and drop important|enable notifications|turn on notifications/i;

// Returns 'upsell' | 'hint' | null for an element described by its class list and text.
export function classifyNoise({ className, text }) {
  const cls = className ?? '';
  if (STRONG_CLASS.test(cls)) {
    return 'upsell';
  }
  if (!CONTAINER_CLASS.test(cls)) {
    return null;
  }
  const body = text ?? '';
  if (UPSELL_TEXT.test(body)) {
    return 'upsell';
  }
  if (HINT_TEXT.test(body)) {
    return 'hint';
  }
  return null;
}

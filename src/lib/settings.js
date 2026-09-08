// Settings: defaults, merging with what is stored, and the chrome.storage plumbing.
// mergeSettings is pure and unit-tested; the load/save/watch helpers wrap chrome.storage.
import { NOISE_RULES } from './noise.js';

export const DEFAULTS = Object.freeze({
  grouping: Object.freeze({ enabled: true, maxDepth: 3 }),
  copyMarkdown: Object.freeze({ enabled: true }),
  workspaceSwitcher: Object.freeze({ column: true }),
  noise: Object.freeze({
    enabled: true,
    heuristic: true,
    rules: Object.freeze(Object.fromEntries(NOISE_RULES.map((rule) => [rule.id, rule.enabledByDefault]))),
  }),
});

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function mergeInto(defaults, stored) {
  const result = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = isPlainObject(stored) ? stored[key] : undefined;
    if (isPlainObject(fallback)) {
      result[key] = mergeInto(fallback, value);
    } else {
      result[key] = typeof value === typeof fallback ? value : fallback;
    }
  }
  return result;
}

// Deep-merges stored values over DEFAULTS. Unknown keys are dropped and values of the wrong
// type fall back to the default. Always returns a fresh, mutable object.
export function mergeSettings(stored) {
  return mergeInto(DEFAULTS, stored);
}

export async function loadSettings() {
  const stored = await chrome.storage.sync.get(null);
  return mergeSettings(stored);
}

export async function saveSettings(settings) {
  await chrome.storage.sync.set(mergeSettings(settings));
}

// Calls back with the merged settings whenever they change.
export function watchSettings(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      loadSettings().then(callback);
    }
  });
}

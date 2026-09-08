import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, mergeSettings } from '../src/lib/settings.js';

test('defaults are returned when nothing is stored', () => {
  assert.deepEqual(mergeSettings(undefined), DEFAULTS);
  assert.deepEqual(mergeSettings({}), DEFAULTS);
});

test('stored values override defaults, key by key, nested', () => {
  const merged = mergeSettings({ grouping: { enabled: false }, noise: { rules: { 'rail-activity': true } } });
  assert.equal(merged.grouping.enabled, false);
  assert.equal(merged.grouping.maxDepth, DEFAULTS.grouping.maxDepth);
  assert.equal(merged.noise.rules['rail-activity'], true);
  assert.equal(merged.noise.enabled, DEFAULTS.noise.enabled);
});

test('unknown keys are dropped and wrong types fall back to defaults', () => {
  const merged = mergeSettings({ bogus: 1, grouping: { enabled: 'yes', maxDepth: 'many' }, noise: 'off' });
  assert.equal('bogus' in merged, false);
  assert.equal(merged.grouping.enabled, DEFAULTS.grouping.enabled);
  assert.equal(merged.grouping.maxDepth, DEFAULTS.grouping.maxDepth);
  assert.deepEqual(merged.noise, DEFAULTS.noise);
});

test('merging never mutates the defaults', () => {
  const before = JSON.stringify(DEFAULTS);
  const merged = mergeSettings({ grouping: { enabled: false } });
  merged.grouping.maxDepth = 99;
  assert.equal(JSON.stringify(DEFAULTS), before);
});

test('the workspace column is on by default', () => {
  assert.equal(DEFAULTS.workspaceSwitcher.column, true);
  assert.equal(mergeSettings({ workspaceSwitcher: { column: false } }).workspaceSwitcher.column, false);
});

test('group folding is on by default', () => {
  assert.equal(DEFAULTS.grouping.folding, true);
});

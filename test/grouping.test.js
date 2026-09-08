import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupChannels } from '../src/lib/grouping.js';

const ch = (name, type = 'channel') => ({ name, type });
const col = (label, showLabel, glyph, key = label) => ({ label, showLabel, glyph, key });

test('a single channel stays ungrouped', () => {
  const rows = groupChannels([ch('general')]);
  assert.deepEqual(rows, [{ name: 'general', grouped: false, hidden: false }]);
});

test('channels sharing a prefix form a flat group: first ┬, middle ├, last └', () => {
  const rows = groupChannels([ch('general'), ch('proj-aaa'), ch('proj-bbb'), ch('proj-ccc'), ch('random')]);
  assert.deepEqual(rows, [
    { name: 'general', grouped: false, hidden: false },
    { name: 'proj-aaa', grouped: true, hidden: false, columns: [col('proj', true, '┬')], leaf: 'aaa' },
    { name: 'proj-bbb', grouped: true, hidden: false, columns: [col('proj', false, '├')], leaf: 'bbb' },
    { name: 'proj-ccc', grouped: true, hidden: false, columns: [col('proj', false, '└')], leaf: 'ccc' },
    { name: 'random', grouped: false, hidden: false },
  ]);
});

test('a prefixed channel with no neighbour sharing the prefix stays ungrouped', () => {
  const rows = groupChannels([ch('a-1'), ch('b-1'), ch('c-1'), ch('a-2')]);
  assert.ok(rows.every((r) => r.grouped === false));
});

test('direct messages never group even when names share a prefix', () => {
  const rows = groupChannels([ch('john-doe', 'im'), ch('john-smith', 'im'), ch('john-and-jane', 'mpim')]);
  assert.ok(rows.every((r) => r.grouped === false));
});

test('empty names (section headers, buttons) never group with each other', () => {
  const rows = groupChannels([ch(''), ch(''), ch('', null)]);
  assert.ok(rows.every((r) => r.grouped === false));
});

test('an empty name separates two groups that share a prefix', () => {
  const rows = groupChannels([ch('proj-a'), ch(''), ch('proj-b')]);
  assert.ok(rows.every((r) => r.grouped === false));
});

test('nested groups: inner group ends before outer group', () => {
  const rows = groupChannels([ch('proj-dev-backend'), ch('proj-dev-frontend'), ch('proj-ops')]);
  assert.deepEqual(rows, [
    { name: 'proj-dev-backend', grouped: true, hidden: false, columns: [col('proj', true, '┬'), col('dev', true, '┬', 'proj-dev')], leaf: 'backend' },
    { name: 'proj-dev-frontend', grouped: true, hidden: false, columns: [col('proj', false, '│'), col('dev', false, '└', 'proj-dev')], leaf: 'frontend' },
    { name: 'proj-ops', grouped: true, hidden: false, columns: [col('proj', false, '└')], leaf: 'ops' },
  ]);
});

test('nested groups: two inner groups inside one outer group', () => {
  const rows = groupChannels([ch('proj-dev-a'), ch('proj-dev-b'), ch('proj-ops-a'), ch('proj-ops-b')]);
  assert.deepEqual(rows.map((r) => r.columns), [
    [col('proj', true, '┬'), col('dev', true, '┬', 'proj-dev')],
    [col('proj', false, '│'), col('dev', false, '└', 'proj-dev')],
    [col('proj', false, '├'), col('ops', true, '┬', 'proj-ops')],
    [col('proj', false, ' '), col('ops', false, '└', 'proj-ops')],
  ]);
  assert.deepEqual(rows.map((r) => r.leaf), ['a', 'b', 'a', 'b']);
});

test('a channel whose whole name is the prefix becomes the root of the group with leaf "/"', () => {
  const rows = groupChannels([ch('proj'), ch('proj-dev'), ch('proj-ops')]);
  assert.deepEqual(rows, [
    { name: 'proj', grouped: true, hidden: false, columns: [col('proj', true, '┬')], leaf: '/' },
    { name: 'proj-dev', grouped: true, hidden: false, columns: [col('proj', false, '├')], leaf: 'dev' },
    { name: 'proj-ops', grouped: true, hidden: false, columns: [col('proj', false, '└')], leaf: 'ops' },
  ]);
});

test('maxDepth caps nesting and the leaf keeps the original separators', () => {
  const rows = groupChannels([ch('proj-dev-backend'), ch('proj-dev-frontend')], { maxDepth: 1 });
  assert.deepEqual(rows, [
    { name: 'proj-dev-backend', grouped: true, hidden: false, columns: [col('proj', true, '┬')], leaf: 'dev-backend' },
    { name: 'proj-dev-frontend', grouped: true, hidden: false, columns: [col('proj', false, '└')], leaf: 'dev-frontend' },
  ]);
});

test('default maxDepth is 3', () => {
  const rows = groupChannels([ch('a-b-c-d-x'), ch('a-b-c-d-y')]);
  assert.equal(rows[0].columns.length, 3);
  assert.equal(rows[0].leaf, 'd-x');
});

test('underscore and hyphen both act as separators and are preserved in the leaf', () => {
  const rows = groupChannels([ch('proj_dev-x_1'), ch('proj_dev-y_2')], { maxDepth: 2 });
  assert.deepEqual(rows[0].columns, [col('proj', true, '┬'), col('dev', true, '┬', 'proj_dev')]);
  assert.equal(rows[0].leaf, 'x_1');
  assert.equal(rows[1].leaf, 'y_2');
});

test('output length and order always match the input', () => {
  const input = [ch('z'), ch('a-1'), ch('a-2'), ch('m', 'im'), ch('')];
  const rows = groupChannels(input);
  assert.deepEqual(rows.map((r) => r.name), input.map((i) => i.name));
});

// ---- folding ----------------------------------------------------------------------------

test('every column carries the prefix key its group is folded by', () => {
  const rows = groupChannels([ch('proj-dev-a'), ch('proj-dev-b'), ch('proj-ops')]);
  assert.deepEqual(rows[0].columns.map((c) => c.key), ['proj', 'proj-dev']);
  assert.deepEqual(rows[2].columns.map((c) => c.key), ['proj']);
  assert.ok(rows.every((r) => r.hidden === false));
});

test('folding a group keeps its first row, marked with the group size, and hides the rest', () => {
  const rows = groupChannels([ch('general'), ch('proj-dev-a'), ch('proj-dev-b'), ch('proj-ops'), ch('random')], { folded: new Set(['proj']) });
  assert.deepEqual(rows[1], {
    name: 'proj-dev-a', grouped: true, hidden: false, foldedAt: 1, foldedCount: 3, foldedUnread: false, foldedMentions: 0,
    columns: [{ label: 'proj', showLabel: true, glyph: '▸', key: 'proj' }], leaf: 'dev-a',
  });
  assert.equal(rows[2].hidden, true);
  assert.equal(rows[3].hidden, true);
  assert.equal(rows[0].hidden, false);
  assert.equal(rows[4].hidden, false);
});

test('folding a nested group only hides that subgroup', () => {
  const rows = groupChannels([ch('proj-dev-a'), ch('proj-dev-b'), ch('proj-ops')], { folded: new Set(['proj-dev']) });
  assert.equal(rows[0].foldedAt, 2);
  assert.equal(rows[0].foldedCount, 2);
  assert.deepEqual(rows[0].columns.map((c) => c.glyph), ['┬', '▸']);
  assert.equal(rows[1].hidden, true);
  assert.equal(rows[2].hidden, false);
  assert.deepEqual(rows[2].columns.map((c) => c.glyph), ['└']);
});

test('a folded outer group wins over an open inner group', () => {
  const rows = groupChannels([ch('proj-dev-a'), ch('proj-dev-b'), ch('proj-ops')], { folded: new Set(['proj', 'proj-dev']) });
  assert.equal(rows[0].foldedAt, 1);
  assert.equal(rows[0].columns.length, 1);
  assert.equal(rows[1].hidden, true);
  assert.equal(rows[2].hidden, true);
});

test('a folded row aggregates unread state and mention counts of the rows it hides', () => {
  const rows = groupChannels(
    [ch('proj-a'), { name: 'proj-b', type: 'channel', unread: true, mentions: 2 }, { name: 'proj-c', type: 'channel', unread: true, mentions: 1 }],
    { folded: new Set(['proj']) },
  );
  assert.equal(rows[0].foldedUnread, true);
  assert.equal(rows[0].foldedMentions, 3);
});

test('folded keys that match no group change nothing', () => {
  const open = groupChannels([ch('proj-a'), ch('proj-b')]);
  const withKey = groupChannels([ch('proj-a'), ch('proj-b')], { folded: new Set(['other']) });
  assert.deepEqual(withKey, open);
});

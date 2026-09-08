import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupChannels } from '../src/lib/grouping.js';

const ch = (name, type = 'channel') => ({ name, type });
const col = (label, showLabel, glyph) => ({ label, showLabel, glyph });

test('a single channel stays ungrouped', () => {
  const rows = groupChannels([ch('general')]);
  assert.deepEqual(rows, [{ name: 'general', grouped: false }]);
});

test('channels sharing a prefix form a flat group: first ┬, middle ├, last └', () => {
  const rows = groupChannels([ch('general'), ch('proj-aaa'), ch('proj-bbb'), ch('proj-ccc'), ch('random')]);
  assert.deepEqual(rows, [
    { name: 'general', grouped: false },
    { name: 'proj-aaa', grouped: true, columns: [col('proj', true, '┬')], leaf: 'aaa' },
    { name: 'proj-bbb', grouped: true, columns: [col('proj', false, '├')], leaf: 'bbb' },
    { name: 'proj-ccc', grouped: true, columns: [col('proj', false, '└')], leaf: 'ccc' },
    { name: 'random', grouped: false },
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
    { name: 'proj-dev-backend', grouped: true, columns: [col('proj', true, '┬'), col('dev', true, '┬')], leaf: 'backend' },
    { name: 'proj-dev-frontend', grouped: true, columns: [col('proj', false, '│'), col('dev', false, '└')], leaf: 'frontend' },
    { name: 'proj-ops', grouped: true, columns: [col('proj', false, '└')], leaf: 'ops' },
  ]);
});

test('nested groups: two inner groups inside one outer group', () => {
  const rows = groupChannels([ch('proj-dev-a'), ch('proj-dev-b'), ch('proj-ops-a'), ch('proj-ops-b')]);
  assert.deepEqual(rows.map((r) => r.columns), [
    [col('proj', true, '┬'), col('dev', true, '┬')],
    [col('proj', false, '│'), col('dev', false, '└')],
    [col('proj', false, '├'), col('ops', true, '┬')],
    [col('proj', false, ' '), col('ops', false, '└')],
  ]);
  assert.deepEqual(rows.map((r) => r.leaf), ['a', 'b', 'a', 'b']);
});

test('a channel whose whole name is the prefix becomes the root of the group with leaf "/"', () => {
  const rows = groupChannels([ch('proj'), ch('proj-dev'), ch('proj-ops')]);
  assert.deepEqual(rows, [
    { name: 'proj', grouped: true, columns: [col('proj', true, '┬')], leaf: '/' },
    { name: 'proj-dev', grouped: true, columns: [col('proj', false, '├')], leaf: 'dev' },
    { name: 'proj-ops', grouped: true, columns: [col('proj', false, '└')], leaf: 'ops' },
  ]);
});

test('maxDepth caps nesting and the leaf keeps the original separators', () => {
  const rows = groupChannels([ch('proj-dev-backend'), ch('proj-dev-frontend')], { maxDepth: 1 });
  assert.deepEqual(rows, [
    { name: 'proj-dev-backend', grouped: true, columns: [col('proj', true, '┬')], leaf: 'dev-backend' },
    { name: 'proj-dev-frontend', grouped: true, columns: [col('proj', false, '└')], leaf: 'dev-frontend' },
  ]);
});

test('default maxDepth is 3', () => {
  const rows = groupChannels([ch('a-b-c-d-x'), ch('a-b-c-d-y')]);
  assert.equal(rows[0].columns.length, 3);
  assert.equal(rows[0].leaf, 'd-x');
});

test('underscore and hyphen both act as separators and are preserved in the leaf', () => {
  const rows = groupChannels([ch('proj_dev-x_1'), ch('proj_dev-y_2')], { maxDepth: 2 });
  assert.deepEqual(rows[0].columns, [col('proj', true, '┬'), col('dev', true, '┬')]);
  assert.equal(rows[0].leaf, 'x_1');
  assert.equal(rows[1].leaf, 'y_2');
});

test('output length and order always match the input', () => {
  const input = [ch('z'), ch('a-1'), ch('a-2'), ch('m', 'im'), ch('')];
  const rows = groupChannels(input);
  assert.deepEqual(rows.map((r) => r.name), input.map((i) => i.name));
});

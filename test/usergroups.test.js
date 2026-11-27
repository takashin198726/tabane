import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REFRESH_AFTER_MS,
  RETRY_AFTER_MS,
  describeError,
  findTeam,
  groupsForUser,
  normalizeUsergroups,
  pickOptionIndex,
  shouldRefresh,
  teamIdFromPath,
  tokenProblem,
} from '../src/lib/usergroups.js';

// Shaped like a usergroups.list response with include_users=true.
const RESPONSE = {
  ok: true,
  usergroups: [
    { id: 'S1', team_id: 'T1', name: 'Engineering', handle: 'eng', date_delete: 0, users: ['U1', 'U2', 'U3', 'U4'], user_count: '4' },
    { id: 'S2', team_id: 'T1', name: 'Backend', handle: 'dev-backend', date_delete: 0, users: ['U1', 'U2'], user_count: 2 },
    { id: 'S3', team_id: 'T1', name: 'Old team', handle: 'old', date_delete: 1446670362, users: ['U1'], user_count: 1 },
    { id: 'S4', team_id: 'T1', name: 'No handle', date_delete: 0, users: ['U1'] },
    { id: 'S5', team_id: 'T1', name: 'Admins', handle: 'admins', date_delete: 0, users: ['U1', 'U9'], user_count: 2 },
  ],
};

test('normalizeUsergroups keeps id, handle, name and members, and drops deleted or handle-less groups', () => {
  const groups = normalizeUsergroups(RESPONSE);
  assert.deepEqual(groups.map((g) => g.id), ['S1', 'S2', 'S5']);
  assert.deepEqual(groups[1], { id: 'S2', handle: 'dev-backend', name: 'Backend', users: ['U1', 'U2'], userCount: 2 });
});

test('normalizeUsergroups counts members from the list, falling back to user_count without one', () => {
  const [counted, fallback, empty] = normalizeUsergroups({
    usergroups: [
      { id: 'S1', handle: 'a', users: ['U1', 'U2'], user_count: '99' },
      { id: 'S2', handle: 'b', user_count: '7' },
      { id: 'S3', handle: 'c' },
    ],
  });
  assert.equal(counted.userCount, 2);
  assert.equal(fallback.userCount, 7);
  assert.deepEqual(fallback.users, []);
  assert.equal(empty.userCount, 0);
});

test('normalizeUsergroups tolerates a missing or malformed response', () => {
  assert.deepEqual(normalizeUsergroups(undefined), []);
  assert.deepEqual(normalizeUsergroups({ ok: false, error: 'missing_scope' }), []);
  assert.deepEqual(normalizeUsergroups({ usergroups: [null, 'x', { id: 1, handle: 'a' }] }), []);
});

test('groupsForUser returns the groups of one person, smallest first, without member lists', () => {
  const groups = normalizeUsergroups(RESPONSE);
  assert.deepEqual(groupsForUser(groups, 'U1'), [
    { id: 'S5', handle: 'admins', name: 'Admins', userCount: 2 },
    { id: 'S2', handle: 'dev-backend', name: 'Backend', userCount: 2 },
    { id: 'S1', handle: 'eng', name: 'Engineering', userCount: 4 },
  ]);
  assert.deepEqual(groupsForUser(groups, 'U4').map((g) => g.handle), ['eng']);
  assert.deepEqual(groupsForUser(groups, 'U404'), []);
  assert.deepEqual(groupsForUser(groups, ''), []);
  assert.deepEqual(groupsForUser(undefined, 'U1'), []);
});

test('teamIdFromPath reads a workspace or Enterprise Grid id from the client URL', () => {
  assert.equal(teamIdFromPath('/client/T0123ABC/C0456DEF'), 'T0123ABC');
  assert.equal(teamIdFromPath('/client/E0123ABC/C0456DEF/thread/C1-1.2'), 'E0123ABC');
  assert.equal(teamIdFromPath('/ssb/redirect'), null);
  assert.equal(teamIdFromPath(undefined), null);
});

test('findTeam matches the workspace id first, then the Enterprise Grid org id', () => {
  const teams = { T1: { teamName: 'one', enterpriseId: null }, T2: { teamName: 'two', enterpriseId: 'E9' } };
  assert.equal(findTeam(teams, 'T1').teamName, 'one');
  assert.equal(findTeam(teams, 'E9').teamName, 'two');
  assert.equal(findTeam(teams, 'T404'), null);
  assert.equal(findTeam(teams, null), null);
  assert.equal(findTeam(undefined, 'T1'), null);
});

test('shouldRefresh waits for the list to age and backs off after a failed attempt', () => {
  const now = 1_800_000_000_000;
  assert.equal(shouldRefresh({ fetchedAt: now - 1000, attemptedAt: now - 1000 }, now), false);
  const old = now - REFRESH_AFTER_MS - 1;
  assert.equal(shouldRefresh({ fetchedAt: old, attemptedAt: old }, now), true);
  assert.equal(shouldRefresh({ fetchedAt: old, attemptedAt: now - RETRY_AFTER_MS + 1000 }, now), false);
  assert.equal(shouldRefresh({ fetchedAt: old, attemptedAt: now - RETRY_AFTER_MS - 1 }, now), true);
  assert.equal(shouldRefresh(null, now), false);
});

test('tokenProblem accepts app tokens and refuses browser session tokens', () => {
  assert.equal(tokenProblem('xoxb-123-456-abcDEF'), null);
  assert.equal(tokenProblem('  xoxp-123-456-789-abcdef  '), null);
  assert.equal(tokenProblem(''), 'token_empty');
  assert.equal(tokenProblem(undefined), 'token_empty');
  assert.equal(tokenProblem('xoxc-123-456'), 'token_session');
  assert.equal(tokenProblem('xoxd-abc%2Fdef'), 'token_session');
  assert.equal(tokenProblem('xoxe.xoxp-1-abc'), 'token_rotating');
  assert.equal(tokenProblem('hello'), 'token_format');
  assert.equal(tokenProblem('xoxb-has space'), 'token_format');
});

test('describeError has a message for every token problem and falls back to the raw code', () => {
  for (const code of ['token_empty', 'token_session', 'token_rotating', 'token_format', 'missing_scope', 'invalid_auth', 'ratelimited']) {
    assert.ok(describeError(code).length > 0);
    assert.equal(describeError(code).includes(code), false);
  }
  assert.match(describeError('missing_scope'), /usergroups:read/);
  assert.match(describeError('some_new_error'), /some_new_error/);
});

test('pickOptionIndex prefers the row with an element reading exactly the handle', () => {
  const options = [
    { texts: ['@devDevelopers', '@dev', 'Developers'], full: '@devDevelopers' },
    { texts: ['@dev-backendBackend', '@dev-backend', 'Backend'], full: '@dev-backendBackend' },
  ];
  assert.equal(pickOptionIndex(options, 'dev'), 0);
  assert.equal(pickOptionIndex(options, 'dev-backend'), 1);
  assert.equal(pickOptionIndex(options, 'DEV-Backend'), 1);
});

test('pickOptionIndex accepts a loose match only when a single row mentions the handle', () => {
  const merged = [{ texts: ['@dev-backendBackend'], full: '@dev-backendBackend' }, { texts: ['@opsOps'], full: '@opsOps' }];
  assert.equal(pickOptionIndex(merged, 'dev-backend'), 0);
  const ambiguous = [{ texts: ['@devDevelopers'], full: '@devDevelopers' }, { texts: ['@dev-backendBackend'], full: '@dev-backendBackend' }];
  assert.equal(pickOptionIndex(ambiguous, 'dev'), -1);
  assert.equal(pickOptionIndex(merged, 'missing'), -1);
  assert.equal(pickOptionIndex([], 'dev'), -1);
  assert.equal(pickOptionIndex(merged, ''), -1);
});

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { REFRESH_AFTER_MS } from '../src/lib/usergroups.js';
import { addToken, listTeams, lookupGroups, refreshTeam, removeTeam } from '../src/lib/usergroups-store.js';

const TOKEN = 'xoxb-111-222-abcDEF';
let local;
let calls;
let replies;

// In-memory chrome.storage.local and a scripted fetch that records every request.
beforeEach(() => {
  local = {};
  calls = [];
  replies = {
    'auth.test': { ok: true, team: 'Acme', team_id: 'T1', user_id: 'U0' },
    'usergroups.list': {
      ok: true,
      usergroups: [
        { id: 'S1', handle: 'eng', name: 'Engineering', date_delete: 0, users: ['U1', 'U2', 'U3'] },
        { id: 'S2', handle: 'dev-backend', name: 'Backend', date_delete: 0, users: ['U1'] },
      ],
    },
  };
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => (key in local ? { [key]: structuredClone(local[key]) } : {}),
        set: async (values) => Object.assign(local, structuredClone(values)),
      },
    },
  };
  globalThis.fetch = async (url, init) => {
    const method = new URL(url).pathname.split('/').pop();
    calls.push({ url: String(url), init, method });
    const reply = replies[method];
    if (reply instanceof Error) {
      throw reply;
    }
    return { status: reply.status ?? 200, json: async () => reply };
  };
});

const stored = () => local.mentionGroupTeams;

test('addToken finds the workspace, stores its groups and answers lookups', async () => {
  assert.equal(await addToken(`  ${TOKEN}  `), 'T1');
  assert.equal(stored().T1.token, TOKEN);
  assert.equal(stored().T1.teamName, 'Acme');
  assert.deepEqual((await lookupGroups('T1', 'U1')).groups.map((g) => g.handle), ['dev-backend', 'eng']);
  assert.deepEqual((await lookupGroups('T1', 'U3')).groups.map((g) => g.handle), ['eng']);
  assert.deepEqual((await lookupGroups('T1', 'U404')).groups, []);
  assert.deepEqual(await lookupGroups('T404', 'U1'), { groups: [], staleTeamId: null });
});

test('the token travels only in the Authorization header, to slack.com, without cookies', async () => {
  await addToken(TOKEN);
  assert.deepEqual(calls.map((c) => c.method), ['auth.test', 'usergroups.list']);
  for (const call of calls) {
    assert.ok(call.url.startsWith('https://slack.com/api/'));
    assert.equal(call.url.includes(TOKEN), false);
    assert.equal(String(call.init.body ?? '').includes(TOKEN), false);
    assert.equal(call.init.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(call.init.credentials, 'omit');
  }
  assert.equal(new URL(calls[1].url).searchParams.get('include_users'), 'true');
});

test('listTeams describes registered workspaces without exposing the token', async () => {
  await addToken(TOKEN);
  const teams = await listTeams();
  assert.equal(teams.length, 1);
  assert.deepEqual({ ...teams[0], fetchedAt: null }, { teamId: 'T1', teamName: 'Acme', groupCount: 2, fetchedAt: null, lastError: null });
  assert.equal(JSON.stringify(teams).includes(TOKEN), false);
});

test('a session token or a malformed token is refused before any request is made', async () => {
  await assert.rejects(addToken('xoxc-123-456'), { code: 'token_session' });
  await assert.rejects(addToken('nope'), { code: 'token_format' });
  assert.equal(calls.length, 0);
  assert.equal(stored(), undefined);
});

test('Slack API errors surface as codes and nothing is stored', async () => {
  replies['usergroups.list'] = { ok: false, error: 'missing_scope' };
  await assert.rejects(addToken(TOKEN), { code: 'missing_scope' });
  assert.equal(stored(), undefined);

  replies['auth.test'] = new TypeError('failed to fetch');
  await assert.rejects(addToken(TOKEN), { code: 'network_error' });

  replies['auth.test'] = { status: 429, ok: false };
  await assert.rejects(addToken(TOKEN), { code: 'ratelimited' });
});

test('refreshTeam replaces the groups; on failure it keeps them and records the error', async () => {
  await addToken(TOKEN);
  replies['usergroups.list'] = { ok: true, usergroups: [{ id: 'S9', handle: 'new', name: 'New', date_delete: 0, users: ['U1'] }] };
  await refreshTeam('T1');
  assert.deepEqual((await lookupGroups('T1', 'U1')).groups.map((g) => g.handle), ['new']);

  replies['usergroups.list'] = { ok: false, error: 'token_revoked' };
  await assert.rejects(refreshTeam('T1'), { code: 'token_revoked' });
  assert.deepEqual((await lookupGroups('T1', 'U1')).groups.map((g) => g.handle), ['new']);
  assert.equal((await listTeams())[0].lastError, 'token_revoked');

  replies['usergroups.list'] = { ok: true, usergroups: [] };
  await refreshTeam('T1');
  assert.equal((await listTeams())[0].lastError, null);
});

test('refreshTeam refuses a token that now answers for another workspace', async () => {
  await addToken(TOKEN);
  replies['auth.test'] = { ok: true, team: 'Other', team_id: 'T2' };
  await assert.rejects(refreshTeam('T1'), { code: 'team_missing' });
  assert.deepEqual(Object.keys(stored()), ['T1']);
  assert.equal(stored().T1.teamName, 'Acme');
});

test('lookupGroups reports a stale workspace once its list is old', async () => {
  await addToken(TOKEN);
  assert.equal((await lookupGroups('T1', 'U1')).staleTeamId, null);
  assert.equal((await lookupGroups('T1', 'U1', Date.now() + REFRESH_AFTER_MS + 1000)).staleTeamId, 'T1');
});

test('an Enterprise Grid org id in the URL resolves to the registered workspace', async () => {
  replies['auth.test'] = { ok: true, team: 'Acme', team_id: 'T1', enterprise_id: 'E7' };
  await addToken(TOKEN);
  const result = await lookupGroups('E7', 'U1', Date.now() + REFRESH_AFTER_MS + 1000);
  assert.deepEqual(result.groups.map((g) => g.handle), ['dev-backend', 'eng']);
  assert.equal(result.staleTeamId, 'T1');
});

test('removeTeam deletes the token and the groups', async () => {
  await addToken(TOKEN);
  await removeTeam('T1');
  assert.deepEqual(stored(), {});
  assert.deepEqual(await listTeams(), []);
  assert.deepEqual((await lookupGroups('T1', 'U1')).groups, []);
});

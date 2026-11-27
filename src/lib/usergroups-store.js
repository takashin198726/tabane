// User group data per workspace: fetching it from the Slack API and keeping it in
// chrome.storage.local. Used by the options page (register / refresh / remove a token) and by
// the background service worker (lookups and refresh of stale data).
//
// This is the only module that talks to the Slack API. It calls two methods, read-only:
//   auth.test        which workspace the token belongs to
//   usergroups.list  the groups and their members (needs the usergroups:read scope)
// The token is one the user created for their own Slack app and pasted into the options page.
// It is kept in chrome.storage.local (this browser only, never synced) and is sent to
// https://slack.com/api/ only, in the Authorization header.
import { findTeam, groupsForUser, normalizeUsergroups, shouldRefresh, tokenProblem } from './usergroups.js';

const TEAMS_KEY = 'mentionGroupTeams'; // { [teamId]: { token, teamName, enterpriseId, groups, fetchedAt, attemptedAt, lastError } }
const API_BASE = 'https://slack.com/api/';

export class SlackApiError extends Error {
  constructor(code) {
    super(code);
    this.name = 'SlackApiError';
    this.code = code;
  }
}

async function callSlack(method, token, { post = false, params = {} } = {}) {
  const url = new URL(method, API_BASE);
  const init = {
    method: post ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}` },
    // Never attach the browser's slack.com cookies; the app token is the only credential.
    credentials: 'omit',
    cache: 'no-store',
  };
  if (post) {
    init.body = new URLSearchParams(params);
  } else {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  let response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new SlackApiError('network_error');
  }
  if (response.status === 429) {
    throw new SlackApiError('ratelimited');
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new SlackApiError('bad_response');
  }
  if (data?.ok !== true) {
    throw new SlackApiError(typeof data?.error === 'string' ? data.error : 'bad_response');
  }
  return data;
}

async function fetchTeam(token) {
  const auth = await callSlack('auth.test', token, { post: true });
  if (typeof auth.team_id !== 'string') {
    throw new SlackApiError('team_missing');
  }
  const list = await callSlack('usergroups.list', token, { params: { include_users: 'true' } });
  return {
    teamId: auth.team_id,
    teamName: typeof auth.team === 'string' ? auth.team : auth.team_id,
    enterpriseId: typeof auth.enterprise_id === 'string' ? auth.enterprise_id : null,
    groups: normalizeUsergroups(list),
  };
}

async function readTeams() {
  const stored = await chrome.storage.local.get(TEAMS_KEY);
  const teams = stored[TEAMS_KEY];
  return teams !== null && typeof teams === 'object' && !Array.isArray(teams) ? teams : {};
}

async function writeTeams(teams) {
  await chrome.storage.local.set({ [TEAMS_KEY]: teams });
}

// Registers a token: finds its workspace, fetches the groups and stores both.
// Registering another token for the same workspace replaces the old one.
export async function addToken(rawToken) {
  const problem = tokenProblem(rawToken);
  if (problem) {
    throw new SlackApiError(problem);
  }
  const token = rawToken.trim();
  const { teamId, ...team } = await fetchTeam(token);
  const now = Date.now();
  const teams = await readTeams();
  teams[teamId] = { token, ...team, fetchedAt: now, attemptedAt: now, lastError: null };
  await writeTeams(teams);
  return teamId;
}

// Fetches a registered workspace again. On failure the previous groups are kept, the error
// code is recorded for the options page, and the error is rethrown.
export async function refreshTeam(teamId) {
  const before = (await readTeams())[teamId];
  if (!before) {
    return;
  }
  let patch;
  let failure = null;
  try {
    const { teamId: fetchedId, ...team } = await fetchTeam(before.token);
    if (fetchedId !== teamId) {
      throw new SlackApiError('team_missing');
    }
    patch = { ...team, fetchedAt: Date.now(), lastError: null };
  } catch (error) {
    failure = error;
    patch = { lastError: error instanceof SlackApiError ? error.code : 'bad_response' };
  }
  // Re-read so that a token removed or replaced while the request was in flight stays that way.
  const teams = await readTeams();
  if (teams[teamId]?.token === before.token) {
    teams[teamId] = { ...teams[teamId], ...patch, attemptedAt: Date.now() };
    await writeTeams(teams);
  }
  if (failure) {
    throw failure;
  }
}

export async function removeTeam(teamId) {
  const teams = await readTeams();
  delete teams[teamId];
  await writeTeams(teams);
}

// What the options page shows. Tokens never leave this module.
export async function listTeams() {
  const teams = await readTeams();
  return Object.entries(teams)
    .map(([teamId, team]) => ({
      teamId,
      teamName: team.teamName ?? teamId,
      groupCount: Array.isArray(team.groups) ? team.groups.length : 0,
      fetchedAt: team.fetchedAt ?? null,
      lastError: team.lastError ?? null,
    }))
    .sort((a, b) => a.teamName.localeCompare(b.teamName));
}

// Groups `userId` belongs to in the workspace shown at `teamId` (T… or, on Enterprise Grid,
// E…), plus the registered workspace to refresh when its data has gone stale.
export async function lookupGroups(teamId, userId, now = Date.now()) {
  const teams = await readTeams();
  const team = findTeam(teams, teamId);
  if (!team) {
    return { groups: [], staleTeamId: null };
  }
  const storedId = Object.keys(teams).find((key) => teams[key] === team) ?? null;
  return {
    groups: groupsForUser(Array.isArray(team.groups) ? team.groups : [], userId),
    staleTeamId: shouldRefresh(team, now) ? storedId : null,
  };
}

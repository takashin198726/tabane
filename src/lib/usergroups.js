// User groups (the "@handle" group mentions): shaping what Slack's usergroups.list returns,
// finding the groups a person belongs to, and the small decisions around them.
// Pure; no DOM, no network, no chrome.* access.

// A fetched list is served for this long before the background refreshes it.
export const REFRESH_AFTER_MS = 6 * 60 * 60 * 1000;
// After a failed refresh, wait this long before trying again.
export const RETRY_AFTER_MS = 15 * 60 * 1000;

// usergroups.list (include_users=true) response -> [{ id, handle, name, users, userCount }].
// Deleted groups and entries without an id or a handle are dropped.
export function normalizeUsergroups(response) {
  const list = Array.isArray(response?.usergroups) ? response.usergroups : [];
  const groups = [];
  for (const entry of list) {
    if (typeof entry?.id !== 'string' || typeof entry.handle !== 'string' || entry.handle === '') {
      continue;
    }
    if (Number(entry.date_delete) > 0) {
      continue;
    }
    const users = Array.isArray(entry.users) ? entry.users.filter((id) => typeof id === 'string') : [];
    const counted = Number(entry.user_count);
    groups.push({
      id: entry.id,
      handle: entry.handle,
      name: typeof entry.name === 'string' ? entry.name : '',
      users,
      userCount: Array.isArray(entry.users) ? users.length : Number.isFinite(counted) ? counted : 0,
    });
  }
  return groups;
}

// The groups `userId` belongs to, smallest first (the most specific group is the likeliest
// replacement), then by handle. Member lists are left out: callers only need what to show.
export function groupsForUser(groups, userId) {
  if (typeof userId !== 'string' || userId === '') {
    return [];
  }
  return (groups ?? [])
    .filter((group) => group.users.includes(userId))
    .map(({ id, handle, name, userCount }) => ({ id, handle, name, userCount }))
    .sort((a, b) => a.userCount - b.userCount || a.handle.localeCompare(b.handle));
}

// Workspace (T…) or Enterprise Grid org (E…) id from an app.slack.com path.
export function teamIdFromPath(pathname) {
  return /\/client\/([TE][A-Z0-9]+)/.exec(pathname ?? '')?.[1] ?? null;
}

// Stored teams are keyed by workspace id. On Enterprise Grid the URL carries the org id
// instead, so fall back to the first team registered for that org.
export function findTeam(teams, id) {
  if (!id || !teams) {
    return null;
  }
  return teams[id] ?? Object.values(teams).find((team) => team.enterpriseId === id) ?? null;
}

// True when a team's list is old enough to refresh and the last attempt is not too recent.
export function shouldRefresh(team, now) {
  if (!team) {
    return false;
  }
  const fetched = team.fetchedAt ?? 0;
  const attempted = team.attemptedAt ?? 0;
  return now - fetched > REFRESH_AFTER_MS && now - attempted > RETRY_AFTER_MS;
}

// Only tokens of a Slack app the user created are accepted. Browser session tokens (xoxc-,
// and the xoxd- cookie) are refused on purpose: tabane never reuses the signed-in session.
// Returns an error code (see describeError) or null when the token looks usable.
export function tokenProblem(token) {
  const value = typeof token === 'string' ? token.trim() : '';
  if (value === '') {
    return 'token_empty';
  }
  if (/^xox[cd]-/.test(value)) {
    return 'token_session';
  }
  if (/^xoxe[.-]/.test(value)) {
    return 'token_rotating';
  }
  if (!/^xox[bp]-[A-Za-z0-9-]+$/.test(value)) {
    return 'token_format';
  }
  return null;
}

const ERROR_TEXT = {
  token_empty: 'トークンを入力してください。',
  token_session: 'ブラウザのセッショントークン（xoxc- / xoxd-）は使えません。Slack アプリのトークン（xoxb- / xoxp-）を入力してください。',
  token_rotating: 'トークンローテーションが有効なアプリのトークン（xoxe…）には対応していません。',
  token_format: 'トークンの形式が違います。xoxb- または xoxp- で始まるトークンを入力してください。',
  invalid_auth: 'トークンが無効です。',
  not_authed: 'トークンが無効です。',
  token_revoked: 'トークンが取り消されています。',
  token_expired: 'トークンの有効期限が切れています。',
  account_inactive: 'トークンの持ち主のアカウントが無効です。',
  missing_scope: 'トークンに usergroups:read スコープがありません。',
  no_permission: 'このトークンにはユーザーグループを読む権限がありません。',
  plan_upgrade_required: 'このワークスペースのプランではユーザーグループを使えません。',
  ratelimited: 'Slack API のレート制限に達しました。しばらくしてからやり直してください。',
  network_error: 'Slack に接続できませんでした。',
  bad_response: 'Slack から想定外の応答が返りました。',
  team_missing: 'ワークスペースを特定できませんでした。',
};

// Japanese message for an error code from tokenProblem or the Slack API.
export function describeError(code) {
  return ERROR_TEXT[code] ?? `Slack API エラー: ${code}`;
}

// Picks Slack's own autocomplete row for `handle`. Each option is described by the texts
// found in it: { texts: [text of every element inside the row], full: whole row text }.
// A row with an element reading exactly "@handle" (or "handle") wins; failing that, the row
// is accepted only when it is the single one mentioning the handle. Returns an index or -1.
export function pickOptionIndex(options, handle) {
  const wanted = String(handle ?? '').toLowerCase();
  if (wanted === '') {
    return -1;
  }
  const clean = (text) => String(text ?? '').trim().replace(/^@/, '').toLowerCase();
  const exact = options.findIndex((option) => (option.texts ?? []).some((text) => clean(text) === wanted));
  if (exact !== -1) {
    return exact;
  }
  const containing = options
    .map((option, index) => ({ index, hit: String(option.full ?? '').toLowerCase().includes(wanted) }))
    .filter((entry) => entry.hit);
  return containing.length === 1 ? containing[0].index : -1;
}

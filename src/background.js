// Background service worker. Its one job: answer "which user groups is this person in?" for
// the mention-groups content script, and refresh a workspace's list when it has gone stale.
// Content scripts cannot call the Slack API themselves (their requests count as the page's),
// so the lookup and the refresh live here. See src/lib/usergroups-store.js for the API use.
import { lookupGroups, refreshTeam } from './lib/usergroups-store.js';

const LOOKUP = 'tabane:mention-groups:lookup';
const refreshing = new Set();

function refreshInBackground(teamId) {
  if (refreshing.has(teamId)) {
    return;
  }
  refreshing.add(teamId);
  refreshTeam(teamId)
    .catch((error) => console.info('[tabane] user group refresh failed:', error?.code ?? error))
    .finally(() => refreshing.delete(teamId));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message?.type !== LOOKUP) {
    return false;
  }
  if (typeof message.teamId !== 'string' || typeof message.userId !== 'string') {
    sendResponse({ groups: [] });
    return false;
  }
  lookupGroups(message.teamId, message.userId)
    .then(({ groups, staleTeamId }) => {
      sendResponse({ groups });
      if (staleTeamId) {
        refreshInBackground(staleTeamId);
      }
    })
    .catch(() => sendResponse({ groups: [] }));
  return true; // the response is sent asynchronously
});

// Content script for slack.com "Opening Slack..." pages (message links and /ssb/redirect).
// Instead of waiting for the desktop app, follow the "use Slack in your browser" link.
(() => {
  const LINK_SELECTORS = ['a[href*="app.slack.com/client/"]', 'a[href*="/messages/"]'];
  const INTERVAL_MS = 500;
  const MAX_ATTEMPTS = 30; // 15 s

  let attempts = 0;

  function tick() {
    for (const selector of LINK_SELECTORS) {
      const link = document.querySelector(selector);
      if (link) {
        window.location.replace(link.href);
        return;
      }
    }
    attempts += 1;
    if (attempts < MAX_ATTEMPTS) {
      window.setTimeout(tick, INTERVAL_MS);
    }
  }

  tick();
})();

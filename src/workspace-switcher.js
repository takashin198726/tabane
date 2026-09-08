// Runs in the page's MAIN world before Slack's scripts (see manifest "world": "MAIN").
// Slack shows the workspace switcher sidebar in the browser only on ChromeOS, so we
// append " CrOS" to the user agent string it reads.
(() => {
  const ua = window.navigator.userAgent;
  if (ua.includes(' CrOS')) {
    return;
  }
  Object.defineProperty(Navigator.prototype, 'userAgent', {
    get: () => `${ua} CrOS`,
    configurable: true,
    enumerable: true,
  });
})();

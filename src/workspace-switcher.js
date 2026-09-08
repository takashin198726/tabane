// Runs in the page's MAIN world before Slack's scripts (see manifest "world": "MAIN").
// Slack shows the workspace switcher sidebar in the browser only on ChromeOS. It decides
// that from navigator.userAgent (not the HTTP header), and it parses the platform section
// in parentheses, so appending "CrOS" at the end is not enough: the whole platform
// section has to look like ChromeOS. The browser version part is kept as-is.
(() => {
  const CHROME_OS_PLATFORM = '(X11; CrOS x86_64 14541.0.0)';
  const PLATFORM_SECTION = /\([^)]*\)/;

  const ua = window.navigator.userAgent;
  if (ua.includes('CrOS')) {
    return;
  }

  const spoofed = PLATFORM_SECTION.test(ua)
    ? ua.replace(PLATFORM_SECTION, CHROME_OS_PLATFORM)
    : `${ua} ${CHROME_OS_PLATFORM}`;

  Object.defineProperty(Navigator.prototype, 'userAgent', {
    get: () => spoofed,
    configurable: true,
    enumerable: true,
  });
})();

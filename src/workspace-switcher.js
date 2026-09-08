// Runs in the page's MAIN world before Slack's scripts (see manifest "world": "MAIN").
// Slack shows the workspace switcher sidebar in the browser only on ChromeOS. Make every
// way of asking "which OS is this?" answer ChromeOS, while keeping the browser version:
//   - navigator.userAgent      the platform section in parentheses is replaced
//   - navigator.platform       what ChromeOS reports
//   - navigator.userAgentData  Client Hints (platform, getHighEntropyValues, toJSON)
(() => {
  const CHROME_OS_UA_PLATFORM = '(X11; CrOS x86_64 14541.0.0)';
  const CHROME_OS_NAVIGATOR_PLATFORM = 'Linux x86_64';
  const CHROME_OS_HINT_PLATFORM = 'Chrome OS';
  const UA_PLATFORM_SECTION = /\([^)]*\)/;

  const nav = window.navigator;
  const ua = nav.userAgent;
  if (ua.includes('CrOS')) {
    return;
  }

  const define = (name, get) => {
    Object.defineProperty(Navigator.prototype, name, { get, configurable: true, enumerable: true });
  };

  const spoofedUa = UA_PLATFORM_SECTION.test(ua)
    ? ua.replace(UA_PLATFORM_SECTION, CHROME_OS_UA_PLATFORM)
    : `${ua} ${CHROME_OS_UA_PLATFORM}`;
  define('userAgent', () => spoofedUa);
  define('platform', () => CHROME_OS_NAVIGATOR_PLATFORM);

  const realData = nav.userAgentData; // read before the getter is replaced
  if (realData) {
    const spoofedData = {
      get brands() {
        return realData.brands;
      },
      get mobile() {
        return realData.mobile;
      },
      get platform() {
        return CHROME_OS_HINT_PLATFORM;
      },
      getHighEntropyValues: (hints) =>
        realData.getHighEntropyValues(hints).then((values) => ({ ...values, platform: CHROME_OS_HINT_PLATFORM })),
      toJSON: () => ({ brands: realData.brands, mobile: realData.mobile, platform: CHROME_OS_HINT_PLATFORM }),
    };
    define('userAgentData', () => spoofedData);
  }
})();

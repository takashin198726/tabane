import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const CROS_UA =
  'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const BRANDS = [{ brand: 'Chromium', version: '140' }, { brand: 'Google Chrome', version: '140' }];

// Runs the real content script against a fake window/Navigator and returns the navigator
// Slack would see afterwards.
async function navigatorAfterScript({ userAgent, platform = 'MacIntel', withClientHints = true }) {
  const source = await readFile(new URL('../src/workspace-switcher.js', import.meta.url), 'utf8');
  class Navigator {}
  Object.defineProperty(Navigator.prototype, 'userAgent', { get: () => userAgent, configurable: true });
  Object.defineProperty(Navigator.prototype, 'platform', { get: () => platform, configurable: true });
  if (withClientHints) {
    const realData = {
      brands: BRANDS,
      mobile: false,
      platform: 'macOS',
      getHighEntropyValues: async () => ({ platform: 'macOS', platformVersion: '14.0.0', architecture: 'arm' }),
    };
    Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => realData, configurable: true });
  }
  const navigator = new Navigator();
  const context = vm.createContext({ window: { navigator }, Navigator });
  vm.runInContext(source, context);
  return navigator;
}

test('the platform section becomes ChromeOS and the browser version is kept', async () => {
  const nav = await navigatorAfterScript({ userAgent: MAC_UA });
  assert.equal(nav.userAgent, CROS_UA);
});

test('a Windows UA is handled the same way', async () => {
  const win = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
  const nav = await navigatorAfterScript({ userAgent: win, platform: 'Win32' });
  assert.equal(nav.userAgent, CROS_UA);
});

test('a real ChromeOS browser is left untouched', async () => {
  const nav = await navigatorAfterScript({ userAgent: CROS_UA, platform: 'Linux x86_64' });
  assert.equal(nav.userAgent, CROS_UA);
  assert.equal(nav.platform, 'Linux x86_64');
  assert.equal(nav.userAgentData.platform, 'macOS'); // fake data untouched = script returned early
});

test('a UA without a platform section still gets one', async () => {
  const nav = await navigatorAfterScript({ userAgent: 'Mozilla/5.0 Chrome/140.0.0.0' });
  assert.equal(nav.userAgent, 'Mozilla/5.0 Chrome/140.0.0.0 (X11; CrOS x86_64 14541.0.0)');
});

test('navigator.platform reports what ChromeOS reports', async () => {
  const nav = await navigatorAfterScript({ userAgent: MAC_UA });
  assert.equal(nav.platform, 'Linux x86_64');
});

test('client hints report Chrome OS while brands and mobile are kept', async () => {
  const nav = await navigatorAfterScript({ userAgent: MAC_UA });
  assert.equal(nav.userAgentData.platform, 'Chrome OS');
  assert.deepEqual(nav.userAgentData.brands, BRANDS);
  assert.equal(nav.userAgentData.mobile, false);
});

test('high-entropy client hints report Chrome OS and keep the other values', async () => {
  const nav = await navigatorAfterScript({ userAgent: MAC_UA });
  const values = await nav.userAgentData.getHighEntropyValues(['platform', 'platformVersion', 'architecture']);
  // Spread: the object comes from the vm realm, so its prototype differs from this realm's.
  assert.deepEqual({ ...values }, { platform: 'Chrome OS', platformVersion: '14.0.0', architecture: 'arm' });
});

test('client hints serialise to JSON with the spoofed platform', async () => {
  const nav = await navigatorAfterScript({ userAgent: MAC_UA });
  assert.deepEqual(JSON.parse(JSON.stringify(nav.userAgentData)), { brands: BRANDS, mobile: false, platform: 'Chrome OS' });
});

test('a browser without client hints (no userAgentData) does not break', async () => {
  const nav = await navigatorAfterScript({ userAgent: MAC_UA, withClientHints: false });
  assert.equal(nav.userAgent, CROS_UA);
  assert.equal(nav.userAgentData, undefined);
});

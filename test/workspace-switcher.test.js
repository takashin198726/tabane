import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Runs the real content script against a fake window/Navigator and returns what
// Slack would see in navigator.userAgent afterwards.
async function userAgentAfterScript(realUserAgent) {
  const source = await readFile(new URL('../src/workspace-switcher.js', import.meta.url), 'utf8');
  class Navigator {}
  Object.defineProperty(Navigator.prototype, 'userAgent', { get: () => realUserAgent, configurable: true });
  const navigator = new Navigator();
  const context = vm.createContext({ window: { navigator }, Navigator });
  vm.runInContext(source, context);
  return navigator.userAgent;
}

const MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const CROS_UA =
  'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

test('the platform section becomes ChromeOS and the browser version is kept', async () => {
  assert.equal(await userAgentAfterScript(MAC_UA), CROS_UA);
});

test('a Windows UA is handled the same way', async () => {
  const win = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
  assert.equal(await userAgentAfterScript(win), CROS_UA);
});

test('a real ChromeOS UA is left untouched', async () => {
  assert.equal(await userAgentAfterScript(CROS_UA), CROS_UA);
});

test('a UA without a platform section still gets one', async () => {
  assert.equal(
    await userAgentAfterScript('Mozilla/5.0 Chrome/140.0.0.0'),
    'Mozilla/5.0 Chrome/140.0.0.0 (X11; CrOS x86_64 14541.0.0)',
  );
});

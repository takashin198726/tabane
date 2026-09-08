// Content script (isolated world): hides UI noise.
//
//   - Fixed rules (src/lib/noise.js NOISE_RULES) are applied as classes on <html>, e.g.
//     `tabane-hide-rail-activity`; src/noise.css does the hiding.
//   - The heuristic scans banner-like containers and hides those whose wording looks like a
//     trial, upsell or hint, so promotions Slack adds later are caught too. Hidden elements
//     get data-tabane-noise="upsell|hint" and are listed with console.info for inspection.
(async () => {
  if (window.top !== window) {
    return;
  }

  // Containers worth classifying. Hashed class names like "banner__kYRUH" match too.
  const CANDIDATES =
    '[class*="banner"], [class*="upsell"], [class*="trial"], [class*="promo"], [class*="nux"], ' +
    '[class*="nudge"], [class*="toast"], [class*="callout"], [class*="announcement"], [class*="notice"]';
  // Never hide anything inside these: message bodies, the composer, menus and dialogs.
  const PROTECTED = '[data-qa="message_container"], .p-composer, .ql-editor, [role="dialog"], [role="menu"], [role="listbox"]';
  const HIDDEN_ATTR = 'data-tabane-noise';
  const MAX_HEIGHT_RATIO = 0.4; // never hide something taller than 40% of the viewport
  const DEBOUNCE_MS = 200;
  const SWEEP_MS = 3000;

  const url = (path) => chrome.runtime.getURL(path);
  const [{ NOISE_RULES, classifyNoise }, { loadSettings, watchSettings }] = await Promise.all([
    import(url('src/lib/noise.js')),
    import(url('src/lib/settings.js')),
  ]);

  let settings = await loadSettings();

  function applyRules() {
    document.documentElement.classList.toggle('tabane-no-workspace-column', settings.workspaceSwitcher.column === false);
    for (const rule of NOISE_RULES) {
      const on = settings.noise.enabled && settings.noise.rules[rule.id] === true;
      document.documentElement.classList.toggle(`tabane-hide-${rule.id}`, on);
    }
  }

  function unhideAll() {
    for (const el of document.querySelectorAll(`[${HIDDEN_ATTR}]`)) {
      el.removeAttribute(HIDDEN_ATTR);
    }
  }

  function scan() {
    if (!settings.noise.enabled || !settings.noise.heuristic) {
      unhideAll();
      return;
    }
    for (const el of document.querySelectorAll(CANDIDATES)) {
      if (el.hasAttribute(HIDDEN_ATTR) || el.closest(PROTECTED)) {
        continue;
      }
      if (el.getBoundingClientRect().height > window.innerHeight * MAX_HEIGHT_RATIO) {
        continue;
      }
      const kind = classifyNoise({ className: el.getAttribute('class') ?? '', text: el.textContent.slice(0, 500) });
      if (kind) {
        el.setAttribute(HIDDEN_ATTR, kind);
        console.info(`[tabane] hid ${kind}:`, el);
      }
    }
  }

  let timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(scan, DEBOUNCE_MS);
  }

  applyRules();
  scan();
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  setInterval(scan, SWEEP_MS);

  watchSettings((next) => {
    settings = next;
    applyRules();
    unhideAll();
    scan();
  });
})();

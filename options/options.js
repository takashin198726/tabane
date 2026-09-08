import { NOISE_RULES } from '../src/lib/noise.js';
import { loadSettings, saveSettings } from '../src/lib/settings.js';

const getPath = (obj, path) => path.split('.').reduce((o, key) => o?.[key], obj);
const setPath = (obj, path, value) => {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, key) => (o[key] ??= {}), obj)[last] = value;
};

function renderRules() {
  const container = document.getElementById('noise-rules');
  for (const rule of NOISE_RULES) {
    const label = document.createElement('label');
    label.className = 'sub';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.path = `noise.rules.${rule.id}`;
    label.append(input, ` ${rule.label}`);
    container.append(label);
  }
}

function fill(settings) {
  for (const el of document.querySelectorAll('[data-path]')) {
    const value = getPath(settings, el.dataset.path);
    if (el.type === 'checkbox') {
      el.checked = value === true;
    } else {
      el.value = String(value);
    }
  }
  document.getElementById('noise-fieldset').disabled = !settings.noise.enabled;
}

async function onChange(event) {
  const el = event.target;
  if (!el.dataset.path) {
    return;
  }
  const settings = await loadSettings();
  const value = el.type === 'checkbox' ? el.checked : el.dataset.type === 'number' ? Number(el.value) : el.value;
  setPath(settings, el.dataset.path, value);
  await saveSettings(settings);
  fill(settings);
}

renderRules();
fill(await loadSettings());
document.addEventListener('change', onChange);

import { NOISE_RULES } from '../src/lib/noise.js';
import { loadSettings, saveSettings } from '../src/lib/settings.js';
import { describeError } from '../src/lib/usergroups.js';
import { addToken, listTeams, refreshTeam, removeTeam } from '../src/lib/usergroups-store.js';

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
  document.getElementById('mg-fieldset').disabled = !settings.mentionGroups.enabled;
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

// ---- mention groups: one Slack app token per workspace ------------------------------------

const mgStatus = document.getElementById('mg-status');
const mgToken = document.getElementById('mg-token');

function setStatus(text, isError = false) {
  mgStatus.textContent = text;
  mgStatus.classList.toggle('error', isError);
}

const messageOf = (error) => describeError(error?.code ?? 'bad_response');

async function renderTeams() {
  const list = document.getElementById('mg-teams');
  const items = (await listTeams()).map((team) => {
    const item = document.createElement('li');
    item.className = 'team';
    const info = document.createElement('span');
    info.className = 'info';
    const fetched = team.fetchedAt ? new Date(team.fetchedAt).toLocaleString() : '未取得';
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = ` ${team.groupCount} グループ・${fetched} 取得`;
    info.append(team.teamName, meta);
    if (team.lastError) {
      const error = document.createElement('span');
      error.className = 'meta error';
      error.textContent = ` 前回の更新に失敗: ${describeError(team.lastError)}`;
      info.append(error);
    }
    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.textContent = '再取得';
    refresh.addEventListener('click', () => run(`${team.teamName} を再取得しました。`, () => refreshTeam(team.teamId)));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '削除';
    remove.addEventListener('click', () => run(`${team.teamName} のトークンとグループ情報を削除しました。`, () => removeTeam(team.teamId)));
    item.append(info, refresh, remove);
    return item;
  });
  list.replaceChildren(...items);
}

// Runs one token operation with the buttons locked, then shows the outcome and the new list.
async function run(doneText, action) {
  const buttons = document.querySelectorAll('#mg-fieldset button');
  buttons.forEach((button) => (button.disabled = true));
  setStatus('Slack に問い合わせ中…');
  try {
    await action();
    setStatus(doneText);
  } catch (error) {
    setStatus(messageOf(error), true);
  } finally {
    buttons.forEach((button) => (button.disabled = false));
    await renderTeams();
  }
}

document.getElementById('mg-add').addEventListener('click', () =>
  run('登録しました。', async () => {
    await addToken(mgToken.value);
    mgToken.value = '';
  }),
);

renderRules();
fill(await loadSettings());
document.addEventListener('change', onChange);
await renderTeams();

// 界面共享的状态与工具。影片的唯一真相是 film.html 的文本：
// 任何编辑都是“文本 → 新文本”，再同步给播放器、时间线和磁盘。
import { parseFilm, clipLength } from '/shared/doc.mjs';

export const CF = window.CUTFORGE;
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const enc = encodeURIComponent;

// h('div.a.b', { onclick, title, dataset: {…}, style: {…}, html }, …子节点)
export function h(spec, props = {}, ...kids) {
  const [tag, ...cls] = spec.split('.');
  const el = document.createElement(tag || 'div');
  if (cls.length) el.className = cls.join(' ');
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid);
  return el;
}

// 原生 append 会把 null 和数组变成文字；这个不会
export const add = (el, ...kids) => {
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid);
  return el;
};

export const S = {
  name: '', root: '', platform: '',
  filmText: null, doc: null, info: { duration: 0, clips: {}, width: 1920, height: 1080 }, srcDur: {},
  t: 0, playing: false, selected: null, history: [], future: [],
  playerErrors: [], look: null, lookBusy: false,
  agents: [], styles: [], chat: [], agentBusy: false, rendering: null,
  snap: localStorage.getItem('cf.snap') !== '0',
  pick: null, // 预览里选中的页面元素
};

const listeners = {};
export const on = (ev, fn) => { (listeners[ev] ||= []).push(fn); };
export const emit = (ev, data) => { for (const fn of listeners[ev] || []) fn(data); };

export async function api(path, { method = 'GET', json, body } = {}) {
  const headers = { 'x-cutforge-token': CF.token };
  if (json) headers['content-type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: json ? JSON.stringify(json) : body });
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return (res.headers.get('content-type') || '').includes('json') ? res.json() : res.text();
}

export function toast(message, kind = '', actions = []) {
  const el = h(`div.toast${kind ? `.${kind}` : ''}`, {}, h('span', {}, message), actions.map(([label, fn]) => h('button.ghost', { onclick: () => { fn(); el.remove(); } }, label)));
  $('#toasts').append(el);
  setTimeout(() => el.remove(), actions.length ? 12000 : 3600);
}

export function log(line) {
  const pre = $('#log');
  pre.textContent += `${new Date().toLocaleTimeString()}  ${line}\n`;
  pre.scrollTop = pre.scrollHeight;
}

export function showTab(group, tab) {
  for (const b of $$(`.tabs[data-group="${group}"] button[data-tab]`)) {
    b.classList.toggle('on', b.dataset.tab === tab);
    $(`#${b.dataset.tab}`).classList.toggle('hidden', b.dataset.tab !== tab);
  }
  emit('tab', { group, tab });
}

// ---- 播放器（另一个源里的 iframe，用 postMessage 通信）
export const player = {
  post(type, data = {}) {
    $('#player').contentWindow?.postMessage({ target: 'cutforge-player', type, ...data }, CF.preview);
  },
};
export const seek = (t) => {
  S.t = clamp(t, 0, S.info.duration || 0);
  player.post('seek', { t: S.t });
  emit('time');
};

// ---- 影片
export const clipByUid = (uid) => S.doc?.clips.find((c) => c.uid === uid) || null;
export const lengthOf = (c) => clipLength(c, S.srcDur[`${c.uid}|${c.file}`] ?? null) ?? 0;
export const localDuration = () => Math.max(0, ...(S.doc?.clips || []).map((c) => c.at + lengthOf(c)));

let saveTimer = null;
function saveFilm() {
  clearTimeout(saveTimer);
  const text = S.filmText;
  saveTimer = setTimeout(() => {
    api('/api/file?path=film.html', { method: 'PUT', body: text }).catch((e) => toast(`保存 film.html 失败：${e.message}`, 'bad'));
  }, 120);
}

export function setFilm(text, { push = true, save = true } = {}) {
  if (text === S.filmText) return;
  if (push && S.filmText) {
    S.history.push(S.filmText);
    if (S.history.length > 200) S.history.shift();
    S.future = [];
  }
  S.filmText = text;
  S.doc = parseFilm(text);
  if (S.selected && !clipByUid(S.selected)) S.selected = null;
  player.post('film', { text });
  player.post('select', { key: clipByUid(S.selected)?.key ?? null });
  if (save) saveFilm();
  emit('film');
}

export const editFilm = (fn) => setFilm(fn(S.filmText));

export function undo() {
  if (!S.history.length) return;
  S.future.push(S.filmText);
  setFilm(S.history.pop(), { push: false });
}

export function redo() {
  if (!S.future.length) return;
  S.history.push(S.filmText);
  setFilm(S.future.pop(), { push: false });
}

export function clearPick() {
  if (!S.pick) return;
  S.pick = null;
  player.post('pick', {});
  emit('pick');
}

export function selectClip(uid) {
  if (S.pick && S.pick.uid !== uid) clearPick();
  if (S.selected === uid) return;
  S.selected = uid;
  player.post('select', { key: clipByUid(uid)?.key ?? null });
  emit('select');
}

// 时间码 分:秒:帧（按 30 帧）
export const timecode = (t) => {
  const f = Math.round(Math.max(0, t) * 30);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(f / 1800))}:${p(Math.floor(f / 30) % 60)}:${p(f % 30)}`;
};
export const fmtDur = (s) => (s < 60 ? `${(Math.round(s * 10) / 10).toFixed(1)} 秒` : `${Math.floor(s / 60)} 分 ${String(Math.round(s % 60)).padStart(2, '0')} 秒`);

// 右键菜单／下拉菜单：items = [[文字, 函数, {disabled, danger}] | null(分隔线)]
export function menu(x, y, items) {
  document.querySelector('.menu')?.remove();
  const el = h('div.menu');
  for (const it of items) {
    if (!it) el.append(h('hr'));
    else if (it instanceof Node) el.append(it);
    else el.append(h(`button${it[2]?.danger ? '.danger-text' : ''}`, { disabled: it[2]?.disabled, onclick: () => { el.remove(); it[1](); } }, it[0], it[2]?.key ? h('kbd', {}, it[2].key) : null));
  }
  document.body.append(el);
  const r = el.getBoundingClientRect();
  el.style.left = `${Math.max(6, Math.min(x, innerWidth - r.width - 6))}px`;
  el.style.top = `${Math.max(6, Math.min(y, innerHeight - r.height - 6))}px`;
  const close = (e) => {
    if (e.type === 'pointerdown' && el.contains(e.target)) return;
    el.remove();
    removeEventListener('pointerdown', close, true);
    removeEventListener('keydown', close, true);
  };
  setTimeout(() => {
    addEventListener('pointerdown', close, true);
    addEventListener('keydown', close, true);
  }, 0);
  return el;
}

// 主题：浅色／深色，默认跟随系统
export function applyTheme(theme) {
  const t = theme || localStorage.getItem('cf.theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = t;
  if (theme) localStorage.setItem('cf.theme', theme);
  player.post('theme', { theme: t });
  emit('theme', t);
  return t;
}

export const fmtTime = (t, precise = true) => {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${precise ? rest.toFixed(2).padStart(5, '0') : String(Math.floor(rest)).padStart(2, '0')}`;
};

export function modal(title, body, { wide = false } = {}) {
  const box = $('#modal');
  const close = () => {
    box.classList.add('hidden');
    box.innerHTML = '';
  };
  box.innerHTML = '';
  box.append(h(`div.sheet${wide ? '.wide' : ''}`, {}, h('div.sheet-head', {}, h('b', {}, title), h('button.ghost.x', { onclick: close }, '✕')), h('div.sheet-body', {}, body)));
  box.classList.remove('hidden');
  box.onclick = (e) => { if (e.target === box) close(); };
  return close;
}

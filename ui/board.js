// 画布与故事板：在白板上摆便签和素材卡片，从左到右就是镜头顺序。
// 可以一键按顺序送上时间线，或者把整块板交给智能体按卡片去做。存在工程的 .cutforge/board.json。
import { parseFilm, insertClip, addTrack, kindOfFile, r3 } from '/shared/doc.mjs';
import { S, $, h, add, api, toast, editFilm, lengthOf, emit, on, enc } from './store.js';
import { icon } from './icons.js';
import { fileUrl, frameUrl } from './thumbs.js';

const center = $('#center');
const view = h('div.card.hidden', { id: 'board' });
center.after(view);
const toolbar = h('div.board-bar');
const space = h('div.board-space');
const inner = h('div.board-inner');
space.append(inner);
add(view, toolbar, space);

let board = { cards: [], mode: 'free' };
let active = false;
let selected = null;
let saveTimer = null;
const uid = () => Math.random().toString(36).slice(2, 9);
const save = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => api('/api/board', { method: 'PUT', json: board }).catch(() => {}), 250);
};

// 从左到右（同一列从上到下）就是镜头顺序
const ordered = () => [...board.cards].sort((a, b) => (Math.abs(a.x - b.x) < 60 ? a.y - b.y : a.x - b.x));

export async function loadBoard() {
  board = await api('/api/board').catch(() => ({ cards: [], mode: 'free' }));
  board.cards ||= [];
  draw();
}

export function toggleBoard(force) {
  active = force ?? !active;
  center.classList.toggle('hidden', active);
  view.classList.toggle('hidden', !active);
  $('#inspector').classList.toggle('board-hide', active);
  emit('layout');
  if (active) draw();
}
export const boardActive = () => active;

function newNote(x = 40 + board.cards.length * 30, y = 40) {
  const c = { id: uid(), kind: 'note', x, y, text: '', dur: 3 };
  board.cards.push(c);
  selected = c.id;
  save();
  draw();
  setTimeout(() => inner.querySelector(`[data-id="${c.id}"] .note-text`)?.focus(), 30);
}

function addMedia(file, x, y) {
  const kind = kindOfFile(file);
  if (!kind) return toast('这种文件不能放到画布上');
  board.cards.push({ id: uid(), kind: 'media', file, x, y, text: '', dur: kind === 'image' || kind === 'page' ? 3 : null });
  save();
  draw();
}

function cardEl(c, i) {
  const kind = c.kind === 'media' ? kindOfFile(c.file) : 'note';
  const el = h(`div.bcard.k-${kind}${selected === c.id ? '.sel' : ''}`, { dataset: { id: c.id }, style: board.mode === 'free' ? { left: `${c.x}px`, top: `${c.y}px` } : {} });
  const head = h('div.bcard-head', {}, h('b', {}, `#${i + 1}`), h('span', {}, kind === 'note' ? '便签' : { video: '视频', image: '图片', audio: '声音', page: '页面' }[kind]), h('div.spacer'),
    h('button.ghost.icon', { title: '删除卡片', onclick: (e) => { e.stopPropagation(); board.cards = board.cards.filter((x) => x !== c); save(); draw(); } }, icon('x', 12)));
  el.append(head);
  if (c.kind === 'media') {
    const pic = h('div.bcard-pic');
    if (kind === 'image') pic.append(h('img', { src: fileUrl(c.file), draggable: false }));
    else if (kind === 'video' || kind === 'page') {
      const img = h('img', { draggable: false });
      const u = frameUrl(c.file, kind === 'page' ? 1.5 : 0.5);
      if (u) img.src = u;
      img.dataset.file = c.file;
      img.dataset.t = kind === 'page' ? '1.5' : '0.5';
      pic.append(img);
    } else pic.append(icon('audio', 24));
    el.append(pic, h('div.bcard-file', { title: c.file }, c.file.split('/').pop()));
  }
  const text = h('div.note-text', { contentEditable: 'true', spellcheck: false, 'data-ph': c.kind === 'note' ? '写下这个镜头要表达什么、画面里有什么' : '备注（可选）' });
  text.textContent = c.text || '';
  text.addEventListener('input', () => { c.text = text.innerText; save(); });
  text.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.append(text);
  if (c.dur != null) {
    const d = h('input', { type: 'number', min: '0.5', step: '0.5', value: String(c.dur), title: '这个镜头多长（秒）' });
    d.addEventListener('change', () => { c.dur = Math.max(0.5, Number(d.value) || 3); save(); });
    d.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.append(h('label.bcard-dur', {}, d, '秒'));
  }
  // 拖动卡片
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    selected = c.id;
    for (const x of inner.querySelectorAll('.bcard')) x.classList.toggle('sel', x === el);
    if (board.mode !== 'free') return;
    const x0 = e.clientX - c.x;
    const y0 = e.clientY - c.y;
    const move = (ev) => {
      c.x = Math.max(0, Math.round((ev.clientX - x0) / 10) * 10);
      c.y = Math.max(0, Math.round((ev.clientY - y0) / 10) * 10);
      el.style.left = `${c.x}px`;
      el.style.top = `${c.y}px`;
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      save();
      drawOrder();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  });
  return el;
}

function drawOrder() {
  const order = ordered();
  for (const el of inner.querySelectorAll('.bcard')) {
    const i = order.findIndex((c) => c.id === el.dataset.id);
    el.querySelector('.bcard-head b').textContent = `#${i + 1}`;
  }
}

function draw() {
  toolbar.innerHTML = '';
  add(toolbar,
    h('b', {}, '画布'),
    h('span.dim', {}, `${board.cards.length} 张卡片 · 从左到右是镜头顺序`),
    h('div.spacer'),
    h('div.seg-mini', {},
      h(`button${board.mode === 'free' ? '.on' : ''}`, { onclick: () => { board.mode = 'free'; save(); draw(); } }, '自由摆放'),
      h(`button${board.mode === 'story' ? '.on' : ''}`, { onclick: () => { board.mode = 'story'; save(); draw(); } }, '故事板')),
    h('button', { onclick: () => newNote() }, icon('plus', 13), '便签'),
    h('button', { title: '把卡片按顺序排到时间线末尾的新轨道上', onclick: sendToTimeline }, '送上时间线'),
    h('button.primary', { title: '把整块板写成任务交给智能体', onclick: sendToAgent }, '交给智能体'),
    h('button.ghost', { title: '回到剪辑（⌘E）', onclick: () => toggleBoard(false) }, '回到剪辑'));
  inner.innerHTML = '';
  inner.classList.toggle('story', board.mode === 'story');
  const list = board.mode === 'story' ? ordered() : board.cards;
  const order = ordered();
  for (const c of list) inner.append(cardEl(c, order.indexOf(c)));
  if (!board.cards.length) inner.append(h('div.board-empty', {}, icon('doc', 22), h('b', {}, '在这里规划你的片子'), h('p', {}, '双击空白处加便签，把左边的素材拖进来。从左到右排好镜头，再一键送上时间线，或交给智能体按卡片去做。')));
  const w = Math.max(...board.cards.map((c) => c.x + 260), 0);
  const hgt = Math.max(...board.cards.map((c) => c.y + 260), 0);
  if (board.mode === 'free') Object.assign(inner.style, { width: `${w + 200}px`, height: `${hgt + 200}px` });
  else Object.assign(inner.style, { width: '', height: '' });
}

// 媒体卡片按顺序排到一条新轨道上；便签变成占位页面交给智能体，这里只排媒体
async function sendToTimeline() {
  const order = ordered().filter((c) => c.kind === 'media');
  if (!order.length) return toast('画布上还没有素材卡片：便签请用“交给智能体”');
  const lens = [];
  for (const c of order) {
    let len = c.dur;
    if (len == null) {
      const p = await api(`/api/probe?path=${enc(c.file)}`).catch(() => null);
      len = p?.duration || 3;
    }
    lens.push(len);
  }
  const start = r3(Math.max(0, ...S.doc.clips.map((c) => c.at + lengthOf(c))));
  editFilm((text) => {
    const pics = order.map((c, i) => [c, lens[i]]).filter(([c]) => kindOfFile(c.file) !== 'audio');
    const sounds = order.map((c, i) => [c, lens[i]]).filter(([c]) => kindOfFile(c.file) === 'audio');
    if (pics.length) {
      text = addTrack(text, 'top');
      let t = start;
      for (const [c, len] of pics) {
        const k = kindOfFile(c.file);
        text = insertClip(text, 0, { kind: k, file: c.file, at: r3(t), ...(k === 'video' ? { out: len } : { out: len }) });
        t += len;
      }
    }
    if (sounds.length) {
      text = addTrack(text, 'bottom');
      const ti = parseFilm(text).tracks.length - 1;
      let t = start;
      for (const [c, len] of sounds) {
        text = insertClip(text, ti, { kind: 'audio', file: c.file, at: r3(t), out: len });
        t += len;
      }
    }
    return text;
  });
  toast(`已把 ${order.length} 张素材卡片排到 ${start.toFixed(1)} 秒之后`, 'good');
  toggleBoard(false);
}

function sendToAgent() {
  const order = ordered();
  if (!order.length) return toast('画布是空的');
  const total = order.reduce((n, c) => n + (c.dur || 0), 0);
  const lines = ['按下面的分镜做这部片子（顺序就是镜头顺序）：', ''];
  order.forEach((c, i) => {
    const what = c.kind === 'media' ? `用素材 ${c.file}${c.text ? `，${c.text}` : ''}` : c.text || '（这个镜头还没写内容，请根据前后镜头补上）';
    lines.push(`${i + 1}. ${c.dur ? `约 ${c.dur} 秒：` : ''}${what}`);
  });
  if (total) lines.push('', `整片大约 ${Math.round(total)} 秒。`);
  emit('compose', lines.join('\n'));
  toggleBoard(false);
}

// 双击空白加便签；素材从左栏拖进来
space.addEventListener('dblclick', (e) => {
  if (e.target !== space && e.target !== inner) return;
  if (board.mode !== 'free') return newNote();
  const r = inner.getBoundingClientRect();
  newNote(Math.round((e.clientX - r.left) / 10) * 10, Math.round((e.clientY - r.top) / 10) * 10);
});
space.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('application/x-cutforge-file')) e.preventDefault(); });
space.addEventListener('drop', (e) => {
  const file = e.dataTransfer.getData('application/x-cutforge-file');
  if (!file) return;
  e.preventDefault();
  const r = inner.getBoundingClientRect();
  addMedia(file, board.mode === 'free' ? Math.max(0, Math.round(e.clientX - r.left - 100)) : 9999, Math.max(0, Math.round(e.clientY - r.top - 40)));
});
addEventListener('keydown', (e) => {
  if (!active || !selected || e.target.isContentEditable || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    board.cards = board.cards.filter((c) => c.id !== selected);
    selected = null;
    save();
    draw();
    e.stopImmediatePropagation();
    e.preventDefault();
  }
}, true);
on('thumbs', () => {
  for (const img of inner.querySelectorAll('img[data-file]:not([src])')) {
    const u = frameUrl(img.dataset.file, Number(img.dataset.t));
    if (u) img.src = u;
  }
});

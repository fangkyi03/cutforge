// 素材库面板：转场、标题、特效、贴纸、音效。悬停预览，点“+”或拖到时间线使用。
// 转场自动对准离播放头最近的切点；标题、特效、贴纸放在播放头处的最上层；音效放最下面的声音轨道。
import { parseFilm, insertClip, addTrack, r3 } from '/shared/doc.mjs';
import { S, $, h, add, api, toast, editFilm, lengthOf, selectClip } from './store.js';
import { icon } from './icons.js';
import { cutPoints } from './edit-ops.js';
import { drawGenerate } from './generate.js';

const pane = $('#library');
const chips = h('div.lib-cats');
const grid = h('div.grid.lib-grid');
add(pane, chips, grid, h('p.hint.lib-hint', {}, '素材都是 CutForge 用代码生成的，可以随意商用。页面里的文字在预览里双击就能改。'));
let lib = null;
let cat = localStorage.getItem('cf.libcat') || 'transitions';
const KIND = { transitions: 'page', titles: 'page', effects: 'page', stickers: 'image', sounds: 'audio' };

function fits(doc, track, at, len) {
  const tr = doc.tracks[track];
  return tr && !tr.locked && !tr.caption && !tr.clips.some((c) => at < c.at + lengthOf(c) - 0.001 && at + len > c.at + 0.001);
}

export async function useItem(item, at = null) {
  let r;
  try {
    r = await api('/api/library/add', { method: 'POST', json: { id: item.id } });
  } catch (e) {
    return toast(e.message, 'bad');
  }
  const kind = KIND[item.cat];
  let len = item.len || 3;
  let start = at ?? S.t;
  if (item.cat === 'transitions' && at == null) {
    // 对准离播放头最近的切点（不含开头和结尾）
    const pts = cutPoints().filter((p) => p > 0.05 && p < (S.info.duration || 0) - 0.05);
    const near = pts.sort((a, b) => Math.abs(a - S.t) - Math.abs(b - S.t))[0];
    if (near == null) return toast('时间线上还没有切点：转场要放在两个镜头之间');
    start = Math.max(0, near - len / 2);
  }
  if (kind === 'audio') {
    const p = await api(`/api/probe?path=${encodeURIComponent(r.file)}`).catch(() => null);
    len = p?.duration || len;
  }
  start = r3(Math.max(0, start));
  const spec = { kind, file: r.file, at: start, ...(kind === 'audio' ? {} : { out: len }) };
  if (kind === 'image') spec.box = { left: Math.round((S.doc.width - 300) / 2), top: Math.round((S.doc.height - 300) / 2), width: 300 };
  let uid = null;
  editFilm((text) => {
    let doc = parseFilm(text);
    let ti = kind === 'audio' ? [...doc.tracks.keys()].reverse().find((i) => fits(doc, i, start, len) && doc.tracks[i].clips.every((c) => c.kind === 'audio')) : (fits(doc, 0, start, len) && doc.tracks[0].clips.every((c) => c.kind !== 'audio') ? 0 : undefined);
    if (ti == null) {
      text = addTrack(text, kind === 'audio' ? 'bottom' : 'top');
      doc = parseFilm(text);
      ti = kind === 'audio' ? doc.tracks.length - 1 : 0;
    }
    const next = insertClip(text, ti, spec);
    uid = parseFilm(next).tracks[ti].clips.find((c) => c.file === r.file && Math.abs(c.at - start) < 0.001)?.uid ?? null;
    return next;
  });
  if (uid) selectClip(uid);
  toast(`已加入 ${item.name}`);
}

let audio = null;
function card(item) {
  const thumb = h(`div.thumb.lib-thumb.k-${item.cat}`);
  if (item.cat === 'stickers') thumb.append(h('img', { src: `/library/${item.file}`, draggable: false }));
  else if (item.cat === 'sounds') thumb.append(icon('audio', 26));
  else thumb.append(h('span.lib-name', {}, item.name));
  const cell = h('div.cell', {
    title: `${item.name}${item.desc ? `\n${item.desc}` : ''}\n悬停预览，点 + 加到时间线`,
    draggable: 'true',
    ondragstart: (e) => {
      e.dataTransfer.setData('application/x-cutforge-library', item.id);
      e.dataTransfer.effectAllowed = 'copy';
    },
    onmouseenter: () => {
      if (item.cat === 'sounds') {
        audio?.pause();
        audio = new Audio(`/library/${item.file}`);
        audio.play().catch(() => {});
      } else if (item.cat !== 'stickers') {
        thumb.innerHTML = '';
        // 页面单独打开时会自己循环播放；背景是透明的，放在棋盘格上看
        thumb.append(h('iframe', { src: `/library/${item.file}`, tabindex: -1, scrolling: 'no' }));
      }
    },
    onmouseleave: () => {
      if (item.cat === 'sounds') audio?.pause();
      else if (item.cat !== 'stickers') {
        thumb.innerHTML = '';
        thumb.append(h('span.lib-name', {}, item.name));
      }
    },
  },
  thumb,
  h('button.add', { title: '加到时间线', onclick: (e) => { e.stopPropagation(); useItem(item); } }, icon('plus', 13)),
  h('div.cap', {}, h('span', {}, item.name)));
  return cell;
}

function draw() {
  if (!lib) return;
  chips.innerHTML = '';
  for (const [k, name] of Object.entries(lib.categories)) {
    chips.append(h(`button${k === cat ? '.on' : ''}`, { onclick: () => { cat = k; localStorage.setItem('cf.libcat', k); draw(); } }, name));
  }
  chips.append(h(`button${cat === 'generate' ? '.on' : ''}`, { onclick: () => { cat = 'generate'; localStorage.setItem('cf.libcat', cat); draw(); } }, '生成'));
  grid.innerHTML = '';
  grid.classList.toggle('gen', cat === 'generate');
  if (cat === 'generate') return drawGenerate(grid);
  for (const item of lib.items.filter((i) => i.cat === cat)) grid.append(card(item));
}

export async function loadLibrary() {
  lib = await api('/api/library').catch(() => null);
  draw();
}

// 时间线接收从素材库拖来的条目
export function libraryDrop(e, at) {
  const id = e.dataTransfer.getData('application/x-cutforge-library');
  if (!id || !lib) return false;
  const item = lib.items.find((i) => i.id === id);
  if (item) useItem(item, item.cat === 'transitions' ? Math.max(0, at - (item.len || 1) / 2) : at);
  return true;
}

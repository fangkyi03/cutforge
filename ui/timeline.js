// 时间线：每条轨道一行，片段里是画面条或波形；可拖动、换轨、裁剪、切开、复制、停用。
// 所有操作最终都落成对 film.html 的一次改写。
import {
  parseFilm, updateClip, moveClip, removeClip, insertClip, splitClip, duplicateClip, addTrack, removeTrack, setTrackFlag, kindOfFile, r3,
} from '/shared/doc.mjs';
import { S, $, h, add, on, api, clamp, editFilm, lengthOf, localDuration, selectClip, clipByUid, seek, toast, undo, redo, fmtTime, enc, menu } from './store.js';
import { icon } from './icons.js';
import { openFile } from './editor.js';
import { frameUrl, waveUrl, fileUrl } from './thumbs.js';

const HEAD = 104;
const ROW = 60;
const LABEL = 17;
const THUMB = ROW - 8 - LABEL;
const SNAP_PX = 8;
let pps = 80;
let userZoom = false;

const root = $('#timeline');
const scroller = h('div.tl-scroll');
const content = h('div.tl-content');
const ruler = h('div.tl-ruler');
const rows = h('div.tl-rows');
const playhead = h('div.tl-playhead');
const empty = h('div.tl-empty', {}, icon('video', 18), '把素材拖到这里开始剪，或在右边让智能体做一部');
content.append(ruler, rows, playhead);
scroller.append(content, empty);
root.append(scroller);

const isMedia = (c) => c.kind === 'video' || c.kind === 'audio';
const speedOf = (c) => (isMedia(c) ? c.speed : 1);
const laneX = (clientX) => clientX - content.getBoundingClientRect().left - HEAD;
const zoomToSlider = () => String(Math.round((Math.log(pps / 6) / Math.log(80)) * 100));

// ---------------------------------------------------------------- 工具栏

const zoom = h('input', { type: 'range', min: '0', max: '100', value: '40', title: '缩放时间线（按住 ⌘ 滚动也可以）', oninput: () => setZoom(6 * Math.pow(80, Number(zoom.value) / 100)) });
const snapBtn = h('button.ghost.icon.toggle', { title: '吸附：拖动时对齐片段边缘和播放头', onclick: () => {
  S.snap = !S.snap;
  localStorage.setItem('cf.snap', S.snap ? '1' : '0');
  snapBtn.classList.toggle('on', S.snap);
} }, icon('magnet'));
snapBtn.classList.toggle('on', S.snap);
const tool = (name, title, fn) => h('button.ghost.icon', { title, onclick: fn }, icon(name));

function setZoom(next, anchorX = null) {
  userZoom = true;
  const x = anchorX ?? scroller.clientWidth / 2 - HEAD + scroller.scrollLeft;
  const t = x / pps;
  pps = clamp(next, 4, 480);
  zoom.value = zoomToSlider();
  render();
  scroller.scrollLeft += t * pps - x;
}

add($('#tlLeft'),
  h('span.sep'),
  tool('undo', '撤销（⌘Z）', undo),
  tool('redo', '重做（⇧⌘Z）', redo),
  h('span.sep'),
  tool('cut', '在播放头处切开（S）', () => splitAtPlayhead()),
  tool('copy', '复制一份（⌘D）', () => duplicateSelected()),
  tool('trash', '删除选中的片段（Delete）', () => deleteSelected()),
  h('span.sep'),
  tool('plus', '添加轨道', () => editFilm((t) => addTrack(t, 'top'))));
add($('#tlRight'),
  snapBtn,
  tool('zoomOut', '缩小', () => setZoom(pps / 1.4)),
  zoom,
  tool('zoomIn', '放大', () => setZoom(pps * 1.4)),
  tool('fit', '缩放到整部影片', () => { userZoom = false; render(); }));

// ---------------------------------------------------------------- 绘制

function tickStep() {
  for (const s of [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]) if (s * pps >= 76) return s;
  return 1200;
}

// 轨道名：按内容给 P（页面）V（视频／图片）A（声音）C（字幕）编号
function trackBadges(doc) {
  const count = {};
  return doc.tracks.map((tr) => {
    let k = 'T';
    if (tr.caption) k = 'C';
    else if (tr.clips.some((c) => c.kind === 'video' || c.kind === 'image')) k = 'V';
    else if (tr.clips.some((c) => c.kind === 'page')) k = 'P';
    else if (tr.clips.some((c) => c.kind === 'audio')) k = 'A';
    count[k] = (count[k] || 0) + 1;
    return { kind: k, name: `${k}${count[k]}` };
  });
}

const QUANTA = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120];

// 片段里的画面条：按宽度铺若干格，每格取片段对应时刻的一帧
function strip(c, widthPx, len) {
  const box = h('div.strip');
  if (c.kind === 'image') {
    box.style.backgroundImage = `url("${fileUrl(c.file)}")`;
    box.classList.add('tile');
    return box;
  }
  if (c.kind === 'audio') return box;
  const meta = S.info.clips[c.key];
  const aspect = c.kind === 'video' && meta?.natW ? meta.natW / meta.natH : S.doc.width / S.doc.height;
  const n = clamp(Math.ceil(widthPx / (THUMB * aspect)), 1, 48);
  const cell = widthPx / n;
  const span = (len * speedOf(c)) / n;
  const q = [...QUANTA].reverse().find((x) => x <= span) ?? 0.1;
  const srcDur = S.srcDur[`${c.uid}|${c.file}`];
  for (let k = 0; k < n; k++) {
    let t = Math.max(0, Math.round((c.in + (k + 0.5) * span) / q) * q);
    if (srcDur) t = Math.min(t, Math.max(0, srcDur - 0.05));
    t = r3(t);
    const img = h('img', { draggable: false, dataset: { file: c.file, t: String(t) }, style: { left: `${k * cell}px`, width: `${cell + 0.5}px` } });
    const url = frameUrl(c.file, t);
    if (url) img.src = url;
    box.append(img);
  }
  return box;
}

function wave(c, len) {
  if (c.kind !== 'audio') return null;
  const el = h('div.wave', { dataset: { file: c.file, from: String(c.in), to: String(r3(c.in + len * speedOf(c))) } });
  const url = waveUrl(c.file, c.in, c.in + len * speedOf(c));
  if (url) el.style.setProperty('--wave', `url("${url}")`);
  return el;
}

export function render() {
  const doc = S.doc;
  if (!doc) return;
  const dur = Math.max(S.info.duration || 0, localDuration());
  const viewW = Math.max(200, scroller.clientWidth - HEAD);
  if (!userZoom) {
    pps = clamp((viewW - 56) / Math.max(dur, 5), 4, 480);
    zoom.value = zoomToSlider();
  }
  const total = Math.max(dur + 3, viewW / pps);
  content.style.width = `${HEAD + total * pps}px`;
  empty.style.display = doc.clips.length ? 'none' : 'flex';

  ruler.innerHTML = '';
  ruler.append(h('div.tl-corner'));
  const step = tickStep();
  for (let t = 0; t <= total + 1e-6; t += step) {
    const label = step < 1 ? `${(Math.round(t * 100) / 100).toFixed(step < 0.5 ? 2 : 1)}` : fmtTime(t, false);
    ruler.append(h('div.tl-tick', { style: { left: `${HEAD + t * pps}px` } }, label));
    for (let k = 1; k < 4; k++) ruler.append(h('div.tl-tick.minor', { style: { left: `${HEAD + (t + (step * k) / 4) * pps}px` } }));
  }

  rows.innerHTML = '';
  const badges = trackBadges(doc);
  doc.tracks.forEach((tr, i) => {
    const flag = (name, onIcon, offIcon, title) => h(`button.ghost.icon${tr[name] ? '.on' : ''}`, {
      title, onclick: () => editFilm((t) => setTrackFlag(t, i, name, !tr[name])),
    }, icon(tr[name] ? onIcon : offIcon, 14));
    const head = h('div.tl-head', { oncontextmenu: (e) => {
      e.preventDefault();
      menu(e.clientX, e.clientY, [
        ['在上方添加轨道', () => editFilm((t) => addTrack(t, 'top'))],
        ['在最下方添加轨道', () => editFilm((t) => addTrack(t, 'bottom'))],
        null,
        ['删除这条轨道', () => deleteTrack(tr, i), { danger: true }],
      ]);
    } },
    h(`span.tl-badge.t-${badges[i].kind}`, { title: `轨道 ${i + 1}（上面的轨道盖住下面的）` }, badges[i].name),
    flag('locked', 'lock', 'unlock', '锁定：智能体和你都不能改它'),
    flag('hidden', 'eyeOff', 'eye', '隐藏这条轨道（不显示也不出声）'),
    flag('muted', 'mute', 'vol', '静音这条轨道'));
    const lane = h(`div.tl-lane${tr.locked ? '.locked' : ''}${tr.hidden ? '.dim' : ''}`, { dataset: { track: String(i) } });
    if (tr.caption) add(lane, h('div.clip.k-caption', { style: { left: '0px', width: `${Math.max(dur, 1) * pps}px` } }, h('div.label', {}, icon('caption', 12), h('span', {}, tr.caption.file))));
    for (const c of tr.clips) {
      const len = lengthOf(c);
      const w = Math.max(6, len * pps);
      const meta = S.info.clips[c.key];
      const el = h(`div.clip.k-${c.kind}${c.uid === S.selected ? '.sel' : ''}${c.disabled ? '.off' : ''}${meta?.failed ? '.bad' : ''}`, {
        dataset: { uid: c.uid },
        title: `${c.uid} · ${c.file}\n${fmtTime(c.at)} → ${fmtTime(c.at + len)}${isMedia(c) && c.speed !== 1 ? ` · ${c.speed}×` : ''}${meta?.failed ? '\n这个文件没有加载成功，看“问题”' : ''}`,
        style: { left: `${c.at * pps}px`, width: `${w}px` },
      });
      add(el,
        h('div.label', {}, h('span', {}, c.uid), h('em', {}, `${(Math.round(len * 10) / 10).toFixed(1)} 秒${isMedia(c) && c.speed !== 1 ? ` · ${c.speed}×` : ''}`)),
        strip(c, w, len), wave(c, len),
        c.fade[0] > 0 ? h('b.fade.in', { style: { width: `${c.fade[0] * pps}px` } }) : null,
        c.fade[1] > 0 ? h('b.fade.out', { style: { width: `${c.fade[1] * pps}px` } }) : null,
        h('i.hl'), h('i.hr'));
      lane.append(el);
    }
    rows.append(h('div.tl-row', {}, head, lane));
  });
  drawPlayhead();
}

function drawPlayhead() {
  playhead.style.left = `${HEAD + S.t * pps}px`;
  playhead.style.height = `${Math.max(scroller.clientHeight, ruler.offsetHeight + rows.offsetHeight)}px`;
}

// 缩略图到了：只补图，不重画
on('thumbs', () => {
  for (const img of rows.querySelectorAll('.strip img:not([src])')) {
    const url = frameUrl(img.dataset.file, Number(img.dataset.t));
    if (url) img.src = url;
  }
  for (const el of rows.querySelectorAll('.wave')) {
    const url = waveUrl(el.dataset.file, Number(el.dataset.from), Number(el.dataset.to));
    if (url) el.style.setProperty('--wave', `url("${url}")`);
  }
});

// ---------------------------------------------------------------- 吸附与重叠

function snapPoints(skipUid) {
  const pts = [0, S.t];
  for (const c of S.doc.clips) {
    if (c.uid === skipUid) continue;
    pts.push(c.at, c.at + lengthOf(c));
  }
  return pts;
}

function snap(t, pts) {
  if (!S.snap) return t;
  let best = t;
  let dist = SNAP_PX / pps;
  for (const p of pts) {
    const d = Math.abs(p - t);
    if (d < dist) {
      dist = d;
      best = p;
    }
  }
  return best;
}

const overlapsOn = (doc, track, skipUid, at, len) => doc.tracks[track].clips.some((c) => c.uid !== skipUid && at < c.at + lengthOf(c) - 0.001 && at + len > c.at + 0.001);

function trackAtY(clientY) {
  const top = rows.getBoundingClientRect().top;
  const i = clamp(Math.floor((clientY - top) / ROW), 0, S.doc.tracks.length - 1);
  const tr = S.doc.tracks[i];
  return tr && !tr.locked && !tr.caption ? i : null;
}

// ---------------------------------------------------------------- 拖动

function dragSeek(e) {
  const move = (ev) => seek(Math.max(0, snap(laneX(ev.clientX) / pps, snapPoints(null).filter((p) => p !== S.t))));
  move(e);
  const up = () => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
}

function dragClip(e, c, el, mode) {
  e.preventDefault();
  const x0 = e.clientX;
  const len0 = lengthOf(c);
  const sp = speedOf(c);
  const srcDur = S.srcDur[`${c.uid}|${c.file}`] ?? null;
  const out0 = c.out ?? r3(c.in + len0 * sp);
  const pts = snapPoints(c.uid);
  let moved = false;
  let patch = null;
  let track = c.track;
  let at = c.at;
  let len = len0;

  const onMove = (ev) => {
    const dt = (ev.clientX - x0) / pps;
    if (!moved && Math.abs(ev.clientX - x0) < 3 && (mode !== 'move' || trackAtY(ev.clientY) === c.track)) return;
    moved = true;
    if (mode === 'move') {
      const raw = Math.max(0, c.at + dt);
      const byStart = snap(raw, pts);
      const byEnd = snap(raw + len0, pts) - len0;
      at = Math.max(0, Math.abs(byStart - raw) <= Math.abs(byEnd - raw) ? byStart : byEnd);
      track = trackAtY(ev.clientY) ?? c.track;
      patch = { at: r3(at) };
      el.style.translate = `0 ${(track - c.track) * ROW}px`;
    } else if (mode === 'l') {
      let d = snap(Math.max(0, c.at + dt), pts) - c.at;
      d = Math.min(d, len0 - 0.1);
      if (c.kind === 'image') patch = { at: r3(c.at + d), out: r3(out0 - d) };
      else {
        if (c.in + d * sp < 0) d = -c.in / sp;
        patch = { at: r3(c.at + d), in: r3(c.in + d * sp), out: out0 };
      }
      at = c.at + d;
      len = len0 - d;
    } else {
      len = Math.max(0.1, snap(c.at + len0 + dt, pts) - c.at);
      if (isMedia(c) && srcDur != null) len = Math.min(len, (srcDur - c.in) / sp);
      patch = { out: r3(c.in + len * sp) };
    }
    el.style.left = `${at * pps}px`;
    el.style.width = `${Math.max(6, len * pps)}px`;
    el.classList.add('dragging');
    el.classList.toggle('blocked', overlapsOn(S.doc, track, c.uid, at, len));
  };
  const onUp = () => {
    removeEventListener('pointermove', onMove);
    removeEventListener('pointerup', onUp);
    if (!moved || !patch) return;
    if (overlapsOn(S.doc, track, c.uid, at, len)) {
      toast('同一条轨道上的片段不能重叠：把它拖到另一条轨道');
      return render();
    }
    editFilm((t) => (track !== c.track ? moveClip(t, c.key, track, patch) : updateClip(t, c.key, patch)));
  };
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
}

ruler.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.tl-corner')) dragSeek(e);
});

rows.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('.tl-head')) return;
  const el = e.target.closest('.clip[data-uid]');
  if (!el) {
    if (e.target.closest('.tl-lane')) {
      selectClip(null);
      dragSeek(e);
    }
    return;
  }
  const c = clipByUid(el.dataset.uid);
  if (!c) return;
  selectClip(c.uid);
  if (S.doc.tracks[c.track].locked) return;
  dragClip(e, c, el, e.target.classList.contains('hl') ? 'l' : e.target.classList.contains('hr') ? 'r' : 'move');
});

rows.addEventListener('dblclick', (e) => {
  const el = e.target.closest('.clip[data-uid]');
  const c = el && clipByUid(el.dataset.uid);
  if (c) openFile(c.file);
});

rows.addEventListener('contextmenu', (e) => {
  const el = e.target.closest('.clip[data-uid]');
  const c = el && clipByUid(el.dataset.uid);
  if (!c) return;
  e.preventDefault();
  selectClip(c.uid);
  const locked = S.doc.tracks[c.track].locked;
  menu(e.clientX, e.clientY, [
    [c.kind === 'page' ? '打开代码' : '查看文件', () => openFile(c.file)],
    null,
    ['在播放头处切开', () => splitAtPlayhead(), { key: 'S', disabled: locked }],
    ['复制一份', () => duplicateSelected(), { key: '⌘D', disabled: locked }],
    [c.disabled ? '启用' : '停用', () => toggleDisabled(), { key: '⇧E', disabled: locked }],
    null,
    ['删除', () => deleteSelected(), { key: '⌫', disabled: locked, danger: true }],
  ]);
});

scroller.addEventListener('wheel', (e) => {
  if (!e.metaKey && !e.ctrlKey) return;
  e.preventDefault();
  setZoom(pps * Math.exp(-e.deltaY * 0.01), laneX(e.clientX));
}, { passive: false });

// ---------------------------------------------------------------- 加素材

// 把工程里的一个文件放到时间线上。track 为空或放不下时新开一条轨道（声音放最下，画面放最上）。
export async function addFileToTimeline(file, at = S.t, track = null) {
  const kind = kindOfFile(file);
  if (!kind || file === 'film.html') return toast('这种文件不能放到时间线上');
  const spec = { kind, file, at: r3(Math.max(0, at)) };
  let len;
  if (kind === 'image') len = spec.out = 3;
  else if (kind === 'page') len = spec.out = 4;
  else {
    const p = await api(`/api/probe?path=${enc(file)}`).catch(() => null);
    if (!p || !p.duration) return toast('读不出这个文件的时长（可能没装 ffprobe）', 'bad');
    len = p.duration;
  }
  let uid = null;
  editFilm((text) => {
    let doc = parseFilm(text);
    let ti = track;
    const fits = (i) => doc.tracks[i] && !doc.tracks[i].locked && !doc.tracks[i].caption
      && !doc.tracks[i].clips.some((c) => spec.at < c.at + lengthOf(c) - 0.001 && spec.at + len > c.at + 0.001);
    if (ti == null || !fits(ti)) {
      text = addTrack(text, kind === 'audio' ? 'bottom' : 'top');
      doc = parseFilm(text);
      ti = kind === 'audio' ? doc.tracks.length - 1 : 0;
    }
    const next = insertClip(text, ti, spec);
    uid = parseFilm(next).tracks[ti].clips.at(-1)?.uid ?? null;
    return next;
  });
  if (uid) selectClip(uid);
}

const DRAG_TYPE = 'application/x-cutforge-file';
scroller.addEventListener('dragover', (e) => {
  if (e.dataTransfer.types.includes(DRAG_TYPE) || e.dataTransfer.types.includes('Files')) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    scroller.classList.add('dropping');
  }
});
scroller.addEventListener('dragleave', () => scroller.classList.remove('dropping'));
scroller.addEventListener('drop', async (e) => {
  e.preventDefault();
  scroller.classList.remove('dropping');
  const at = Math.max(0, snap(laneX(e.clientX) / pps, snapPoints(null)));
  const lane = e.target.closest('.tl-lane');
  const track = lane ? Number(lane.dataset.track) : null;
  const internal = e.dataTransfer.getData(DRAG_TYPE);
  if (internal) return addFileToTimeline(internal, at, track);
  for (const f of e.dataTransfer.files) {
    try {
      const r = await api(`/api/upload?path=${enc(`assets/${f.name}`)}`, { method: 'POST', body: f });
      await addFileToTimeline(r.path, at, track);
    } catch (err) {
      toast(`上传 ${f.name} 失败：${err.message}`, 'bad');
    }
  }
});

// ---------------------------------------------------------------- 命令

const editable = (c) => c && !S.doc.tracks[c.track].locked;

function deleteTrack(tr, i) {
  if (tr.clips.length && !confirm(`这条轨道上有 ${tr.clips.length} 个片段，一起删除？`)) return;
  editFilm((t) => removeTrack(t, i));
}

export function splitAtPlayhead() {
  const under = (c) => S.t > c.at + 0.02 && S.t < c.at + lengthOf(c) - 0.02 && !S.doc.tracks[c.track].locked;
  const sel = clipByUid(S.selected);
  const c = sel && under(sel) ? sel : S.doc.clips.find(under);
  if (!c) return toast('播放头没有落在可切开的片段上');
  editFilm((t) => splitClip(t, c.key, r3(S.t), lengthOf(c)));
}

export function deleteSelected() {
  const c = clipByUid(S.selected);
  if (!c) return;
  if (!editable(c)) return toast('这条轨道已锁定');
  editFilm((t) => removeClip(t, c.key));
}

export function toggleDisabled() {
  const c = clipByUid(S.selected);
  if (editable(c)) editFilm((t) => updateClip(t, c.key, { disabled: !c.disabled }));
}

// 副本接在原片段后面；那里被占了就放到新开的最上面一条轨道
export function duplicateSelected() {
  const c = clipByUid(S.selected);
  if (!editable(c)) return;
  const len = lengthOf(c);
  const at = r3(c.at + len);
  let uid = null;
  editFilm((text) => {
    let next = duplicateClip(text, c.key, { at });
    let doc = parseFilm(next);
    let copy = doc.tracks[c.track].clips[doc.tracks[c.track].clips.findIndex((x) => x.uid === c.uid) + 1];
    uid = copy.uid;
    if (overlapsOn(S.doc, c.track, c.uid, at, len)) {
      next = addTrack(next, c.kind === 'audio' ? 'bottom' : 'top');
      doc = parseFilm(next);
      copy = doc.clips.find((x) => x.uid === uid);
      next = moveClip(next, copy.key, c.kind === 'audio' ? doc.tracks.length - 1 : 0, {});
    }
    return next;
  });
  if (uid) selectClip(uid);
}

on('film', render);
on('info', render);
on('select', () => {
  for (const el of rows.querySelectorAll('.clip[data-uid]')) el.classList.toggle('sel', el.dataset.uid === S.selected);
});
on('time', () => {
  drawPlayhead();
  if (!S.playing) return;
  const x = HEAD + S.t * pps;
  if (x > scroller.scrollLeft + scroller.clientWidth - 40 || x < scroller.scrollLeft + HEAD) scroller.scrollLeft = x - HEAD - 60;
});
on('tab', ({ group, tab }) => { if (group === 'bottom' && tab === 'timeline') render(); });
new ResizeObserver(() => render()).observe(scroller);

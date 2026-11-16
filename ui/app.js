// 主程序：把各面板接起来——播放器消息、服务端事件、快捷键、导出与环境。
import { updateClip, setStage, setElementOverride } from '/shared/doc.mjs';
import { S, CF, $, $$, h, add, on, emit, api, toast, log, showTab, player, seek, setFilm, editFilm, undo, redo, selectClip, clipByUid, clearPick, saveEditorState, lengthOf, timecode, fmtTime, modal, menu, enc, applyTheme } from './store.js';
import { icon } from './icons.js';
import { render as drawTimeline, splitAtPlayhead, duplicateSelected, zoomBy, zoomFit } from './timeline.js';
import { deleteMany, moveMany, toggleDisabledMany, trimToPlayhead, detachAudio, copyMany, pasteMany, copyAttrs, pasteAttrs, selectAll, selectNeighbor, cutPoints, selectedClips } from './edit-ops.js';
import { externalChange, isTextFile, openFile, save as saveEditor, hasDirty } from './editor.js';
import { refresh as refreshMedia, drawStyles } from './media.js';
import './inspector.js';
import { drawAgents, drawChat, onChatEvent } from './agent.js';
import { drawProblems, onLookEvent, runLook } from './problems.js';
import { forget } from './thumbs.js';
import { loadLibrary } from './library.js';
import { loadBoard, toggleBoard } from './board.js';
import { toggleRecording } from './record.js';

// ---------------------------------------------------------------- 标签、分隔条、主题

for (const bar of $$('.tabs')) {
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b) showTab(bar.dataset.group, b.dataset.tab);
  });
}
on('tab', ({ group, tab }) => {
  if (group !== 'bottom') return;
  $('#tlLeft').classList.toggle('hidden', tab !== 'timeline');
  $('#tlRight').classList.toggle('hidden', tab !== 'timeline');
});

function splitter(el, apply) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    document.body.classList.add('resizing');
    const up = () => {
      document.body.classList.remove('resizing');
      removeEventListener('pointermove', apply);
      removeEventListener('pointerup', up);
      emit('layout');
    };
    addEventListener('pointermove', apply);
    addEventListener('pointerup', up);
  });
}
splitter($('.split-h'), (e) => {
  const hgt = Math.min(innerHeight - 240, Math.max(150, innerHeight - e.clientY - 6));
  document.documentElement.style.setProperty('--bottom', `${hgt}px`);
  localStorage.setItem('cf.bottom', String(hgt));
});
splitter($('.split-v'), (e) => {
  const r = $('#center').getBoundingClientRect();
  $('#editorPane').style.flexBasis = `${Math.min(75, Math.max(22, ((e.clientX - r.left) / r.width) * 100))}%`;
});
if (localStorage.getItem('cf.bottom')) document.documentElement.style.setProperty('--bottom', `${localStorage.getItem('cf.bottom')}px`);

// 在预览之外按下指针时，让 iframe 暂时不接收指针事件，拖动经过预览区也不会断
addEventListener('pointerdown', (e) => { if (!e.target.closest('#stageWrap')) document.body.classList.add('no-iframe'); }, true);
for (const ev of ['pointerup', 'pointercancel', 'blur']) addEventListener(ev, () => document.body.classList.remove('no-iframe'), true);

const themeBtn = $('#themeBtn');
function drawTheme(t) {
  themeBtn.innerHTML = '';
  themeBtn.append(icon(t === 'dark' ? 'sun' : 'moon', 15));
}
themeBtn.onclick = () => drawTheme(applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));

// 属性栏：选中片段时出现，可以收起
const inspector = $('#inspector');
$('#inspClose').append(icon('x', 14));
function showInspector(show) {
  inspector.classList.toggle('hidden', !show);
  localStorage.setItem('cf.insp', show ? '1' : '0');
  emit('layout');
}
$('#inspClose').onclick = () => showInspector(false);
if (localStorage.getItem('cf.insp') === '0') inspector.classList.add('hidden');
on('select', () => { if (S.selected && inspector.classList.contains('hidden')) showInspector(true); });

// ---------------------------------------------------------------- 预览与走带

const playBtn = h('button.ghost.icon.play', { title: '播放／暂停（空格）', onclick: () => player.post('toggle') }, icon('play', 18));
const now = h('b');
const total = h('span');
const volume = h('input', { type: 'range', min: '0', max: '100', value: localStorage.getItem('cf.vol') || '100', title: '预览音量', oninput: () => {
  localStorage.setItem('cf.vol', volume.value);
  player.post('volume', { value: Number(volume.value) / 100 });
} });
// 播放倍速与循环（只影响预览）
const playback = { rate: Number(localStorage.getItem('cf.rate')) || 1, loop: localStorage.getItem('cf.loop') === '1' };
const rateBtn = h('button.ghost.rate', { title: '播放倍速与循环', onclick: (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  menu(r.left, r.top - 8, [
    h('div.menu-title', {}, '播放倍速（只影响预览）'),
    ...[0.5, 1, 1.5, 2, 4].map((v) => [`${playback.rate === v ? '✓ ' : '　'}${v}×`, () => setPlayback({ rate: v })]),
    null,
    [`${playback.loop ? '✓ ' : '　'}循环播放`, () => setPlayback({ loop: !playback.loop }), { key: 'L' }],
  ]).classList.add('up');
} });
function setPlayback(p) {
  Object.assign(playback, p);
  localStorage.setItem('cf.rate', String(playback.rate));
  localStorage.setItem('cf.loop', playback.loop ? '1' : '0');
  player.post('playback', playback);
  rateBtn.textContent = `${playback.rate}×${playback.loop ? ' ↻' : ''}`;
}
const stageBtn = h('button.ghost', { title: '舞台尺寸', onclick: (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  const item = (w, hh, name) => [`${name}　${w}×${hh}`, () => editFilm((t) => setStage(t, w, hh))];
  menu(r.left, r.top - 8, [item(1920, 1080, '横屏 16:9'), item(1080, 1920, '竖屏 9:16'), item(1080, 1080, '方形 1:1'), item(1440, 1080, '标准 4:3')]).classList.add('up');
} });
add($('#transport'),
  h('div.tc', { title: '分:秒:帧（按 30 帧）' }, now, total),
  h('div.spacer'),
  rateBtn,
  h('button.ghost.icon', { title: '回到开头（Home）', onclick: () => seek(0) }, icon('start', 16)),
  playBtn,
  h('span.gap'),
  h('div.spacer'),
  h('span.vol', {}, icon('vol', 15), volume),
  stageBtn,
  h('button.ghost.icon', { title: '属性栏', onclick: () => showInspector(inspector.classList.contains('hidden')) }, icon('sliders', 15)),
  h('button.ghost.icon', { title: '全屏预览', onclick: () => $('#stageWrap').requestFullscreen?.() }, icon('expand', 15)));

function drawTransport() {
  playBtn.innerHTML = '';
  playBtn.append(icon(S.playing ? 'pause' : 'play', 18));
  now.textContent = timecode(S.t);
  total.textContent = ` / ${timecode(S.info.duration || 0)}`;
  stageBtn.innerHTML = '';
  if (S.doc) add(stageBtn, icon('aspect', 15), `${S.doc.width}×${S.doc.height}`);
}

addEventListener('message', (e) => {
  if (e.origin !== CF.preview || !e.data || e.data.source !== 'cutforge-player') return;
  const m = e.data;
  if (m.type === 'info') {
    S.info = m;
    for (const c of S.doc?.clips || []) {
      const meta = m.clips[c.key];
      if (meta && meta.uid === c.uid && meta.srcDur != null) S.srcDur[`${c.uid}|${c.file}`] = meta.srcDur;
    }
    S.playerErrors = m.errors || [];
    emit('info');
    emit('errors');
    drawTransport();
  } else if (m.type === 'time') {
    S.t = m.t;
    S.playing = m.playing;
    drawTransport();
    emit('time');
  } else if (m.type === 'errors') {
    S.playerErrors = m.errors || [];
    emit('errors');
  } else if (m.type === 'select') {
    const c = S.doc?.clips.find((x) => x.key === m.key);
    S.selected = c ? c.uid : null;
    emit('select');
  } else if (m.type === 'geom') {
    const c = S.doc?.clips.find((x) => x.key === m.key);
    if (c) editFilm((t) => updateClip(t, c.key, { box: m.box }));
  } else if (m.type === 'pick') {
    S.pick = m.pick;
    emit('pick');
    if (m.pick && inspector.classList.contains('hidden')) showInspector(true);
  } else if (m.type === 'pick-edit') emit('pick-edit');
  else if (m.type === 'elmove') {
    const c = clipByUid(m.uid);
    if (c) editFilm((t) => setElementOverride(t, c.key, m.at, { t: m.t }));
  } else if (m.type === 'key') handleKey(m);
});
on('time', drawTransport);
on('film', drawTransport);

// ---------------------------------------------------------------- 快捷键

const mac = /Mac/.test(navigator.platform);
// 快捷键：与 OpenFilm 的默认键位一致（⌘ 在 Windows 上是 Ctrl）
const FRAME = 1 / 30;
function addMarker() {
  const t = Math.round(S.t * 1000) / 1000;
  if (S.markers.some((m) => Math.abs(m.t - t) < 0.01)) return;
  S.markers.push({ t, name: '' });
  S.markers.sort((a, b) => a.t - b.t);
  saveEditorState();
}
function jumpMarker(dir) {
  const list = dir > 0 ? S.markers.filter((m) => m.t > S.t + 0.001) : S.markers.filter((m) => m.t < S.t - 0.001).reverse();
  if (list[0]) seek(list[0].t);
}
function jumpCut(dir) {
  const pts = cutPoints();
  const p = dir > 0 ? pts.find((x) => x > S.t + 0.001) : [...pts].reverse().find((x) => x < S.t - 0.001);
  if (p != null) seek(p);
}
function setRange(side) {
  const t = Math.round(S.t * 1000) / 1000;
  const r = { ...(S.range || { in: 0, out: S.info.duration || t }) };
  r[side] = t;
  S.range = r.out > r.in ? r : side === 'in' ? { in: t, out: S.info.duration || t + 1 } : { in: 0, out: t };
  saveEditorState();
}
function rangeToClips() {
  const list = selectedClips();
  if (!list.length) return;
  S.range = { in: Math.min(...list.map((c) => c.at)), out: Math.max(...list.map((c) => c.at + lengthOf(c))) };
  saveEditorState();
}
let shuttle = 0;
function handleKey(e) {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const { meta, shift, alt, ctrl } = e;
  // 基本
  if (meta && k === 'z') return shift ? redo() : undo();
  if (meta && shift && k === 'c') return copyAttrs();
  if (meta && shift && k === 'v') return pasteAttrs();
  if (meta && k === 'x') return copyMany({ cut: true });
  if (meta && k === 'c') return copyMany();
  if (meta && k === 'v') return pasteMany();
  if (meta && k === 'd') return duplicateSelected();
  if (meta && k === 'a') return selectAll();
  if (meta && k === 'b') return splitAtPlayhead();
  if (meta && k === 'e') return toggleBoard();
  if (meta && (k === '=' || k === '+')) return zoomBy(1.4);
  if (meta && k === '-') return zoomBy(1 / 1.4);
  if (meta && k === '0') return zoomFit();
  if (ctrl && shift && k === 's') return detachAudio();
  if (meta) return false;
  if (k === 'Delete' || k === 'Backspace') return deleteMany({ ripple: shift });
  // 播放
  if (e.code === 'Space') return player.post('toggle');
  if (k === 'k') { shuttle = 0; return player.post('pause'); }
  if (k === 'l' && shift) return setPlayback({ loop: !playback.loop });
  if (k === 'l') { shuttle = Math.min(3, shuttle + 1); setPlayback({ rate: [1, 1, 2, 4][shuttle] }); return player.post('play'); }
  if (k === 'j') { shuttle = 0; player.post('pause'); return seek(S.t - 1); }
  if (alt && k === 'ArrowLeft') return moveMany(-FRAME);
  if (alt && k === 'ArrowRight') return moveMany(FRAME);
  if (k === 'ArrowLeft') return seek(S.t - (shift ? 1 : FRAME));
  if (k === 'ArrowRight') return seek(S.t + (shift ? 1 : FRAME));
  if (k === 'ArrowUp') return jumpCut(-1);
  if (k === 'ArrowDown') return jumpCut(1);
  if (k === 'Home') return seek(0);
  if (k === 'End') return seek(S.info.duration || 0);
  // 入出点、标记
  if (k === 'i' && shift) return S.range && seek(S.range.in);
  if (k === 'o' && shift) return S.range && seek(S.range.out);
  if (k === 'i') return setRange('in');
  if (k === 'o') return setRange('out');
  if (k === 'x' && shift) return rangeToClips();
  if (k === 'x') { S.range = null; return saveEditorState(); }
  if (k === 'm' && shift) return jumpMarker(1);
  if (k === 'm' && alt) return jumpMarker(-1);
  if (k === 'm') return addMarker();
  // 时间线
  if (k === 'e' && shift) return toggleDisabledMany();
  if (k === 'q') return trimToPlayhead('start');
  if (k === 'w') return trimToPlayhead('end');
  if (k === '[') return selectNeighbor(-1);
  if (k === ']') return selectNeighbor(1);
  if (k === 'n') return document.querySelector('#tlRight .toggle')?.click();
  if (k === 'z' && shift) return zoomFit();
  if (k === 'Escape') return S.pick ? clearPick() : selectClip(null);
  if (k === '?') return shortcutsDialog();
  return false;
}

const SHORTCUTS = [
  ['播放', [['空格', '播放／暂停'], ['J / K / L', '后退 1 秒／停止／播放（连按 L 加速）'], ['⇧L', '循环播放'], ['← →', '前后一帧（加 ⇧ 一秒）'], ['↑ ↓', '上一个／下一个剪辑点'], ['Home / End', '开头／结尾']]],
  ['范围与标记', [['I / O', '设入点／出点'], ['⇧I / ⇧O', '跳到入点／出点'], ['X', '清除入出点'], ['⇧X', '入出点设为选中片段'], ['M', '加标记'], ['⇧M / ⌥M', '下一个／上一个标记']]],
  ['时间线', [['⌘B', '在播放头处切开'], ['Q / W', '把开头／结尾裁到播放头'], ['⌥← ⌥→', '选中片段微移一帧'], ['[ ]', '选上一个／下一个片段'], ['⇧E', '停用／启用'], ['⌃⇧S', '分离音频'], ['N', '吸附开关'], ['⌘+ ⌘- ⌘0 ⇧Z', '放大／缩小／适应']]],
  ['编辑', [['⌘Z / ⇧⌘Z', '撤销／重做'], ['⌘X ⌘C ⌘V', '剪切／复制／粘贴到播放头'], ['⌘D', '复制一份接在后面'], ['⇧⌘C / ⇧⌘V', '复制／粘贴属性'], ['⌘A', '全选'], ['⌫', '删除'], ['⇧⌫', '波纹删除'], ['⌘ 或 ⇧ 点击', '多选'], ['空白处拖动', '框选'], ['⌘S', '保存代码']]],
];
function shortcutsDialog() {
  modal('快捷键', h('div.keys', {}, SHORTCUTS.map(([title, list]) => h('div', {}, h('h4', {}, title), list.map(([k, d]) => h('div.key-row', {}, h('kbd', {}, mac ? k : k.replace(/⌘/g, 'Ctrl+').replace(/⌥/g, 'Alt+').replace(/⇧/g, 'Shift+').replace(/⌃/g, 'Ctrl+')), h('span', {}, d)))))), { wide: true });
}

addEventListener('keydown', (e) => {
  const t = e.target;
  const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable || t.closest?.('.CodeMirror');
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    return saveEditor();
  }
  if (typing) return;
  if (handleKey({ key: e.key, code: e.code, meta: e.metaKey || (e.ctrlKey && !mac), ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey }) !== false) e.preventDefault();
});
addEventListener('beforeunload', (e) => {
  if (hasDirty()) e.preventDefault();
});

// ---------------------------------------------------------------- 文件变化

async function onFs(paths) {
  const clipFiles = new Set((S.doc?.clips || []).map((c) => c.file));
  const reload = new Set();
  let allPages = false;
  for (const p of paths) {
    if (p.startsWith('exports/')) continue;
    forget(p);
    if (isTextFile(p)) {
      const text = await api(`/api/file?path=${enc(p)}`).catch(() => null);
      externalChange(p, text);
      if (p === 'film.html') {
        if (text != null && text !== S.filmText) setFilm(text, { save: false });
        continue;
      }
    }
    if (clipFiles.has(p)) reload.add(p);
    else if (/\.(m?js|css|json|svg|woff2?|ttf|otf|glsl|frag|vert|png|jpe?g|webp)$/i.test(p)) allPages = true;
  }
  if (allPages) for (const c of S.doc?.clips || []) if (c.kind === 'page') reload.add(c.file);
  if (reload.size) player.post('reload', { files: [...reload] });
  refreshMedia();
  if (reload.size) drawTimeline();
}

// ---------------------------------------------------------------- 导出

const statusEl = $('#status');
function setStatus(text, cancel) {
  statusEl.innerHTML = '';
  if (text) add(statusEl, h('span.spin'), h('span', {}, text), cancel ? h('button.ghost', { onclick: cancel }, '取消') : null);
}

function exportDialog() {
  if (S.rendering) return toast('已经有一个导出在进行');
  if (!(S.info.duration > 0)) return toast('影片还是空的，先放点东西到时间线上');
  const fps = h('select', {}, [30, 60, 25, 24].map((v) => h('option', { value: String(v) }, `${v} 帧／秒`)));
  const scale = h('select', {},
    h('option', { value: '1' }, `原始尺寸 ${S.doc.width}×${S.doc.height}`),
    h('option', { value: '0.5' }, `半尺寸 ${S.doc.width / 2}×${S.doc.height / 2}（快，用来预览）`),
    h('option', { value: '2' }, `两倍 ${S.doc.width * 2}×${S.doc.height * 2}`));
  const errors = S.doc.problems.filter((p) => p.level === 'error').length + S.playerErrors.length;
  let kind = localStorage.getItem('cf.exportKind') || 'mp4';
  const install = h('input', { type: 'checkbox', checked: !!S.jianyingRoot, disabled: !S.jianyingRoot });
  const mp4Box = h('div', {}, h('label', {}, h('span', {}, '帧率'), fps), h('label', {}, h('span', {}, '尺寸'), scale),
    h('p.hint', {}, `H.264 MP4，时长 ${fmtTime(S.info.duration)}，存到工程的 exports/。`));
  const jyBox = h('div', {},
    h('p.hint', {}, '生成剪映专业版的草稿文件夹，在剪映里接着剪。视频、图片、声音保持分轨，位置、缩放、变速、音量、淡入淡出都带过去；页面先渲染成透明背景的视频再放进去；字幕变成剪映自己的字幕（也另存一份 .srt）；淡入淡出变成不透明度关键帧。片段的 CSS 外观（圆角、滤镜、动画）剪映里没有对应。'),
    h('label.check', {}, install, S.jianyingRoot ? '直接放进剪映的草稿目录（重开剪映就能看到）' : '没找到剪映的草稿目录：导出到 exports/jianying/，再手动拷进去'),
    h('p.hint.warn', {}, '按剪映 5.9 的草稿格式生成。剪映 6 以后的版本会加密草稿，能否打开取决于你的剪映版本。'));
  const OTHER = { gif: 'GIF 动图', webm: '透明视频 WebM（VP9）', mov: '透明视频 MOV（ProRes 4444）', audio: '声音：混音 WAV + MP3', stems: '声音：每条轨一个 WAV', subtitles: '字幕 SRT + VTT', still: `静帧 PNG（播放头 ${fmtTime(S.t)}）`, slides: '幻灯片 PDF（每个镜头一页）', fcpxml: 'Final Cut／DaVinci 时间线（FCPXML）' };
  const other = h('select', {}, Object.entries(OTHER).map(([k, v]) => h('option', { value: k }, v)));
  other.value = localStorage.getItem('cf.otherKind') || 'gif';
  const otherBox = h('div', {}, h('label', {}, h('span', {}, '格式'), other),
    h('p.hint', {}, '导出的文件在工程的 exports/ 里。透明视频没有声音；FCPXML 会把素材一起拷出来，页面先渲染成透明视频。'));
  const loud = h('input', { type: 'checkbox', checked: localStorage.getItem('cf.loud') === '1', onchange: () => localStorage.setItem('cf.loud', loud.checked ? '1' : '0') });
  mp4Box.append(h('label.check', {}, loud, '响度标准化到 -14 LUFS（各大视频平台的标准）'));
  const onlyRange = h('input', { type: 'checkbox', checked: !!S.range, disabled: !S.range });
  mp4Box.append(h('label.check', {}, onlyRange, S.range ? `只导出入出点之间（${fmtTime(S.range.in)} → ${fmtTime(S.range.out)}）` : '只导出入出点之间（先在时间线上按 I／O 设入出点）'));
  if (3840 / S.doc.width !== 2) scale.append(h('option', { value: String(3840 / S.doc.width) }, `4K ${3840}×${Math.round((3840 * S.doc.height) / S.doc.width)}`));
  const seg = h('div.seg');
  const draw = () => {
    seg.innerHTML = '';
    for (const [k, label] of [['mp4', 'MP4 视频'], ['jianying', '剪映草稿'], ['other', '其它格式']]) seg.append(h(`button${kind === k ? '.on' : ''}`, { onclick: () => { kind = k; localStorage.setItem('cf.exportKind', k); draw(); } }, label));
    mp4Box.classList.toggle('hidden', kind !== 'mp4');
    jyBox.classList.toggle('hidden', kind !== 'jianying');
    otherBox.classList.toggle('hidden', kind !== 'other');
  };
  draw();
  const close = modal('导出', h('div.form', {}, seg, mp4Box, jyBox, otherBox,
    errors ? h('p.hint.warn', {}, `“问题”里还有 ${errors} 个错误，导出的画面可能不对。`) : null,
    h('div.row.end', {}, h('button.primary', { onclick: async () => {
      close();
      try {
        if (kind === 'jianying') await api('/api/export/jianying', { method: 'POST', json: { install: install.checked } });
        else if (kind === 'other') {
          localStorage.setItem('cf.otherKind', other.value);
          await api('/api/export', { method: 'POST', json: { kind: other.value, t: S.t } });
        } else await api('/api/render', { method: 'POST', json: { fps: Number(fps.value), scale: Number(scale.value), loudness: loud.checked ? -14 : null, range: onlyRange.checked && S.range ? [S.range.in, S.range.out] : null } });
      } catch (e) {
        toast(e.message, 'bad');
      }
    } }, '开始导出'))));
}

function onRender(ev) {
  const cancel = () => api('/api/render/cancel', { method: 'POST', json: {} });
  if (ev.state === 'start') {
    S.rendering = ev.file;
    setStatus('正在导出…', cancel);
    log(`开始导出 ${ev.file}`);
  } else if (ev.state === 'progress') setStatus(ev.text || `正在导出 ${Math.round((ev.frame / ev.total) * 100)}%`, cancel);
  else {
    S.rendering = null;
    setStatus('');
    if (ev.state === 'done' && ev.kind === 'jianying') {
      const i = ev.info;
      log(`已导出剪映草稿 ${i.folder}（${i.videoTracks} 条视频轨、${i.audioTracks} 条音频轨，${i.pages} 个页面渲染成视频${i.subtitles.length ? `，字幕 ${i.subtitles.join('、')}` : ''}）${i.installed ? `；已放进剪映：${i.installed}` : ''}`);
      for (const n of i.notes) log(`  提醒：${n}`);
      toast(i.installed ? '剪映草稿已放进剪映，重开剪映就能看到' : `已导出剪映草稿 ${i.folder}`, 'good', [['在文件夹中显示', () => api('/api/reveal', { method: 'POST', json: { path: i.folder } })]]);
    } else if (ev.state === 'done' && ev.kind === 'other') {
      const i = ev.info;
      log(`已导出 ${i.label}：${i.files.join('、')}`);
      for (const n of i.notes) log(`  提醒：${n}`);
      toast(`已导出 ${i.label}`, 'good', [['在文件夹中显示', () => api('/api/reveal', { method: 'POST', json: { path: i.files[0] } })]]);
      refreshMedia();
    } else if (ev.state === 'done') {
      const i = ev.info;
      log(`已导出 ${ev.file}（${i.width}×${i.height}，${i.fps} fps，${i.duration.toFixed(2)} 秒，${i.audioClips} 路声音，用时 ${i.seconds.toFixed(1)} 秒）`);
      toast(`已导出 ${ev.file}`, 'good', [['播放', () => openFile(ev.file)], ['在文件夹中显示', () => api('/api/reveal', { method: 'POST', json: { path: ev.file } })]]);
      refreshMedia();
    } else {
      log(`导出失败：${ev.message}`);
      toast(`导出失败：${ev.message}`, 'bad');
    }
  }
}

// ---------------------------------------------------------------- 环境

async function envDialog() {
  const body = h('div.env', {}, h('p.hint', {}, '正在检查这台电脑…'));
  modal('环境与智能体', body, { wide: true });
  let data;
  try {
    data = await api('/api/doctor');
  } catch (e) {
    body.innerHTML = '';
    return body.append(h('p.hint.warn', {}, e.message));
  }
  S.agents = data.agents;
  drawAgents();
  const custom = (data.config.agents || []).map((a) => ({ ...a }));
  const gs = await api('/api/gen/status').catch(() => null);
  const llm = await api('/api/llm').catch(() => null);
  const usage = await api('/api/usage').catch(() => []);
  const llmBox = h('div.custom');
  if (llm) {
    const st = llm.status || {};
    const preset = h('select', {}, llm.presets.map((p) => h('option', { value: p.id }, p.name)));
    preset.value = st.preset || 'deepseek';
    const base = h('input.grow', { placeholder: '接口地址，例如 https://api.deepseek.com', value: st.base || '' });
    const model = h('input', { placeholder: '模型名', value: st.model || '', style: { width: '170px' } });
    const key = h('input.grow', { type: 'password', autocomplete: 'off', placeholder: st.hasKey ? '已保存（填新的会覆盖）' : 'API 密钥' });
    const fill = () => {
      const p = llm.presets.find((x) => x.id === preset.value);
      if (p && p.base) { base.value = p.base; model.value = p.model; }
    };
    preset.onchange = fill;
    if (!st.base) fill();
    add(llmBox,
      h('div.row', {}, preset, model),
      h('div.row', {}, base),
      h('div.row', {}, key, h('button', { onclick: async () => {
        try {
          await api('/api/llm', { method: 'POST', json: { preset: preset.value, base: base.value, model: model.value, key: key.value } });
          toast('已保存。智能体列表里会出现“内置智能体”', 'good');
          envDialog();
        } catch (e) {
          toast(e.message, 'bad');
        }
      } }, '保存')));
  }
  const keyRows = h('div.custom');
  if (gs) {
    for (const [id, s] of Object.entries(gs.services)) {
      keyRows.append(h('div.row', {}, h('b', { style: { width: '110px' } }, s.name), h('input.grow', { name: id, type: 'password', autocomplete: 'off', placeholder: gs.keys[id] ? '已保存（填新的会覆盖）' : `${s.what} · 在 ${new URL(s.url).host} 获取` })));
    }
    keyRows.append(h('div.row', {}, h('p.hint', { style: { flex: 1, margin: 0 } }, `语音转字幕：${gs.speech.whisper ? 'whisper.cpp 已安装' : '没有 whisper.cpp（brew install whisper-cpp）'}；${gs.speech.models.small ? '正在用更准的中文模型' : gs.speech.models.base ? '已有标准模型，中文识别一般' : '第一次使用时自动下载标准模型（约 150MB）'}`),
      gs.speech.models.small ? null : h('button', { onclick: async () => { const g = await import('./generate.js'); g.downloadBetterModel().catch((e) => toast(e.message, 'bad')); } }, '下载更准的中文模型')));
  }
  const rows = h('div.custom');
  const drawCustom = () => {
    rows.innerHTML = '';
    custom.forEach((a, i) => rows.append(h('div.row', {},
      h('input', { placeholder: '名字，如 Kimi', value: a.name, oninput: (e) => { a.name = e.target.value; } }),
      h('input.grow', { placeholder: '命令，如 kimi --print {prompt}', value: a.command, oninput: (e) => { a.command = e.target.value; } }),
      h('button.ghost.icon', { onclick: () => { custom.splice(i, 1); drawCustom(); } }, icon('trash', 13)))));
  };
  drawCustom();
  body.innerHTML = '';
  add(body,
    h('h4', {}, '出片需要的工具'),
    data.checks.map((c) => h(`div.check.${c.ok ? 'ok' : c.required ? 'bad' : 'warn'}`, {},
      h('i', {}, c.ok ? '✓' : c.required ? '✗' : '!'), h('b', {}, c.label), h('span', { title: c.detail }, c.detail), c.ok ? null : h('code', {}, c.fix))),
    h('h4', {}, '智能体命令行'),
    data.agents.map((a) => h(`div.check.${a.installed ? (a.loggedIn === false ? 'warn' : 'ok') : 'off'}`, {},
      h('i', {}, a.installed ? '●' : '○'), h('b', {}, a.name),
      h('span', { title: a.path || '' }, a.installed ? `${a.version || a.path}${a.loggedIn === false ? ' · 未登录' : a.loggedIn ? ' · 已登录' : ''}${a.tested ? '' : ' · 未实测'}` : '未安装'),
      a.installed ? null : h('code', {}, a.install))),
    h('h4', {}, '服务密钥'),
    h('p.hint', {}, '用于生成图片、音乐和高质量配音。密钥只存在这台电脑的 ~/.cutforge/keys.json，只在调用对应服务时发给它。留空表示不改。'),
    keyRows,
    h('div.row', {}, h('div.spacer'), h('button', { onclick: async () => {
      const body = {};
      for (const inp of keyRows.querySelectorAll('input')) if (inp.value.trim()) body[inp.name] = inp.value.trim();
      try {
        await api('/api/gen/keys', { method: 'POST', json: body });
        toast('密钥已保存', 'good');
        const g = await import('./generate.js');
        await g.loadGenStatus();
        envDialog();
      } catch (e) {
        toast(e.message, 'bad');
      }
    } }, '保存密钥')),
    h('h4', {}, '内置智能体（API 密钥直连模型）'),
    h('p.hint', {}, '没装命令行智能体也能出片：直接用兼容 OpenAI 接口的大模型（DeepSeek、Kimi、通义千问、OpenAI 或中转站）。模型要支持工具调用。密钥只存在这台电脑的 ~/.cutforge/llm.json。'),
    llmBox,
    usage.length ? h('h4', {}, '各家智能体对比') : null,
    usage.length ? h('table.usage', {}, h('tr', {}, h('th', {}, '智能体'), h('th', {}, '次数'), h('th', {}, '成功率'), h('th', {}, '平均用时'), h('th', {}, '平均用量')),
      usage.map((u) => h('tr', {}, h('td', {}, u.agent), h('td', {}, String(u.runs)), h('td', {}, `${Math.round(u.okRate * 100)}%`), h('td', {}, `${Math.round(u.avgSeconds)} 秒`), h('td', {}, u.avgTokens != null ? `${u.avgTokens.toLocaleString()} tokens` : '—')))) : null,
    h('h4', {}, '自定义智能体'),
    h('p.hint', {}, '任何能在命令行里不问话跑完一个任务的智能体都能接。命令里写 {prompt} 的位置会换成任务书；不写则从标准输入传入。它会在工程目录里运行。'),
    rows,
    h('div.row', {},
      h('button', { onclick: () => { custom.push({ name: '', command: '' }); drawCustom(); } }, '添加一个'),
      h('div.spacer'),
      h('button.primary', { onclick: async () => {
        try {
          const r = await api('/api/config', { method: 'POST', json: { agents: custom } });
          S.agents = r.agents;
          drawAgents();
          toast('已保存', 'good');
        } catch (e) {
          toast(e.message, 'bad');
        }
      } }, '保存')));
}
on('env', envDialog);

// ---------------------------------------------------------------- 版本

async function versionsDialog() {
  const list = h('div.versions');
  const name = h('input', { placeholder: '版本名，例如“给客户看的第一版”' });
  const draw = async () => {
    const vs = await api('/api/versions').catch(() => []);
    list.innerHTML = '';
    if (!vs.length) list.append(h('p.hint', {}, '还没有存过版本。'));
    for (const v of vs) {
      add(list, h('div.version', {},
        h('b', {}, v.name), h('span.dim', {}, `${new Date(v.time).toLocaleString()} · ${v.count} 个文件`), h('div.spacer'),
        h('button', { onclick: async () => {
          if (!confirm(`回到“${v.name}”？当前状态会先自动存一个版本。`)) return;
          try {
            const r = await api('/api/versions', { method: 'POST', json: { op: 'restore', id: v.id } });
            toast(`已回到“${r.restored}”`, 'good');
            draw();
          } catch (e) {
            toast(e.message, 'bad');
          }
        } }, '回到这个版本'),
        h('button.ghost.icon', { title: '删除这个版本', onclick: async () => { await api('/api/versions', { method: 'POST', json: { op: 'delete', id: v.id } }); draw(); } }, icon('trash', 13))));
    }
  };
  modal('版本', add(h('div.form'),
    h('div.row', {}, name, h('button.primary', { onclick: async () => {
      const r = await api('/api/versions', { method: 'POST', json: { op: 'save', name: name.value } });
      name.value = '';
      toast(`已存版本“${r.name}”`, 'good');
      draw();
    } }, '存为版本')),
    h('p.hint', {}, '版本存的是工程里的全部文件（不含 exports/）。回到旧版本前会自动把当前状态存一份，不会丢。'), list), { wide: true });
  draw();
}

// ---------------------------------------------------------------- 启动

function connectEvents() {
  const es = new EventSource(`/api/events?token=${CF.token}`);
  es.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === 'fs') onFs(ev.paths);
    else if (ev.type === 'chat') onChatEvent(ev);
    else if (ev.type === 'look') onLookEvent(ev);
    else if (ev.type === 'render') onRender(ev);
    else if (ev.type === 'model') {
      emit('model', ev);
      if (ev.total) setStatus(`下载识别模型 ${Math.round((ev.got / ev.total) * 100)}%`);
      if (ev.done || ev.error) setStatus('');
    }
    else if (ev.type === 'agent') {
      S.agentBusy = ev.state === 'start';
      emit('agentBusy');
      if (ev.state === 'start') log('智能体开始工作');
      else {
        log(ev.ok ? '智能体完成，自动检查影片' : '智能体没有完成');
        if (ev.ok) toast('智能体做完了，正在检查影片', 'good');
      }
    }
  };
  es.onerror = () => {
    setStatus('与本地服务的连接断开，正在重连…');
    fetch('/api/tree', { headers: { 'x-cutforge-token': CF.token } }).then((r) => { if (r.status === 403) location.reload(); }, () => {});
  };
  es.onopen = () => { if (!S.rendering) setStatus(''); };
}

async function boot() {
  const state = await api('/api/state');
  Object.assign(S, { name: state.name, root: state.root, platform: state.platform, agents: state.agents, styles: state.styles, chat: state.chat, look: state.look, agentBusy: state.agentBusy, rendering: state.rendering, jianyingRoot: state.jianyingRoot });
  document.title = `${S.name} — CutForge`;
  add($('#projBtn'), icon('folder', 14), S.name);
  $('#projBtn').onclick = () => api('/api/reveal', { method: 'POST', json: {} });
  $('#lookBtn').onclick = runLook;
  $('#exportBtn').onclick = exportDialog;
  $('#envBtn').onclick = envDialog;
  $('#versionsBtn').onclick = versionsDialog;
  $('#keysBtn').onclick = shortcutsDialog;
  $('#recBtn').onclick = toggleRecording;
  for (const b of $$('#modeSeg button')) b.onclick = () => toggleBoard(b.dataset.mode === 'board');
  on('layout', () => { const board = !$('#board').classList.contains('hidden'); for (const b of $$('#modeSeg button')) b.classList.toggle('on', (b.dataset.mode === 'board') === board); });
  if (!state.hasCodeMirror) log('没有安装 CodeMirror（在 CutForge 目录运行 npm install），代码编辑器暂用纯文本框');

  const theme = document.documentElement.dataset.theme;
  drawTheme(theme);
  const text = await api('/api/file?path=film.html').catch(() => '');
  const frame = $('#player');
  await new Promise((resolve) => {
    frame.addEventListener('load', resolve, { once: true });
    frame.src = `${CF.preview}/__cf__/player.html?film=film.html&theme=${theme}`;
  });
  setFilm(text, { push: false, save: false });
  player.post('volume', { value: Number(volume.value) / 100 });
  setPlayback({});
  Object.assign(S, await api('/api/editor-state').catch(() => ({ markers: [], range: null })));
  refreshMedia();
  loadLibrary();
  loadBoard();
  drawStyles();
  drawAgents();
  drawChat();
  drawProblems();
  drawTransport();
  drawTimeline();
  emit('agentBusy');
  connectEvents();
  if (S.rendering) setStatus('正在导出…', () => api('/api/render/cancel', { method: 'POST', json: {} }));
}

boot().catch((e) => {
  document.body.append(h('div.fatal', {}, `启动失败：${e.message}`));
});

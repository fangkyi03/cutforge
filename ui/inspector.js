// 属性栏：选中片段时改它的位置、外观、时间和声音；没选中时改舞台。
import { updateClip, setStage, setLookProp, getLookProp, setElementOverride, r3 } from '/shared/doc.mjs';
import { S, $, h, add, on, editFilm, clipByUid, lengthOf, fmtTime, toast, clearPick } from './store.js';
import { icon } from './icons.js';
import { openFile } from './editor.js';

const pane = $('#props');
const KIND = { page: '页面', video: '视频', image: '图片', audio: '声音' };

function field(label, value, { step = 0.1, min = null, unit = '', onchange, disabled = false, title = '' } = {}) {
  const input = h('input', { type: 'number', step: String(step), value: value == null ? '' : String(value), disabled });
  if (min != null) input.min = String(min);
  input.addEventListener('change', () => {
    if (input.value === '') return onchange(null);
    const v = Number(input.value);
    if (Number.isFinite(v)) onchange(v);
  });
  return h('label.field', { title }, h('span', {}, label), input, unit ? h('em', {}, unit) : null);
}

const section = (title, ...kids) => add(h('div.sec'), h('h4', {}, title), kids);

function drawStage() {
  const d = S.doc;
  const preset = (w, hh, name) => h(`button${d.width === w && d.height === hh ? '.on' : ''}`, { onclick: () => editFilm((t) => setStage(t, w, hh)) }, name);
  add(pane,
    h('div.nothing', {}, icon('sliders', 20), h('b', {}, '没有选中片段'), h('p', {}, '点一下预览里的画面或时间线上的片段，这里显示它的属性。预览里可以直接拖动和缩放画面；双击画面里的文字可以改它。')),
    section('舞台',
      h('div.seg', {}, preset(1920, 1080, '横屏 16:9'), preset(1080, 1920, '竖屏 9:16'), preset(1080, 1080, '方形 1:1'), preset(1440, 1080, '4:3')),
      h('div.grid2', {},
        field('宽', d.width, { step: 2, min: 16, onchange: (v) => v && editFilm((t) => setStage(t, Math.round(v), d.height)) }),
        field('高', d.height, { step: 2, min: 16, onchange: (v) => v && editFilm((t) => setStage(t, d.width, Math.round(v))) })),
      h('p.hint', {}, `总长 ${fmtTime(S.info.duration || 0)} · ${d.tracks.length} 条轨道 · ${d.clips.length} 个片段`)));
}

const toHex = (color) => {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(color || '');
  return m ? `#${[m[1], m[2], m[3]].map((v) => Math.round(Number(v)).toString(16).padStart(2, '0')).join('')}` : '#000000';
};

// 页面里被选中的那个元素：文字、颜色、字号、位移、缩放。改动写进片段的 overrides，页面代码不动。
function drawElement(c, locked) {
  const p = S.pick;
  const entry = c.overrides.find((o) => o && o.at === p.at) || {};
  const set = (patch) => editFilm((t) => setElementOverride(t, c.key, p.at, patch));
  const text = h('textarea.el-text', { rows: 2, value: p.text, disabled: locked || !p.editable, placeholder: p.editable ? '' : '这个元素自己没有文字（文字在它里面的元素上，再点一下具体的字）' });
  text.addEventListener('change', () => set({ text: text.value }));
  const color = h('input', { type: 'color', value: toHex(p.color), disabled: locked });
  color.addEventListener('change', () => set({ style: { color: color.value } }));
  const changed = Object.keys(entry).some((k) => k !== 'at' && k !== 'n');
  return add(h('div.sec.el-sec'),
    h('div.el-head', {},
      h('span.badge.k-el', {}, '元素'), h('code', { title: p.at }, `<${p.tag}>`),
      h('div.spacer'),
      changed ? h('button.ghost', { title: '去掉对这个元素的全部修改', disabled: locked, onclick: () => set(null) }, '恢复原样') : null,
      h('button.ghost.icon', { title: '退出元素选择（Esc）', onclick: () => clearPick() }, icon('x', 13))),
    text,
    h('div.grid2', {},
      h('label.field.color', {}, h('span', {}, '颜色'), color, h('em', {}, toHex(p.color))),
      field('字号', p.fontSize, { step: 1, min: 1, unit: 'px', disabled: locked, onchange: (v) => set({ style: { fontSize: v ? `${v}px` : null } }) }),
      field('位移 X', entry.t?.[0] ?? 0, { step: 1, disabled: locked, onchange: (v) => set({ t: [v || 0, entry.t?.[1] ?? 0] }) }),
      field('位移 Y', entry.t?.[1] ?? 0, { step: 1, disabled: locked, onchange: (v) => set({ t: [entry.t?.[0] ?? 0, v || 0] }) }),
      field('缩放', Math.round((entry.s ?? 1) * 100), { step: 5, min: 1, unit: '%', disabled: locked, onchange: (v) => set({ s: v ? v / 100 : 1 }) }),
      field('旋转', entry.r ?? 0, { step: 1, unit: '°', disabled: locked, onchange: (v) => set({ r: v || 0 }) })),
    h('p.hint', {}, '在预览里拖动它可以移动；这些修改只记在这个片段上，智能体改页面时会保留。'));
}

function drawClip(c) {
  const len = lengthOf(c);
  const media = c.kind === 'video' || c.kind === 'audio';
  const sp = media ? c.speed : 1;
  const out = c.out ?? r3(c.in + len * sp);
  const locked = S.doc.tracks[c.track].locked;
  const set = (patch) => editFilm((t) => updateClip(t, c.key, patch));
  const rect = S.info.clips[c.key]?.rect || {};
  const W = S.doc.width;
  const H = S.doc.height;
  const cur = { left: rect.left ?? 0, top: rect.top ?? 0, width: rect.width ?? W, height: rect.height ?? H };
  const place = (patch) => set({ box: { left: Math.round(cur.left), top: Math.round(cur.top), width: Math.round(cur.width), height: Math.round(cur.height), ...patch } });
  const show = (k) => (c.box[k] != null ? c.box[k] : rect[k] != null ? Math.round(rect[k]) : null);
  const look = (prop, value) => set({ look: setLookProp(c.look, prop, value) });
  const opacity = getLookProp(c.look, 'opacity');
  const radius = getLookProp(c.look, 'border-radius');

  add(pane,
    h('div.clip-head', {},
      h(`span.badge.k-${c.kind}`, {}, KIND[c.kind]),
      h('b', { title: c.uid }, c.uid),
      h('button.ghost', { title: c.kind === 'page' ? '打开这个页面的代码' : '查看文件', onclick: () => openFile(c.file) }, icon(c.kind === 'page' ? 'code' : 'file', 13), c.file.split('/').pop())),
    locked ? h('p.hint.warn', {}, '这条轨道已锁定，先在时间线上解锁再改。') : null,
    S.pick && S.pick.uid === c.uid ? drawElement(c, locked) : null);

  if (c.kind !== 'audio') {
    const align = (name, title, patch) => h('button.ghost.icon', { title, disabled: locked, onclick: () => place(patch()) }, icon(name, 15));
    add(pane,
      h('div.align', {},
        align('alignL', '靠左', () => ({ left: 0 })),
        align('alignC', '水平居中', () => ({ left: Math.round((W - cur.width) / 2) })),
        align('alignR', '靠右', () => ({ left: Math.round(W - cur.width) })),
        h('span.sep'),
        align('alignT', '靠上', () => ({ top: 0 })),
        align('alignM', '垂直居中', () => ({ top: Math.round((H - cur.height) / 2) })),
        align('alignB', '靠下', () => ({ top: Math.round(H - cur.height) }))),
      section('位置',
        h('div.grid2', {},
          field('X', show('left'), { step: 1, disabled: locked, onchange: (v) => set({ box: { left: v } }) }),
          field('Y', show('top'), { step: 1, disabled: locked, onchange: (v) => set({ box: { top: v } }) }),
          field('旋转', c.box.rotate || 0, { step: 1, unit: '°', disabled: locked, onchange: (v) => set({ box: { rotate: v || null } }) }))),
      section('大小',
        h('div.grid2', {},
          field('宽', show('width'), { step: 1, min: 1, disabled: locked, onchange: (v) => set({ box: { width: v } }) }),
          field('高', show('height'), { step: 1, min: 1, disabled: locked, onchange: (v) => set({ box: { height: v } }) })),
        h('div.row', {},
          h('button', { disabled: locked, onclick: () => set({ box: { left: null, top: null, width: null, height: null, rotate: null } }) }, c.kind === 'page' ? '恢复默认' : '铺满舞台'))),
      section('外观',
        h('div.grid2', {},
          field('不透明', opacity == null ? 100 : Math.round(Number.parseFloat(opacity) * 100), { step: 5, min: 0, unit: '%', disabled: locked, onchange: (v) => look('opacity', v == null || v >= 100 ? null : String(Math.max(0, v) / 100)) }),
          field('圆角', radius == null ? 0 : Number.parseFloat(radius), { step: 2, min: 0, unit: 'px', disabled: locked, onchange: (v) => look('border-radius', v ? `${v}px` : null) })),
        c.cls ? h('p.hint', {}, `还套用了 class="${c.cls}"，样式在 film.html 的 <style> 里。`) : null));
  }

  add(pane,
    section('时间',
      h('div.grid2', {},
        field('开始', c.at, { min: 0, unit: '秒', disabled: locked, onchange: (v) => set({ at: Math.max(0, v || 0) }) }),
        field('时长', r3(len), { min: 0.1, unit: '秒', disabled: locked, onchange: (v) => v && set({ out: r3(c.in + Math.max(0.1, v) * sp) }) }),
        c.kind === 'image' ? null : field('入点', c.in, { min: 0, unit: '秒', disabled: locked, title: '从文件的第几秒开始播', onchange: (v) => {
          const i = Math.max(0, v || 0);
          if (i >= out) return toast('入点要早于出点');
          set({ in: i, out });
        } }),
        c.kind === 'image' ? null : field('出点', out, { min: 0, unit: '秒', disabled: locked, title: '播到文件的第几秒', onchange: (v) => {
          if (!(v > c.in)) return toast('出点要晚于入点');
          set({ out: v });
        } }),
        field('淡入', c.fade[0], { min: 0, unit: '秒', disabled: locked, onchange: (v) => set({ fade: [Math.min(Math.max(0, v || 0), len), c.fade[1]] }) }),
        field('淡出', c.fade[1], { min: 0, unit: '秒', disabled: locked, onchange: (v) => set({ fade: [c.fade[0], Math.min(Math.max(0, v || 0), len)] }) }))),
    media ? section('声音与速度',
      h('div.grid2', {},
        field('音量', Math.round(c.volume * 100), { step: 5, min: 0, unit: '%', disabled: locked, onchange: (v) => set({ volume: Math.max(0, (v || 0) / 100) }) }),
        field('速度', c.speed, { step: 0.05, min: 0.1, unit: '×', disabled: locked, onchange: (v) => v && set({ speed: Math.min(100, Math.max(0.1, v)), out }) }))) : null,
    h('label.check', {}, h('input', { type: 'checkbox', checked: c.disabled, disabled: locked, onchange: (e) => set({ disabled: e.target.checked }) }), '停用（不显示也不出声，位置保留）'));
}

function draw() {
  if (!S.doc) return;
  const focus = document.activeElement && pane.contains(document.activeElement) ? document.activeElement.previousSibling?.textContent : null;
  const scroll = pane.scrollTop;
  pane.innerHTML = '';
  const c = clipByUid(S.selected);
  if (c) drawClip(c);
  else drawStage();
  pane.scrollTop = scroll;
  if (focus) {
    for (const f of pane.querySelectorAll('label.field')) {
      if (f.firstChild.textContent === focus) f.querySelector('input').focus();
    }
  }
}

on('film', draw);
on('info', draw);
on('select', draw);
on('pick', draw);
on('pick-edit', () => setTimeout(() => {
  const t = pane.querySelector('.el-text:not(:disabled)');
  if (t) {
    t.focus();
    t.select();
  }
}, 60));

// 左栏：素材（缩略图网格）、文件（整个工程的文件树）、风格库。
// 素材和文件都能点开、拖到时间线、右键操作；外部文件拖进来就是上传。
import { kindOfFile } from '/shared/doc.mjs';
import { S, $, h, add, on, emit, api, toast, enc, menu } from './store.js';
import { icon, iconForFile } from './icons.js';
import { openFile } from './editor.js';
import { addFileToTimeline } from './timeline.js';
import { frameUrl, waveUrl, fileUrl } from './thumbs.js';

const DRAG_TYPE = 'application/x-cutforge-file';
const mediaPane = $('#media');
const filesPane = $('#files');
const grid = h('div.grid');
const list = h('div.tree');
const search = h('input.search', { placeholder: '搜索素材', oninput: () => drawMedia() });
const picker = h('input', { type: 'file', multiple: true, style: { display: 'none' }, onchange: () => {
  upload([...picker.files]);
  picker.value = '';
} });
const open = new Set(['scenes', 'assets']);
let tree = [];

add(mediaPane,
  h('div.pane-bar', {},
    h('label.search-box', {}, icon('search', 13), search),
    h('button.ghost.icon', { title: '新建页面（一个镜头）', onclick: newPage }, icon('plus', 15)),
    h('button.ghost.icon', { title: '导入素材到 assets/', onclick: () => picker.click() }, icon('upload', 15))),
  grid, picker);
add(filesPane,
  h('div.pane-bar', {},
    h('span.dim', {}, '工程里的全部文件'),
    h('div.spacer'),
    h('button.ghost.icon', { title: '刷新', onclick: () => refresh() }, icon('refresh', 14))),
  list);

const PAGE_TEMPLATE = (name) => `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #101218; color: #f3f5fa; }
  body { display: grid; place-items: center; font: 700 8vw/1.1 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
</style>
</head>
<body>
<div id="text">${name}</div>
<script type="module">
const text = document.getElementById('text');
const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

window.film = {
  duration: 4,
  frame(t) {
    const k = ease(t / 0.6);
    text.style.opacity = k;
    text.style.translate = \`0 \${(1 - k) * 40}px\`;
  },
};
if (!window.filmHost) {
  const t0 = performance.now();
  const loop = () => { film.frame(((performance.now() - t0) / 1000) % film.duration); requestAnimationFrame(loop); };
  loop();
}
</script>
</body>
</html>
`;

async function newPage() {
  const name = (prompt('新页面的名字（会建在 scenes/ 里）', 'shot') || '').trim().replace(/\.html?$/i, '');
  if (!name) return;
  if (/[\\/:*?"<>|]/.test(name)) return toast('名字里不能有 / \\ : * ? " < > |', 'bad');
  const path = `scenes/${name}.html`;
  try {
    await api('/api/fs', { method: 'POST', json: { op: 'newfile', path, text: PAGE_TEMPLATE(name) } });
    await refresh();
    openFile(path);
  } catch (e) {
    toast(e.message, 'bad');
  }
}

async function upload(files) {
  for (const f of files) {
    try {
      const r = await api(`/api/upload?path=${enc(`assets/${f.name}`)}`, { method: 'POST', body: f });
      toast(`已导入 ${r.path}`, 'good');
    } catch (e) {
      toast(`导入 ${f.name} 失败：${e.message}`, 'bad');
    }
  }
  refresh();
}

async function remove(node) {
  if (node.path === 'film.html') return toast('film.html 是影片本身，不能删除');
  const used = S.doc?.clips.some((c) => c.file === node.path);
  if (!confirm(`删除 ${node.path}${node.dir ? ' 和里面的所有文件' : ''}？${used ? '\n它正在时间线上使用，删除后那些片段会失效。' : ''}`)) return;
  await api('/api/fs', { method: 'POST', json: { op: 'delete', path: node.path } }).catch((e) => toast(e.message, 'bad'));
  refresh();
}

async function rename(node) {
  const next = (prompt('新名字', node.name) || '').trim();
  if (!next || next === node.name) return;
  const to = [...node.path.split('/').slice(0, -1), next].join('/');
  await api('/api/fs', { method: 'POST', json: { op: 'rename', path: node.path, to } }).catch((e) => toast(e.message, 'bad'));
  refresh();
}

const placeable = (node) => !node.dir && kindOfFile(node.path) && node.path !== 'film.html';
const isUsed = (path) => !!S.doc?.clips.some((c) => c.file === path);

function fileMenu(e, node) {
  e.preventDefault();
  const items = [];
  if (!node.dir) items.push([kindOfFile(node.path) === 'page' || !kindOfFile(node.path) ? '打开代码' : '查看', () => openFile(node.path)]);
  if (placeable(node)) items.push(['放到时间线的播放头处', () => addFileToTimeline(node.path)]);
  items.push(['在文件管理器中显示', () => api('/api/reveal', { method: 'POST', json: { path: node.path } })], null,
    ['重命名', () => rename(node)], ['删除', () => remove(node), { danger: true }]);
  menu(e.clientX, e.clientY, items);
}

const dragStart = (node) => (e) => {
  e.dataTransfer.setData(DRAG_TYPE, node.path);
  e.dataTransfer.effectAllowed = 'copy';
};

// ---------------------------------------------------------------- 素材网格

const KIND_NAME = { page: '页面', video: '视频', image: '图片', audio: '声音' };

function flat(nodes, out = []) {
  for (const n of nodes) {
    if (n.dir) flat(n.children, out);
    else if (placeable(n)) out.push(n);
  }
  return out;
}

function thumbFor(node, kind) {
  const box = h(`div.thumb.k-${kind}`, { dataset: { file: node.path, kind } });
  if (kind === 'image') box.append(h('img', { src: fileUrl(node.path), draggable: false, loading: 'lazy' }));
  else if (kind === 'audio') {
    const w = h('div.wave');
    const url = waveUrl(node.path);
    if (url) w.style.setProperty('--wave', `url("${url}")`);
    box.append(w);
  } else {
    const img = h('img', { draggable: false });
    const url = frameUrl(node.path, kind === 'page' ? 1.5 : 0.5);
    if (url) img.src = url;
    box.append(img);
  }
  return box;
}

function drawMedia() {
  const q = search.value.trim().toLowerCase();
  const order = { page: 0, video: 1, image: 2, audio: 3 };
  const items = flat(tree).filter((n) => !q || n.path.toLowerCase().includes(q))
    .sort((a, b) => order[kindOfFile(a.path)] - order[kindOfFile(b.path)] || a.name.localeCompare(b.name));
  grid.innerHTML = '';
  if (!items.length) {
    add(grid, h('div.empty', {},
      icon('image', 22), h('b', {}, q ? '没有匹配的素材' : '还没有素材'),
      q ? null : h('p', {}, '把视频、图片、声音拖到这里导入；智能体做出来的页面也会出现在这里。'),
      q ? null : h('button', { onclick: () => picker.click() }, icon('upload', 14), '导入素材')));
    return;
  }
  for (const n of items) {
    const kind = kindOfFile(n.path);
    grid.append(h(`div.cell${isUsed(n.path) ? '.used' : ''}`, {
      draggable: 'true', title: `${n.path}\n双击${kind === 'page' ? '打开代码' : '查看'}，拖到时间线使用`,
      ondragstart: dragStart(n), ondblclick: () => openFile(n.path), oncontextmenu: (e) => fileMenu(e, n),
    },
    thumbFor(n, kind),
    h('button.add', { title: '放到时间线的播放头处', onclick: (e) => { e.stopPropagation(); addFileToTimeline(n.path); } }, icon('plus', 13)),
    h('span.kind', {}, KIND_NAME[kind]),
    h('div.cap', {}, h('span', {}, n.name.replace(/\.[^.]+$/, '')), isUsed(n.path) ? h('i.dot', { title: '已在时间线上' }) : null)));
  }
}

on('thumbs', () => {
  for (const box of grid.querySelectorAll('.thumb')) {
    const { file, kind } = box.dataset;
    if (kind === 'audio') {
      const url = waveUrl(file);
      if (url) box.firstChild.style.setProperty('--wave', `url("${url}")`);
    } else if (kind !== 'image' && !box.firstChild.getAttribute('src')) {
      const url = frameUrl(file, kind === 'page' ? 1.5 : 0.5);
      if (url) box.firstChild.src = url;
    }
  }
});

// ---------------------------------------------------------------- 文件树

function row(node, depth) {
  return h(`div.node${node.dir ? '.dir' : ''}`, {
    style: { paddingLeft: `${10 + depth * 14}px` }, title: node.path, draggable: placeable(node) ? 'true' : null,
    onclick: () => {
      if (!node.dir) return openFile(node.path);
      if (open.has(node.path)) open.delete(node.path);
      else open.add(node.path);
      drawTree();
    },
    ondragstart: dragStart(node), oncontextmenu: (e) => fileMenu(e, node),
  },
  node.dir ? h(`span.caret${open.has(node.path) ? '.open' : ''}`, {}, icon('chevron', 11)) : h('span.caret'),
  icon(iconForFile(node.path, node.dir), 14),
  h('span.name', {}, node.name),
  !node.dir && isUsed(node.path) ? h('i.dot', { title: '已在时间线上' }) : null);
}

function drawTree() {
  list.innerHTML = '';
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      list.append(row(n, depth));
      if (n.dir && open.has(n.path)) walk(n.children, depth + 1);
    }
  };
  walk(tree, 0);
}

export async function refresh() {
  try {
    tree = await api('/api/tree');
    drawMedia();
    drawTree();
  } catch { /* 服务暂时不可用 */ }
}

for (const pane of [mediaPane, filesPane]) {
  pane.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      pane.classList.add('dropping');
    }
  });
  pane.addEventListener('dragleave', (e) => { if (!pane.contains(e.relatedTarget)) pane.classList.remove('dropping'); });
  pane.addEventListener('drop', (e) => {
    e.preventDefault();
    pane.classList.remove('dropping');
    upload([...e.dataTransfer.files]);
  });
}
on('film', () => {
  drawMedia();
  drawTree();
});

// ---------------------------------------------------------------- 风格库

export function drawStyles() {
  const box = $('#styles');
  box.innerHTML = '';
  const chosen = localStorage.getItem('cf.style') || '';
  const card = (s) => h(`div.style-card${(s?.id || '') === chosen ? '.on' : ''}`, {
    onclick: () => {
      localStorage.setItem('cf.style', s?.id || '');
      drawStyles();
      emit('style');
    },
  },
  h('div.swatch', {}, (s?.colors || ['#d9dce3', '#c2c7d1', '#a9b0be', '#8f97a8']).map((c) => h('i', { style: { background: c } }))),
  h('b', {}, s ? s.name : '不用风格'),
  h('p', {}, s ? s.desc : '画面、字体、配色、节奏都按你写的话来定'));
  add(box, h('h4.sk-head', {}, '风格'), h('p.hint', {}, '选一种风格，下一次让智能体出片时会带上它的做法说明。'), card(null), S.styles.map(card), skillsBox);
  drawSkills();
}

// ---------------------------------------------------------------- 技能（与 OpenFilm 的技能格式相同）

const skillsBox = h('div.skills');
export const chosenSkills = () => JSON.parse(localStorage.getItem('cf.skills') || '[]');

async function drawSkills() {
  const list = await api('/api/skills').catch(() => []);
  const chosen = new Set(chosenSkills().filter((n) => list.some((s) => s.full === n)));
  localStorage.setItem('cf.skills', JSON.stringify([...chosen]));
  const link = h('input', { placeholder: 'GitHub 链接或本地文件夹路径' });
  const catBox = h('div');
  skillsBox.innerHTML = '';
  add(skillsBox,
    h('h4.sk-head', {}, '技能'),
    h('p.hint', {}, '技能是一类片子的做法说明（SKILL.md），格式与 OpenFilm 的技能相同。勾上的技能会写进下一次出片的任务书。'),
    list.length ? null : h('p.hint', {}, '还没有安装技能。'),
    list.map((s) => h(`label.skill${chosen.has(s.full) ? '.on' : ''}`, { title: s.source ? `来自 ${s.source}` : '' },
      h('input', { type: 'checkbox', checked: chosen.has(s.full), onchange: (e) => {
        if (e.target.checked) chosen.add(s.full);
        else chosen.delete(s.full);
        localStorage.setItem('cf.skills', JSON.stringify([...chosen]));
        emit('style');
        drawSkills();
      } }),
      h('div', {}, h('b', {}, s.title), h('code', {}, s.full), s.description ? h('p', {}, s.description) : null),
      h('button.ghost.icon', { title: '删除这个技能', onclick: async (e) => {
        e.preventDefault();
        if (!confirm(`删除技能 ${s.full}？`)) return;
        await api('/api/skills', { method: 'POST', json: { op: 'remove', name: s.full } }).catch((er) => toast(er.message, 'bad'));
        drawSkills();
      } }, icon('trash', 12)))),
    h('div.row', {}, link, h('button', { onclick: async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try {
        const r = await api('/api/skills', { method: 'POST', json: { op: 'add', link: link.value } });
        toast(`已安装 ${r.join('、')}`, 'good');
        drawSkills();
      } catch (er) {
        toast(er.message, 'bad');
      } finally {
        b.disabled = false;
      }
    } }, '安装')),
    h('button.ghost', { onclick: async () => {
      catBox.innerHTML = '';
      catBox.append(h('p.hint', {}, '正在读取 OpenFilm 的技能目录…'));
      try {
        const cat = await api('/api/skills/catalog');
        catBox.innerHTML = '';
        for (const c of cat) {
          catBox.append(h('div.row', {}, h('code', { style: { flex: 1 } }, c.full), c.installed ? h('span.dim', {}, '已安装') : h('button', { onclick: async () => {
            await api('/api/skills', { method: 'POST', json: { op: 'add', link: c.link } }).then(() => toast(`已安装 ${c.full}`, 'good'), (er) => toast(er.message, 'bad'));
            drawSkills();
          } }, '安装')));
        }
      } catch (er) {
        catBox.innerHTML = '';
        catBox.append(h('p.hint.warn', {}, `读不到技能目录：${er.message}`));
      }
    } }, '浏览 OpenFilm 技能目录'),
    catBox);
}

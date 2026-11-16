// 代码编辑器：多标签，⌘S 保存，保存后预览立刻重载；智能体改了文件时未改动的标签自动跟上。
// 有 CodeMirror 就用它，没有（没装依赖）就退回到纯文本框。
import { S, $, h, add, on, api, toast, setFilm, CF, enc, emit } from './store.js';
import { icon, iconForFile } from './icons.js';

const CM = window.CodeMirror || null;
const pane = $('#editorPane');
const tabBar = $('#edTabs');
const body = $('#edBody');
const split = $('.split-v[data-split="editor"]');
const tabs = [];
let active = null;
let cm = null;
let area = null;
const mediaBox = h('div.ed-media.hidden');
body.append(mediaBox);

const MODES = { html: 'htmlmixed', htm: 'htmlmixed', js: 'javascript', mjs: 'javascript', json: { name: 'javascript', json: true }, css: 'css', md: 'markdown', svg: 'xml', xml: 'xml', vtt: null };
const extOf = (p) => (p.split('.').pop() || '').toLowerCase();
const TEXT = new Set(['html', 'htm', 'js', 'mjs', 'css', 'json', 'md', 'txt', 'vtt', 'srt', 'svg', 'csv', 'xml', 'yaml', 'yml', 'glsl', 'frag', 'vert']);
export const isTextFile = (p) => TEXT.has(extOf(p));

function ensureEditor() {
  if (cm || area) return;
  if (CM) {
    cm = CM(body, {
      lineNumbers: true, theme: 'cutforge', tabSize: 2, indentUnit: 2, lineWrapping: false, matchBrackets: true,
      autoCloseBrackets: true, autoCloseTags: true, styleActiveLine: true,
      extraKeys: { 'Cmd-S': save, 'Ctrl-S': save, 'Cmd-/': 'toggleComment', 'Ctrl-/': 'toggleComment', Tab: (c) => c.execCommand(c.somethingSelected() ? 'indentMore' : 'insertSoftTab') },
    });
    cm.on('changes', () => active && markDirty(active));
  } else {
    area = h('textarea.ed-plain', { spellcheck: false, oninput: () => active && markDirty(active) });
    area.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
    });
    body.append(area);
  }
}

const valueOf = (tab) => (tab.doc ? tab.doc.getValue() : tab === active && area ? area.value : tab.text);

function markDirty(tab) {
  const dirty = tab.doc ? !tab.doc.isClean(tab.gen) : valueOf(tab) !== tab.saved;
  if (dirty !== tab.dirty) {
    tab.dirty = dirty;
    drawTabs();
  }
}

function drawTabs() {
  tabBar.innerHTML = '';
  for (const tab of tabs) {
    tabBar.append(h(`div.ed-tab${tab === active ? '.on' : ''}`, { title: tab.path, onclick: () => activate(tab) },
      icon(tab.kind === 'media' ? iconForFile(tab.path) : iconForFile(tab.path), 13),
      h('span', {}, tab.name),
      tab.stale ? h('em', { title: '磁盘上的文件已被改动；保存会覆盖它' }, '已变更') : null,
      h(`button.ghost.x${tab.dirty ? '.dirty' : ''}`, { title: '关闭', onclick: (e) => { e.stopPropagation(); closeTab(tab); } }, tab.dirty ? '●' : '✕')));
  }
  add(tabBar, h('div.spacer'),
    active && active.kind === 'text' ? h('button.ghost.save', { title: '保存（⌘S）', onclick: save }, '保存') : null,
    h('button.ghost.icon', { title: '关闭编辑器', onclick: () => { for (const t of [...tabs]) closeTab(t); } }, icon('x', 13)));
  pane.classList.toggle('hidden', !tabs.length);
  split.classList.toggle('hidden', !tabs.length);
  emit('layout');
}

function activate(tab) {
  if (active && active.kind === 'text' && area) active.text = area.value;
  active = tab;
  const text = tab.kind === 'text';
  mediaBox.classList.toggle('hidden', text);
  if (cm) cm.getWrapperElement().classList.toggle('hidden', !text);
  if (area) area.classList.toggle('hidden', !text);
  if (text) {
    ensureEditor();
    if (cm) {
      cm.getWrapperElement().classList.remove('hidden');
      cm.swapDoc(tab.doc);
      setTimeout(() => {
        cm.refresh();
        cm.focus();
      }, 0);
    } else {
      area.classList.remove('hidden');
      area.value = tab.text;
    }
  } else {
    mediaBox.innerHTML = '';
    const url = tab.url;
    const kind = iconForFile(tab.path);
    mediaBox.append(kind === 'video' ? h('video', { src: url, controls: true }) : kind === 'audio' ? h('audio', { src: url, controls: true }) : h('img', { src: url }));
  }
  drawTabs();
}

function closeTab(tab) {
  if (tab.dirty && !confirm(`${tab.name} 还没保存，确定关闭？`)) return;
  const i = tabs.indexOf(tab);
  tabs.splice(i, 1);
  if (active === tab) {
    active = null;
    if (tabs.length) activate(tabs[Math.max(0, i - 1)]);
    else mediaBox.innerHTML = '';
  }
  drawTabs();
}

export async function openFile(path, { line } = {}) {
  let tab = tabs.find((t) => t.path === path);
  if (!tab) {
    const name = path.split('/').pop();
    if (isTextFile(path)) {
      let text;
      try {
        text = await api(`/api/file?path=${enc(path)}`);
      } catch (e) {
        return toast(`打不开 ${path}：${e.message}`, 'bad');
      }
      ensureEditor();
      tab = { path, name, kind: 'text', saved: text, text, dirty: false, stale: false, doc: null, gen: 0 };
      if (CM) {
        tab.doc = CM.Doc(text, MODES[extOf(path)] ?? null);
        tab.gen = tab.doc.changeGeneration(true);
      }
    } else {
      tab = { path, name, kind: 'media', url: `${CF.preview}/${path.split('/').map(enc).join('/')}?v=${Date.now()}`, dirty: false };
    }
    tabs.push(tab);
  }
  activate(tab);
  if (line && tab.doc && cm) {
    setTimeout(() => {
      cm.setCursor({ line: line - 1, ch: 0 });
      cm.scrollIntoView({ line: line - 1, ch: 0 }, 120);
      cm.focus();
    }, 30);
  }
}

export async function save() {
  const tab = active;
  if (!tab || tab.kind !== 'text') return;
  const text = valueOf(tab);
  try {
    await api(`/api/file?path=${enc(tab.path)}`, { method: 'PUT', body: text });
  } catch (e) {
    return toast(`保存失败：${e.message}`, 'bad');
  }
  tab.saved = tab.text = text;
  tab.stale = false;
  if (tab.doc) tab.gen = tab.doc.changeGeneration(true);
  tab.dirty = false;
  drawTabs();
  if (tab.path === 'film.html') setFilm(text, { save: false });
}

// 磁盘上的文件变了（智能体或别的程序改的）。text 为 null 表示文件没了。
export function externalChange(path, text) {
  const tab = tabs.find((t) => t.path === path);
  if (!tab || tab.kind !== 'text' || text == null || text === tab.saved) return;
  if (tab.dirty) {
    tab.stale = true;
    return drawTabs();
  }
  tab.saved = tab.text = text;
  if (tab.doc) {
    const scroll = tab === active && cm ? cm.getScrollInfo() : null;
    const cur = tab.doc.getCursor();
    tab.doc.setValue(text);
    tab.gen = tab.doc.changeGeneration(true);
    tab.doc.setCursor(cur);
    if (scroll) cm.scrollTo(scroll.left, scroll.top);
  } else if (tab === active && area) area.value = text;
  tab.dirty = false;
  drawTabs();
}

// 时间线等处改了 film.html：打开着的 film.html 标签跟着变
on('film', () => externalChange('film.html', S.filmText));
on('layout', () => cm && setTimeout(() => cm.refresh(), 0));
export const hasDirty = () => tabs.some((t) => t.dirty);

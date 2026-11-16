// 问题面板：像 IDE 的诊断一样，把三处来源的问题列在一起，点一下跳到文件和时间。
//  写法 —— film.html 一改就即时检查（写法错误、同轨重叠）
//  预览 —— 播放器里页面的报错、加载失败
//  检查 —— “检查”跑出来的结果（画面不确定、文字被裁、纯色帧…）
import { findOverlaps } from '/shared/doc.mjs';
import { S, $, h, add, on, api, toast, seek, lengthOf, showTab, log } from './store.js';
import { openFile } from './editor.js';

const pane = $('#problems');
const count = $('#probCount');

function collect() {
  const out = [];
  const d = S.doc;
  if (d) {
    for (const p of d.problems) out.push({ src: '写法', level: p.level, file: 'film.html', line: p.line, message: p.message });
    const lengths = Object.fromEntries(d.clips.map((c) => [c.key, lengthOf(c)]));
    for (const [a, b] of findOverlaps(d, lengths)) {
      out.push({ src: '写法', level: 'error', file: 'film.html', line: b.line, message: `同一条轨道上 "${a.uid}" 和 "${b.uid}" 重叠` });
    }
  }
  for (const e of S.playerErrors) out.push({ src: '预览', level: 'error', file: e.file, line: e.line || 0, message: e.message });
  for (const p of S.look?.problems || []) {
    if (out.some((x) => x.file === p.file && x.message === p.message)) continue;
    out.push({ src: '检查', ...p });
  }
  return out;
}

export function runLook() {
  if (S.lookBusy) return;
  showTab('bottom', 'problems');
  api('/api/look', { method: 'POST', json: {} }).catch((e) => toast(`检查失败：${e.message}`, 'bad'));
}

function draw() {
  const list = collect();
  const errors = list.filter((p) => p.level === 'error').length;
  count.textContent = list.length ? String(list.length) : '';
  count.className = errors ? 'bad' : list.length ? 'warn' : '';
  pane.innerHTML = '';
  const look = S.look;
  add(pane, h('div.prob-bar', {},
    h('button', { disabled: S.lookBusy, onclick: runLook }, S.lookBusy ? `检查中… ${S.lookProgress || ''}` : '运行检查'),
    h('span.dim', {}, look ? `上次检查：${look.duration} 秒，取样 ${look.frames} 帧，${look.ok ? '没有错误' : '有错误'}` : '还没检查过：检查会找出画面不确定、文字被裁、缺文件等问题'),
    h('div.spacer'),
    look?.sheet ? h('button.ghost', { onclick: () => openFile(look.sheet) }, '看联系表') : null));
  if (!list.length) {
    pane.append(h('div.prob-empty', {}, look ? '没有发现问题。' : '目前没有问题。'));
    return;
  }
  const body = h('div.prob-list');
  for (const p of list) {
    body.append(h(`div.prob.${p.level}`, {
      onclick: () => {
        if (p.t != null) seek(p.t);
        if (/\.(html?|js|css|vtt|json|md)$/i.test(p.file)) openFile(p.file, { line: p.line || undefined });
      },
    },
    h('i', {}, p.level === 'error' ? '✗' : '!'),
    h('span.src', {}, p.src),
    h('span.where', {}, `${p.file}${p.line ? `:${p.line}` : ''}`),
    h('span.what', {}, p.message)));
  }
  pane.append(body);
}

export function onLookEvent(ev) {
  if (ev.state === 'start') {
    S.lookBusy = true;
    S.lookProgress = '';
    log('开始检查影片');
  } else if (ev.state === 'progress') S.lookProgress = `${ev.step}/${ev.total}`;
  else {
    S.lookBusy = false;
    if (ev.state === 'done') {
      S.look = ev.report;
      const errs = ev.report.problems.filter((p) => p.level === 'error').length;
      log(`检查完成：${errs} 个错误，${ev.report.problems.length - errs} 个提醒`);
    } else {
      log(`检查失败：${ev.message}`);
      toast(`检查失败：${ev.message}`, 'bad');
    }
  }
  draw();
}

on('film', draw);
on('info', draw);
on('errors', draw);
export { draw as drawProblems };

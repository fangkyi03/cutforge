// 检查影片：把模型容易做错、人眼又不易发现的问题找出来。
//  · film.html 写法、缺失的文件、同轨重叠
//  · 页面报错、加载失败、字体加载失败
//  · 画面不确定：同一时刻按两种乱序各画一次，结果不同即违反“同一个 t 画出同一幅画面”
//  · 文字被画面裁掉、整帧纯色
// 并生成一张联系表（.cutforge/look/sheet.png），供人和能看图的智能体过目。
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { parseFilm, findOverlaps } from '../film/doc.mjs';
import { startPreview } from '../server/preview.mjs';
import { launchChrome } from './chrome.mjs';

const HELPER = `
window.shots = {};
const load = (b64) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = 'data:image/png;base64,' + b64; });
const pixels = async (b64) => { const img = await load(b64); const c = new OffscreenCanvas(img.width, img.height); const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0); return g.getImageData(0, 0, img.width, img.height).data; };
window.keep = (k, b64) => { window.shots[k] = b64; };
window.compare = async (k, b64) => {
  const [a, b] = await Promise.all([pixels(window.shots[k]), pixels(b64)]);
  let sum = 0, far = 0, lumSum = 0, lumSq = 0; const n = a.length / 4;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    sum += d; if (d > 32) far++;
    const l = 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2]; lumSum += l; lumSq += l * l;
  }
  const mean = lumSum / n;
  return { mean: sum / n, far: far / n, flat: Math.sqrt(Math.max(0, lumSq / n - mean * mean)) < 0.6 };
};
window.sheet = async (keys, labels, cols, tw) => {
  const imgs = await Promise.all(keys.map((k) => load(window.shots[k])));
  const th = Math.round(tw * imgs[0].height / imgs[0].width), gap = 10, lab = 24; const rows = Math.ceil(imgs.length / cols);
  const c = document.createElement('canvas'); c.width = cols * (tw + gap) + gap; c.height = rows * (th + lab + gap) + gap;
  const g = c.getContext('2d'); g.fillStyle = '#14161c'; g.fillRect(0, 0, c.width, c.height); g.font = '13px ui-monospace, Menlo, monospace'; g.textBaseline = 'middle';
  imgs.forEach((img, i) => { const x = gap + (i % cols) * (tw + gap), y = gap + Math.floor(i / cols) * (th + lab + gap);
    g.drawImage(img, x, y, tw, th); g.strokeStyle = '#2a2e3a'; g.strokeRect(x + .5, y + .5, tw - 1, th - 1); g.fillStyle = '#aab3c5'; g.fillText(labels[i], x + 2, y + th + lab / 2); });
  return c.toDataURL('image/png').split(',')[1];
};
`;

function shuffled(list, seed) {
  const a = [...list];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    const j = Math.abs(s) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const secs = (t) => `${(Math.round(t * 100) / 100).toFixed(2)}s`;

export async function lookFilm({ root, film = 'film.html', samples = 12, onProgress = () => {} } = {}) {
  root = path.resolve(root);
  const filmFile = path.join(root, film);
  const filmDir = path.dirname(filmFile);
  const problems = [];
  const add = (level, file, message, extra = {}) => {
    if (!problems.some((p) => p.file === file && p.message === message)) problems.push({ level, file, line: 0, message, ...extra });
  };
  const report = { ok: false, film, duration: 0, width: 0, height: 0, tracks: 0, clips: 0, frames: 0, sheet: null, problems };
  const finish = async () => {
    report.ok = !problems.some((p) => p.level === 'error');
    const dir = path.join(root, '.cutforge', 'look');
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
    return report;
  };

  let text;
  try {
    text = await fsp.readFile(filmFile, 'utf8');
  } catch {
    add('error', film, '这个工程里没有 film.html');
    return finish();
  }
  const doc = parseFilm(text);
  Object.assign(report, { width: doc.width, height: doc.height, tracks: doc.tracks.length, clips: doc.clips.length });
  for (const p of doc.problems) add(p.level, film, p.message, { line: p.line });
  for (const c of doc.clips) {
    if (c.file && !fs.existsSync(path.resolve(filmDir, c.file))) add('error', film, `找不到文件 ${c.file}`, { line: c.line });
  }
  for (const tr of doc.tracks) {
    if (tr.caption && !fs.existsSync(path.resolve(filmDir, tr.caption.file))) add('error', film, `找不到字幕文件 ${tr.caption.file}`, { line: tr.caption.line });
  }
  if (!doc.clips.length) {
    add('error', film, '影片里还没有片段');
    return finish();
  }

  const preview = await startPreview({ root });
  let browser = null;
  try {
    browser = await launchChrome();
    const scale = Math.min(1, Math.max(0.25, 640 / doc.width));
    // 辅助页先开：后开的影片页留在前台，否则后台标签页里的媒体不会加载
    const helper = await browser.newPage({ width: 400, height: 300 });
    await helper.evaluate(HELPER);
    const page = await browser.newPage({ width: doc.width, height: doc.height, scale });
    await page.front();
    await page.goto(`${preview.origin}/__cf__/player.html?film=${encodeURIComponent(film)}&render=1`);
    const info = await page.evaluate('__cf.ready.then(() => __cf.info())');
    report.duration = info.duration;

    const lengths = Object.fromEntries(Object.entries(info.clips).map(([k, v]) => [k, v.length]));
    for (const [a, b] of findOverlaps(doc, lengths)) {
      add('error', film, `同一条轨道上 "${a.uid}" 和 "${b.uid}" 重叠：要叠在一起的画面放到不同轨道`, { line: b.line });
    }
    if (!(info.duration > 0)) {
      for (const e of info.errors) add('error', e.file, e.message, { line: e.line || 0 });
      add('error', film, '影片长度是 0');
      return await finish();
    }

    const n = Math.max(2, Math.min(samples, Math.ceil(info.duration * 4)));
    const times = Array.from({ length: n }, (_, i) => Math.round((i / n) * info.duration * 1000) / 1000);
    times.push(Math.max(0, Math.round((info.duration - 1 / 30) * 1000) / 1000));
    const activeAt = (t, kinds) => doc.clips.filter((c) => {
      const len = lengths[c.key] || 0;
      return kinds.includes(c.kind) && !c.disabled && !doc.tracks[c.track].hidden && t >= c.at && t < c.at + len;
    });

    const clippedSeen = new Map();
    const unstable = new Map();
    const flat = new Map();
    const note = (map, file, t) => map.set(file, [...(map.get(file) || []), t]);
    const failed = new Set(Object.entries(info.clips).filter(([, v]) => v.failed).map(([k]) => doc.clips.find((c) => c.key === k)?.file));
    let step = 0;
    for (const t of shuffled(times, 7)) {
      await page.evaluate(`__cf.seek(${t})`);
      await helper.evaluate(`keep(${JSON.stringify(String(t))}, ${JSON.stringify(await page.screenshot({ format: 'png' }))})`);
      const audit = await page.evaluate('__cf.audit()');
      for (const c of audit.clipped) {
        const k = `${c.file}|${c.text}`;
        const prev = clippedSeen.get(k) || { ...c, times: [] };
        prev.times.push(t);
        prev.cut = Math.max(prev.cut, c.cut);
        clippedSeen.set(k, prev);
      }
      for (const f of audit.fonts) add('warning', f.file, `字体 ${f.family} 加载失败，画面会用替代字体`);
      onProgress({ step: ++step, total: times.length * 2 });
    }
    for (const t of shuffled(times, 99991)) {
      await page.evaluate(`__cf.seek(${t})`);
      const d = await helper.evaluate(`compare(${JSON.stringify(String(t))}, ${JSON.stringify(await page.screenshot({ format: 'png' }))})`);
      const pages = activeAt(t, ['page']);
      const pictures = activeAt(t, ['page', 'video', 'image']);
      if (d.far > 0.002 || d.mean > 1.5) {
        const who = pages.length ? pages.map((c) => c.file) : activeAt(t, ['video']).map((c) => c.file);
        for (const file of who.length ? who : [film]) note(unstable, file, t);
      }
      const drawn = pictures.filter((c) => !failed.has(c.file));
      if (d.flat && drawn.length && t > 0.2 && t < info.duration - 0.2) note(flat, drawn[0].file, t);
      onProgress({ step: ++step, total: times.length * 2 });
    }
    const when = (list) => list.sort((a, b) => a - b).map(secs).join('、');
    for (const [file, list] of unstable) {
      add('error', file, `画面不确定（第 ${when(list)}）：同一时刻画两次结果不同。frame(t) 只能由 t 决定——不要跨帧累加状态、不要用计时器，补间要写明起点和终点`, { t: list[0] });
    }
    for (const [file, list] of flat) {
      add('warning', file, `画面是一整片纯色（第 ${when(list)}），确认是不是有东西没画出来`, { t: list[0] });
    }
    for (const c of clippedSeen.values()) {
      add('warning', c.file, `文字被画面边缘裁掉约 ${c.cut}px（第 ${when(c.times)}）：“${c.text}”`, { t: c.times[0] });
    }

    const errors = await page.evaluate('__cf.errors()');
    for (const e of errors) add('error', e.file, e.message, { line: e.line || 0 });
    for (const p of page.problems) {
      const file = p.url.startsWith(preview.origin) ? decodeURIComponent(new URL(p.url).pathname.slice(1)) : p.url || film;
      if (file.startsWith('__cf__/')) continue;
      const known = problems.some((x) => x.message.includes(file) || (x.file === file && x.level === 'error'));
      if (p.kind === 'http') {
        if (!known) add('error', film, `请求失败 ${file}（${p.message}）`);
      } else if (!/Failed to load resource/.test(p.message) && !problems.some((x) => x.file === file && p.message.includes(x.message))) {
        add('error', file, p.message, { line: p.line });
      }
    }

    const sheet = await helper.evaluate(`sheet(${JSON.stringify(times.map(String))}, ${JSON.stringify(times.map(secs))}, ${Math.min(4, times.length)}, 320)`);
    const sheetFile = path.join(root, '.cutforge', 'look', 'sheet.png');
    await fsp.mkdir(path.dirname(sheetFile), { recursive: true });
    await fsp.writeFile(sheetFile, Buffer.from(sheet, 'base64'));
    report.sheet = '.cutforge/look/sheet.png';
    report.frames = times.length;
    return await finish();
  } finally {
    if (browser) await browser.close();
    await preview.close();
  }
}

export function formatReport(r) {
  const lines = [`检查 ${r.film}：${r.duration} 秒，${r.width}×${r.height}，${r.tracks} 条轨道，${r.clips} 个片段`];
  for (const p of r.problems) {
    lines.push(`${p.level === 'error' ? '✗' : '!'} ${p.file}${p.line ? `:${p.line}` : ''}  ${p.message}`);
  }
  if (r.sheet) lines.push(`联系表：${r.sheet}（${r.frames} 帧，可以打开看画面）`);
  const errors = r.problems.filter((p) => p.level === 'error').length;
  const warnings = r.problems.length - errors;
  lines.push(errors || warnings ? `结果：${errors} 个错误，${warnings} 个提醒` : '结果：没有发现问题');
  return lines.join('\n');
}

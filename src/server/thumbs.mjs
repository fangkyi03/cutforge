// 缩略图：时间线片段里的画面条、素材栏里的预览、声音的波形。
// 视频帧用 ffmpeg 取，页面帧用一个常驻的无头浏览器画，波形用 ffmpeg 画。
// 结果按“文件 + 修改时间 + 时刻”缓存在 .cutforge/thumbs/，文件一改就自然失效。
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { kindOfFile } from '../film/doc.mjs';
import { launchChrome } from '../render/chrome.mjs';
import { findTool, run } from '../render/probe.mjs';

const IDLE_MS = 45000;

export function createThumbs({ root, previewOrigin, stage }) {
  const dir = path.join(root, '.cutforge', 'thumbs');
  const inflight = new Map();
  let browser = null;
  let launching = null;
  let idle = null;
  let pageQueue = Promise.resolve();
  let active = 0;
  const waiting = [];

  const keyOf = async (abs) => {
    const st = await fsp.stat(abs);
    return crypto.createHash('sha1').update(`${abs}|${st.mtimeMs}|${st.size}`).digest('hex').slice(0, 14);
  };
  const rel = (name) => `.cutforge/thumbs/${name}`;
  const once = (name, make) => {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) return Promise.resolve(rel(name));
    if (!inflight.has(name)) {
      inflight.set(name, make(file).then(() => (fs.existsSync(file) ? rel(name) : null), () => null).finally(() => inflight.delete(name)));
    }
    return inflight.get(name);
  };
  // ffmpeg 并发上限
  const limited = (fn) => new Promise((resolve) => {
    const start = () => {
      active++;
      fn().then(resolve, () => resolve(null)).finally(() => {
        active--;
        waiting.shift()?.();
      });
    };
    if (active < 4) start();
    else waiting.push(start);
  });

  async function getBrowser() {
    clearTimeout(idle);
    if (browser) return browser;
    launching ||= launchChrome().then((b) => {
      browser = b;
      launching = null;
      return b;
    }, (e) => {
      launching = null;
      throw e;
    });
    return launching;
  }
  const touchIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(() => {
      const b = browser;
      browser = null;
      b?.close();
    }, IDLE_MS);
    idle.unref?.();
  };

  // 一个页面的若干时刻：开一次页，逐个时刻画
  function pageFrames(file, key, times, h) {
    const job = async () => {
      const todo = times.filter((t) => !fs.existsSync(path.join(dir, `${key}-${Math.round(t * 1000)}-${h}.jpg`)));
      if (!todo.length) return;
      const { width, height } = stage();
      const b = await getBrowser();
      const page = await b.newPage({ width, height, scale: h / height });
      try {
        await page.goto(`${previewOrigin}/${file.split('/').map(encodeURIComponent).join('/')}`);
        const ok = await page.evaluate(`(async () => {
          const until = Date.now() + 8000;
          while (!(window.film && typeof window.film.frame === 'function') && Date.now() < until) await new Promise((r) => setTimeout(r, 30));
          if (!window.film) return false;
          try { await (typeof film.ready === 'function' ? film.ready() : film.ready); } catch {}
          return true;
        })()`);
        if (!ok) return;
        for (const t of todo) {
          await page.evaluate(`(async () => {
            const t = Math.min(${t}, film.duration > 0 ? film.duration : ${t});
            filmHost.time(t); await film.frame(t);
            for (const a of document.getAnimations()) { a.pause(); a.currentTime = t * 1000; }
          })()`);
          const data = await page.screenshot({ format: 'jpeg', quality: 72 });
          await fsp.writeFile(path.join(dir, `${key}-${Math.round(t * 1000)}-${h}.jpg`), Buffer.from(data, 'base64'));
        }
      } finally {
        await page.close();
        touchIdle();
      }
    };
    pageQueue = pageQueue.then(job, job).catch(() => {});
    return pageQueue;
  }

  return {
    // → 与 times 等长的地址数组（相对工程目录；取不到的是 null）
    async frames(file, times, h = 72) {
      const abs = path.resolve(root, file);
      if (!abs.startsWith(root + path.sep) || !fs.existsSync(abs)) return times.map(() => null);
      await fsp.mkdir(dir, { recursive: true });
      const kind = kindOfFile(file);
      const key = await keyOf(abs);
      const name = (t) => `${key}-${Math.round(t * 1000)}-${h}.jpg`;
      if (kind === 'video') {
        const ffmpeg = findTool('ffmpeg');
        if (!ffmpeg) return times.map(() => null);
        return Promise.all(times.map((t) => once(name(t), (out) => limited(() => run(ffmpeg, ['-y', '-loglevel', 'error', '-ss', String(Math.max(0, t)), '-i', abs, '-frames:v', '1', '-vf', `scale=-2:${h}`, '-q:v', '6', out])))));
      }
      if (kind === 'page') {
        await pageFrames(file, key, times, h).catch(() => {});
        return times.map((t) => (fs.existsSync(path.join(dir, name(t))) ? rel(name(t)) : null));
      }
      return times.map(() => null);
    },

    // 一段声音的波形（白色、透明底，界面用它做遮罩再上色）
    async wave(file, from = 0, to = null) {
      const abs = path.resolve(root, file);
      const ffmpeg = findTool('ffmpeg');
      if (!ffmpeg || !abs.startsWith(root + path.sep) || !fs.existsSync(abs)) return null;
      await fsp.mkdir(dir, { recursive: true });
      const name = `${await keyOf(abs)}-w${Math.round(from * 1000)}-${to == null ? 'end' : Math.round(to * 1000)}.png`;
      const cut = to == null ? ['-ss', String(from)] : ['-ss', String(from), '-t', String(Math.max(0.05, to - from))];
      return once(name, (out) => limited(() => run(ffmpeg, ['-y', '-loglevel', 'error', ...cut, '-i', abs, '-filter_complex',
        'aformat=channel_layouts=mono,showwavespic=s=1400x96:colors=white:scale=sqrt', '-frames:v', '1', out])));
    },

    async close() {
      clearTimeout(idle);
      const b = browser;
      browser = null;
      await b?.close();
    },
  };
}

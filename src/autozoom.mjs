// 自动运镜：分析录屏里“哪儿在动”，生成推近、平移的关键帧。
// 读不到系统的鼠标点击（那需要原生录屏组件），所以看画面本身：把录像缩成小图逐帧比较，
// 一段时间里变化集中在某个区域，就推近到那里；变化铺满全屏或没有变化，就回到全景。
import { spawn } from 'node:child_process';
import { findTool, probe } from './render/probe.mjs';

const W = 160;
const H = 90;
const FPS = 4;

async function frames(file) {
  const ffmpeg = findTool('ffmpeg');
  if (!ffmpeg) throw new Error('找不到 ffmpeg');
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-loglevel', 'error', '-i', file, '-vf', `fps=${FPS},scale=${W}:${H}:flags=area,format=gray`, '-f', 'rawvideo', '-']);
    const chunks = [];
    p.stdout.on('data', (d) => chunks.push(d));
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(err.trim() || 'ffmpeg 失败'));
      const buf = Buffer.concat(chunks);
      const n = Math.floor(buf.length / (W * H));
      resolve(Array.from({ length: n }, (_, i) => buf.subarray(i * W * H, (i + 1) * W * H)));
    });
  });
}

// 每一帧和上一帧的变化区域（包围盒，0–1 坐标）
function activity(list) {
  const out = [];
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1];
    const b = list[i];
    let x0 = W;
    let y0 = H;
    let x1 = -1;
    let y1 = -1;
    let n = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const k = y * W + x;
        if (Math.abs(a[k] - b[k]) > 18) {
          n++;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    out.push({ t: i / FPS, n, box: n > 3 ? { x: x0 / W, y: y0 / H, w: (x1 - x0 + 1) / W, h: (y1 - y0 + 1) / H } : null });
  }
  return out;
}

// → 关键帧 [{ t, scale, cx, cy }]（cx、cy 是推近中心，0–1）
export async function planZoom(file, { maxScale = 2.2, hold = 1.2 } = {}) {
  const meta = await probe(file);
  const list = await frames(file);
  const act = activity(list);
  const dur = meta?.duration || list.length / FPS;
  // 按 1 秒的窗口合并变化区域
  const win = [];
  for (let t = 0; t < dur; t += 1) {
    const inWin = act.filter((a) => a.box && a.t >= t && a.t < t + 1);
    if (!inWin.length) {
      win.push({ t, box: null });
      continue;
    }
    // 只取多数帧所在的那一块：别处一闪而过的变化（比如上一个东西消失）不算
    const center = (b) => [b.x + b.w / 2, b.y + b.h / 2];
    const near = (a, b) => Math.hypot(center(a)[0] - center(b)[0], center(a)[1] - center(b)[1]) < 0.2;
    const groups = inWin.map((a) => inWin.filter((b) => near(a.box, b.box)));
    const best = groups.sort((p, q) => q.length - p.length)[0];
    const x0 = Math.min(...best.map((a) => a.box.x));
    const y0 = Math.min(...best.map((a) => a.box.y));
    const x1 = Math.max(...best.map((a) => a.box.x + a.box.w));
    const y1 = Math.max(...best.map((a) => a.box.y + a.box.h));
    win.push({ t, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } });
  }
  const keys = [{ t: 0, scale: 1, cx: 0.5, cy: 0.5 }];
  let cur = keys[0];
  for (const w of win) {
    let next;
    const big = !w.box || w.box.w > 0.6 || w.box.h > 0.6;
    if (big) next = { scale: 1, cx: 0.5, cy: 0.5 };
    else {
      // 推近到变化区域，留出边距；中心夹在画面内，推近后不露出画面外
      const s = Math.min(maxScale, Math.max(1.3, 0.75 / Math.max(w.box.w, w.box.h * 1)));
      const half = 0.5 / s;
      next = { scale: Math.round(s * 100) / 100, cx: Math.min(1 - half, Math.max(half, w.box.x + w.box.w / 2)), cy: Math.min(1 - half, Math.max(half, w.box.y + w.box.h / 2)) };
    }
    const moved = Math.abs(next.scale - cur.scale) > 0.15 || Math.abs(next.cx - cur.cx) > 0.12 || Math.abs(next.cy - cur.cy) > 0.12;
    // 第一次可以马上动；之后每个镜位至少停 hold 秒，避免来回晃
    const wide = next.scale === 1 && w.box && big;
    if (moved && (keys.length === 1 || wide || w.t - keys.at(-1).t >= hold)) {
      // 提前 0.3 秒开始，用 0.6 秒过渡到新位置
      const from = Math.max(keys.at(-1).t, w.t - 0.3);
      if (from > keys.at(-1).t) keys.push({ ...cur, t: from });
      keys.push({ ...next, t: Math.min(dur, from + 0.6) });
      cur = keys.at(-1);
    }
  }
  keys.push({ ...cur, t: dur });
  return { duration: dur, keys: keys.filter((k, i) => i === 0 || k.t > keys[i - 1].t + 0.005) };
}

// 关键帧 → CSS @keyframes（作用在片段上：放大 + 平移，盒子不变）
export function zoomKeyframesCss(name, plan) {
  const lines = plan.keys.map((k) => {
    const pct = ((k.t / plan.duration) * 100).toFixed(2);
    // 以画面中心为原点放大 s 倍后，把 (cx, cy) 移回中心
    const tx = ((0.5 - k.cx) * k.scale * 100).toFixed(2);
    const ty = ((0.5 - k.cy) * k.scale * 100).toFixed(2);
    return `  ${pct}% { scale: ${k.scale}; translate: ${tx}% ${ty}%; }`;
  });
  return `@keyframes ${name} {\n${lines.join('\n')}\n}`;
}

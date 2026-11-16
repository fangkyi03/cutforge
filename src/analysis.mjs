// 素材分析：说话段落（Silero VAD）、镜头切点（TransNetV2）、人脸位置（YuNet）。
// 三个模型都是宽松许可（MIT），用 onnxruntime-web 的 WebAssembly 后端在 Node 里跑，不需要 Python 和原生编译。
//   Silero VAD   https://github.com/snakers4/silero-vad           MIT
//   TransNetV2   https://github.com/soCzech/TransNetV2（ONNX 版 elya5/transnetv2）  MIT
//   YuNet        https://github.com/opencv/opencv_zoo（face_detection_yunet）       MIT
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTool, probe } from './render/probe.mjs';

const MODELS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../models');
let ortP = null;
async function ort() {
  ortP ||= import('onnxruntime-web').then((m) => {
    m.env.wasm.numThreads = Math.max(1, Math.min(8, os.cpus().length - 1));
    return m;
  });
  return ortP;
}
const sessions = new Map();
async function session(name) {
  if (!sessions.has(name)) sessions.set(name, (await ort()).InferenceSession.create(path.join(MODELS, `${name}.onnx`)));
  return sessions.get(name);
}

// ffmpeg 解码成原始数据
function decode(args) {
  const ffmpeg = findTool('ffmpeg');
  if (!ffmpeg) return Promise.reject(new Error('找不到 ffmpeg'));
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-loglevel', 'error', ...args, '-']);
    const chunks = [];
    let err = '';
    p.stdout.on('data', (d) => chunks.push(d));
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(err.trim() || 'ffmpeg 解码失败'))));
  });
}

const range = (from, to) => [...(from > 0 ? ['-ss', String(from)] : []), ...(to != null ? ['-t', String(Math.max(0.05, to - from))] : [])];

// ---------------------------------------------------------------- 说话段落

// → [{ start, end }]（秒，相对 from）
export async function speechSegments(file, { from = 0, to = null, threshold = 0.5, minSilence = 0.35, minSpeech = 0.2, pad = 0.12 } = {}) {
  const buf = await decode([...range(from, to), '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le']);
  const pcm = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
  const o = await ort();
  const s = await session('silero_vad');
  const CH = 512;
  const CTX = 64; // 新版模型每块前面要带上一块的最后 64 个采样
  let state = new o.Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
  const sr = new o.Tensor('int64', BigInt64Array.from([16000n]), []);
  const probs = [];
  let ctx = new Float32Array(CTX);
  for (let i = 0; i + CH <= pcm.length; i += CH) {
    const x = new Float32Array(CTX + CH);
    x.set(ctx, 0);
    x.set(pcm.subarray(i, i + CH), CTX);
    const out = await s.run({ input: new o.Tensor('float32', x, [1, CTX + CH]), state, sr });
    probs.push(out.output.data[0]);
    state = out.stateN;
    ctx = pcm.slice(i + CH - CTX, i + CH);
  }
  const dt = CH / 16000;
  // 概率 → 段落：高于阈值开始，低于（阈值 - 0.15）且持续 minSilence 才结束
  const segs = [];
  let start = null;
  let lastVoice = 0;
  probs.forEach((p, k) => {
    const t = k * dt;
    if (p >= threshold) {
      if (start == null) start = t;
      lastVoice = t + dt;
    } else if (start != null && p < threshold - 0.15 && t - lastVoice >= minSilence) {
      segs.push({ start, end: lastVoice });
      start = null;
    }
  });
  if (start != null) segs.push({ start, end: lastVoice });
  const dur = pcm.length / 16000;
  return segs.filter((g) => g.end - g.start >= minSpeech).map((g) => ({ start: Math.max(0, g.start - pad), end: Math.min(dur, g.end + pad) }))
    // 加了前后余量后可能重叠：合并
    .reduce((acc, g) => {
      const last = acc.at(-1);
      if (last && g.start <= last.end + 0.05) last.end = Math.max(last.end, g.end);
      else acc.push({ ...g });
      return acc;
    }, []).map((g) => ({ start: Math.round(g.start * 1000) / 1000, end: Math.round(g.end * 1000) / 1000 }));
}

// ---------------------------------------------------------------- 镜头切点

// → [秒]：每个新镜头开始的时刻（相对 from，不含 0）
export async function shotCuts(file, { from = 0, to = null, threshold = 0.5 } = {}) {
  const meta = await probe(file);
  const fps = 25;
  const buf = await decode([...range(from, to), '-i', file, '-an', '-vf', `fps=${fps},scale=48:27`, '-pix_fmt', 'rgb24', '-f', 'rawvideo']);
  const FR = 27 * 48 * 3;
  const n = Math.floor(buf.length / FR);
  if (n < 2) return [];
  const o = await ort();
  const s = await session('transnetv2');
  // 官方做法：前后各补 25 帧，100 帧一窗、步长 50，每窗取中间 50 帧的结果
  const frame = (i) => buf.subarray(Math.min(n - 1, Math.max(0, i)) * FR, (Math.min(n - 1, Math.max(0, i)) + 1) * FR);
  const preds = new Float32Array(n);
  for (let w = -25; w < n - 25; w += 50) {
    const x = new Float32Array(100 * FR);
    for (let k = 0; k < 100; k++) {
      const f = frame(w + k);
      for (let j = 0; j < FR; j++) x[k * FR + j] = f[j];
    }
    const out = await s.run({ input: new o.Tensor('float32', x, [1, 100, 27, 48, 3]) });
    const y = out[s.outputNames[0]].data;
    for (let k = 25; k < 75; k++) {
      const i = w + k;
      if (i >= 0 && i < n) preds[i] = y[k]; // 这个 ONNX 版本的输出已经是概率（该帧是镜头最后一帧的可能性）
    }
  }
  const cuts = [];
  for (let i = 0; i < n - 1; i++) {
    // 取峰值：超过阈值且是附近最大的那一帧
    if (preds[i] >= threshold && (i === 0 || preds[i] >= preds[i - 1]) && preds[i] > preds[i + 1]) {
      const t = Math.round(((i + 1) / fps) * 1000) / 1000; // 下一帧开始是新镜头
      if (!cuts.length || t - cuts.at(-1) > 0.4) cuts.push(t);
    }
  }
  void meta;
  return cuts;
}

// ---------------------------------------------------------------- 人脸

// 一帧图像（BGR，640×640）→ [{ x, y, w, h, score }]（0–1，相对原图）
async function facesInFrame(bgr, W, H) {
  const o = await ort();
  const s = await session('yunet');
  const S = 640;
  const x = new Float32Array(3 * S * S);
  for (let i = 0; i < S * S; i++) {
    x[i] = bgr[i * 3];
    x[S * S + i] = bgr[i * 3 + 1];
    x[2 * S * S + i] = bgr[i * 3 + 2];
  }
  const out = await s.run({ input: new o.Tensor('float32', x, [1, 3, S, S]) });
  const found = [];
  for (const stride of [8, 16, 32]) {
    const cols = S / stride;
    const cls = out[`cls_${stride}`].data;
    const obj = out[`obj_${stride}`].data;
    const box = out[`bbox_${stride}`].data;
    for (let i = 0; i < cls.length; i++) {
      const score = Math.sqrt(Math.max(0, Math.min(1, cls[i])) * Math.max(0, Math.min(1, obj[i])));
      if (score < 0.6) continue;
      const r = Math.floor(i / cols);
      const c = i % cols;
      const cx = (c + box[i * 4]) * stride;
      const cy = (r + box[i * 4 + 1]) * stride;
      const w = Math.exp(box[i * 4 + 2]) * stride;
      const h = Math.exp(box[i * 4 + 3]) * stride;
      found.push({ x: (cx - w / 2) / S, y: (cy - h / 2) / S, w: w / S, h: h / S, score });
    }
  }
  // 非极大值抑制
  found.sort((a, b) => b.score - a.score);
  const keep = [];
  const iou = (a, b) => {
    const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const inter = ix * iy;
    return inter / (a.w * a.h + b.w * b.h - inter);
  };
  for (const f of found) if (keep.every((k) => iou(k, f) < 0.3)) keep.push(f);
  void W;
  void H;
  return keep;
}

// 每隔 step 秒找一次人脸 → [{ t, faces }]
export async function faceTrack(file, { from = 0, to = null, step = 0.5 } = {}) {
  const meta = await probe(file);
  const S = 640;
  // 等比缩放后放进 640×640 的方框（左上对齐，补黑边），换算回原图比例
  const W = meta?.width || 1920;
  const H = meta?.height || 1080;
  const k = Math.min(S / W, S / H);
  const sw = Math.round(W * k / 2) * 2;
  const sh = Math.round(H * k / 2) * 2;
  const buf = await decode([...range(from, to), '-i', file, '-an', '-vf', `fps=${1 / step},scale=${sw}:${sh},pad=${S}:${S}:0:0:black`, '-pix_fmt', 'bgr24', '-f', 'rawvideo']);
  const FR = S * S * 3;
  const out = [];
  for (let i = 0; i * FR + FR <= buf.length; i++) {
    const faces = (await facesInFrame(buf.subarray(i * FR, (i + 1) * FR), W, H)).map((f) => ({
      x: f.x * (S / sw), y: f.y * (S / sh), w: f.w * (S / sw), h: f.h * (S / sh), score: Math.round(f.score * 100) / 100,
    })).filter((f) => f.x < 1 && f.y < 1);
    out.push({ t: Math.round(i * step * 1000) / 1000, faces });
  }
  return { width: W, height: H, track: out };
}

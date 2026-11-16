// 缩略图的界面侧缓存：同步取地址，没有的攒成一批去要，到了再通知重画。
import { CF, api, emit, enc } from './store.js';

const H = 72;
const frames = new Map(); // "文件|毫秒" → 地址 | '' (正在取) | null (取不到)
const waves = new Map();
const want = new Map(); // 文件 → Set(秒)
let timer = null;

const full = (rel) => `${CF.preview}/${rel}`;

async function flush() {
  timer = null;
  const batch = [...want.entries()];
  want.clear();
  await Promise.all(batch.map(async ([file, set]) => {
    const times = [...set];
    try {
      const { urls } = await api(`/api/thumbs?path=${enc(file)}&times=${times.join(',')}&h=${H}`);
      times.forEach((t, i) => frames.set(`${file}|${Math.round(t * 1000)}`, urls[i] ? full(urls[i]) : null));
    } catch {
      for (const t of times) frames.set(`${file}|${Math.round(t * 1000)}`, null);
    }
  }));
  emit('thumbs');
}

// 某个文件在第 t 秒的画面；还没有时返回 null，并在取到后发出 'thumbs'
export function frameUrl(file, t) {
  const key = `${file}|${Math.round(t * 1000)}`;
  const hit = frames.get(key);
  if (hit !== undefined) return hit || null;
  frames.set(key, '');
  if (!want.has(file)) want.set(file, new Set());
  want.get(file).add(Math.round(t * 1000) / 1000);
  timer ||= setTimeout(flush, 140);
  return null;
}

export function waveUrl(file, from = 0, to = null) {
  const a = Math.round(from * 10) / 10;
  const b = to == null ? '' : Math.round(to * 10) / 10;
  const key = `${file}|${a}|${b}`;
  const hit = waves.get(key);
  if (hit !== undefined) return hit || null;
  waves.set(key, '');
  api(`/api/wave?path=${enc(file)}&from=${a}&to=${b}`).then(({ url }) => {
    waves.set(key, url ? full(url) : null);
    emit('thumbs');
  }, () => waves.set(key, null));
  return null;
}

// 文件改了：忘掉它的缩略图，下次会取到新的
export function forget(file) {
  for (const map of [frames, waves]) for (const k of map.keys()) if (k.startsWith(`${file}|`)) map.delete(k);
}

export const fileUrl = (file) => `${CF.preview}/${file.split('/').map(enc).join('/')}`;

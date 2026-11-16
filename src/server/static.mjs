// 静态文件：MIME、Range（视频拖动必需）、路径安全。
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const MIME = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8',
  md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8', vtt: 'text/vtt; charset=utf-8',
  srt: 'text/plain; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', ico: 'image/x-icon', mp4: 'video/mp4', m4v: 'video/mp4',
  mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', mp3: 'audio/mpeg', wav: 'audio/wav',
  m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', woff: 'font/woff',
  woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', wasm: 'application/wasm', glb: 'model/gltf-binary',
  gltf: 'model/gltf+json', csv: 'text/csv; charset=utf-8',
};

export const mimeOf = (file) => MIME[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream';

// 把 URL 路径解析到 root 之内；越界返回 null
export function resolveInside(root, rel) {
  let decoded;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const abs = path.resolve(root, `.${path.sep}${decoded.replace(/^[/\\]+/, '')}`);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

export function send(res, status, body, type = 'text/plain; charset=utf-8', headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(status, { 'content-type': type, 'content-length': buf.length, 'cache-control': 'no-store', ...headers });
  res.end(buf);
}

export const sendJson = (res, data, status = 200) => send(res, status, JSON.stringify(data), MIME.json);

// transform(text) 可在发送前改写文本（给页面注入宿主脚本）
export async function sendFile(req, res, file, { transform, headers = {} } = {}) {
  let st;
  try {
    st = await fsp.stat(file);
    if (st.isDirectory()) throw new Error('dir');
  } catch {
    return send(res, 404, 'Not found');
  }
  const type = mimeOf(file);
  if (transform) {
    const text = transform(await fsp.readFile(file, 'utf8'));
    return send(res, 200, text, type, headers);
  }
  const base = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-cache', ...headers };
  const etag = `"${st.size}-${Math.round(st.mtimeMs)}"`;
  if (req.headers['if-none-match'] === etag && !req.headers.range) {
    res.writeHead(304, { etag, 'cache-control': 'no-cache' });
    return res.end();
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
    let end = range[1] && range[2] ? Number(range[2]) : st.size - 1;
    end = Math.min(end, st.size - 1);
    if (start > end || start >= st.size) {
      res.writeHead(416, { 'content-range': `bytes */${st.size}` });
      return res.end();
    }
    res.writeHead(206, { ...base, etag, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...base, etag, 'content-length': st.size });
  if (req.method === 'HEAD') return res.end();
  return fs.createReadStream(file).pipe(res);
}

export function readBody(req, limit = 2 * 1024 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

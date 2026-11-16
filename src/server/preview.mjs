// 预览服务：把工程目录和播放器放在一个独立的源（端口）上。
// IDE 界面在另一个源，影片页面里的脚本因此碰不到 IDE 的接口。
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveInside, send, sendFile } from './static.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME = path.resolve(HERE, '../../runtime');
const SHARED = {
  'doc.mjs': path.resolve(HERE, '../film/doc.mjs'),
  'vtt.mjs': path.resolve(HERE, '../film/vtt.mjs'),
};
const PRELUDE = '<script src="/__cf__/prelude.js"></script>';

// 宿主脚本必须先于页面自己的脚本运行
export function injectPrelude(html) {
  const m = /<head[^>]*>/i.exec(html) || /<html[^>]*>/i.exec(html) || /<!doctype[^>]*>/i.exec(html);
  if (!m) return PRELUDE + html;
  const at = m.index + m[0].length;
  return html.slice(0, at) + PRELUDE + html.slice(at);
}

const hostOk = (req, port) => {
  const h = String(req.headers.host || '');
  return h === `127.0.0.1:${port}` || h === `localhost:${port}`;
};

export async function startPreview({ root, port = 0 }) {
  root = path.resolve(root);
  let trusted = null;
  const server = http.createServer(async (req, res) => {
    try {
      if (!hostOk(req, server.address().port)) return send(res, 403, 'Forbidden');
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/favicon.ico') {
        res.writeHead(204);
        return res.end();
      }
      if (url.pathname.startsWith('/__cf__/')) {
        const name = url.pathname.slice('/__cf__/'.length);
        const file = SHARED[name] || resolveInside(RUNTIME, name);
        if (!file) return send(res, 404, 'Not found');
        return sendFile(req, res, file, { headers: { 'cache-control': 'no-store' } });
      }
      const file = resolveInside(root, url.pathname);
      if (!file) return send(res, 403, 'Forbidden');
      const rel = path.relative(root, file).split(path.sep);
      // 点开头的目录只放行检查结果（联系表图片）
      if (rel.some((p) => p.startsWith('.')) && !(rel[0] === '.cutforge' && (rel[1] === 'look' || rel[1] === 'thumbs' || rel[1] === 'jy'))) return send(res, 404, 'Not found');
      const isHtml = /\.html?$/i.test(file);
      if (isHtml && !url.searchParams.has('raw')) return sendFile(req, res, file, { transform: injectPrelude });
      const cors = trusted && req.headers.origin === trusted && rel[0] === '.cutforge' ? { 'access-control-allow-origin': trusted, vary: 'Origin' } : {};
      return sendFile(req, res, file, isHtml ? { transform: (t) => t } : { headers: cors });
    } catch (e) {
      send(res, 500, String(e && e.message));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const actual = server.address().port;
  return {
    origin: `http://127.0.0.1:${actual}`,
    port: actual,
    trust: (origin) => { trusted = origin; },
    close: () => new Promise((r) => {
      server.closeAllConnections?.();
      server.close(() => r());
    }),
  };
}

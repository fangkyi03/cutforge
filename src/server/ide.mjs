// IDE 服务：界面、文件读写、检查与导出任务、智能体运行、事件推送。
// 只监听 127.0.0.1；改动类接口要带本次启动生成的口令，并核对 Host，挡住其它网页的跨站请求。
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { AgentRunner } from '../agents/run.mjs';
import { loadStyles } from '../agents/brief.mjs';
import { detectAgents, readConfig, writeConfig } from '../agents/registry.mjs';
import { doctor } from '../doctor.mjs';
import { HOME } from '../project.mjs';
import { findChrome } from '../render/chrome.mjs';
import { lookFilm } from '../render/look.mjs';
import { probe } from '../render/probe.mjs';
import { renderFilm } from '../render/render.mjs';
import { exportJianying, jianyingDraftRoots } from '../export/jianying.mjs';
import { exportAs, KINDS } from '../export/more.mjs';
import { saveVersion, listVersions, restoreVersion, deleteVersion, writeAtomic } from '../versions.mjs';
import { libraryManifest, addToProject, LIB } from '../library.mjs';
import * as gen from '../gen.mjs';
import { announceServer, retireServer, serveRpc } from '../rpc.mjs';
import { startPreview } from './preview.mjs';
import { createThumbs } from './thumbs.mjs';
import { parseFilm } from '../film/doc.mjs';
import { readBody, resolveInside, send, sendFile, sendJson } from './static.mjs';

const UI = path.join(HOME, 'ui');
const CM = path.join(HOME, 'node_modules', 'codemirror');
const SHARED = { 'doc.mjs': path.join(HOME, 'src', 'film', 'doc.mjs'), 'vtt.mjs': path.join(HOME, 'src', 'film', 'vtt.mjs') };
const IGNORE = new Set(['.cutforge', '.git', 'node_modules', '.DS_Store']);
const TEXT_EXT = new Set(['html', 'htm', 'js', 'mjs', 'css', 'json', 'md', 'txt', 'vtt', 'srt', 'svg', 'csv', 'xml', 'yaml', 'yml', 'glsl', 'frag', 'vert']);

const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

async function readTree(root, dir = root) {
  const out = [];
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    if (IGNORE.has(e.name)) continue;
    const abs = path.join(dir, e.name);
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (e.isDirectory()) out.push({ name: e.name, path: rel, dir: true, children: await readTree(root, abs) });
    else out.push({ name: e.name, path: rel, dir: false });
  }
  return out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
}

export async function startIde({ root, port = 0, open = true }) {
  root = path.resolve(root);
  const preview = await startPreview({ root });
  const token = crypto.randomBytes(18).toString('hex');
  const clients = new Set();
  const chatFile = path.join(root, '.cutforge', 'chat.json');
  let chat = [];
  try {
    chat = JSON.parse(await fsp.readFile(chatFile, 'utf8'));
    for (const m of chat) if (m.kind === 'run' && m.status === 'running') m.status = 'stopped';
  } catch { /* 还没有对话 */ }
  let lastLook = null;
  try {
    lastLook = JSON.parse(await fsp.readFile(path.join(root, '.cutforge', 'look', 'report.json'), 'utf8'));
  } catch { /* 还没检查过 */ }
  let renderJob = null;
  let lookBusy = null;
  let modelJob = null;
  const thumbs = createThumbs({
    root, previewOrigin: preview.origin,
    stage: () => {
      try {
        const d = parseFilm(fs.readFileSync(path.join(root, 'film.html'), 'utf8'));
        return { width: d.width, height: d.height };
      } catch {
        return { width: 1920, height: 1080 };
      }
    },
  });

  const broadcast = (ev) => {
    const line = `data: ${JSON.stringify(ev)}\n\n`;
    for (const res of clients) res.write(line);
  };
  let chatTimer = null;
  const saveChat = () => {
    clearTimeout(chatTimer);
    chatTimer = setTimeout(() => fsp.writeFile(chatFile, JSON.stringify(chat.slice(-200))).catch(() => {}), 400);
  };

  // ---- 文件变化
  const changed = new Set();
  let fsTimer = null;
  let watcher = null;
  try {
    watcher = fs.watch(root, { recursive: true }, (type, name) => {
      if (!name) return;
      const rel = String(name).split(path.sep).join('/');
      const top = rel.split('/')[0];
      if (IGNORE.has(top) || rel.endsWith('.DS_Store') || rel.endsWith('~')) return;
      changed.add(rel);
      clearTimeout(fsTimer);
      fsTimer = setTimeout(() => {
        const paths = [...changed];
        changed.clear();
        broadcast({ type: 'fs', paths });
      }, 140);
    });
  } catch { /* 这个平台不支持递归监听：界面上可手动刷新 */ }

  // ---- 检查与导出
  const runLook = (params = {}) => {
    if (lookBusy) return lookBusy;
    broadcast({ type: 'look', state: 'start' });
    lookBusy = lookFilm({ root, samples: params.samples || 12, onProgress: (p) => broadcast({ type: 'look', state: 'progress', ...p }) })
      .then((report) => {
        lastLook = report;
        broadcast({ type: 'look', state: 'done', report });
        return report;
      })
      .catch((e) => {
        broadcast({ type: 'look', state: 'error', message: String(e.message || e) });
        throw e;
      })
      .finally(() => { lookBusy = null; });
    return lookBusy;
  };

  const startRender = ({ fps = 30, scale = 1, loudness = null, range = null } = {}) => {
    if (renderJob) throw new Error('已经有一个导出在进行');
    const rel = `exports/${path.basename(root)}-${stamp()}.mp4`;
    const ctl = new AbortController();
    renderJob = { ctl, file: rel };
    broadcast({ type: 'render', state: 'start', file: rel });
    renderFilm({ root, out: path.join(root, rel), fps, scale, loudness, range: Array.isArray(range) && range[1] > range[0] ? range : null, signal: ctl.signal, onProgress: (p) => broadcast({ type: 'render', state: 'progress', ...p }) })
      .then((r) => broadcast({ type: 'render', state: 'done', file: rel, info: { ...r, out: rel } }))
      .catch((e) => broadcast({ type: 'render', state: 'error', message: String(e.message || e) }))
      .finally(() => { renderJob = null; });
    return rel;
  };

  // 导出剪映草稿：先导到工程的 exports/jianying/；选了“放进剪映”且找到了剪映的草稿目录，再复制一份过去
  const startJianying = ({ install = false } = {}) => {
    if (renderJob) throw new Error('已经有一个导出在进行');
    const name = `${path.basename(root)}-${stamp()}`;
    const rel = `exports/jianying/${name}`;
    const ctl = new AbortController();
    renderJob = { ctl, file: rel };
    broadcast({ type: 'render', state: 'start', file: rel, kind: 'jianying' });
    exportJianying({ root, name, signal: ctl.signal, onProgress: (p) => broadcast({ type: 'render', state: 'progress', kind: 'jianying', text: p.text, frame: p.step, total: p.total }) })
      .then(async (r) => {
        let installed = null;
        const target = jianyingDraftRoots()[0];
        if (install && target) {
          installed = path.join(target, name);
          await fsp.cp(r.folder, installed, { recursive: true });
          // 草稿里的路径要指向剪映目录里的那份
          for (const f of ['draft_content.json', 'draft_meta_info.json']) {
            const p = path.join(installed, f);
            await fsp.writeFile(p, (await fsp.readFile(p, 'utf8')).split(JSON.stringify(r.folder).slice(1, -1)).join(JSON.stringify(installed).slice(1, -1)));
          }
        }
        broadcast({ type: 'render', state: 'done', kind: 'jianying', file: rel, info: { ...r, folder: rel, installed } });
      })
      .catch((e) => broadcast({ type: 'render', state: 'error', message: String(e.message || e) }))
      .finally(() => { renderJob = null; });
    return rel;
  };

  const startExport = ({ kind, t = 0, fps, width, loudness } = {}) => {
    if (renderJob) throw new Error('已经有一个导出在进行');
    if (!KINDS[kind]) throw new Error('不认识的导出类型');
    const ctl = new AbortController();
    renderJob = { ctl, file: KINDS[kind] };
    broadcast({ type: 'render', state: 'start', file: KINDS[kind], kind });
    exportAs({ root, kind, t, fps, width, loudness, signal: ctl.signal, onProgress: (p) => broadcast({ type: 'render', state: 'progress', kind, text: `${KINDS[kind]}：${p.text}` }) })
      .then((r) => broadcast({ type: 'render', state: 'done', kind: 'other', file: r.files[0], info: { ...r, label: KINDS[kind] } }))
      .catch((e) => broadcast({ type: 'render', state: 'error', message: String(e.message || e) }))
      .finally(() => { renderJob = null; });
    return KINDS[kind];
  };

  // ---- 智能体
  const pushChat = (m) => {
    chat.push(m);
    saveChat();
    broadcast({ type: 'chat', op: 'add', message: m });
  };
  const runner = new AgentRunner({
    root,
    emit: (ev) => {
      if (ev.type === 'note') return pushChat({ kind: 'note', text: ev.text, time: Date.now() });
      if (ev.type === 'run-start') return pushChat({ kind: 'run', runId: ev.runId, agent: ev.agent, log: '', status: 'running', time: ev.time });
      const m = chat.find((x) => x.kind === 'run' && x.runId === ev.runId);
      if (!m) return;
      if (ev.type === 'run-out') {
        m.log += ev.text;
        saveChat();
        broadcast({ type: 'chat', op: 'out', runId: ev.runId, text: ev.text });
      } else if (ev.type === 'run-end') {
        Object.assign(m, { status: ev.stopped ? 'stopped' : ev.code === 0 ? 'ok' : 'failed', code: ev.code, seconds: ev.seconds, error: ev.error || null, reply: ev.reply || '' });
        saveChat();
        broadcast({ type: 'chat', op: 'end', runId: ev.runId, message: m });
      }
    },
  });
  const startAgent = async ({ prompt, agents, style }) => {
    if (runner.busy) throw new Error('智能体正在工作，先等它完成或点停止');
    const styles = await loadStyles();
    const chosen = styles.find((s) => s.id === style) || null;
    pushChat({ kind: 'user', text: prompt, style: chosen?.name || null, time: Date.now() });
    broadcast({ type: 'agent', state: 'start' });
    runner.run({ request: prompt, agentIds: agents, style: chosen })
      .then((r) => {
        if (r.stopped) pushChat({ kind: 'note', text: '已停止。工程里保留了它做到一半的内容。', time: Date.now() });
        else if (!r.ok) pushChat({ kind: 'note', text: '没有智能体跑完这个任务。看上面的输出：常见原因是没登录、额度用完或网络不通。', time: Date.now() });
        broadcast({ type: 'agent', state: 'done', ok: !!r.ok });
        if (r.ok) runLook().catch(() => {});
      })
      .catch((e) => {
        pushChat({ kind: 'note', text: `出错了：${e.message}`, time: Date.now() });
        broadcast({ type: 'agent', state: 'done', ok: false });
      });
  };

  // ---- HTTP
  const inProject = (rel) => {
    const abs = resolveInside(root, String(rel || ''));
    if (!abs || abs === root) return null;
    const parts = path.relative(root, abs).split(path.sep);
    return parts.some((p) => p === '.git' || p === '.cutforge') ? null : abs;
  };

  const api = async (req, res, url) => {
    const q = url.searchParams;
    const route = `${req.method} ${url.pathname}`;
    const json = async () => JSON.parse((await readBody(req, 4 * 1024 * 1024)).toString('utf8') || '{}');
    switch (route) {
      case 'GET /api/state':
        return sendJson(res, {
          root, name: path.basename(root), preview: preview.origin, platform: process.platform, chat, look: lastLook,
          agents: await detectAgents(), styles: (await loadStyles()).map(({ guide, ...s }) => s),
          agentBusy: runner.busy, rendering: renderJob ? renderJob.file : null, jianyingRoot: jianyingDraftRoots()[0] || null, hasCodeMirror: fs.existsSync(CM),
        });
      case 'GET /api/tree':
        return sendJson(res, await readTree(root));
      case 'GET /api/file': {
        const abs = inProject(q.get('path'));
        if (!abs) return send(res, 403, 'Forbidden');
        const ext = path.extname(abs).slice(1).toLowerCase();
        if (!TEXT_EXT.has(ext)) return send(res, 415, '不是文本文件');
        try {
          return send(res, 200, await fsp.readFile(abs, 'utf8'));
        } catch {
          return send(res, 404, 'Not found');
        }
      }
      case 'PUT /api/file': {
        const abs = inProject(q.get('path'));
        if (!abs) return send(res, 403, 'Forbidden');
        await writeAtomic(abs, await readBody(req, 20 * 1024 * 1024));
        return sendJson(res, { ok: true });
      }
      case 'POST /api/upload': {
        let abs = inProject(q.get('path'));
        if (!abs) return send(res, 403, 'Forbidden');
        const { dir, name, ext } = path.parse(abs);
        for (let i = 2; fs.existsSync(abs); i++) abs = path.join(dir, `${name}-${i}${ext}`);
        await fsp.mkdir(dir, { recursive: true });
        await fsp.writeFile(abs, await readBody(req));
        return sendJson(res, { ok: true, path: path.relative(root, abs).split(path.sep).join('/') });
      }
      case 'POST /api/fs': {
        const body = await json();
        const abs = inProject(body.path);
        if (!abs) return send(res, 403, 'Forbidden');
        if (body.op === 'delete') await fsp.rm(abs, { recursive: true, force: true });
        else if (body.op === 'mkdir') await fsp.mkdir(abs, { recursive: true });
        else if (body.op === 'newfile') {
          if (fs.existsSync(abs)) return send(res, 409, '已经有同名文件');
          await fsp.mkdir(path.dirname(abs), { recursive: true });
          await fsp.writeFile(abs, body.text || '');
        } else if (body.op === 'rename') {
          const to = inProject(body.to);
          if (!to) return send(res, 403, 'Forbidden');
          if (fs.existsSync(to)) return send(res, 409, '已经有同名文件');
          await fsp.mkdir(path.dirname(to), { recursive: true });
          await fsp.rename(abs, to);
        } else return send(res, 400, 'bad op');
        return sendJson(res, { ok: true });
      }
      case 'GET /api/probe': {
        const abs = inProject(q.get('path'));
        return sendJson(res, abs ? await probe(abs) : null);
      }
      case 'GET /api/thumbs': {
        if (!inProject(q.get('path'))) return send(res, 403, 'Forbidden');
        const times = String(q.get('times') || '').split(',').map(Number).filter((n) => Number.isFinite(n) && n >= 0).slice(0, 60);
        const h = Math.min(240, Math.max(32, Number(q.get('h')) || 72));
        return sendJson(res, { urls: await thumbs.frames(q.get('path'), times, h) });
      }
      case 'GET /api/wave': {
        if (!inProject(q.get('path'))) return send(res, 403, 'Forbidden');
        const to = q.get('to');
        return sendJson(res, { url: await thumbs.wave(q.get('path'), Number(q.get('from')) || 0, to == null || to === '' ? null : Number(to)) });
      }
      case 'POST /api/look':
        return sendJson(res, await runLook(await json()));
      case 'POST /api/render':
        return sendJson(res, { file: startRender(await json()) });
      case 'POST /api/export/jianying':
        return sendJson(res, { file: startJianying(await json()) });
      case 'POST /api/export':
        return sendJson(res, { file: startExport(await json()) });
      case 'GET /api/library':
        return sendJson(res, libraryManifest());
      case 'POST /api/library/add':
        return sendJson(res, await addToProject(root, (await json()).id));
      case 'GET /api/gen/status':
        return sendJson(res, { keys: await gen.keyStatus(), services: gen.SERVICES, systemVoices: await gen.systemVoices(), voices: gen.VOICES, speech: await gen.speechStatus() });
      case 'POST /api/gen/keys': {
        const body = await json();
        const cur = await gen.readKeys();
        for (const [k, v] of Object.entries(body)) if (gen.SERVICES[k]) cur[k] = v;
        await gen.writeKeys(cur);
        return sendJson(res, await gen.keyStatus());
      }
      case 'POST /api/gen/voice':
        return sendJson(res, await gen.makeVoice({ root, ...(await json()) }));
      case 'POST /api/gen/image':
        return sendJson(res, await gen.makeImage({ root, ...(await json()) }));
      case 'POST /api/gen/music':
        return sendJson(res, await gen.makeMusic({ root, ...(await json()) }));
      case 'POST /api/gen/transcribe': {
        const body = await json();
        if (!inProject(body.file)) return send(res, 403, 'Forbidden');
        return sendJson(res, await gen.transcribeFile(root, body.file, { lang: body.lang || 'zh', reuse: body.reuse !== false }));
      }
      case 'POST /api/gen/model':
        if (!modelJob) {
          const name = (await json().catch(() => ({}))).name || 'base';
          modelJob = gen.downloadModel(({ got, total }) => broadcast({ type: 'model', got, total }), name)
            .then(() => broadcast({ type: 'model', done: true }), (e) => broadcast({ type: 'model', error: String(e.message) }))
            .finally(() => { modelJob = null; });
        }
        return sendJson(res, { ok: true });
      case 'GET /api/editor-state':
        try {
          return sendJson(res, JSON.parse(await fsp.readFile(path.join(root, '.cutforge', 'editor.json'), 'utf8')));
        } catch {
          return sendJson(res, { markers: [], range: null });
        }
      case 'PUT /api/editor-state': {
        const body = await json();
        const markers = (Array.isArray(body.markers) ? body.markers : []).filter((m) => Number.isFinite(m?.t)).slice(0, 500).map((m) => ({ t: Math.round(m.t * 1000) / 1000, name: String(m.name || '').slice(0, 80) }));
        const range = body.range && Number.isFinite(body.range.in) && Number.isFinite(body.range.out) && body.range.out > body.range.in ? { in: body.range.in, out: body.range.out } : null;
        await writeAtomic(path.join(root, '.cutforge', 'editor.json'), JSON.stringify({ markers, range }));
        return sendJson(res, { ok: true });
      }
      case 'GET /api/versions':
        return sendJson(res, await listVersions(root));
      case 'POST /api/versions': {
        const body = await json();
        if (body.op === 'save') return sendJson(res, await saveVersion(root, body.name));
        if (body.op === 'restore') {
          if (runner.busy) return send(res, 409, '智能体正在工作，先停止再回退');
          return sendJson(res, await restoreVersion(root, body.id));
        }
        if (body.op === 'delete') return sendJson(res, await deleteVersion(root, body.id));
        return send(res, 400, 'bad op');
      }
      case 'POST /api/render/cancel':
        renderJob?.ctl.abort();
        return sendJson(res, { ok: true });
      case 'POST /api/agent/run': {
        const body = await json();
        if (!String(body.prompt || '').trim()) return send(res, 400, '先写下要做什么');
        if (!Array.isArray(body.agents) || !body.agents.length) return send(res, 400, '先选一个智能体');
        await startAgent(body);
        return sendJson(res, { ok: true });
      }
      case 'POST /api/agent/stop':
        runner.stop();
        return sendJson(res, { ok: true });
      case 'POST /api/chat/clear':
        chat = [];
        saveChat();
        broadcast({ type: 'chat', op: 'clear' });
        return sendJson(res, { ok: true });
      case 'GET /api/doctor':
        return sendJson(res, { checks: await doctor({ fresh: true }), agents: await detectAgents(), config: await readConfig() });
      case 'POST /api/config': {
        const body = await json();
        const cfg = await readConfig();
        cfg.agents = (body.agents || []).filter((a) => a && a.name && a.command).map((a) => ({ name: String(a.name).slice(0, 40), command: String(a.command).slice(0, 500) }));
        await writeConfig(cfg);
        return sendJson(res, { ok: true, agents: await detectAgents({ fresh: true }) });
      }
      case 'POST /api/reveal': {
        const body = await json();
        const abs = body.path ? inProject(body.path) : root;
        if (!abs) return send(res, 403, 'Forbidden');
        if (process.platform === 'darwin') spawn('open', body.path ? ['-R', abs] : [abs], { stdio: 'ignore' });
        else if (process.platform === 'win32') spawn('explorer', [body.path ? `/select,${abs}` : abs], { stdio: 'ignore' });
        else spawn('xdg-open', [body.path ? path.dirname(abs) : abs], { stdio: 'ignore' });
        return sendJson(res, { ok: true });
      }
      default:
        return send(res, 404, 'Not found');
    }
  };

  const server = http.createServer(async (req, res) => {
    try {
      const self = server.address().port;
      const host = String(req.headers.host || '');
      if (host !== `127.0.0.1:${self}` && host !== `localhost:${self}`) return send(res, 403, 'Forbidden');
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/api/events') {
        if (url.searchParams.get('token') !== token) return send(res, 403, 'Forbidden');
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(': ok\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        if (req.headers['x-cutforge-token'] !== token) return send(res, 403, 'Forbidden');
        return await api(req, res, url);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
      if (url.pathname === '/' || url.pathname === '/index.html') {
        const boot = `<script>window.CUTFORGE=${JSON.stringify({ token, preview: preview.origin })}</script>`;
        return sendFile(req, res, path.join(UI, 'index.html'), { transform: (t) => t.replace('<!--boot-->', boot) });
      }
      if (url.pathname.startsWith('/shared/')) {
        const f = SHARED[url.pathname.slice(8)];
        return f ? sendFile(req, res, f, { headers: { 'cache-control': 'no-store' } }) : send(res, 404, 'Not found');
      }
      if (url.pathname.startsWith('/library/')) {
        const f = resolveInside(LIB, url.pathname.slice('/library/'.length));
        return f ? sendFile(req, res, f) : send(res, 404, 'Not found');
      }
      if (url.pathname.startsWith('/vendor/codemirror/')) {
        const f = resolveInside(CM, url.pathname.slice('/vendor/codemirror/'.length));
        return f ? sendFile(req, res, f) : send(res, 404, 'Not found');
      }
      const f = resolveInside(UI, url.pathname);
      return f ? sendFile(req, res, f, { headers: { 'cache-control': 'no-store' } }) : send(res, 404, 'Not found');
    } catch (e) {
      if (!res.headersSent) send(res, 500, String((e && e.message) || e));
      else res.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}/`;
  preview.trust(url.slice(0, -1));

  // 沙盒里的智能体通过文件信箱请求检查
  await announceServer(root, { url });
  const stopRpc = serveRpc(root, { look: (p) => runLook(p) });
  const heartbeat = setInterval(() => { for (const res of clients) res.write(': hb\n\n'); }, 25000);

  const close = async () => {
    clearInterval(heartbeat);
    stopRpc();
    runner.stop();
    renderJob?.ctl.abort();
    watcher?.close();
    await thumbs.close();
    await retireServer(root);
    for (const res of clients) res.end();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(() => r()));
    await preview.close();
  };
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.once(sig, () => close().finally(() => process.exit(0)));
  }

  if (open) {
    const chrome = findChrome();
    if (process.platform === 'darwin') spawn('open', chrome ? ['-a', chrome.replace(/\/Contents\/MacOS\/.*/, ''), url] : [url], { stdio: 'ignore' });
    else if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore' });
    else spawn('xdg-open', [url], { stdio: 'ignore' });
  }
  return { url, token, preview: preview.origin, close };
}

// 无头浏览器：直接用 Chrome DevTools Protocol 驱动本机已装的 Chrome / Edge / Chromium。
// 不下载浏览器，也不依赖 puppeteer / playwright（Node 22 自带 WebSocket）。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export function findChrome() {
  const env = process.env.CUTFORGE_CHROME;
  if (env && fs.existsSync(env)) return env;
  const list = [];
  if (process.platform === 'darwin') {
    for (const base of ['/Applications', path.join(os.homedir(), 'Applications')]) {
      list.push(
        `${base}/Google Chrome.app/Contents/MacOS/Google Chrome`,
        `${base}/Chromium.app/Contents/MacOS/Chromium`,
        `${base}/Microsoft Edge.app/Contents/MacOS/Microsoft Edge`,
        `${base}/Brave Browser.app/Contents/MacOS/Brave Browser`,
      );
    }
  } else if (process.platform === 'win32') {
    for (const base of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]) {
      if (!base) continue;
      list.push(`${base}\\Google\\Chrome\\Application\\chrome.exe`, `${base}\\Microsoft\\Edge\\Application\\msedge.exe`);
    }
  } else {
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
      for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) {
        list.push(path.join(dir, name));
      }
    }
  }
  return list.find((p) => fs.existsSync(p)) || null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launchChrome() {
  const exe = findChrome();
  if (!exe) throw new Error('找不到 Chrome、Edge 或 Chromium。装一个，或用环境变量 CUTFORGE_CHROME 指定它的可执行文件。');
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cutforge-chrome-'));
  const proc = spawn(exe, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--force-color-profile=srgb',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--use-mock-keychain', '--password-store=basic', '--disable-extensions', '--disable-component-update', '--disable-features=Translate,MediaRouter', 'about:blank',
  ], { stdio: 'ignore' });
  let exited = false;
  proc.on('exit', () => { exited = true; });

  const portFile = path.join(dir, 'DevToolsActivePort');
  let endpoint = null;
  for (let i = 0; i < 200 && !exited; i++) {
    try {
      const [port, wsPath] = (await fsp.readFile(portFile, 'utf8')).trim().split('\n');
      if (port && wsPath) {
        endpoint = `ws://127.0.0.1:${port}${wsPath}`;
        break;
      }
    } catch { /* 还没写出来 */ }
    await sleep(50);
  }
  const cleanup = async () => {
    if (!exited) proc.kill('SIGKILL');
    await sleep(60);
    await fsp.rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  };
  if (!endpoint) {
    await cleanup();
    throw new Error('无头浏览器没有启动成功');
  }

  const ws = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('连不上无头浏览器')), { once: true });
  });
  let seq = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id) {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.error) p.reject(new Error(`${p.method}: ${m.error.message}`));
      else p.resolve(m.result);
    } else for (const l of listeners) l(m);
  });
  ws.addEventListener('close', () => {
    for (const p of pending.values()) p.reject(new Error('无头浏览器已关闭'));
    pending.clear();
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject, method });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

  async function newPage({ width = 1280, height = 720, scale = 1 } = {}) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const cmd = (method, params) => send(method, params, sessionId);
    const problems = [];
    const waiters = new Map();
    const listener = (m) => {
      if (m.sessionId !== sessionId) return;
      const p = m.params || {};
      if (m.method === 'Runtime.exceptionThrown') {
        const d = p.exceptionDetails || {};
        problems.push({ kind: 'exception', url: d.url || '', line: (d.lineNumber || 0) + 1, message: d.exception?.description?.split('\n')[0] || d.text || '脚本错误' });
      } else if (m.method === 'Log.entryAdded' && p.entry?.level === 'error') {
        problems.push({ kind: 'log', url: p.entry.url || '', line: p.entry.lineNumber || 0, message: p.entry.text });
      } else if (m.method === 'Network.responseReceived' && p.response?.status >= 400) {
        problems.push({ kind: 'http', url: p.response.url, line: 0, message: `HTTP ${p.response.status}` });
      }
      const w = waiters.get(m.method);
      if (w) {
        waiters.delete(m.method);
        w(p);
      }
    };
    listeners.add(listener);
    await cmd('Page.enable');
    await cmd('Runtime.enable');
    await cmd('Log.enable');
    await cmd('Network.enable');
    await cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
    return {
      problems,
      async goto(url) {
        const loaded = new Promise((r) => waiters.set('Page.loadEventFired', r));
        const res = await cmd('Page.navigate', { url });
        if (res.errorText) throw new Error(`打不开 ${url}：${res.errorText}`);
        let timer;
        await Promise.race([loaded, new Promise((r) => { timer = setTimeout(r, 30000); })]);
        clearTimeout(timer);
      },
      async evaluate(expression) {
        const res = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (res.exceptionDetails) {
          throw new Error(res.exceptionDetails.exception?.description?.split('\n')[0] || res.exceptionDetails.text);
        }
        return res.result.value;
      },
      async screenshot({ format = 'jpeg', quality = 95 } = {}) {
        const res = await cmd('Page.captureScreenshot', { format, quality: format === 'jpeg' ? quality : undefined, optimizeForSpeed: true });
        return res.data;
      },
      front: () => cmd('Page.bringToFront'),
      send: cmd,
      async close() {
        listeners.delete(listener);
        await send('Target.closeTarget', { targetId }).catch(() => {});
      },
    };
  }

  return {
    exe,
    newPage,
    async close() {
      try {
        ws.close();
      } catch { /* 已断开 */ }
      await cleanup();
    },
  };
}

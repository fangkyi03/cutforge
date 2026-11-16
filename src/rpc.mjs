// 文件信箱：智能体常在沙盒里运行（不能联网、不能启动浏览器），
// 这时 `cutforge look` 把请求写进 .cutforge/rpc/，由沙盒外的 IDE 服务代为执行，再把结果写回来。
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const dirOf = (root) => path.join(root, '.cutforge', 'rpc');
const serverFile = (root) => path.join(root, '.cutforge', 'server.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM'; // 沙盒里不许发信号，但进程存在
  }
}

export async function announceServer(root, data) {
  await fsp.mkdir(dirOf(root), { recursive: true });
  for (const f of await fsp.readdir(dirOf(root))) await fsp.rm(path.join(dirOf(root), f), { force: true });
  await fsp.writeFile(serverFile(root), JSON.stringify({ pid: process.pid, ...data }));
}

export async function retireServer(root) {
  await fsp.rm(serverFile(root), { force: true }).catch(() => {});
}

export function serverFor(root) {
  try {
    const s = JSON.parse(fs.readFileSync(serverFile(root), 'utf8'));
    return alive(s.pid) ? s : null;
  } catch {
    return null;
  }
}

// 客户端：发请求并等结果
export async function call(root, method, params = {}, timeoutMs = 240000) {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = dirOf(root);
  await fsp.mkdir(dir, { recursive: true });
  const res = path.join(dir, `res-${id}.json`);
  await fsp.writeFile(path.join(dir, `req-${id}.tmp`), JSON.stringify({ id, method, params }));
  await fsp.rename(path.join(dir, `req-${id}.tmp`), path.join(dir, `req-${id}.json`));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(res)) {
      const out = JSON.parse(await fsp.readFile(res, 'utf8'));
      await fsp.rm(res, { force: true });
      if (out.error) throw new Error(out.error);
      return out.result;
    }
    await sleep(150);
  }
  throw new Error('IDE 服务没有响应');
}

// 服务端：轮询信箱，逐个处理
export function serveRpc(root, handlers) {
  const dir = dirOf(root);
  let stopped = false;
  const busy = new Set();
  (async () => {
    while (!stopped) {
      let names = [];
      try {
        names = (await fsp.readdir(dir)).filter((n) => /^req-.*\.json$/.test(n));
      } catch { /* 目录还没建 */ }
      for (const name of names) {
        if (busy.has(name)) continue;
        busy.add(name);
        (async () => {
          const file = path.join(dir, name);
          let req = null;
          try {
            req = JSON.parse(await fsp.readFile(file, 'utf8'));
            await fsp.rm(file, { force: true });
            const fn = handlers[req.method];
            if (!fn) throw new Error(`不认识的请求 ${req.method}`);
            const result = await fn(req.params || {});
            await fsp.writeFile(path.join(dir, `res-${req.id}.json`), JSON.stringify({ result }));
          } catch (e) {
            if (req) await fsp.writeFile(path.join(dir, `res-${req.id}.json`), JSON.stringify({ error: String(e.message || e) })).catch(() => {});
            else await fsp.rm(file, { force: true }).catch(() => {});
          }
          busy.delete(name);
        })();
      }
      await sleep(200);
    }
  })();
  return () => { stopped = true; };
}

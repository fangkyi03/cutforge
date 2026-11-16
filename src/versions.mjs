// 命名版本：把工程里的文件（不含 exports/ 和 .cutforge/）存一份快照，随时回到那个版本。
// 不依赖 git；同样内容的文件只存一份（按内容哈希），所以存很多个版本也不会占太多空间。
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const SKIP = new Set(['.cutforge', 'exports', '.git', 'node_modules', '.DS_Store']);

async function walk(root, dir = root, out = []) {
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) await walk(root, abs, out);
    else if (e.isFile()) out.push(path.relative(root, abs).split(path.sep).join('/'));
  }
  return out;
}

const store = (root) => path.join(root, '.cutforge', 'versions');

export async function saveVersion(root, name) {
  const dir = store(root);
  const blobs = path.join(dir, 'blobs');
  await fsp.mkdir(blobs, { recursive: true });
  const files = {};
  for (const rel of await walk(root)) {
    const buf = await fsp.readFile(path.join(root, rel));
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    const blob = path.join(blobs, hash);
    if (!fs.existsSync(blob)) await fsp.writeFile(blob, buf);
    files[rel] = hash;
  }
  const id = `${Date.now().toString(36)}`;
  const entry = { id, name: String(name || '').trim().slice(0, 60) || '未命名版本', time: Date.now(), files };
  await fsp.writeFile(path.join(dir, `${id}.json`), JSON.stringify(entry));
  return { id, name: entry.name, time: entry.time, count: Object.keys(files).length };
}

export async function listVersions(root) {
  const dir = store(root);
  const out = [];
  for (const f of await fsp.readdir(dir).catch(() => [])) {
    if (!f.endsWith('.json')) continue;
    try {
      const v = JSON.parse(await fsp.readFile(path.join(dir, f), 'utf8'));
      out.push({ id: v.id, name: v.name, time: v.time, count: Object.keys(v.files).length });
    } catch { /* 坏的跳过 */ }
  }
  return out.sort((a, b) => b.time - a.time);
}

// 回到某个版本：先自动把当前状态存一个版本，再还原；版本里没有的文件会被删除
export async function restoreVersion(root, id) {
  const dir = store(root);
  const v = JSON.parse(await fsp.readFile(path.join(dir, `${path.basename(id)}.json`), 'utf8'));
  const backup = await saveVersion(root, `回到“${v.name}”之前的自动存档`);
  for (const rel of await walk(root)) if (!(rel in v.files)) await fsp.rm(path.join(root, rel), { force: true });
  for (const [rel, hash] of Object.entries(v.files)) {
    const dest = path.join(root, rel);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.cf-tmp`;
    await fsp.copyFile(path.join(dir, 'blobs', hash), tmp);
    await fsp.rename(tmp, dest);
  }
  return { restored: v.name, backup };
}

export async function deleteVersion(root, id) {
  await fsp.rm(path.join(store(root), `${path.basename(id)}.json`), { force: true });
}

// 写文件不写坏：先写临时文件再改名
export async function writeAtomic(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.cf-${process.pid}-${Date.now()}.tmp`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
}

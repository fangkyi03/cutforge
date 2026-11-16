// 工程目录：新建、补齐说明文件与命令包装脚本。
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(HOME, 'bin', 'cutforge.mjs');
const MARK = '<!-- cutforge-manual';

async function copyDir(from, to) {
  await fsp.mkdir(to, { recursive: true });
  for (const e of await fsp.readdir(from, { withFileTypes: true })) {
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isDirectory()) await copyDir(a, b);
    else if (!fs.existsSync(b)) await fsp.copyFile(a, b);
  }
}

export function defaultProjectDir() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  return path.join(os.homedir(), 'Movies', 'CutForge', `影片-${stamp}`);
}

// 让目录成为可用的工程；已有的文件一律不覆盖（说明文件除外，它带版本标记）
export async function ensureProject(dir) {
  const root = path.resolve(dir);
  await fsp.mkdir(root, { recursive: true });
  if (!fs.existsSync(path.join(root, 'film.html'))) await copyDir(path.join(HOME, 'templates', 'starter'), root);
  await fsp.mkdir(path.join(root, 'assets'), { recursive: true });

  const manual = await fsp.readFile(path.join(HOME, 'manual', 'AGENTS.md'), 'utf8');
  const agentsFile = path.join(root, 'AGENTS.md');
  const existing = fs.existsSync(agentsFile) ? await fsp.readFile(agentsFile, 'utf8') : null;
  if (existing == null || existing.startsWith(MARK)) {
    if (existing !== manual) await fsp.writeFile(agentsFile, manual);
  }
  const claudeFile = path.join(root, 'CLAUDE.md');
  if (!fs.existsSync(claudeFile)) await fsp.writeFile(claudeFile, '@AGENTS.md\n');

  // 包装脚本写死本次确认过的 node 与 CutForge 路径，智能体不用自己找
  const bin = path.join(root, '.cutforge', 'bin');
  await fsp.mkdir(bin, { recursive: true });
  const sh = `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@" --project "$(cd "$(dirname "$0")/../.." && pwd)"\n`;
  await fsp.writeFile(path.join(bin, 'cutforge'), sh, { mode: 0o755 });
  await fsp.writeFile(path.join(bin, 'cutforge.cmd'), `@echo off\r\n"${process.execPath}" "${CLI}" %* --project "%~dp0..\\.."\r\n`);
  return root;
}

#!/usr/bin/env node
// 入口：只做 Node 版本把关（这个文件要能在旧版 Node 上运行），其余在 src/cli.mjs。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NEED = 22;
const major = (v) => Number(String(v).replace(/^v/, '').split('.')[0]);

function findNewerNode() {
  const found = [];
  const nvm = path.join(os.homedir(), '.nvm', 'versions', 'node');
  try {
    for (const name of fs.readdirSync(nvm)) {
      const bin = path.join(nvm, name, 'bin', 'node');
      if (major(name) >= NEED && fs.existsSync(bin)) found.push({ v: name.replace(/^v/, '').split('.').map(Number), bin });
    }
  } catch (e) { /* 没装 nvm */ }
  found.sort((a, b) => b.v[0] - a.v[0] || b.v[1] - a.v[1] || b.v[2] - a.v[2]);
  if (found.length) return found[0].bin;
  for (const bin of ['/opt/homebrew/bin/node', '/usr/local/bin/node']) {
    if (!fs.existsSync(bin) || bin === process.execPath) continue;
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    if (r.status === 0 && major(r.stdout) >= NEED) return bin;
  }
  return null;
}

if (major(process.versions.node) < NEED) {
  const node = findNewerNode();
  if (!node) {
    console.error(`CutForge 需要 Node ${NEED} 或更新的版本（当前是 ${process.versions.node}）。\n装一个新版：https://nodejs.org ，或 nvm install ${NEED}`);
    process.exit(1);
  }
  const r = spawnSync(node, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status == null ? 1 : r.status);
}

const { main } = await import('../src/cli.mjs');
await main(process.argv.slice(2));

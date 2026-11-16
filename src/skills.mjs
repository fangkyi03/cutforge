// 技能：一份给智能体的“做某类片子”的说明（SKILL.md），格式与 OpenFilm 的技能一致，可以直接装它的技能。
// 全名 <owner>/<name>：GitHub 上的取仓库所在账号，本地文件夹添加的是 local/<name>。
// 装在 ~/.cutforge/skills/<owner>-<name>/，出片时选上的技能会写进任务书。
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findTool } from './render/probe.mjs';

const ROOT = path.join(process.env.CUTFORGE_HOME || path.join(os.homedir(), '.cutforge'), 'skills');
const CATALOG = 'https://raw.githubusercontent.com/openfilm/skills/main/index.json';

const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, timeout: 300000, ...opts }, (e, out, err) => (e ? reject(new Error(String(err || e.message).trim().split('\n').slice(-2).join(' '))) : resolve(String(out))));
});

// 走系统代理：有 curl 用 curl
async function download(url, dest) {
  const curl = findTool('curl');
  if (curl) return run(curl, ['-fsSL', '--connect-timeout', '15', '-o', dest, url]);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 ${res.status}`);
  await fsp.writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  return Object.fromEntries(m[1].split('\n').map((l) => {
    const i = l.indexOf(':');
    return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] : null;
  }).filter(Boolean));
}

// openfilm.json 里的文字可能按语言分开写：优先中文
const pickLang = (v) => (v && typeof v === 'object' ? v['zh-CN'] || v.zh || v.en || Object.values(v)[0] : v) || '';

const slugOf = (full) => full.replace('/', '-');

async function readSkill(dir) {
  const md = await fsp.readFile(path.join(dir, 'SKILL.md'), 'utf8');
  const fm = frontmatter(md);
  let meta = {};
  try {
    meta = JSON.parse(await fsp.readFile(path.join(dir, 'openfilm.json'), 'utf8'));
  } catch { /* 可选 */ }
  let source = {};
  try {
    source = JSON.parse(await fsp.readFile(path.join(dir, '.cutforge-skill.json'), 'utf8'));
  } catch { /* 可选 */ }
  return {
    full: source.full || `local/${fm.name || path.basename(dir)}`,
    name: fm.name || path.basename(dir),
    title: pickLang(meta.title) || fm.name || path.basename(dir),
    description: pickLang(meta.summary) || fm.description || '',
    version: meta.version || '',
    source: source.from || '',
    cover: fs.existsSync(path.join(dir, 'cover.jpg')) ? path.join(dir, 'cover.jpg') : null,
    dir,
  };
}

export async function listSkills() {
  const out = [];
  for (const e of await fsp.readdir(ROOT, { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory() || !fs.existsSync(path.join(ROOT, e.name, 'SKILL.md'))) continue;
    try {
      out.push(await readSkill(path.join(ROOT, e.name)));
    } catch { /* 坏的跳过 */ }
  }
  return out.sort((a, b) => a.full.localeCompare(b.full));
}

// 按全名或名字找
export async function findSkill(name) {
  const all = await listSkills();
  return all.find((s) => s.full === name) || all.find((s) => s.name === name) || null;
}

export async function readSkillText(name) {
  const s = await findSkill(name);
  if (!s) throw new Error(`没有安装技能 ${name}（cutforge skills 看已安装的）`);
  return { ...s, text: await fsp.readFile(path.join(s.dir, 'SKILL.md'), 'utf8') };
}

async function findSkillDirs(dir, out = []) {
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) await findSkillDirs(abs, out);
    else if (e.name === 'SKILL.md') out.push(dir);
  }
  return out;
}

async function install(dir, full, from) {
  const dest = path.join(ROOT, slugOf(full));
  await fsp.rm(dest, { recursive: true, force: true });
  await fsp.mkdir(ROOT, { recursive: true });
  await fsp.cp(dir, dest, { recursive: true, filter: (src) => !path.basename(src).startsWith('.git') });
  await fsp.writeFile(path.join(dest, '.cutforge-skill.json'), JSON.stringify({ full, from, installed: Date.now() }));
  return readSkill(dest);
}

// link：GitHub 仓库地址（可带 /tree/<分支>/<路径>）或本地文件夹
export async function addSkill(link) {
  link = String(link || '').trim();
  if (!link) throw new Error('给一个 GitHub 链接或本地文件夹');
  if (fs.existsSync(link) && fs.statSync(link).isDirectory()) {
    const dirs = await findSkillDirs(path.resolve(link));
    if (!dirs.length) throw new Error('这个文件夹里没有 SKILL.md');
    const added = [];
    for (const d of dirs) {
      const name = frontmatter(await fsp.readFile(path.join(d, 'SKILL.md'), 'utf8')).name || path.basename(d);
      added.push(await install(d, `local/${name}`, path.resolve(link)));
    }
    return added;
  }
  const m = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([^/]+)(?:\/(.+))?)?\/?$/.exec(link);
  if (!m) throw new Error('只支持 GitHub 仓库链接（https://github.com/owner/repo）或本地文件夹');
  const [, owner, repo, ref = 'HEAD', sub = ''] = m;
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'cutforge-skill-'));
  try {
    const tgz = path.join(tmp, 'repo.tgz');
    await download(`https://codeload.github.com/${owner}/${repo}/tar.gz/${ref}`, tgz);
    await run('tar', ['-xzf', tgz, '-C', tmp]);
    const top = (await fsp.readdir(tmp, { withFileTypes: true })).find((e) => e.isDirectory());
    if (!top) throw new Error('仓库是空的');
    const base = path.join(tmp, top.name, sub);
    const dirs = await findSkillDirs(base);
    if (!dirs.length) throw new Error('仓库里没有 SKILL.md');
    const lower = owner.toLowerCase();
    const ownerName = lower === 'local' || lower === 'project' ? `github-${lower}` : lower;
    const added = [];
    for (const d of dirs) {
      const name = frontmatter(await fsp.readFile(path.join(d, 'SKILL.md'), 'utf8')).name || path.basename(d);
      added.push(await install(d, `${ownerName}/${name}`, `https://github.com/${owner}/${repo}`));
    }
    return added;
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

export async function removeSkill(name) {
  const s = await findSkill(name);
  if (!s) throw new Error(`没有安装技能 ${name}`);
  await fsp.rm(s.dir, { recursive: true, force: true });
}

// OpenFilm 的官方技能目录
export async function skillCatalog() {
  const tmp = path.join(os.tmpdir(), `cutforge-catalog-${crypto.randomBytes(3).toString('hex')}.json`);
  try {
    await download(CATALOG, tmp);
    const idx = JSON.parse(await fsp.readFile(tmp, 'utf8'));
    const installed = new Set((await listSkills()).map((s) => s.full));
    return (idx.skills || []).filter((s) => !(idx.revoked || []).includes(s.name)).map((s) => {
      const owner = /github\.com\/([\w.-]+)\//.exec(s.repo)?.[1]?.toLowerCase() || 'unknown';
      const full = `${owner}/${s.name}`;
      return { full, name: s.name, repo: s.repo, path: s.path, version: s.version, link: `${s.repo}/tree/${s.commit || 'HEAD'}/${s.path}`, installed: installed.has(full) };
    });
  } finally {
    await fsp.rm(tmp, { force: true });
  }
}

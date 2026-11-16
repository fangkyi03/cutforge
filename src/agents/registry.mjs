// 智能体接入：找到本机装好的编码智能体命令行，并知道怎样让它们不问话地跑完一个任务。
// 不改它们自己的配置（~/.codex、~/.claude 等），只在启动这一次时传参数。
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../render/probe.mjs';

const HOME = os.homedir();
export const CONFIG_FILE = path.join(process.env.CUTFORGE_HOME || path.join(HOME, '.cutforge'), 'config.json');

// tested：是否在开发机上按当前版本核对过参数
const CLI = fileURLToPath(new URL('../../bin/cutforge.mjs', import.meta.url));
const BUILTIN = [
  {
    id: 'builtin', name: '内置智能体', bin: process.execPath, install: '在“环境 → 内置智能体”里填 API 接口和密钥', tested: false, needsLlm: true,
    command: ({ root }) => ({ args: [CLI, 'agent', '--project', root], stdin: true }),
  },
  {
    id: 'codex', name: 'Codex', bin: 'codex', install: 'npm i -g @openai/codex', tested: true, login: ['login', 'status'],
    command: ({ root }) => ({ args: ['exec', '--skip-git-repo-check', '--sandbox', 'workspace-write', '--color', 'never', '-C', root, '-'], stdin: true }),
  },
  {
    id: 'claude', name: 'Claude Code', bin: 'claude', install: 'npm i -g @anthropic-ai/claude-code', tested: false,
    command: () => ({ args: ['-p', '--permission-mode', 'acceptEdits', '--allowedTools', 'Bash(.cutforge/bin/cutforge:*)', 'Read', 'Glob', 'Grep'], stdin: true }),
  },
  {
    id: 'gemini', name: 'Gemini CLI', bin: 'gemini', install: 'npm i -g @google/gemini-cli', tested: false,
    command: ({ prompt }) => ({ args: ['--yolo', '-p', prompt] }),
  },
  {
    id: 'qwen', name: 'Qwen Code', bin: 'qwen', install: 'npm i -g @qwen-code/qwen-code', tested: false,
    command: ({ prompt }) => ({ args: ['--yolo', '-p', prompt] }),
  },
  {
    id: 'opencode', name: 'opencode', bin: 'opencode', install: 'npm i -g opencode-ai', tested: false,
    command: ({ prompt }) => ({ args: ['run', prompt] }),
  },
];

function searchDirs() {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const extra = [path.dirname(process.execPath), '/opt/homebrew/bin', '/usr/local/bin', path.join(HOME, '.local', 'bin'),
    path.join(HOME, '.bun', 'bin'), path.join(HOME, '.npm-global', 'bin'), path.join(HOME, '.claude', 'local')];
  try {
    const nvm = path.join(HOME, '.nvm', 'versions', 'node');
    for (const v of fs.readdirSync(nvm)) extra.push(path.join(nvm, v, 'bin'));
  } catch { /* 没装 nvm */ }
  if (process.platform === 'win32' && process.env.APPDATA) extra.push(path.join(process.env.APPDATA, 'npm'));
  return [...new Set([...dirs, ...extra])];
}

export function findBin(name) {
  if (path.isAbsolute(name)) return fs.existsSync(name) ? name : null;
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : [''];
  for (const dir of searchDirs()) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      try {
        if (fs.statSync(p).isFile()) return p;
      } catch { /* 不在这个目录 */ }
    }
  }
  return null;
}

// "kimi --print {prompt}" → ['kimi', '--print', '{prompt}']，支持引号
export function splitCommand(s) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

export async function readConfig() {
  try {
    return JSON.parse(await fsp.readFile(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export async function writeConfig(cfg) {
  await fsp.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
  await fsp.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

async function customAgents() {
  const cfg = await readConfig();
  return (cfg.agents || []).filter((a) => a && a.name && a.command).map((a) => {
    const parts = splitCommand(a.command);
    return {
      id: `custom:${a.name}`, name: a.name, bin: parts[0], install: '在“环境”里修改命令', tested: false, custom: true, template: a.command,
      command: ({ prompt }) => {
        const hasSlot = parts.some((p) => p.includes('{prompt}'));
        return { args: parts.slice(1).map((p) => p.replaceAll('{prompt}', prompt)), stdin: !hasSlot };
      },
    };
  });
}

export async function allAgents() {
  return [...BUILTIN, ...(await customAgents())];
}

let cache = null;
export async function detectAgents({ fresh = false } = {}) {
  if (cache && !fresh && Date.now() - cache.at < 30000) return cache.list;
  const list = await Promise.all((await allAgents()).map(async (a) => {
    const file = a.needsLlm ? (fs.existsSync(path.join(path.dirname(CONFIG_FILE), 'llm.json')) ? a.bin : null) : findBin(a.bin);
    const out = { id: a.id, name: a.name, install: a.install, tested: a.tested, custom: !!a.custom, template: a.template || null, installed: !!file, path: file, version: null, loggedIn: null };
    if (!file) return out;
    const env = { ...process.env, PATH: [path.dirname(process.execPath), path.dirname(file), process.env.PATH].join(path.delimiter) };
    if (a.needsLlm) {
      try {
        const c = JSON.parse(fs.readFileSync(path.join(path.dirname(CONFIG_FILE), 'llm.json'), 'utf8'));
        out.version = `${c.model} · ${new URL(c.base).host}`;
      } catch { /* 没配 */ }
      return out;
    }
    if (!a.custom) {
      const v = await run(file, ['--version'], { timeout: 6000, env });
      out.version = (v.stdout || v.stderr).trim().split('\n')[0].slice(0, 60) || null;
    }
    if (a.login) out.loggedIn = (await run(file, a.login, { timeout: 8000, env })).ok;
    return out;
  }));
  cache = { at: Date.now(), list };
  return list;
}

export async function resolveAgent(id) {
  const a = (await allAgents()).find((x) => x.id === id);
  if (!a) return null;
  const file = a.needsLlm ? a.bin : findBin(a.bin);
  return file ? { ...a, path: file } : null;
}

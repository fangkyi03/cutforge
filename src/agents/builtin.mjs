// 内置智能体：直接用 API 密钥调用兼容 OpenAI Chat Completions 的大模型（OpenAI、DeepSeek、Kimi、通义千问、中转站…），
// 给它几个工具（列文件、读文件、写文件、运行 cutforge 命令），在工程目录里把片子做出来。
// 用法同其它命令行智能体：任务书从标准输入读入，过程打印到标准错误，最后的说明打印到标准输出。
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const HOME_DIR = process.env.CUTFORGE_HOME || path.join(os.homedir(), '.cutforge');
export const LLM_PRESETS = [
  { id: 'openai', name: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-4.1' },
  { id: 'deepseek', name: 'DeepSeek', base: 'https://api.deepseek.com', model: 'deepseek-chat' },
  { id: 'kimi', name: 'Kimi（月之暗面）', base: 'https://api.moonshot.cn/v1', model: 'kimi-k2-0711-preview' },
  { id: 'qwen', name: '通义千问', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { id: 'custom', name: '自定义（兼容 OpenAI 的中转站）', base: '', model: '' },
];

export async function readLlm() {
  try {
    const c = JSON.parse(await fsp.readFile(path.join(HOME_DIR, 'llm.json'), 'utf8'));
    return c && c.base && c.model && c.key ? c : null;
  } catch {
    return null;
  }
}

export async function writeLlm({ preset, base, model, key }) {
  const old = (await readLlm()) || {};
  const c = { preset: preset || 'custom', base: String(base || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, ''), model: String(model || '').trim(), key: String(key || '').trim() || old.key || '' };
  await fsp.mkdir(HOME_DIR, { recursive: true });
  await fsp.writeFile(path.join(HOME_DIR, 'llm.json'), JSON.stringify(c), { mode: 0o600 });
  await fsp.chmod(path.join(HOME_DIR, 'llm.json'), 0o600).catch(() => {});
  return { preset: c.preset, base: c.base, model: c.model, hasKey: !!c.key };
}

export async function llmStatus() {
  try {
    const c = JSON.parse(await fsp.readFile(path.join(HOME_DIR, 'llm.json'), 'utf8'));
    return { preset: c.preset, base: c.base, model: c.model, hasKey: !!c.key };
  } catch {
    return null;
  }
}

const TOOLS = [
  { name: 'list_files', description: '列出工程里某个目录下的文件（相对工程目录，默认根目录）。', parameters: { type: 'object', properties: { dir: { type: 'string' } } } },
  { name: 'read_file', description: '读一个文本文件的全部内容（相对工程目录）。', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'write_file', description: '写一个文本文件（整份覆盖，相对工程目录，目录不存在会自动建）。用来写 film.html 和页面。', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'cutforge', description: '运行 CutForge 命令：look（检查影片）、probe <文件>、library、library add <id>、get voice "文字"、skills、skill <名字>。返回命令输出。', parameters: { type: 'object', properties: { args: { type: 'array', items: { type: 'string' } } }, required: ['args'] } },
];
const ALLOWED = new Set(['look', 'probe', 'library', 'get', 'skills', 'skill', 'transcribe']);

function inside(root, rel) {
  const abs = path.resolve(root, String(rel || '.'));
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('只能访问工程目录里的文件');
  const parts = path.relative(root, abs).split(path.sep);
  if (parts[0] === '.cutforge' || parts[0] === '.git') throw new Error('不能访问 .cutforge 和 .git（那是工具自己的文件）');
  return abs;
}

async function callTool(root, name, args, cli) {
  if (name === 'list_files') {
    const dir = inside(root, args.dir || '.');
    const out = [];
    const walk = async (d, depth) => {
      for (const e of await fsp.readdir(d, { withFileTypes: true })) {
        if (e.name.startsWith('.') || e.name === 'exports' || e.name === 'node_modules') continue;
        const rel = path.relative(root, path.join(d, e.name)).split(path.sep).join('/');
        out.push(e.isDirectory() ? `${rel}/` : rel);
        if (e.isDirectory() && depth < 3) await walk(path.join(d, e.name), depth + 1);
      }
    };
    await walk(dir, 0);
    return out.slice(0, 400).join('\n') || '（空）';
  }
  if (name === 'read_file') {
    const text = await fsp.readFile(inside(root, args.path), 'utf8');
    return text.length > 60000 ? `${text.slice(0, 60000)}\n…（文件太长，只给了前 60000 个字符）` : text;
  }
  if (name === 'write_file') {
    const abs = inside(root, args.path);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, String(args.content ?? ''));
    return `已写入 ${args.path}（${String(args.content ?? '').length} 个字符）`;
  }
  if (name === 'cutforge') {
    const a = (Array.isArray(args.args) ? args.args : String(args.args || '').split(/\s+/)).map(String).filter(Boolean);
    if (!ALLOWED.has(a[0])) throw new Error(`只允许这些命令：${[...ALLOWED].join('、')}`);
    return new Promise((resolve) => {
      execFile(process.execPath, [cli, ...a, '--project', root], { timeout: 600000, maxBuffer: 16 * 1024 * 1024 }, (e, out, err) => resolve(`${out}${err}`.trim() || (e ? e.message : '（没有输出）')));
    });
  }
  throw new Error(`没有这个工具：${name}`);
}

const SYSTEM = `你是做视频的智能体，在一个 CutForge 影片工程里工作。你只能通过工具读写工程里的文件、运行 cutforge 命令。
先读 AGENTS.md 和 film.html，弄清格式和现状；写完运行 cutforge look，修到没有错误为止。
最后用两三句中文说明做了什么。不要编造不存在的素材文件。`;

export async function runBuiltin({ root, prompt, cli, log = (s) => process.stderr.write(`${s}\n`), maxSteps = 60 }) {
  const cfg = await readLlm();
  if (!cfg) throw new Error('还没有配置内置智能体：在“环境 → 内置智能体”里填接口地址、模型和密钥');
  const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }];
  let usage = { prompt: 0, completion: 0 };
  for (let step = 1; step <= maxSteps; step++) {
    const res = await fetch(`${cfg.base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ model: cfg.model, messages, tools: TOOLS.map((t) => ({ type: 'function', function: t })), tool_choice: 'auto' }),
      signal: AbortSignal.timeout(300000),
    });
    if (!res.ok) throw new Error(`${new URL(cfg.base).host} 返回 ${res.status}：${(await res.text()).slice(0, 400)}`);
    const j = await res.json();
    usage.prompt += j.usage?.prompt_tokens || 0;
    usage.completion += j.usage?.completion_tokens || 0;
    const msg = j.choices?.[0]?.message;
    if (!msg) throw new Error('模型没有返回内容');
    messages.push({ role: 'assistant', content: msg.content ?? '', ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}) });
    if (!msg.tool_calls?.length) {
      log(`共 ${step} 步，用量：输入 ${usage.prompt} tokens，输出 ${usage.completion} tokens`);
      return { reply: (msg.content || '').trim(), usage, steps: step };
    }
    if (msg.content) log(msg.content.trim());
    for (const call of msg.tool_calls) {
      let args = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch { /* 参数坏了，按空处理 */ }
      const brief = call.function.name === 'write_file' ? args.path : call.function.name === 'cutforge' ? (args.args || []).join(' ') : args.path || args.dir || '';
      log(`→ ${call.function.name} ${brief || ''}`);
      let out;
      try {
        out = await callTool(root, call.function.name, args, cli);
      } catch (e) {
        out = `出错：${e.message}`;
      }
      if (call.function.name === 'cutforge') log(out.split('\n').slice(-3).join('\n'));
      messages.push({ role: 'tool', tool_call_id: call.id, content: out });
    }
  }
  throw new Error(`超过 ${maxSteps} 步还没做完，停下了`);
}

export const hasLlm = async () => !!(await readLlm());
export const llmConfigured = () => fs.existsSync(path.join(HOME_DIR, 'llm.json'));

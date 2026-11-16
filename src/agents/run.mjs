// 运行智能体：流式输出、可停止、失败时换下一个从当前进度接着做。
// 工程的全部状态都在文件里，所以换一家接手不需要任何会话迁移。
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { buildPrompt } from './brief.mjs';
import { resolveAgent } from './registry.mjs';
import { recordRun, tokensFrom } from './usage.mjs';

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;
const MAX_LOG = 300000;

export class AgentRunner {
  constructor({ root, emit }) {
    this.root = root;
    this.emit = emit;
    this.current = null;
    this.stopped = false;
  }

  get busy() {
    return !!this.current;
  }

  stop() {
    this.stopped = true;
    const p = this.current?.proc;
    if (!p || p.exitCode != null) return;
    try {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(p.pid), '/T', '/F']);
      else process.kill(-p.pid, 'SIGTERM');
    } catch {
      p.kill('SIGTERM');
    }
  }

  // 依次尝试 agentIds；返回 { ok, agent }
  async run({ request, agentIds, style, skills = [] }) {
    this.stopped = false;
    let previous = null;
    try {
      for (let i = 0; i < agentIds.length; i++) {
        const agent = await resolveAgent(agentIds[i]);
        if (!agent) {
          this.emit({ type: 'note', text: `没有找到 ${agentIds[i]} 的命令行，跳过。` });
          continue;
        }
        const prompt = await buildPrompt({ root: this.root, request, style, skills, previous });
        const result = await this.#once(agent, prompt);
        if (result.code === 0) return { ok: true, agent: agent.name };
        if (this.stopped) return { ok: false, stopped: true };
        previous = agent.name;
        if (i < agentIds.length - 1) this.emit({ type: 'note', text: `${agent.name} 没有跑完（退出码 ${result.code}），换下一个从当前进度接着做。` });
      }
      return { ok: false };
    } finally {
      this.current = null;
    }
  }

  async #once(agent, prompt) {
    const runId = `${Date.now().toString(36)}-${agent.id.replace(/[^a-z0-9]/gi, '')}`;
    const dir = path.join(this.root, '.cutforge', 'runs');
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, `${runId}.prompt.md`), prompt);
    const { args, stdin } = agent.command({ root: this.root, prompt });
    const env = { ...process.env, PATH: [path.dirname(process.execPath), path.dirname(agent.path), process.env.PATH].join(path.delimiter), NO_COLOR: '1', FORCE_COLOR: '0' };
    const started = Date.now();
    this.emit({ type: 'run-start', runId, agent: { id: agent.id, name: agent.name }, time: started });

    return new Promise((resolve) => {
      let proc;
      try {
        proc = spawn(agent.path, args, { cwd: this.root, env, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' });
      } catch (e) {
        this.emit({ type: 'run-end', runId, code: -1, seconds: 0, error: String(e.message) });
        return resolve({ code: -1 });
      }
      this.current = { proc, runId };
      let size = 0;
      let buf = '';
      let said = '';
      let fullLog = '';
      let timer = null;
      const flush = () => {
        timer = null;
        if (!buf) return;
        this.emit({ type: 'run-out', runId, text: buf });
        buf = '';
      };
      const onData = (d) => {
        if (size > MAX_LOG) return;
        const text = String(d).replace(ANSI, '').replace(/\r(?!\n)/g, '\n');
        size += text.length;
        if (fullLog.length < 200000) fullLog += text;
        buf += text;
        if (!timer) timer = setTimeout(flush, 120);
      };
      proc.stdout.on('data', (d) => {
        if (said.length < 20000) said += String(d).replace(ANSI, '');
        onData(d);
      });
      proc.stderr.on('data', onData);
      proc.stdin.on('error', () => {});
      if (stdin) proc.stdin.write(prompt);
      proc.stdin.end();
      let done = false;
      const finish = (code, error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        flush();
        const seconds = (Date.now() - started) / 1000;
        if (!this.stopped) recordRun({ agent: agent.name, ok: code === 0, seconds, tokens: tokensFrom(fullLog) }).catch(() => {});
        this.emit({ type: 'run-end', runId, code, seconds, stopped: this.stopped, error, reply: said.trim().slice(-6000) });
        resolve({ code });
      };
      proc.on('error', (e) => finish(-1, String(e.message)));
      proc.on('close', (code, signal) => finish(code ?? (signal ? 130 : -1)));
    });
  }
}

// 各家智能体的用时与用量记录：每跑完一次记一条，环境对话框里汇总对比。
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const FILE = path.join(process.env.CUTFORGE_HOME || path.join(os.homedir(), '.cutforge'), 'usage.json');

// 从输出里认出用了多少 token（Codex：“tokens used\n23,606”；内置智能体：“输入 X tokens，输出 Y tokens”）
export function tokensFrom(log) {
  const builtin = /输入\s*([\d,]+)\s*tokens，输出\s*([\d,]+)\s*tokens/.exec(log);
  if (builtin) return Number(builtin[1].replace(/,/g, '')) + Number(builtin[2].replace(/,/g, ''));
  const codex = /tokens used\s*\n?\s*([\d,]+)/i.exec(log);
  if (codex) return Number(codex[1].replace(/,/g, ''));
  const generic = /([\d,]{3,})\s*(?:total\s*)?tokens/i.exec(log);
  return generic ? Number(generic[1].replace(/,/g, '')) : null;
}

export async function recordRun(entry) {
  let list = [];
  try {
    list = JSON.parse(await fsp.readFile(FILE, 'utf8'));
  } catch { /* 第一次 */ }
  list.push({ time: Date.now(), ...entry });
  await fsp.mkdir(path.dirname(FILE), { recursive: true });
  await fsp.writeFile(FILE, JSON.stringify(list.slice(-500)));
}

export async function usageSummary() {
  let list = [];
  try {
    list = JSON.parse(await fsp.readFile(FILE, 'utf8'));
  } catch { /* 还没有 */ }
  const by = {};
  for (const r of list) {
    const s = (by[r.agent] ||= { agent: r.agent, runs: 0, ok: 0, seconds: 0, tokens: 0, tokenRuns: 0 });
    s.runs++;
    if (r.ok) s.ok++;
    s.seconds += r.seconds || 0;
    if (r.tokens != null) {
      s.tokens += r.tokens;
      s.tokenRuns++;
    }
  }
  return Object.values(by).map((s) => ({ agent: s.agent, runs: s.runs, okRate: s.ok / s.runs, avgSeconds: s.seconds / s.runs, avgTokens: s.tokenRuns ? Math.round(s.tokens / s.tokenRuns) : null }));
}

// 环境检查：出片前先确认这台电脑上需要的东西都在，缺什么给出装法。
import { detectAgents } from './agents/registry.mjs';
import { findChrome } from './render/chrome.mjs';
import { findTool, run } from './render/probe.mjs';

export async function doctor({ fresh = false } = {}) {
  const checks = [];
  const nodeOk = Number(process.versions.node.split('.')[0]) >= 22;
  checks.push({ id: 'node', label: 'Node.js', required: true, ok: nodeOk, detail: `v${process.versions.node}`, fix: '需要 Node 22 或更新：https://nodejs.org' });

  const ffmpeg = findTool('ffmpeg');
  let ffDetail = '没有找到';
  let x264 = false;
  if (ffmpeg) {
    ffDetail = (await run(ffmpeg, ['-version'])).stdout.split('\n')[0].replace(/ Copyright.*/, '');
    x264 = /libx264/.test((await run(ffmpeg, ['-hide_banner', '-encoders'])).stdout);
  }
  const ffFix = process.platform === 'darwin' ? 'brew install ffmpeg' : process.platform === 'win32' ? 'winget install ffmpeg' : 'sudo apt install ffmpeg';
  checks.push({ id: 'ffmpeg', label: 'FFmpeg（导出视频）', required: true, ok: !!ffmpeg && x264, detail: ffmpeg && !x264 ? `${ffDetail}（缺少 libx264 编码器）` : ffDetail, fix: ffFix });
  checks.push({ id: 'ffprobe', label: 'ffprobe（读素材信息）', required: true, ok: !!findTool('ffprobe'), detail: findTool('ffprobe') || '没有找到', fix: ffFix });

  const chrome = findChrome();
  checks.push({ id: 'chrome', label: 'Chrome / Edge（预览与渲染）', required: true, ok: !!chrome, detail: chrome || '没有找到', fix: '安装 Google Chrome 或 Microsoft Edge，或设置环境变量 CUTFORGE_CHROME' });

  const agents = await detectAgents({ fresh });
  const usable = agents.filter((a) => a.installed);
  checks.push({
    id: 'agent', label: '智能体命令行（出片）', required: false, ok: usable.length > 0,
    detail: usable.length ? usable.map((a) => `${a.name}${a.loggedIn === false ? '（未登录）' : ''}`).join('、') : '一个都没有找到',
    fix: '至少装一个，例如 npm i -g @openai/codex；没有智能体仍可手动剪辑和导出',
  });
  return checks;
}

export function formatDoctor(checks) {
  return checks.map((c) => `${c.ok ? '✓' : c.required ? '✗' : '!'} ${c.label}  ${c.detail}${c.ok ? '' : `\n    → ${c.fix}`}`).join('\n');
}

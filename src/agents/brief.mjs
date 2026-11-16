// 给智能体的任务书：要求 + 风格 + 现有素材 + 完成标准。
import fsp from 'node:fs/promises';
import path from 'node:path';
import { kindOfFile } from '../film/doc.mjs';
import { probe } from '../render/probe.mjs';
import { HOME } from '../project.mjs';

const KIND = { video: '视频', image: '图片', audio: '声音', page: '页面' };

export async function listAssets(root, limit = 60) {
  const out = [];
  async function walk(dir) {
    let entries = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.') || out.length >= limit) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) await walk(abs);
      else {
        const rel = path.relative(root, abs).split(path.sep).join('/');
        const kind = kindOfFile(rel);
        if (!kind || kind === 'page') {
          out.push({ file: rel, kind: null });
          continue;
        }
        const p = kind === 'image' ? null : await probe(abs);
        out.push({ file: rel, kind, duration: p?.duration ?? null, width: p?.width ?? null, height: p?.height ?? null, hasAudio: p?.hasAudio ?? null });
      }
    }
  }
  await walk(path.join(root, 'assets'));
  return out;
}

export async function loadStyles() {
  const dir = path.join(HOME, 'styles');
  const out = [];
  for (const name of (await fsp.readdir(dir)).sort()) {
    if (!name.endsWith('.md')) continue;
    const text = await fsp.readFile(path.join(dir, name), 'utf8');
    const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
    if (!m) continue;
    const meta = Object.fromEntries(m[1].split('\n').map((l) => {
      const i = l.indexOf(':');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }));
    out.push({ id: meta.id || name.replace(/\.md$/, ''), name: meta.name || name, desc: meta.desc || '', colors: (meta.colors || '').split(/\s+/).filter(Boolean), guide: m[2].trim() });
  }
  return out;
}

export async function buildPrompt({ root, request, style, previous }) {
  const assets = await listAssets(root);
  const lines = [
    '你在一个 CutForge 影片工程里工作，当前目录就是工程目录。',
    '先完整读一遍 AGENTS.md：它说明了影片的文件格式、必须遵守的规则和检查命令。然后读 film.html 与已有页面，弄清现状。',
    '',
    '## 任务',
    request.trim(),
  ];
  if (previous) {
    lines.push('', '## 接手说明', `上一个智能体（${previous}）中途失败了。工程目录里是它已经完成的部分：先检查现状（运行 look），在它的基础上继续完成任务，不要推倒重来。`);
  }
  if (style) lines.push('', `## 风格：${style.name}`, style.guide);
  lines.push('', '## 现有素材（assets/）');
  if (!assets.length) lines.push('（没有素材。需要图形就用代码画；不要引用不存在的文件。）');
  for (const a of assets) {
    const bits = [];
    if (a.kind) bits.push(KIND[a.kind]);
    if (a.duration != null) bits.push(`${a.duration.toFixed(2)} 秒`);
    if (a.width) bits.push(`${a.width}×${a.height}`);
    if (a.kind === 'video') bits.push(a.hasAudio ? '有声音' : '无声音');
    lines.push(`- ${a.file}${bits.length ? `（${bits.join('，')}）` : ''}`);
  }
  lines.push(
    '', '## 完成标准',
    '1. 运行 `.cutforge/bin/cutforge look`，修到没有错误（✗）为止；提醒（!）逐条判断。',
    '2. 不要渲染成片，不要改 .cutforge/ 里的文件，不要动带 locked 的轨道。',
    '3. 最后用两三句中文说明做了什么，以及有意保留的提醒。',
  );
  return lines.join('\n');
}

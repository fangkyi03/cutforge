// 媒体文件信息（ffprobe）与工具查找。
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function findTool(name) {
  const env = process.env[`CUTFORGE_${name.toUpperCase()}`];
  if (env && fs.existsSync(env)) return env;
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  const dirs = (process.env.PATH || '').split(path.delimiter).concat(
    process.platform === 'win32' ? [] : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'],
  );
  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

export function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024, timeout: 30000, ...opts }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: String(stdout || ''), stderr: String(stderr || ''), error });
    });
  });
}

export async function probe(file) {
  const ffprobe = findTool('ffprobe');
  if (!ffprobe) return null;
  const r = await run(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  if (!r.ok) return null;
  try {
    const j = JSON.parse(r.stdout);
    const v = (j.streams || []).find((s) => s.codec_type === 'video');
    const a = (j.streams || []).find((s) => s.codec_type === 'audio');
    const duration = Number(j.format?.duration);
    return {
      duration: Number.isFinite(duration) ? duration : null,
      hasVideo: !!v, hasAudio: !!a,
      width: v?.width || null, height: v?.height || null,
      videoCodec: v?.codec_name || null, audioCodec: a?.codec_name || null,
    };
  } catch {
    return null;
  }
}

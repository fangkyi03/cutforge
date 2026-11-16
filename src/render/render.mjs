// 渲染成片：无头浏览器逐帧画，ffmpeg 编码；声音不从页面录，由 ffmpeg 按时间线混。
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { parseFilm } from '../film/doc.mjs';
import { startPreview } from '../server/preview.mjs';
import { launchChrome } from './chrome.mjs';
import { findTool, probe } from './probe.mjs';

const f3 = (n) => (Math.round(n * 1000) / 1000).toString();

function tempoChain(speed) {
  const out = [];
  let s = speed;
  while (s < 0.5) {
    out.push('atempo=0.5');
    s /= 0.5;
  }
  while (s > 100) {
    out.push('atempo=100');
    s /= 100;
  }
  if (Math.abs(s - 1) > 1e-4) out.push(`atempo=${f3(s)}`);
  return out;
}

// 影片里会出声的片段 → ffmpeg 的输入与滤镜
export async function audioPlan(doc, info, filmDir) {
  const inputs = [];
  const chains = [];
  for (const c of doc.clips) {
    const tr = doc.tracks[c.track];
    const meta = info.clips[c.key];
    if (c.kind !== 'audio' && c.kind !== 'video') continue;
    if (c.disabled || tr.hidden || tr.muted || c.volume <= 0 || !meta || !(meta.length > 0)) continue;
    const file = path.resolve(filmDir, c.file);
    const p = await probe(file);
    if (!p || !p.hasAudio) continue;
    const n = inputs.length / 6 + 1;
    inputs.push('-ss', f3(c.in), '-t', f3(meta.length * c.speed), '-i', file);
    const fx = ['aresample=48000', 'aformat=channel_layouts=stereo', ...tempoChain(c.speed)];
    if (c.volume !== 1) fx.push(`volume=${f3(c.volume)}`);
    if (c.fade[0] > 0) fx.push(`afade=t=in:st=0:d=${f3(c.fade[0])}`);
    if (c.fade[1] > 0) fx.push(`afade=t=out:st=${f3(Math.max(0, meta.length - c.fade[1]))}:d=${f3(c.fade[1])}`);
    if (c.at > 0) fx.push(`adelay=${Math.round(c.at * 1000)}:all=1`);
    chains.push(`[${n}:a]${fx.join(',')}[a${n}]`);
  }
  return { inputs, chains, count: chains.length };
}

export async function renderFilm({ root, film = 'film.html', out, fps = 30, scale = 1, range = null, alpha = false, loudness = null, onProgress = () => {}, signal } = {}) {
  const ffmpeg = findTool('ffmpeg');
  if (!ffmpeg) throw new Error('找不到 ffmpeg：macOS 运行 brew install ffmpeg，Windows 运行 winget install ffmpeg');
  root = path.resolve(root);
  const filmFile = path.join(root, film);
  const doc = parseFilm(await fsp.readFile(filmFile, 'utf8'));
  const started = Date.now();
  const preview = await startPreview({ root });
  let browser = null;
  let enc = null;
  try {
    browser = await launchChrome();
    const page = await browser.newPage({ width: doc.width, height: doc.height, scale });
    if (alpha) await page.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    await page.goto(`${preview.origin}/__cf__/player.html?film=${encodeURIComponent(film)}&render=1${alpha ? '&alpha=1' : ''}`);
    const info = await page.evaluate('__cf.ready.then(() => __cf.info())');
    if (!(info.duration > 0)) throw new Error('影片长度是 0：film.html 里还没有能播放的片段');
    const from = Math.max(0, range ? range[0] : 0);
    const to = Math.min(info.duration, range ? range[1] : info.duration);
    const total = Math.max(1, Math.round((to - from) * fps));
    const audio = alpha ? { inputs: [], chains: [], count: 0 } : await audioPlan(doc, info, path.dirname(filmFile));

    const webm = /\.webm$/i.test(out);
    const graph = [alpha ? (webm ? '[0:v]format=yuva420p[v]' : '[0:v]format=yuva444p10le[v]') : '[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2:in_range=full:out_range=tv,format=yuv420p[v]', ...audio.chains];
    if (audio.count) {
      const ins = Array.from({ length: audio.count }, (_, i) => `[a${i + 1}]`).join('');
      const trim = from > 0 ? `,atrim=start=${f3(from)},asetpts=PTS-STARTPTS` : '';
      // amix 之后时间戳不连续，直接编码会得到时长错乱的音轨；先重整再补静音到片尾
      graph.push(`${ins}amix=inputs=${audio.count}:normalize=0:dropout_transition=0${trim},aresample=async=1:first_pts=0${loudness ? `,loudnorm=I=${loudness}:TP=-1.5:LRA=11,aresample=48000` : ''},apad[aout]`);
    }
    await fsp.mkdir(path.dirname(out), { recursive: true });
    const args = [
      '-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', alpha ? 'png' : 'mjpeg', '-i', 'pipe:0',
      ...audio.inputs, '-filter_complex', graph.join(';'), '-map', '[v]', ...(audio.count ? ['-map', '[aout]', '-c:a', 'aac', '-b:a', '192k'] : []),
      ...(alpha && webm ? ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '30', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4'] : alpha ? ['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16'] : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-movflags', '+faststart']), '-r', String(fps),
      '-t', f3(total / fps), out,
    ];
    enc = spawn(ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let encErr = '';
    enc.stderr.on('data', (d) => { encErr += d; });
    const encDone = new Promise((resolve) => enc.on('close', resolve));
    enc.stdin.on('error', () => {});

    for (let i = 0; i < total; i++) {
      if (signal?.aborted) throw new Error('已取消');
      if (enc.exitCode != null) break;
      await page.evaluate(`__cf.seek(${from + i / fps})`);
      const buf = Buffer.from(await page.screenshot(alpha ? { format: 'png' } : { format: 'jpeg', quality: 95 }), 'base64');
      if (!enc.stdin.write(buf)) await new Promise((r) => enc.stdin.once('drain', r));
      if (i % 5 === 0 || i === total - 1) onProgress({ frame: i + 1, total });
    }
    enc.stdin.end();
    const code = await encDone;
    if (code !== 0) throw new Error(`ffmpeg 编码失败：${encErr.trim().split('\n').slice(-3).join(' ')}`);
    const errors = await page.evaluate('__cf.errors()');
    return {
      out, frames: total, fps, duration: total / fps, width: Math.round(doc.width * scale), height: Math.round(doc.height * scale),
      audioClips: audio.count, seconds: (Date.now() - started) / 1000, errors,
    };
  } catch (e) {
    if (enc && enc.exitCode == null) enc.kill('SIGKILL');
    await fsp.rm(out, { force: true }).catch(() => {});
    throw e;
  } finally {
    if (browser) await browser.close();
    await preview.close();
  }
}

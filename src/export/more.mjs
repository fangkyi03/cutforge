// 其它导出：GIF、透明视频、声音（混音与分轨）、字幕、静帧、幻灯片 PDF、FCPXML。
// 统一入口 exportAs({ root, kind, ... }) → { files: [相对工程目录的路径], notes }
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { parseFilm, clipLength, r3 } from '../film/doc.mjs';
import { parseVtt, toSrt } from '../film/vtt.mjs';
import { findTool, probe, run } from '../render/probe.mjs';
import { renderFilm, audioPlan } from '../render/render.mjs';
import { renderPage, placement } from './jianying.mjs';

export const KINDS = {
  gif: 'GIF 动图', webm: '透明视频 WebM', mov: '透明视频 MOV（ProRes 4444）', audio: '声音（混音 WAV + MP3）', stems: '声音分轨（每条轨一个 WAV）',
  subtitles: '字幕（SRT + VTT）', still: '静帧 PNG（播放头所在帧）', slides: '幻灯片 PDF（每个镜头一页）', fcpxml: 'Final Cut／DaVinci 时间线（FCPXML）',
};

const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

async function ff(args) {
  const ffmpeg = findTool('ffmpeg');
  if (!ffmpeg) throw new Error('找不到 ffmpeg');
  const r = await run(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { timeout: 600000 });
  if (!r.ok) throw new Error(`ffmpeg 失败：${r.stderr.trim().split('\n').slice(-2).join(' ')}`);
}

// 不开浏览器也能知道每个片段多长（声音导出、字幕导出用）
async function lengths(doc, filmDir) {
  const clips = {};
  let duration = 0;
  for (const c of doc.clips) {
    const p = c.kind === 'video' || c.kind === 'audio' ? await probe(path.resolve(filmDir, c.file)) : null;
    const len = clipLength(c, p?.duration ?? null) ?? 0;
    clips[c.key] = { length: len, hasAudio: p?.hasAudio };
    duration = Math.max(duration, c.at + len);
  }
  return { clips, duration: r3(duration) };
}

async function mixAudio({ doc, filmDir, info, out, only = null, loudness = null }) {
  const sub = only != null ? { ...doc, clips: doc.clips.filter((c) => c.track === only) } : doc;
  const plan = await audioPlan(sub, info, filmDir);
  if (!plan.count) return false;
  const ins = Array.from({ length: plan.count }, (_, i) => `[a${i + 1}]`).join('');
  const graph = [...plan.chains, `${ins}amix=inputs=${plan.count}:normalize=0:dropout_transition=0,aresample=async=1:first_pts=0${loudness ? `,loudnorm=I=${loudness}:TP=-1.5:LRA=11,aresample=48000` : ''},apad[aout]`];
  // audioPlan 的输入从 1 开始编号（0 号留给画面），这里补一个静音输入占位
  await ff(['-f', 'lavfi', '-t', '0.1', '-i', 'anullsrc=r=48000:cl=stereo', ...plan.inputs, '-filter_complex', graph.join(';'), '-map', '[aout]', '-t', String(info.duration), ...(out.endsWith('.mp3') ? ['-c:a', 'libmp3lame', '-q:a', '2'] : ['-c:a', 'pcm_s16le']), out]);
  return true;
}

// 字幕：字幕轨（影片时间）+ 每个能听到的声音／视频片段旁边的 .vtt（文件时间，按 at、入点、速度换算）
async function collectCues(doc, filmDir, info) {
  const cues = [];
  for (const tr of doc.tracks) {
    if (!tr.caption || tr.hidden) continue;
    try {
      cues.push(...parseVtt(await fsp.readFile(path.resolve(filmDir, tr.caption.file), 'utf8')));
    } catch { /* 读不到就跳过 */ }
  }
  for (const c of doc.clips) {
    if ((c.kind !== 'audio' && c.kind !== 'video') || c.disabled || doc.tracks[c.track].hidden || doc.tracks[c.track].muted || c.volume <= 0) continue;
    const vtt = path.resolve(filmDir, c.file.replace(/\.[^./]+$/, '.vtt'));
    let list;
    try {
      list = parseVtt(await fsp.readFile(vtt, 'utf8'));
    } catch {
      continue;
    }
    const len = info.clips[c.key]?.length || 0;
    for (const q of list) {
      const s = c.at + (q.start - c.in) / c.speed;
      const e = c.at + (q.end - c.in) / c.speed;
      if (e <= c.at || s >= c.at + len) continue;
      cues.push({ start: r3(Math.max(c.at, s)), end: r3(Math.min(c.at + len, e)), text: q.text });
    }
  }
  return cues.sort((a, b) => a.start - b.start);
}

const vttTime = (t) => {
  const ms = Math.round(t * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`;
};

// FCPXML 1.9：视频、图片、声音保持分轨；页面渲染成透明 MOV 再放进去
async function writeFcpxml({ root, doc, filmDir, info, dir, fps, signal, onProgress }) {
  const W = doc.width;
  const H = doc.height;
  const fd = (s) => `${Math.round(s * fps)}/${fps}s`;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const media = path.join(dir, 'media');
  await fsp.mkdir(media, { recursive: true });
  const assets = [];
  const assetOf = new Map();
  const addAsset = async (file, { video, audio, dur }) => {
    if (assetOf.has(file)) return assetOf.get(file);
    const id = `r${assets.length + 2}`;
    assets.push(`    <asset id="${id}" name="${esc(path.basename(file))}" start="0s" duration="${fd(dur)}" hasVideo="${video ? 1 : 0}" hasAudio="${audio ? 1 : 0}" format="r1"${audio ? ' audioSources="1" audioChannels="2" audioRate="48000"' : ''}>\n      <media-rep kind="original-media" src="${esc(`file://${encodeURI(file)}`)}"/>\n    </asset>`);
    assetOf.set(file, id);
    return id;
  };
  // FCPXML 里 lane 越大越靠上；film.html 里写在前面的轨道在上层
  const lanes = [];
  const notes = [];
  const pages = doc.clips.filter((c) => c.kind === 'page' && !c.disabled).length;
  let n = 0;
  for (const c of doc.clips) {
    const tr = doc.tracks[c.track];
    if (c.disabled || tr.hidden || tr.caption) continue;
    const len = info.clips[c.key]?.length || 0;
    if (!len) continue;
    let file = path.resolve(filmDir, c.file);
    let start = c.in;
    let speed = c.kind === 'video' || c.kind === 'audio' ? c.speed : 1;
    let clipForPlace = c;
    let nat;
    if (c.kind === 'page') {
      onProgress({ text: `渲染页面 ${c.uid}（${++n}/${pages}）` });
      file = path.join(media, `${c.uid}.mov`);
      await renderPage({ root, doc, filmDir, c, len, out: file, fps, signal });
      start = 0;
      speed = 1;
      nat = { width: W, height: H };
      clipForPlace = { ...c, box: { left: null, top: null, width: null, height: null, rotate: null }, look: '', cls: '' };
    } else {
      const p = await probe(file);
      nat = { width: p?.width || W, height: p?.height || H };
      const dest = path.join(media, path.basename(file));
      await fsp.copyFile(file, dest).catch(() => {});
      file = dest;
    }
    const p = c.kind === 'image' ? null : await probe(file);
    const id = await addAsset(file, { video: c.kind !== 'audio', audio: !!p?.hasAudio && c.kind !== 'page', dur: c.kind === 'image' ? 3600 : p?.duration || len });
    const lane = doc.tracks.length - c.track;
    const vol = c.kind === 'video' || c.kind === 'audio' ? (tr.muted ? 0 : c.volume) : 1;
    const db = vol > 0 ? (20 * Math.log10(vol)).toFixed(1) : '-96';
    let inner = '';
    if (c.kind !== 'audio') {
      const { clip } = placement(clipForPlace, nat, W, H);
      // FCPXML 的位置单位是“画面高度的百分比”，原点在中心，y 向上
      const px = ((clip.transform.x * W) / 2 / H) * 100;
      const py = ((clip.transform.y * H) / 2 / H) * 100;
      inner += `\n          <adjust-transform position="${px.toFixed(3)} ${py.toFixed(3)}" scale="${clip.scale.x.toFixed(5)} ${clip.scale.y.toFixed(5)}" rotation="${(-clip.rotation).toFixed(2)}"/>`;
      if (clip.alpha < 1) inner += `\n          <adjust-blend amount="${clip.alpha}"/>`;
    }
    if (vol !== 1) inner += `\n          <adjust-volume amount="${db}dB"/>`;
    if (speed !== 1) inner += `\n          <timeMap><timept time="0s" value="0s" interp="linear"/><timept time="${fd(len)}" value="${fd(len * speed)}" interp="linear"/></timeMap>`;
    if (c.fade[0] || c.fade[1]) notes.push(`${c.uid}：淡入淡出没有写进 FCPXML，需要在剪辑软件里重新加`);
    const tag = c.kind === 'audio' ? 'asset-clip' : 'asset-clip';
    lanes.push({ at: c.at, xml: `        <${tag} ref="${id}" lane="${lane}" name="${esc(c.uid)}" offset="${fd(c.at)}" start="${fd(start)}" duration="${fd(len)}" format="r1"${c.kind === 'audio' ? ' audioRole="dialogue"' : ''}>${inner}\n        </${tag}>` });
  }
  const total = info.duration;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r1" name="FFVideoFormat${H}p${fps}" frameDuration="1/${fps}s" width="${W}" height="${H}"/>
${assets.join('\n')}
  </resources>
  <library>
    <event name="CutForge">
      <project name="${esc(path.basename(root))}">
        <sequence format="r1" duration="${fd(total)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
            <gap name="间隔" offset="0s" start="0s" duration="${fd(total)}">
${lanes.sort((a, b) => a.at - b.at).map((l) => l.xml).join('\n')}
            </gap>
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
  const out = path.join(dir, `${path.basename(root)}.fcpxml`);
  await fsp.writeFile(out, xml);
  return { out, notes };
}

export async function exportAs({ root, film = 'film.html', kind, t = 0, fps, width, loudness = null, signal, onProgress = () => {} }) {
  if (!KINDS[kind]) throw new Error(`不认识的导出类型 ${kind}`);
  root = path.resolve(root);
  const filmFile = path.join(root, film);
  const filmDir = path.dirname(filmFile);
  const doc = parseFilm(await fsp.readFile(filmFile, 'utf8'));
  const base = `${path.basename(root)}-${stamp()}`;
  const dir = path.join(root, 'exports');
  await fsp.mkdir(dir, { recursive: true });
  const rel = (f) => path.relative(root, f).split(path.sep).join('/');
  const tmp = path.join(root, '.cutforge', `tmp-${crypto.randomBytes(4).toString('hex')}`);
  const progress = (p) => onProgress(p.frame ? { ...p, text: `渲染 ${Math.round((p.frame / p.total) * 100)}%` } : p);
  const notes = [];

  try {
    if (kind === 'gif') {
      const f = fps || 15;
      const w = width || Math.min(960, doc.width);
      const mp4 = `${tmp}.mp4`;
      await fsp.mkdir(path.dirname(mp4), { recursive: true });
      await renderFilm({ root, film, out: mp4, fps: f, scale: w / doc.width, signal, onProgress: progress });
      const out = path.join(dir, `${base}.gif`);
      onProgress({ text: '生成调色板' });
      await ff(['-i', mp4, '-filter_complex', `[0:v]fps=${f},scale=${w}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a`, '-loop', '0', out]);
      return { files: [rel(out)], notes };
    }
    if (kind === 'webm' || kind === 'mov') {
      const out = path.join(dir, `${base}-alpha.${kind}`);
      await renderFilm({ root, film, out, fps: fps || 30, alpha: true, signal, onProgress: progress });
      notes.push('透明视频没有声音；需要声音请另外导出“声音”');
      return { files: [rel(out)], notes };
    }
    const info = await lengths(doc, filmDir);
    if (kind === 'audio') {
      const wav = path.join(dir, `${base}.wav`);
      const mp3 = path.join(dir, `${base}.mp3`);
      onProgress({ text: '混音' });
      if (!(await mixAudio({ doc, filmDir, info, out: wav, loudness }))) throw new Error('影片里没有能听到的声音');
      await ff(['-i', wav, '-c:a', 'libmp3lame', '-q:a', '2', mp3]);
      return { files: [rel(wav), rel(mp3)], notes };
    }
    if (kind === 'stems') {
      const sub = path.join(dir, `${base}-stems`);
      await fsp.mkdir(sub, { recursive: true });
      const files = [];
      for (const tr of doc.tracks) {
        onProgress({ text: `分轨 ${tr.index + 1}/${doc.tracks.length}` });
        const out = path.join(sub, `track${tr.index + 1}.wav`);
        if (await mixAudio({ doc, filmDir, info, out, only: tr.index })) files.push(rel(out));
      }
      if (!files.length) throw new Error('影片里没有能听到的声音');
      notes.push('每个分轨都从影片开头算起、长度与整片相同，放进别的软件时从 0 对齐即可');
      return { files, notes };
    }
    if (kind === 'subtitles') {
      const cues = await collectCues(doc, filmDir, info);
      if (!cues.length) throw new Error('没有字幕：加一条字幕轨，或在声音文件旁边放同名 .vtt');
      const srt = path.join(dir, `${base}.srt`);
      const vtt = path.join(dir, `${base}.vtt`);
      await fsp.writeFile(srt, toSrt(cues));
      await fsp.writeFile(vtt, `WEBVTT\n\n${cues.map((c) => `${vttTime(c.start)} --> ${vttTime(c.end)}\n${c.text}\n`).join('\n')}`);
      return { files: [rel(srt), rel(vtt)], notes };
    }
    if (kind === 'still' || kind === 'slides') {
      const times = kind === 'still' ? [Math.min(t, Math.max(0, info.duration - 0.01))] : shotTimes(doc, info);
      const outs = [];
      for (let i = 0; i < times.length; i++) {
        onProgress({ text: `截取画面 ${i + 1}/${times.length}` });
        const mp4 = `${tmp}-${i}.mp4`;
        await fsp.mkdir(path.dirname(mp4), { recursive: true });
        await renderFilm({ root, film, out: mp4, fps: 30, range: [times[i], times[i] + 1 / 30], signal });
        const png = kind === 'still' ? path.join(dir, `${base}-${times[i].toFixed(2)}s.png`) : `${tmp}-${i}.png`;
        await ff(['-i', mp4, '-frames:v', '1', png]);
        outs.push(png);
      }
      if (kind === 'still') return { files: [rel(outs[0])], notes };
      const pdf = path.join(dir, `${base}-slides.pdf`);
      await imagesToPdf(outs, pdf, doc.width, doc.height);
      return { files: [rel(pdf)], notes: [`每页取每个镜头中间的一帧，共 ${outs.length} 页`] };
    }
    if (kind === 'fcpxml') {
      const sub = path.join(dir, `${base}-fcpxml`);
      const r = await writeFcpxml({ root, doc, filmDir, info, dir: sub, fps: fps || 30, signal, onProgress });
      return { files: [rel(r.out)], notes: [...r.notes, '素材已拷进同目录的 media/；在 Final Cut 或 DaVinci Resolve 里“导入 XML／FCPXML”'] };
    }
  } finally {
    const d = path.join(root, '.cutforge');
    for (const f of await fsp.readdir(d).catch(() => [])) if (f.startsWith(path.basename(tmp))) await fsp.rm(path.join(d, f), { force: true });
  }
  return { files: [], notes };
}

// 幻灯片：按“画面换了一批片段”切镜头，每个镜头取中间
function shotTimes(doc, info) {
  const edges = new Set([0]);
  for (const c of doc.clips) {
    if (c.kind === 'audio' || c.disabled || doc.tracks[c.track].hidden) continue;
    edges.add(r3(c.at));
    edges.add(r3(c.at + (info.clips[c.key]?.length || 0)));
  }
  const list = [...edges].filter((e) => e < info.duration).sort((a, b) => a - b);
  list.push(info.duration);
  const out = [];
  for (let i = 0; i < list.length - 1; i++) if (list[i + 1] - list[i] > 0.3) out.push(r3((list[i] + list[i + 1]) / 2));
  return out.length ? out : [info.duration / 2];
}

// 极简 PDF：每页一张 JPEG，页面尺寸按画面比例（宽 960pt）
async function imagesToPdf(pngs, out, W, H) {
  const pw = 960;
  const ph = Math.round((pw * H) / W);
  const jpgs = [];
  for (const p of pngs) {
    const j = p.replace(/\.png$/, '.jpg');
    await ff(['-i', p, '-q:v', '3', j]);
    jpgs.push(await fsp.readFile(j));
  }
  const objs = [];
  const add = (body) => {
    objs.push(body);
    return objs.length;
  };
  const pagesId = 2;
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(null);
  const kids = [];
  for (const [i, jpg] of jpgs.entries()) {
    const img = add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`), jpg, Buffer.from('\nendstream')]));
    const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im${i} Do Q`;
    const cs = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im${i} ${img} 0 R >> >> /Contents ${cs} 0 R >>`));
  }
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const parts = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  const offsets = [];
  let pos = parts[0].length;
  objs.forEach((o, i) => {
    const head = Buffer.from(`${i + 1} 0 obj\n`);
    const body = Buffer.isBuffer(o) ? o : Buffer.from(o);
    const tail = Buffer.from('\nendobj\n');
    offsets.push(pos);
    parts.push(head, body, tail);
    pos += head.length + body.length + tail.length;
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
  parts.push(Buffer.from(xref));
  await fsp.writeFile(out, Buffer.concat(parts));
}

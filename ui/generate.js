// 生成：配音、图片、音乐（放进时间线），以及语音转字幕（变成一条字幕轨）。
import { parseFilm, insertClip, addTrack, addCaptionTrack, r3 } from '/shared/doc.mjs';
import { parseVtt } from '/shared/vtt.mjs';
import { S, h, add, api, toast, editFilm, lengthOf, selectClip, log, enc, on } from './store.js';
import { icon } from './icons.js';

let status = null;
export async function downloadBetterModel() {
  toast('开始下载更准的中文识别模型（约 470MB）');
  await new Promise((resolve, reject) => {
    modelWait = { resolve, reject };
    api('/api/gen/model', { method: 'POST', json: { name: 'small' } }).catch(reject);
  });
  toast('模型已下载，之后的识别会用它', 'good');
  await loadGenStatus();
}

export async function loadGenStatus() {
  status = await api('/api/gen/status').catch(() => null);
  return status;
}

// 放到播放头处：声音放最下面能放下的声音轨，图片放最上面
function place(kind, file, len) {
  const at = r3(S.t);
  let uid = null;
  editFilm((text) => {
    let doc = parseFilm(text);
    const free = (i) => doc.tracks[i] && !doc.tracks[i].locked && !doc.tracks[i].caption && !doc.tracks[i].clips.some((c) => at < c.at + lengthOf(c) - 0.001 && at + len > c.at + 0.001);
    let ti = kind === 'audio' ? [...doc.tracks.keys()].reverse().find((i) => free(i) && doc.tracks[i].clips.every((c) => c.kind === 'audio')) : undefined;
    if (ti == null) {
      text = addTrack(text, kind === 'audio' ? 'bottom' : 'top');
      doc = parseFilm(text);
      ti = kind === 'audio' ? doc.tracks.length - 1 : 0;
    }
    const next = insertClip(text, ti, { kind, file, at, ...(kind === 'image' ? { out: len } : {}) });
    uid = parseFilm(next).tracks[ti].clips.find((c) => c.file === file)?.uid ?? null;
    return next;
  });
  if (uid) selectClip(uid);
}

async function busy(btn, label, fn) {
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '';
  add(btn, h('span.spin'), label);
  try {
    await fn();
  } catch (e) {
    toast(e.message, 'bad');
    log(`生成失败：${e.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = old;
  }
}

const field = (label, el) => h('label.gen-field', {}, h('span', {}, label), el);

export function drawGenerate(box) {
  box.innerHTML = '';
  if (!status) {
    box.append(h('p.hint', {}, '正在读取…'));
    loadGenStatus().then(() => drawGenerate(box));
    return;
  }
  const k = status.keys;
  // ---- 配音
  const vText = h('textarea', { rows: 3, placeholder: '要说的话，例如：大家好，欢迎来到我们的新品发布会。' });
  const vProv = h('select', {}, h('option', { value: 'system' }, '系统语音（免费）'), h('option', { value: 'openai', disabled: !k.openai }, `OpenAI${k.openai ? '' : '（未配密钥）'}`), h('option', { value: 'elevenlabs', disabled: !k.elevenlabs }, `ElevenLabs${k.elevenlabs ? '' : '（未配密钥）'}`));
  const vVoice = h('select');
  const fillVoices = () => {
    vVoice.innerHTML = '';
    if (vProv.value === 'system') {
      vVoice.append(h('option', { value: '' }, '自动（按文字的语言）'));
      for (const v of status.systemVoices) vVoice.append(h('option', { value: v.id }, `${v.id} · ${v.lang}`));
    } else if (vProv.value === 'openai') for (const v of status.voices.openai) vVoice.append(h('option', { value: v }, v));
    else for (const [id, name] of status.voices.elevenlabs) vVoice.append(h('option', { value: id }, name));
  };
  vProv.onchange = fillVoices;
  fillVoices();
  const vBtn = h('button.primary', { onclick: () => busy(vBtn, '生成中…', async () => {
    const r = await api('/api/gen/voice', { method: 'POST', json: { text: vText.value, provider: vProv.value, voice: vVoice.value || undefined } });
    place('audio', r.file, r.duration || 3);
    log(`已生成配音 ${r.file}（${(r.duration || 0).toFixed(2)} 秒，字幕${r.aligned ? '已按语音对齐' : '按字数估算'}）`);
    toast('配音已放到播放头处；它的字幕在“语音转字幕”里可以加到画面上', 'good');
  }) }, icon('audio', 14), '生成配音');
  // ---- 图片
  const iText = h('textarea', { rows: 2, placeholder: '画面描述，例如：清晨的城市天际线，柔和的逆光，电影感' });
  const iProv = h('select', {}, h('option', { value: 'openai', disabled: !k.openai }, `OpenAI${k.openai ? '' : '（未配密钥）'}`), h('option', { value: 'fal', disabled: !k.fal }, `fal${k.fal ? '' : '（未配密钥）'}`));
  if (!k.openai && k.fal) iProv.value = 'fal';
  const iBtn = h('button.primary', { disabled: !k.openai && !k.fal, onclick: () => busy(iBtn, '生成中…', async () => {
    const r = await api('/api/gen/image', { method: 'POST', json: { prompt: iText.value, provider: iProv.value } });
    place('image', r.file, 3);
    log(`已生成图片 ${r.file}`);
  }) }, icon('image', 14), '生成图片');
  // ---- 音乐
  const mText = h('textarea', { rows: 2, placeholder: '音乐描述，例如：轻快的电子乐，适合产品介绍，结尾渐弱' });
  const mSec = h('input', { type: 'number', value: '30', min: '5', max: '180', step: '5' });
  const mProv = h('select', {}, h('option', { value: 'elevenlabs', disabled: !k.elevenlabs }, `ElevenLabs${k.elevenlabs ? '' : '（未配密钥）'}`), h('option', { value: 'fal', disabled: !k.fal }, `fal${k.fal ? '' : '（未配密钥）'}`));
  if (!k.elevenlabs && k.fal) mProv.value = 'fal';
  const mBtn = h('button.primary', { disabled: !k.elevenlabs && !k.fal, onclick: () => busy(mBtn, '生成中…', async () => {
    const r = await api('/api/gen/music', { method: 'POST', json: { prompt: mText.value, provider: mProv.value, seconds: Number(mSec.value) } });
    place('audio', r.file, Number(mSec.value));
    log(`已生成音乐 ${r.file}`);
  }) }, icon('audio', 14), '生成音乐');
  const anyKey = k.openai || k.elevenlabs || k.fal;
  add(box,
    h('div.gen-block', {}, h('h4', {}, '配音'), vText, field('服务', vProv), field('声音', vVoice), vBtn),
    h('div.gen-block', {}, h('h4', {}, '图片'), iText, field('服务', iProv), iBtn),
    h('div.gen-block', {}, h('h4', {}, '音乐'), mText, field('秒数', mSec), field('服务', mProv), mBtn),
    anyKey ? null : h('p.hint', {}, '图片和音乐需要你自己的服务密钥：右上角“环境 → 服务密钥”。系统语音配音不需要密钥。'));
}

// ---------------------------------------------------------------- 语音转字幕

let modelWait = null;
on('model', (ev) => {
  if (ev.done || ev.error) {
    modelWait?.[ev.done ? 'resolve' : 'reject'](new Error(ev.error));
    modelWait = null;
  }
});

export async function transcribeClip(c, { fresh = false } = {}) {
  await loadGenStatus();
  if (!status.speech.whisper) return toast('没有安装 whisper.cpp：macOS 在终端运行 brew install whisper-cpp', 'bad');
  if (!status.speech.model) {
    toast('第一次使用：下载语音识别模型（约 150MB）…');
    log('开始下载语音识别模型');
    await new Promise((resolve, reject) => {
      modelWait = { resolve, reject };
      api('/api/gen/model', { method: 'POST', json: {} }).catch(reject);
    }).catch((e) => { throw new Error(`模型下载失败：${e.message}`); });
    log('模型下载完成');
  }
  toast(`正在识别 ${c.uid} 的语音…`);
  let sidecar;
  try {
    const r = await api('/api/gen/transcribe', { method: 'POST', json: { file: c.file, lang: 'zh', reuse: !fresh } });
    sidecar = r.file;
    if (r.reused) log(`${c.file} 旁边已有字幕文件 ${sidecar}，直接使用（要重新识别，右键选“重新识别语音”）`);
  } catch (e) {
    return toast(`识别失败：${e.message}`, 'bad');
  }
  // 文件时间 → 影片时间，写成字幕轨用的 VTT
  const cues = parseVtt(await api(`/api/file?path=${enc(sidecar)}`));
  const len = lengthOf(c);
  const ts = (x) => {
    const ms = Math.round(Math.max(0, x) * 1000);
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`;
  };
  const lines = [];
  for (const q of cues) {
    const s = c.at + (q.start - c.in) / c.speed;
    const e = c.at + (q.end - c.in) / c.speed;
    if (e <= c.at || s >= c.at + len) continue;
    lines.push(`${ts(Math.max(c.at, s))} --> ${ts(Math.min(c.at + len, e))}\n${q.text}\n`);
  }
  if (!lines.length) return toast('没有识别出说话内容');
  const file = `assets/captions/${c.uid}.vtt`;
  await api(`/api/file?path=${enc(file)}`, { method: 'PUT', body: `WEBVTT\n\n${lines.join('\n')}` });
  editFilm((text) => addCaptionTrack(text, file, `${c.uid} 的字幕`));
  log(`已识别 ${lines.length} 句，字幕轨用 ${file}（可以在代码编辑器里改字）；原始识别结果在 ${sidecar}`);
  toast(`已加上 ${lines.length} 句字幕`, 'good');
}

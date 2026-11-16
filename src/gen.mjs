// 生成：配音、图片、音乐，以及语音转字幕。
// 免费、本机就能用的：系统语音（macOS say／Windows 语音合成）、whisper.cpp 转字幕。
// 需要自带密钥的：OpenAI（配音、图片）、ElevenLabs（配音、音乐）、fal（图片、音乐）。
// 密钥只存在本机 ~/.cutforge/keys.json（权限 600），只在调用对应服务时发给它。
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findTool, probe } from './render/probe.mjs';

const HOME_DIR = process.env.CUTFORGE_HOME || path.join(os.homedir(), '.cutforge');
const KEYS = path.join(HOME_DIR, 'keys.json');
const MODELS = path.join(HOME_DIR, 'models');
export const SERVICES = {
  openai: { name: 'OpenAI', what: '配音、图片', url: 'https://platform.openai.com/api-keys' },
  elevenlabs: { name: 'ElevenLabs', what: '配音、音乐', url: 'https://elevenlabs.io/app/settings/api-keys' },
  fal: { name: 'fal', what: '图片、音乐', url: 'https://fal.ai/dashboard/keys' },
};

export async function readKeys() {
  try {
    return JSON.parse(await fsp.readFile(KEYS, 'utf8'));
  } catch {
    return {};
  }
}

export async function writeKeys(keys) {
  await fsp.mkdir(HOME_DIR, { recursive: true });
  const clean = Object.fromEntries(Object.entries(keys).filter(([k, v]) => SERVICES[k] && typeof v === 'string' && v.trim()).map(([k, v]) => [k, v.trim()]));
  await fsp.writeFile(KEYS, JSON.stringify(clean), { mode: 0o600 });
  await fsp.chmod(KEYS, 0o600).catch(() => {});
}

// 给界面看的：哪些服务配了密钥（不返回密钥本身）
export async function keyStatus() {
  const k = await readKeys();
  return Object.fromEntries(Object.keys(SERVICES).map((id) => [id, !!k[id]]));
}

const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, timeout: 600000, ...opts }, (e, stdout, stderr) => (e ? reject(new Error(String(stderr || e.message).trim().split('\n').slice(-3).join(' '))) : resolve(String(stdout))));
});

const slug = (text) => {
  const s = text.replace(/[\s\\/:*?"<>|，。！？、；：,.!?;:'"“”‘’()（）[\]【】]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
  return `${s || 'gen'}-${crypto.randomBytes(2).toString('hex')}`;
};

async function postJson(url, headers, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${new URL(url).host} 返回 ${res.status}：${(await res.text()).slice(0, 300)}`);
  return res;
}

async function need(service) {
  const k = (await readKeys())[service];
  if (!k) throw new Error(`没有 ${SERVICES[service].name} 的密钥：在“环境 → 服务密钥”里填上（${SERVICES[service].url}）`);
  return k;
}

async function toWav(src, out) {
  const ffmpeg = findTool('ffmpeg');
  if (!ffmpeg) throw new Error('找不到 ffmpeg');
  await run(ffmpeg, ['-y', '-loglevel', 'error', '-i', src, '-ar', '48000', '-ac', '2', out]);
}

// ---------------------------------------------------------------- 配音

export async function systemVoices() {
  if (process.platform === 'darwin') {
    const out = await run('say', ['-v', '?']).catch(() => '');
    return out.split('\n').map((l) => /^(.+?)\s{2,}(\w\w_\w\w)\s+#/.exec(l)).filter(Boolean).map((m) => ({ id: m[1].trim(), lang: m[2] })).filter((v) => /^(zh|en)/.test(v.lang));
  }
  if (process.platform === 'win32') {
    const out = await run('powershell', ['-NoProfile', '-Command', 'Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | % { $_.VoiceInfo.Name + "|" + $_.VoiceInfo.Culture }']).catch(() => '');
    return out.split('\n').map((l) => l.trim().split('|')).filter((p) => p[0]).map(([id, lang]) => ({ id, lang: (lang || '').replace('-', '_') }));
  }
  return [];
}

export const VOICES = {
  openai: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'],
  elevenlabs: [['21m00Tcm4TlvDq8ikWAM', 'Rachel'], ['pNInz6obpgDQGcFmaJgB', 'Adam'], ['EXAVITQu4vr4xnSDxMaL', 'Sarah']],
};

// → { file（工程里的相对路径）, duration }
export async function makeVoice({ root, text, provider = 'system', voice, speed = 1 }) {
  if (!String(text || '').trim()) throw new Error('先写要配音的文字');
  const dir = path.join(root, 'assets', 'voice');
  await fsp.mkdir(dir, { recursive: true });
  const name = slug(text);
  const out = path.join(dir, `${name}.wav`);
  const tmp = path.join(os.tmpdir(), `cutforge-${name}`);
  if (provider === 'system') {
    if (process.platform === 'darwin') {
      const v = voice || (/[一-鿿]/.test(text) ? (await systemVoices()).find((x) => x.lang === 'zh_CN')?.id : undefined);
      await run('say', [...(v ? ['-v', v] : []), '-r', String(Math.round(180 * speed)), '-o', `${tmp}.aiff`, text]);
      await toWav(`${tmp}.aiff`, out);
    } else if (process.platform === 'win32') {
      const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ${voice ? `$s.SelectVoice(${JSON.stringify(voice)});` : ''} $s.Rate = ${Math.round((speed - 1) * 10)}; $s.SetOutputToWaveFile(${JSON.stringify(`${tmp}.wav`)}); $s.Speak([Console]::In.ReadToEnd()); $s.Dispose()`;
      await new Promise((resolve, reject) => {
        const p = execFile('powershell', ['-NoProfile', '-Command', ps], (e, _o, se) => (e ? reject(new Error(String(se || e.message))) : resolve()));
        p.stdin.end(text);
      });
      await toWav(`${tmp}.wav`, out);
    } else throw new Error('这个系统没有内置语音合成：请用 OpenAI 或 ElevenLabs');
  } else if (provider === 'openai') {
    const key = await need('openai');
    const res = await postJson('https://api.openai.com/v1/audio/speech', { authorization: `Bearer ${key}` }, { model: 'gpt-4o-mini-tts', voice: voice || 'alloy', input: text, response_format: 'wav', speed });
    await fsp.writeFile(`${tmp}.wav`, Buffer.from(await res.arrayBuffer()));
    await toWav(`${tmp}.wav`, out);
  } else if (provider === 'elevenlabs') {
    const key = await need('elevenlabs');
    const res = await postJson(`https://api.elevenlabs.io/v1/text-to-speech/${voice || VOICES.elevenlabs[0][0]}?output_format=mp3_44100_128`, { 'xi-api-key': key }, { text, model_id: 'eleven_multilingual_v2' });
    await fsp.writeFile(`${tmp}.mp3`, Buffer.from(await res.arrayBuffer()));
    await toWav(`${tmp}.mp3`, out);
  } else throw new Error(`不认识的配音服务 ${provider}`);
  for (const ext of ['aiff', 'wav', 'mp3']) await fsp.rm(`${tmp}.${ext}`, { force: true });
  const p = await probe(out);
  // 配音旁边放一份 .vtt：有 whisper 模型就按真实语音对齐，否则按字数估算
  const vtt = out.replace(/\.wav$/, '.vtt');
  const zh = /[\u4e00-\u9fff]/.test(text);
  let aligned = false;
  try {
    await transcribeTo(out, vtt, { lang: zh ? 'zh' : 'auto' });
    // 时间用识别结果，文字用原文：识别出的句数和原文句数一样就一一对应，否则在说话的时间段里按字数分
    const { parseVtt } = await import('./film/vtt.mjs');
    const heard = parseVtt(await fsp.readFile(vtt, 'utf8'));
    const said = splitSentences(text);
    if (heard.length) {
      const cues = heard.length === said.length
        ? heard.map((c, i) => ({ start: c.start, end: c.end, text: said[i] }))
        : spread(said, heard[0].start, heard[heard.length - 1].end);
      await fsp.writeFile(vtt, toVtt(cues));
      aligned = true;
    }
  } catch { /* 没有 whisper 或模型：下面按字数估算 */ }
  if (!aligned) await fsp.writeFile(vtt, toVtt(spread(splitSentences(text), 0, p?.duration || 1)));
  return { file: path.relative(root, out).split(path.sep).join('/'), duration: p?.duration ?? null, aligned };
}

const splitSentences = (text) => text.split(/(?<=[。！？!?；;\n])/).map((x) => x.trim().replace(/[，,；;]$/, '')).filter(Boolean);

function spread(parts, from, to) {
  const total = parts.reduce((n, x) => n + x.length, 0) || 1;
  let t = from;
  return parts.map((x) => {
    const d = ((to - from) * x.length) / total;
    const c = { start: t, end: t + d, text: x };
    t += d;
    return c;
  });
}

function toVtt(cues) {
  const ts = (x) => {
    const ms = Math.round(x * 1000);
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`;
  };
  return `WEBVTT\n\n${cues.map((c) => `${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join('\n')}`;
}

// ---------------------------------------------------------------- 图片、音乐

export async function makeImage({ root, prompt, provider = 'openai', size = '1536x1024' }) {
  if (!String(prompt || '').trim()) throw new Error('先写要画什么');
  const dir = path.join(root, 'assets', 'images');
  await fsp.mkdir(dir, { recursive: true });
  const out = path.join(dir, `${slug(prompt)}.png`);
  if (provider === 'openai') {
    const key = await need('openai');
    const res = await postJson('https://api.openai.com/v1/images/generations', { authorization: `Bearer ${key}` }, { model: 'gpt-image-1', prompt, size, n: 1 });
    const j = await res.json();
    await fsp.writeFile(out, Buffer.from(j.data[0].b64_json, 'base64'));
  } else if (provider === 'fal') {
    const key = await need('fal');
    const res = await postJson('https://fal.run/fal-ai/flux/schnell', { authorization: `Key ${key}` }, { prompt, image_size: 'landscape_16_9', num_images: 1 });
    const j = await res.json();
    const img = await fetch(j.images[0].url);
    await fsp.writeFile(out, Buffer.from(await img.arrayBuffer()));
  } else throw new Error(`不认识的图片服务 ${provider}`);
  return { file: path.relative(root, out).split(path.sep).join('/') };
}

export async function makeMusic({ root, prompt, provider = 'elevenlabs', seconds = 30 }) {
  if (!String(prompt || '').trim()) throw new Error('先描述想要的音乐');
  const dir = path.join(root, 'assets', 'music');
  await fsp.mkdir(dir, { recursive: true });
  const out = path.join(dir, `${slug(prompt)}.wav`);
  const tmp = path.join(os.tmpdir(), `cutforge-music-${crypto.randomBytes(3).toString('hex')}`);
  if (provider === 'elevenlabs') {
    const key = await need('elevenlabs');
    const res = await postJson('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128', { 'xi-api-key': key }, { prompt, music_length_ms: Math.round(seconds * 1000) });
    await fsp.writeFile(`${tmp}.mp3`, Buffer.from(await res.arrayBuffer()));
  } else if (provider === 'fal') {
    const key = await need('fal');
    const res = await postJson('https://fal.run/fal-ai/stable-audio', { authorization: `Key ${key}` }, { prompt, seconds_total: Math.min(47, seconds) });
    const j = await res.json();
    const a = await fetch(j.audio_file.url);
    await fsp.writeFile(`${tmp}.mp3`, Buffer.from(await a.arrayBuffer()));
  } else throw new Error(`不认识的音乐服务 ${provider}`);
  await toWav(`${tmp}.mp3`, out);
  await fsp.rm(`${tmp}.mp3`, { force: true });
  return { file: path.relative(root, out).split(path.sep).join('/') };
}

// ---------------------------------------------------------------- 语音转字幕（whisper.cpp）

// 识别模型：base 小而快，small 中文准得多。下载时先试官方地址，连不上再试国内镜像。
export const MODEL_INFO = { base: { size: 147951465, label: '标准（约 150MB）' }, small: { size: 487601967, label: '更准的中文（约 470MB）' } };
const modelUrls = (name) => [`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${name}.bin`, `https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-${name}.bin`];
const MODEL_URL = modelUrls('base')[0];
const modelFile = (name) => path.join(MODELS, `ggml-${name}.bin`);
// 有 small 就用 small
export const modelPath = () => ['small', 'base'].map(modelFile).find((f) => fs.existsSync(f)) || modelFile('base');
export const whisperBin = () => findTool('whisper-cli') || findTool('whisper-cpp') || findTool('main');

export async function speechStatus() {
  return { whisper: whisperBin(), model: fs.existsSync(modelPath()) ? modelPath() : null, models: Object.fromEntries(Object.keys(MODEL_INFO).map((n) => [n, fs.existsSync(modelFile(n))])), info: MODEL_INFO, modelUrl: MODEL_URL };
}

// 用 curl 下载（会走系统代理；Mac 与 Windows 10 以上自带），没有 curl 再用 fetch
export async function downloadModel(onProgress = () => {}, name = 'base') {
  if (!MODEL_INFO[name]) throw new Error(`没有 ${name} 模型`);
  const size = MODEL_INFO[name].size;
  const target = modelFile(name);
  await fsp.mkdir(MODELS, { recursive: true });
  const tmp = `${target}.part`;
  const curl = findTool('curl');
  const errors = [];
  for (const url of modelUrls(name)) {
    try {
      if (curl) {
        const timer = setInterval(() => {
          try { onProgress({ got: fs.statSync(tmp).size, total: size }); } catch { /* 还没开始 */ }
        }, 500);
        try {
          await run(curl, ['-fL', '--connect-timeout', '15', '-sS', '-o', tmp, url], { timeout: 1800000 });
        } finally {
          clearInterval(timer);
        }
      } else {
        const res = await fetch(url, { signal: AbortSignal.timeout(1800000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const fh = await fsp.open(tmp, 'w');
        let got = 0;
        for await (const chunk of res.body) {
          await fh.write(chunk);
          got += chunk.length;
          onProgress({ got, total: size });
        }
        await fh.close();
      }
      if (fs.statSync(tmp).size !== size) throw new Error('下载的文件大小不对');
      await fsp.rename(tmp, target);
      return target;
    } catch (e) {
      errors.push(`${new URL(url).host}：${e.message}`);
      await fsp.rm(tmp, { force: true });
    }
  }
  throw new Error(`下载语音识别模型失败（${errors.join('；')}）`);
}

// 把声音转写成 WebVTT（写到 vttPath）
export async function transcribeTo(audioPath, vttPath, { lang = 'auto' } = {}) {
  const bin = whisperBin();
  if (!bin) throw new Error('没有安装 whisper.cpp：macOS 运行 brew install whisper-cpp');
  if (!fs.existsSync(modelPath())) throw new Error('还没有下载语音识别模型');
  const tmp = path.join(os.tmpdir(), `cutforge-stt-${crypto.randomBytes(3).toString('hex')}`);
  const ffmpeg = findTool('ffmpeg');
  await run(ffmpeg, ['-y', '-loglevel', 'error', '-i', audioPath, '-vn', '-ar', '16000', '-ac', '1', `${tmp}.wav`]);
  await run(bin, ['-m', modelPath(), '-l', lang, ...(lang === 'zh' ? ['--prompt', '以下是普通话的句子，使用简体中文。'] : []), '-ovtt', '-of', tmp, '-np', `${tmp}.wav`]);
  let vtt = await fsp.readFile(`${tmp}.vtt`, 'utf8');
  vtt = vtt.replace(/^\s*\[[^\]]*\]\s*$/gm, '').replace(/\n{3,}/g, '\n\n');
  await fsp.writeFile(vttPath, vtt);
  await fsp.rm(`${tmp}.wav`, { force: true });
  await fsp.rm(`${tmp}.vtt`, { force: true });
  return vttPath;
}

// 工程里某个声音／视频文件 → 旁边的同名 .vtt
export async function transcribeFile(root, rel, opts = {}) {
  const abs = path.resolve(root, rel);
  const vtt = abs.replace(/\.[^./]+$/, '.vtt');
  if (opts.reuse && fs.existsSync(vtt)) return { file: path.relative(root, vtt).split(path.sep).join('/'), reused: true };
  await transcribeTo(abs, vtt, opts);
  return { file: path.relative(root, vtt).split(path.sep).join('/') };
}

// 导出剪映草稿：把时间线变成剪映专业版能打开、能继续剪的草稿文件夹。
// 草稿格式参考 pyJianYingDraft（Apache-2.0）整理的剪映 5.9 明文格式；剪映 6 以后的版本会加密草稿，
// 能否读取这里生成的明文草稿取决于剪映版本，没有在真机上验证过。
//
// 对应关系：
//   视频、图片、声音片段 → 剪映的视频轨／音频轨片段（位置、缩放、旋转、不透明度、裁剪、变速、音量、淡入淡出）
//   页面片段             → 先渲染成透明背景的 ProRes 4444 .mov，再作为视频片段放进去
//   字幕轨               → 另存一份 .srt，在剪映里“导入字幕”
// 片段自己的 CSS（圆角、滤镜、关键帧动画）剪映里没有对应，会丢失。
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseFilm, clipLength, getLookProp, serializeTag } from '../film/doc.mjs';
import { parseVtt, toSrt } from '../film/vtt.mjs';
import { probe } from '../render/probe.mjs';
import { renderFilm } from '../render/render.mjs';

const US = 1e6;
const us = (s) => Math.round(s * US);
const uid = () => crypto.randomUUID().toUpperCase();
const hex = () => crypto.randomBytes(16).toString('hex');

// 剪映草稿文件夹的常见位置（找不到就只导出到工程里）
export function jianyingDraftRoots() {
  const home = os.homedir();
  const list = process.platform === 'darwin'
    ? [path.join(home, 'Movies', 'JianyingPro', 'User Data', 'Projects', 'com.lveditor.draft'), path.join(home, 'Movies', 'CapCut', 'User Data', 'Projects', 'com.lveditor.draft')]
    : process.platform === 'win32'
      ? [path.join(process.env.LOCALAPPDATA || '', 'JianyingPro', 'User Data', 'Projects', 'com.lveditor.draft'), path.join(process.env.LOCALAPPDATA || '', 'CapCut', 'User Data', 'Projects', 'com.lveditor.draft')]
      : [];
  return list.filter((p) => fs.existsSync(p));
}

function contentTemplate(width, height, fps, duration, name) {
  const mats = ['ai_translates', 'audio_balances', 'audio_effects', 'audio_fades', 'audio_track_indexes', 'audios', 'beats', 'canvases', 'chromas',
    'color_curves', 'digital_humans', 'drafts', 'effects', 'flowers', 'green_screens', 'handwrites', 'hsl', 'images', 'log_color_wheels', 'loudnesses',
    'manual_deformations', 'masks', 'material_animations', 'material_colors', 'multi_language_refs', 'placeholders', 'plugin_effects',
    'primary_color_wheels', 'realtime_denoises', 'shapes', 'smart_crops', 'smart_relights', 'sound_channel_mappings', 'speeds', 'stickers',
    'tail_leaders', 'text_templates', 'texts', 'time_marks', 'transitions', 'video_effects', 'video_trackings', 'videos', 'vocal_beautifys', 'vocal_separations'];
  const platform = { app_id: 3704, app_source: 'lv', app_version: '5.9.0', os: process.platform === 'win32' ? 'windows' : 'mac' };
  return {
    canvas_config: { height, ratio: 'original', width },
    color_space: 0,
    config: {
      adjust_max_index: 1, attachment_info: [], combination_max_index: 1, export_range: null, extract_audio_last_index: 1, lyrics_recognition_id: '',
      lyrics_sync: true, lyrics_taskinfo: [], maintrack_adsorb: false, material_save_mode: 0, multi_language_current: 'none', multi_language_list: [],
      multi_language_main: 'none', multi_language_mode: 'none', original_sound_last_index: 1, record_audio_last_index: 1, sticker_max_index: 1,
      subtitle_keywords_config: null, subtitle_recognition_id: '', subtitle_sync: true, subtitle_taskinfo: [], system_font_list: [], video_mute: false,
      zoom_info_params: null,
    },
    cover: null, create_time: 0, duration, extra_info: null, fps, free_render_index_mode_on: false, group_container: null, id: uid(),
    keyframe_graph_list: [], keyframes: { adjusts: [], audios: [], effects: [], filters: [], handwrites: [], stickers: [], texts: [], videos: [] },
    last_modified_platform: platform, platform,
    materials: Object.fromEntries(mats.map((k) => [k, []])),
    mutable_config: null, name, new_version: '110.0.0', relationships: [], render_index_track_mode_on: false, retouch_cover: null, source: 'default',
    static_cover_image_path: '', time_marks: null, tracks: [], update_time: 0, version: 360000,
  };
}

function metaTemplate(name, folder, duration) {
  const now = Date.now();
  return {
    cloud_package_completed_time: '', draft_cloud_capcut_purchase_info: '', draft_cloud_last_action_download: false, draft_cloud_materials: [],
    draft_cloud_purchase_info: '', draft_cloud_template_id: '', draft_cloud_tutorial_info: '', draft_cloud_videocut_purchase_info: '', draft_cover: '',
    draft_deeplink_url: '', draft_enterprise_info: { draft_enterprise_extra: '', draft_enterprise_id: '', draft_enterprise_name: '', enterprise_material: [] },
    draft_fold_path: folder, draft_id: uid(), draft_is_ai_packaging_used: false, draft_is_ai_shorts: false, draft_is_ai_translate: false,
    draft_is_article_video_draft: false, draft_is_from_deeplink: 'false', draft_is_invisible: false,
    draft_materials: [0, 1, 2, 3, 6, 7, 8].map((type) => ({ type, value: [] })), draft_materials_copied_info: [], draft_name: name,
    draft_new_version: '', draft_removable_storage_device: '', draft_root_path: path.dirname(folder), draft_segment_extra_info: [], draft_type: '',
    tm_draft_cloud_completed: '', tm_draft_cloud_modified: 0, tm_draft_create: now * 1000, tm_draft_modified: now * 1000, tm_draft_removed: 0, tm_duration: duration,
  };
}

// 把一个页面片段单独渲染成透明视频：临时影片里只有它，位置和外观照搬
export async function renderPage({ root, doc, filmDir, c, len, out, fps, signal }) {
  const tmpDir = path.join(root, '.cutforge', 'jy');
  await fsp.mkdir(tmpDir, { recursive: true });
  const rel = path.relative(tmpDir, path.resolve(filmDir, c.file)).split(path.sep).join('/');
  const attrs = c.attrs.filter((a) => a.name !== 'at' && a.name !== 'src' && a.name !== 'disabled');
  attrs.unshift({ name: 'src', value: `${rel}#t=${c.in},${Math.round((c.in + len) * 1000) / 1000}` });
  const film = `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=${doc.width}, height=${doc.height}">\n<style>${doc.css}</style>\n</head>\n<body>\n<section>\n  ${serializeTag('iframe', attrs)}</iframe>\n</section>\n</body>\n</html>\n`;
  const name = `page-${hex().slice(0, 8)}.html`;
  await fsp.writeFile(path.join(tmpDir, name), film);
  try {
    await renderFilm({ root, film: `.cutforge/jy/${name}`, out, fps, alpha: true, signal });
  } finally {
    await fsp.rm(path.join(tmpDir, name), { force: true });
  }
}

// 淡入淡出 → 剪映的不透明度关键帧（时间是相对片段开头的微秒）
function fadeKeyframes([fin, fout], len, alpha = 1) {
  if (!(fin > 0) && !(fout > 0)) return [];
  const kf = (t, v) => ({ curveType: 'Line', graphID: '', left_control: { x: 0, y: 0 }, right_control: { x: 0, y: 0 }, id: hex(), time_offset: us(t), values: [v] });
  const list = [];
  if (fin > 0) list.push(kf(0, 0), kf(Math.min(fin, len), alpha));
  if (fout > 0) list.push(kf(Math.max(0, len - fout), alpha), kf(len, 0));
  return [{ id: hex(), keyframe_list: list.sort((a, b) => a.time_offset - b.time_offset), material_id: '', property_type: 'KFTypeAlpha' }];
}

// 字幕的文本素材：白字黑描边，居中，按剪映“字幕”类型自动换行
function textMaterial(text) {
  const content = {
    styles: [{
      fill: { alpha: 1, content: { render_type: 'solid', solid: { alpha: 1, color: [1, 1, 1] } } },
      range: [0, [...text].length], size: 8, bold: false, italic: false, underline: false,
      strokes: [{ content: { solid: { alpha: 1, color: [0, 0, 0] } }, width: 0.08 }],
    }],
    text,
  };
  return {
    id: hex(), content: JSON.stringify(content), typesetting: 0, alignment: 1, letter_spacing: 0, line_spacing: 0.02,
    line_feed: 1, line_max_width: 0.82, force_apply_line_max_width: false, check_flag: 15, type: 'subtitle', global_alpha: 1,
  };
}

export function placement(c, nat, W, H) {
  const b = c.box;
  const nw = nat.width || W;
  const nh = nat.height || H;
  const boxed = b.left != null || b.top != null || b.width != null || b.height != null;
  let w = b.width;
  let h = b.height;
  if (w == null && h == null) { w = boxed ? nw : W; h = boxed ? nh : H; }
  else if (w == null) w = (h * nw) / nh;
  else if (h == null) h = (w * nh) / nw;
  const left = b.left ?? (boxed ? 0 : 0);
  const top = b.top ?? 0;
  const cover = /cover/.test(getLookProp(c.look, 'object-fit') || '') || /\bcard\b/.test(c.cls) && /object-fit:\s*cover/.test(c.look);
  // 剪映的缩放 1 = 素材按“适应画布”放下的大小
  const fit = Math.min(W / nw, H / nh);
  const s = cover ? Math.max(w / nw, h / nh) : Math.min(w / nw, h / nh);
  const crop = { upper_left_x: 0, upper_left_y: 0, upper_right_x: 1, upper_right_y: 0, lower_left_x: 0, lower_left_y: 1, lower_right_x: 1, lower_right_y: 1 };
  if (cover) {
    // cover 会裁掉超出盒子的部分：用剪映的素材裁剪表达（以素材为单位的 0–1 坐标）
    const cx = Math.min(1, w / (nw * s));
    const cy = Math.min(1, h / (nh * s));
    const x0 = (1 - cx) / 2;
    const y0 = (1 - cy) / 2;
    Object.assign(crop, { upper_left_x: x0, upper_left_y: y0, upper_right_x: 1 - x0, upper_right_y: y0, lower_left_x: x0, lower_left_y: 1 - y0, lower_right_x: 1 - x0, lower_right_y: 1 - y0 });
  }
  const opacity = Number.parseFloat(getLookProp(c.look, 'opacity') ?? '1');
  return {
    crop,
    clip: {
      alpha: Number.isFinite(opacity) ? opacity : 1,
      flip: { horizontal: false, vertical: false },
      rotation: b.rotate || 0,
      scale: { x: s / fit, y: s / fit },
      transform: { x: (left + w / 2 - W / 2) / (W / 2), y: -(top + h / 2 - H / 2) / (H / 2) },
    },
  };
}

function segmentBase(materialId, at, len, extra) {
  return {
    enable_adjust: true, enable_color_correct_adjust: false, enable_color_curves: true, enable_color_match_adjust: false, enable_color_wheels: true,
    enable_lut: true, enable_smart_color_adjust: false, last_nonzero_volume: 1, reverse: false, track_attribute: 0, track_render_index: 0, visible: true,
    id: hex(), material_id: materialId, target_timerange: { start: us(at), duration: us(len) }, common_keyframes: [], keyframe_refs: [],
    ...extra,
  };
}

// onProgress({ step, total, text })
export async function exportJianying({ root, film = 'film.html', name, outDir, fps = 30, signal, onProgress = () => {} }) {
  root = path.resolve(root);
  const filmFile = path.join(root, film);
  const filmDir = path.dirname(filmFile);
  const doc = parseFilm(await fsp.readFile(filmFile, 'utf8'));
  if (doc.problems.some((p) => p.level === 'error')) throw new Error('film.html 里还有写法错误，先在“问题”里改好');
  const W = doc.width;
  const H = doc.height;
  name ||= path.basename(root);
  const folder = path.join(outDir || path.join(root, 'exports', 'jianying'), name);
  await fsp.rm(folder, { recursive: true, force: true });
  const matDir = path.join(folder, 'materials');
  await fsp.mkdir(matDir, { recursive: true });

  const content = contentTemplate(W, H, fps, 0, name);
  const M = content.materials;
  const tracks = [];
  const notes = [];
  const copied = new Map();
  const live = doc.clips.filter((c) => !c.disabled && !doc.tracks[c.track].hidden);
  const pages = live.filter((c) => c.kind === 'page').length;
  let step = 0;
  let end = 0;

  const copy = async (abs) => {
    if (copied.has(abs)) return copied.get(abs);
    let dest = path.join(matDir, path.basename(abs));
    for (let i = 2; [...copied.values()].includes(dest); i++) dest = path.join(matDir, `${path.parse(abs).name}-${i}${path.extname(abs)}`);
    await fsp.copyFile(abs, dest);
    copied.set(abs, dest);
    return dest;
  };

  // 时间线上写在前面的轨道在上层；剪映里后面的视频轨在上层，所以倒过来放
  const order = [...doc.tracks].reverse();
  for (const tr of order) {
    if (tr.hidden || tr.caption) continue;
    const vSegs = [];
    const aSegs = [];
    for (const c of tr.clips) {
      if (c.disabled) continue;
      const abs = path.resolve(filmDir, c.file);
      if (!fs.existsSync(abs)) throw new Error(`找不到 ${c.file}`);
      if (c.kind === 'audio') {
        const p = await probe(abs);
        const len = clipLength(c, p?.duration ?? null);
        if (!len) continue;
        const mat = { app_id: 0, category_id: '', category_name: 'local', check_flag: 3, copyright_limit_type: 'none', duration: us(p?.duration ?? len), effect_id: '', formula_id: '', id: hex(), local_material_id: '', music_id: '', name: path.basename(abs), path: await copy(abs), source_platform: 0, type: 'extract_music', wave_points: [] };
        mat.local_material_id = mat.music_id = mat.id;
        M.audios.push(mat);
        const speed = { curve_speed: null, id: hex(), mode: 0, speed: c.speed, type: 'speed' };
        M.speeds.push(speed);
        const refs = [speed.id];
        if (c.fade[0] || c.fade[1]) {
          const fade = { id: hex(), fade_in_duration: us(c.fade[0]), fade_out_duration: us(c.fade[1]), fade_type: 0, type: 'audio_fade' };
          M.audio_fades.push(fade);
          refs.push(fade.id);
        }
        aSegs.push(segmentBase(mat.id, c.at, len, {
          source_timerange: { start: us(c.in), duration: us(len * c.speed) }, speed: c.speed, volume: tr.muted ? 0 : c.volume,
          extra_material_refs: refs, is_tone_modify: false, clip: null, hdr_settings: null,
        }));
        end = Math.max(end, c.at + len);
        continue;
      }
      let file = abs;
      let nat;
      let len;
      let srcIn = c.in;
      let speedV = c.kind === 'video' ? c.speed : 1;
      let isPhoto = c.kind === 'image';
      let placeClip = c;
      if (c.kind === 'page') {
        len = clipLength(c, null);
        if (!len) {
          notes.push(`${c.uid}：页面没写时长，跳过`);
          continue;
        }
        onProgress({ step: ++step, total: pages, text: `渲染页面 ${c.uid}（${step}/${pages}）` });
        file = path.join(matDir, `${c.uid}.mov`);
        await renderPage({ root, doc, filmDir, c, len, out: file, fps, signal });
        copied.set(file, file);
        nat = { width: W, height: H };
        srcIn = 0;
        speedV = 1;
        // 页面已按位置画进整幅画面，放到剪映里就是铺满画布
        placeClip = { ...c, box: { left: null, top: null, width: null, height: null, rotate: null }, look: '', cls: '' };
      } else {
        const p = isPhoto ? null : await probe(abs);
        nat = isPhoto ? await imageSize(abs) : { width: p?.width, height: p?.height };
        len = clipLength(c, p?.duration ?? null);
        if (!len) continue;
        file = await copy(abs);
        if (c.look && /(border-radius|filter|clip-path|animation|mask)/.test(c.look + c.cls)) notes.push(`${c.uid}：CSS 外观（圆角、滤镜、动画等）剪映里没有对应，已忽略`);
      }
      const { clip, crop } = placement(placeClip, nat, W, H);
      const mat = {
        audio_fade: null, category_id: '', category_name: 'local', check_flag: 63487, crop, crop_ratio: 'free', crop_scale: 1,
        duration: isPhoto ? 10800000000 : us(c.kind === 'page' ? len : (await probe(abs))?.duration ?? len),
        height: nat.height || H, id: hex(), local_material_id: '', material_id: '', material_name: path.basename(file), media_path: '',
        path: file, type: isPhoto ? 'photo' : 'video', width: nat.width || W,
      };
      mat.material_id = mat.id;
      M.videos.push(mat);
      const speed = { curve_speed: null, id: hex(), mode: 0, speed: speedV, type: 'speed' };
      M.speeds.push(speed);
      const refs = [speed.id];
      const vol = c.kind === 'video' && !tr.muted ? c.volume : 0;
      if (c.kind === 'video' && (c.fade[0] || c.fade[1])) {
        const fade = { id: hex(), fade_in_duration: us(c.fade[0]), fade_out_duration: us(c.fade[1]), fade_type: 0, type: 'audio_fade' };
        M.audio_fades.push(fade);
        refs.push(fade.id);
      }
      const alphaKeys = c.kind !== 'page' ? fadeKeyframes(c.fade, len, clip.alpha) : [];
      vSegs.push(segmentBase(mat.id, c.at, len, {
        source_timerange: { start: us(srcIn), duration: us(len * speedV) }, speed: speedV, volume: vol, extra_material_refs: refs,
        is_tone_modify: false, clip, uniform_scale: { on: true, value: 1 }, hdr_settings: { intensity: 1, mode: 1, nits: 1000 }, common_keyframes: alphaKeys,
      }));
      end = Math.max(end, c.at + len);
    }
    if (vSegs.length) tracks.push({ type: 'video', segs: vSegs, mute: tr.muted });
    if (aSegs.length) tracks.push({ type: 'audio', segs: aSegs, mute: tr.muted });
  }

  // 字幕轨 → 剪映自己的字幕（文本片段），在剪映里可以直接改字和样式
  let captionCount = 0;
  for (const tr of doc.tracks) {
    if (!tr.caption || tr.hidden) continue;
    let cues = [];
    try {
      cues = parseVtt(await fsp.readFile(path.resolve(filmDir, tr.caption.file), 'utf8'));
    } catch { continue; }
    const segs = [];
    for (const q of cues) {
      const mat = textMaterial(q.text);
      M.texts.push(mat);
      const speed = { curve_speed: null, id: hex(), mode: 0, speed: 1, type: 'speed' };
      M.speeds.push(speed);
      segs.push(segmentBase(mat.id, q.start, q.end - q.start, {
        source_timerange: null, speed: 1, volume: 1, extra_material_refs: [speed.id], is_tone_modify: false,
        clip: { alpha: 1, flip: { horizontal: false, vertical: false }, rotation: 0, scale: { x: 1, y: 1 }, transform: { x: 0, y: -0.8 } },
        uniform_scale: { on: true, value: 1 },
      }));
      end = Math.max(end, q.end);
      captionCount++;
    }
    if (segs.length) tracks.push({ type: 'text', segs, mute: false });
  }

  // 剪映：音频轨在前，视频轨按下→上，字幕在最上；render_index 越大越靠上
  const ordered = [...tracks.filter((t) => t.type === 'audio'), ...tracks.filter((t) => t.type === 'video'), ...tracks.filter((t) => t.type === 'text')];
  content.tracks = ordered.map((t, i) => ({
    attribute: t.mute ? 1 : 0, flag: 0, id: hex(), is_default_name: true, name: '',
    segments: t.segs.map((s) => ({ ...s, render_index: i, track_render_index: 0 })), type: t.type,
  }));
  content.duration = us(end);
  await fsp.writeFile(path.join(folder, 'draft_content.json'), JSON.stringify(content, null, 2));
  await fsp.writeFile(path.join(folder, 'draft_meta_info.json'), JSON.stringify(metaTemplate(name, folder, us(end)), null, 2));

  // 字幕轨另存为 SRT
  const subs = [];
  for (const tr of doc.tracks) {
    if (!tr.caption || tr.hidden) continue;
    try {
      const cues = parseVtt(await fsp.readFile(path.resolve(filmDir, tr.caption.file), 'utf8'));
      const out = path.join(folder, `${path.parse(tr.caption.file).name}.srt`);
      await fsp.writeFile(out, toSrt(cues));
      subs.push(path.basename(out));
    } catch {
      notes.push(`字幕 ${tr.caption.file} 读不到，没有导出`);
    }
  }
  await fsp.rm(path.join(root, '.cutforge', 'jy'), { recursive: true, force: true });
  return { folder, name, duration: end, captions: captionCount, videoTracks: tracks.filter((t) => t.type === 'video').length, audioTracks: tracks.filter((t) => t.type === 'audio').length, pages, subtitles: subs, notes };
}

async function imageSize(file) {
  const p = await probe(file);
  return { width: p?.width || 0, height: p?.height || 0 };
}

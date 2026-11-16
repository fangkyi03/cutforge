// 批量编辑：多个片段的删除、波纹删除、微移、停用、分离音频、裁到播放头、复制粘贴属性。
// 每个操作是一次 editFilm，所以都能一步撤销。片段在改写过程中位置会变，按 uid 重新找。
import {
  parseFilm, updateClip, removeClip, moveClip, insertClip, addTrack, duplicateClip, r3,
} from '/shared/doc.mjs';
import { S, editFilm, lengthOf, toast, selectClip, setSelection } from './store.js';

const find = (text, uid) => parseFilm(text).clips.find((c) => c.uid === uid);
const isMedia = (c) => c.kind === 'video' || c.kind === 'audio';
const speedOf = (c) => (isMedia(c) ? c.speed : 1);
const editable = (c) => c && !S.doc.tracks[c.track].locked;

export const selectedClips = () => [...S.sel].map((u) => S.doc.clips.find((c) => c.uid === u)).filter(Boolean);
const editableSel = () => {
  const list = selectedClips();
  const ok = list.filter(editable);
  if (list.length && !ok.length) toast('选中的片段都在锁定的轨道上');
  return ok;
};

export function deleteMany({ ripple = false } = {}) {
  const list = editableSel();
  if (!list.length) return;
  editFilm((text) => {
    for (const c of [...list].sort((a, b) => b.at - a.at)) {
      const cur = find(text, c.uid);
      if (!cur) continue;
      const len = lengthOf(c);
      text = removeClip(text, cur.key);
      if (!ripple) continue;
      // 波纹：同轨道后面的片段往前挪，补上空出来的位置
      for (const later of parseFilm(text).tracks[c.track].clips.filter((x) => x.at >= c.at + len - 0.001).sort((a, b) => a.at - b.at)) {
        text = updateClip(text, later.key, { at: r3(Math.max(0, later.at - len)) });
      }
    }
    return text;
  });
  setSelection([]);
}

const overlaps = (doc, track, skip, at, len) => doc.tracks[track].clips.some((c) => !skip.has(c.uid) && at < c.at + lengthOf(c) - 0.001 && at + len > c.at + 0.001);

// 把选中的片段一起挪 dt 秒（会撞上别的片段时不挪）
export function moveMany(dt, list = editableSel()) {
  if (!list.length || !dt) return false;
  const skip = new Set(list.map((c) => c.uid));
  for (const c of list) {
    if (c.at + dt < -0.0005 || overlaps(S.doc, c.track, skip, c.at + dt, lengthOf(c))) {
      toast(c.at + dt < 0 ? '已经到开头了' : '会和同一轨道上的片段重叠');
      return false;
    }
  }
  editFilm((text) => {
    for (const c of list) {
      const cur = find(text, c.uid);
      if (cur) text = updateClip(text, cur.key, { at: r3(Math.max(0, c.at + dt)) });
    }
    return text;
  });
  return true;
}

export function toggleDisabledMany() {
  const list = editableSel();
  if (!list.length) return;
  const off = !list.every((c) => c.disabled);
  editFilm((text) => {
    for (const c of list) {
      const cur = find(text, c.uid);
      if (cur) text = updateClip(text, cur.key, { disabled: off });
    }
    return text;
  });
}

// Q／W：把播放头下的片段的开头／结尾裁到播放头；ripple 时同轨道后面的片段跟着挪
export function trimToPlayhead(side, ripple = true) {
  const t = r3(S.t);
  const under = (c) => t > c.at + 0.02 && t < c.at + lengthOf(c) - 0.02 && editable(c);
  const sel = selectedClips().filter(under);
  const list = sel.length ? sel : S.doc.clips.filter((c) => under(c) && c.kind !== 'audio').slice(0, 1);
  if (!list.length) return toast('播放头没有落在可裁剪的片段上');
  editFilm((text) => {
    for (const c of list) {
      const len = lengthOf(c);
      const sp = speedOf(c);
      const out = c.out ?? r3(c.in + len * sp);
      const cur = find(text, c.uid);
      if (!cur) continue;
      let shift = 0;
      if (side === 'start') {
        const cut = t - c.at;
        text = updateClip(text, cur.key, c.kind === 'image' ? { out: r3(out - cut), at: ripple ? c.at : t } : { in: r3(c.in + cut * sp), out, at: ripple ? c.at : t });
        shift = ripple ? cut : 0;
        if (ripple) {
          for (const later of parseFilm(text).tracks[c.track].clips.filter((x) => x.uid !== c.uid && x.at >= c.at + len - 0.001)) text = updateClip(text, later.key, { at: r3(later.at - shift) });
        }
      } else {
        const cut = c.at + len - t;
        text = updateClip(text, cur.key, { out: r3(out - cut * sp) });
        if (ripple) {
          for (const later of parseFilm(text).tracks[c.track].clips.filter((x) => x.uid !== c.uid && x.at >= c.at + len - 0.001)) text = updateClip(text, later.key, { at: r3(later.at - cut) });
        }
      }
    }
    return text;
  });
}

// 分离音频：视频静音，在最下面新开一条轨道放它的声音
export function detachAudio() {
  const list = editableSel().filter((c) => c.kind === 'video' && c.volume > 0);
  if (!list.length) return toast('选一个有声音的视频片段');
  editFilm((text) => {
    for (const c of list) {
      text = addTrack(text, 'bottom');
      const doc = parseFilm(text);
      text = insertClip(text, doc.tracks.length - 1, { kind: 'audio', file: c.file, in: c.in, out: c.out ?? r3(c.in + lengthOf(c) * c.speed), at: c.at, speed: c.speed, volume: c.volume, id: `${c.uid}-audio` });
      const cur = find(text, c.uid);
      if (cur) text = updateClip(text, cur.key, { volume: 0 });
    }
    return text;
  });
  toast('已把声音分离到新轨道');
}

// ---- 剪贴板：多个片段，保持彼此的相对时间
let clips = null;
let attrs = null;

export function copyMany({ cut = false } = {}) {
  const list = selectedClips();
  if (!list.length) return;
  const t0 = Math.min(...list.map((c) => c.at));
  clips = list.map((c) => ({ uid: c.uid, track: c.track, kind: c.kind, dt: c.at - t0, len: lengthOf(c) }));
  toast(`已${cut ? '剪切' : '复制'} ${list.length} 个片段`);
  if (cut) deleteMany();
}

export const hasClipboard = () => !!clips;

export function pasteMany() {
  if (!clips) return;
  const t = r3(S.t);
  const made = [];
  editFilm((text) => {
    let doc = parseFilm(text);
    // 原轨道放不下（或已锁定）的统一放到新开的一条轨道
    const fits = clips.every((p) => doc.tracks[p.track] && !doc.tracks[p.track].locked && !overlaps(S.doc, p.track, new Set(), t + p.dt, p.len));
    let extra = null;
    if (!fits) {
      text = addTrack(text, clips.every((p) => p.kind === 'audio') ? 'bottom' : 'top');
      doc = parseFilm(text);
      extra = clips.every((p) => p.kind === 'audio') ? doc.tracks.length - 1 : 0;
    }
    for (const p of clips) {
      const src = find(text, p.uid);
      if (!src) continue;
      text = duplicateClip(text, src.key, { at: r3(t + p.dt) });
      const d = parseFilm(text);
      const list = d.tracks[src.track].clips;
      const copy = list[list.findIndex((x) => x.uid === src.uid) + 1];
      made.push(copy.uid);
      if (extra != null && src.track !== extra) text = moveClip(text, copy.key, extra, {});
    }
    return text;
  });
  if (made.length) setSelection(made);
}

export function copyAttrs() {
  const c = selectedClips()[0];
  if (!c) return;
  attrs = { box: { ...c.box }, look: c.look, fade: [...c.fade], volume: c.volume, speed: c.speed, kind: c.kind };
  toast(`已复制 ${c.uid} 的属性（位置、外观、淡入淡出、音量）`);
}

export function pasteAttrs() {
  if (!attrs) return toast('先在一个片段上按 ⇧⌘C 复制属性');
  const list = editableSel();
  editFilm((text) => {
    for (const c of list) {
      const cur = find(text, c.uid);
      if (!cur) continue;
      const patch = { fade: attrs.fade };
      if (c.kind !== 'audio' && attrs.kind !== 'audio') Object.assign(patch, { box: attrs.box, look: attrs.look });
      if (isMedia(c) && isMedia(attrs)) patch.volume = attrs.volume;
      text = updateClip(text, cur.key, patch);
    }
    return text;
  });
}

// ---- 选择
export function selectAll() {
  setSelection(S.doc.clips.filter((c) => !S.doc.tracks[c.track].locked).map((c) => c.uid));
}

// [ ]：选上一个／下一个片段（同一轨道，没选中时用最上面一条有片段的轨道）
export function selectNeighbor(dir) {
  const cur = selectedClips()[0];
  const track = cur ? cur.track : S.doc.tracks.findIndex((t) => t.clips.length);
  if (track < 0) return;
  const list = [...S.doc.tracks[track].clips].sort((a, b) => a.at - b.at);
  const i = cur ? list.findIndex((c) => c.uid === cur.uid) + dir : dir > 0 ? 0 : list.length - 1;
  if (list[i]) selectClip(list[i].uid);
}

// ↑ ↓：跳到上一个／下一个剪辑点
export function cutPoints() {
  const pts = new Set([0]);
  for (const c of S.doc.clips) {
    pts.add(r3(c.at));
    pts.add(r3(c.at + lengthOf(c)));
  }
  return [...pts].sort((a, b) => a - b);
}

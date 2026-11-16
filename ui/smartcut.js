// 智能剪辑：去掉停顿、按镜头切开、竖屏跟随人脸。分析在本机跑（Silero VAD、TransNetV2、YuNet），
// 结果都落成对 film.html 的一次改写，可以一步撤销，也可以继续手动调。
import { parseFilm, updateClip, removeClip, duplicateClip, splitClip, upsertKeyframes, setLookProp, r3 } from '/shared/doc.mjs';
import { S, api, toast, editFilm, lengthOf, log, setSelection } from './store.js';

const find = (text, uid) => parseFilm(text).clips.find((c) => c.uid === uid);

async function analyze(what, c, extra = {}) {
  const sp = c.speed || 1;
  const from = c.in;
  const to = c.out ?? r3(c.in + lengthOf(c) * sp);
  return api('/api/analyze', { method: 'POST', json: { what, file: c.file, from, to, ...extra } });
}

// 去掉停顿：只保留说话的段落，首尾相接；同一轨道后面的片段往前补上
export async function removeSilence(c) {
  if (S.doc.tracks[c.track].locked) return toast('这条轨道已锁定');
  toast('正在分析说话段落…');
  let segs;
  try {
    segs = (await analyze('speech', c)).segments;
  } catch (e) {
    return toast(`分析失败：${e.message}`, 'bad');
  }
  if (!segs.length) return toast('没有找到说话的声音');
  const sp = c.speed || 1;
  const len = lengthOf(c);
  const kept = segs.reduce((n, g) => n + (g.end - g.start), 0) / sp;
  const saved = len - kept;
  if (saved < 0.3) return toast('停顿很少，不用剪');
  const made = [];
  editFilm((text) => {
    let at = c.at;
    let prev = c.uid;
    segs.forEach((g, i) => {
      const patch = { in: r3(c.in + g.start), out: r3(c.in + g.end), at: r3(at), fade: [0, 0] };
      if (i === 0) {
        text = updateClip(text, find(text, c.uid).key, patch);
      } else {
        text = duplicateClip(text, find(text, prev).key, patch);
        const list = parseFilm(text).tracks[c.track].clips;
        prev = list[list.findIndex((x) => x.uid === prev) + 1].uid;
      }
      if (i === 0) prev = c.uid;
      made.push(prev);
      at += (g.end - g.start) / sp;
    });
    // 同轨道后面的片段往前移，补上剪掉的时长
    for (const later of parseFilm(text).tracks[c.track].clips.filter((x) => !made.includes(x.uid) && x.at >= c.at + len - 0.001)) {
      text = updateClip(text, later.key, { at: r3(Math.max(0, later.at - saved)) });
    }
    return text;
  });
  setSelection(made);
  log(`去掉停顿：${c.uid} 分成 ${segs.length} 段说话，剪掉 ${saved.toFixed(1)} 秒（原长 ${len.toFixed(1)} 秒）。别的轨道没有跟着移动，配乐等请自己检查`);
  toast(`剪掉了 ${saved.toFixed(1)} 秒停顿`, 'good');
}

// 按镜头切开
export async function splitShots(c) {
  if (S.doc.tracks[c.track].locked) return toast('这条轨道已锁定');
  toast('正在找镜头切点…');
  let cuts;
  try {
    cuts = (await analyze('shots', c)).cuts;
  } catch (e) {
    return toast(`分析失败：${e.message}`, 'bad');
  }
  const sp = c.speed || 1;
  const times = cuts.map((t) => r3(c.at + t / sp)).filter((t) => t > c.at + 0.1 && t < c.at + lengthOf(c) - 0.1);
  if (!times.length) return toast('这段素材里只有一个镜头');
  editFilm((text) => {
    // 从后往前切，前面的片段时长不变
    for (const t of [...times].reverse()) {
      const cur = find(text, c.uid);
      text = splitClip(text, cur.key, t, lengthOf({ ...cur }) || (t - cur.at) + 1);
    }
    return text;
  });
  log(`按镜头切开：${c.uid} 在 ${times.map((t) => `${t.toFixed(2)}s`).join('、')} 切成 ${times.length + 1} 段`);
  toast(`切成了 ${times.length + 1} 个镜头`, 'good');
}

// 竖屏跟随人脸：铺满舞台（cover），画面的取景位置跟着最大的那张脸移动
export async function reframe(c) {
  if (S.doc.tracks[c.track].locked) return toast('这条轨道已锁定');
  toast('正在找人脸…');
  let r;
  try {
    r = await analyze('faces', c, { step: 0.5 });
  } catch (e) {
    return toast(`分析失败：${e.message}`, 'bad');
  }
  const W = S.doc.width;
  const H = S.doc.height;
  const vw = r.width;
  const vh = r.height;
  // cover 之后画面露出的比例；只有比舞台“宽”的素材才需要左右跟随，比舞台“高”的就上下跟随
  const k = Math.max(W / vw, H / vh);
  const fx = W / (vw * k);
  const fy = H / (vh * k);
  if (fx > 0.98 && fy > 0.98) return toast('素材和舞台比例一样，不需要跟随');
  const pts = r.track.map((p) => {
    const face = [...p.faces].sort((a, b) => b.w * b.h - a.w * a.h)[0];
    return { t: p.t, cx: face ? face.x + face.w / 2 : null, cy: face ? face.y + face.h / 2 : null };
  });
  if (!pts.some((p) => p.cx != null)) return toast('没有找到人脸', 'bad');
  // 没检测到的时刻沿用上一个位置；再做平滑，避免抖
  let last = pts.find((p) => p.cx != null);
  for (const p of pts) {
    if (p.cx == null) Object.assign(p, { cx: last.cx, cy: last.cy });
    else last = p;
  }
  const smooth = pts.map((p, i) => {
    const win = pts.slice(Math.max(0, i - 2), i + 3);
    return { t: p.t, cx: win.reduce((n, q) => n + q.cx, 0) / win.length, cy: win.reduce((n, q) => n + q.cy, 0) / win.length };
  });
  const pos = (center, f) => (f >= 0.999 ? 50 : Math.min(100, Math.max(0, ((center - f / 2) / (1 - f)) * 100)));
  const sp = c.speed || 1;
  const dur = smooth.at(-1).t + 0.5;
  const name = `cf-reframe-${c.uid.replace(/[^\w-]/g, '').slice(0, 30) || 'clip'}`;
  const frames = smooth.map((p) => `  ${((p.t / dur) * 100).toFixed(2)}% { object-position: ${pos(p.cx, fx).toFixed(1)}% ${pos(p.cy * 0.9, fy).toFixed(1)}%; }`);
  const css = `@keyframes ${name} {\n${frames.join('\n')}\n}`;
  editFilm((text) => {
    text = upsertKeyframes(text, name, css);
    const cur = find(text, c.uid);
    let look = setLookProp(cur.look, 'object-fit', 'cover');
    look = setLookProp(look, 'animation', `${name} ${(dur / sp).toFixed(3)}s linear both`);
    return updateClip(text, cur.key, { box: { left: 0, top: 0, width: W, height: H }, look });
  });
  log(`竖屏跟随：${c.uid} 铺满舞台，取景跟着人脸移动（${smooth.length} 个关键帧，写在 film.html 的 @keyframes ${name}）`);
  toast('已按人脸调整取景', 'good');
}

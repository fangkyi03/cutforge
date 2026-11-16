// OpenTimelineIO（.otio）时间线导出：Premiere（通过插件）、达芬奇、Avid、Nuke 等都能读。
// 格式规范：https://opentimeline.io（Apache-2.0）。这里直接生成 JSON，不依赖它的 Python 库。
import fsp from 'node:fs/promises';
import path from 'node:path';
import { probe } from '../render/probe.mjs';

const rt = (seconds, rate) => ({ OTIO_SCHEMA: 'RationalTime.1', rate, value: Math.round(seconds * rate) });
const tr = (start, dur, rate) => ({ OTIO_SCHEMA: 'TimeRange.1', start_time: rt(start, rate), duration: rt(dur, rate) });

// clips: [{ name, file（绝对路径）, kind, at, in, len, speed, track, mediaDuration }]
export async function writeOtio({ name, clips, tracks, duration, fps = 30, out }) {
  const rate = fps;
  const byTrack = new Map();
  for (const c of clips) {
    if (!byTrack.has(c.track)) byTrack.set(c.track, []);
    byTrack.get(c.track).push(c);
  }
  const children = [];
  // OTIO 的轨道从下往上排；film.html 里写在前面的在上层，所以倒过来
  for (const ti of [...byTrack.keys()].sort((a, b) => b - a)) {
    const list = byTrack.get(ti).sort((a, b) => a.at - b.at);
    const kind = list.every((c) => c.kind === 'audio') ? 'Audio' : 'Video';
    const items = [];
    let t = 0;
    for (const c of list) {
      if (c.at > t + 1e-6) items.push({ OTIO_SCHEMA: 'Gap.1', name: '', source_range: tr(0, c.at - t, rate), effects: [], markers: [], metadata: {} });
      const p = c.mediaDuration ?? (await probe(c.file))?.duration ?? null;
      items.push({
        OTIO_SCHEMA: 'Clip.2', name: c.name, metadata: { cutforge: { kind: c.kind } }, markers: [],
        effects: c.speed !== 1 ? [{ OTIO_SCHEMA: 'LinearTimeWarp.1', name: '', effect_name: 'LinearTimeWarp', time_scalar: c.speed, metadata: {} }] : [],
        source_range: tr(c.in, c.len * c.speed, rate),
        media_references: { DEFAULT_MEDIA: { OTIO_SCHEMA: 'ExternalReference.1', name: path.basename(c.file), target_url: `file://${encodeURI(c.file.split(path.sep).join('/'))}`, available_range: p ? tr(0, p, rate) : null, metadata: {} } },
        active_media_reference_key: 'DEFAULT_MEDIA',
      });
      t = c.at + c.len;
    }
    children.push({ OTIO_SCHEMA: 'Track.1', name: `${kind === 'Audio' ? 'A' : 'V'}${children.filter((x) => x.kind === kind).length + 1}`, kind, children: items, source_range: null, effects: [], markers: [], metadata: {} });
  }
  const doc = {
    OTIO_SCHEMA: 'Timeline.1', name, global_start_time: rt(0, rate), metadata: { cutforge: { duration, tracks } },
    tracks: { OTIO_SCHEMA: 'Stack.1', name: 'tracks', children, source_range: null, effects: [], markers: [], metadata: {} },
  };
  await fsp.writeFile(out, JSON.stringify(doc, null, 2));
  return out;
}

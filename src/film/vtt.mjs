// WebVTT 的最小读取：只取每条字幕的起止时间与文字（去掉行内标签）。

const ts = (s) => {
  const p = s.trim().split(':').map(Number);
  if (p.some((x) => !Number.isFinite(x))) return null;
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
};

export function parseVtt(text) {
  const cues = [];
  const blocks = String(text || '').replace(/\r/g, '').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const m = /^\s*([\d:.]+)\s*-->\s*([\d:.]+)/.exec(lines[i]);
    if (!m) continue;
    const start = ts(m[1]);
    const end = ts(m[2]);
    if (start == null || end == null || end <= start) continue;
    const body = lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').trim();
    if (body) cues.push({ start, end, text: body });
  }
  return cues.sort((a, b) => a.start - b.start);
}

const srtTime = (t) => {
  const ms = Math.round(t * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

export function toSrt(cues) {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n');
}

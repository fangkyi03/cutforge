// 影片文档：读取与改写 film.html（兼容 OpenFilm Protocol 0.1 的子集）。
// 同一份代码在 Node 与浏览器里运行，不依赖 DOM。
// 改写只替换被改动的那一个标签，其余文本原样保留，智能体写的格式不会被打乱。

export const CLIP_KINDS = { iframe: 'page', video: 'video', img: 'image', audio: 'audio' };
const RAW_TEXT = new Set(['style', 'script', 'title', 'textarea']);
const VOID = new Set(['img', 'track']);
const KNOWN_ATTRS = new Set([
  'src', 'id', 'at', 'speed', 'volume', 'muted', 'disabled', 'size', 'style', 'class', 'overrides',
  'alt', 'title', 'lang', 'dir',
]);
const PLACE_PROPS = ['left', 'top', 'width', 'height', 'rotate'];
const BANNED_PROPS = new Set(['position', 'transform', 'margin', 'margin-left', 'margin-top', 'right', 'bottom', 'inset', 'transition']);

export const r3 = (n) => Math.round(n * 1000) / 1000;
export const fmt = (n) => String(r3(n));
const px = (n) => `${Math.round(n * 100) / 100}px`;

const ENT = { quot: '"', amp: '&', lt: '<', gt: '>', '#39': "'", apos: "'" };
const decode = (s) => s.replace(/&(quot|amp|lt|gt|#39|apos);/g, (m, k) => ENT[k]);

// ---------------------------------------------------------------- 词法

export function tokenize(text) {
  const out = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    if (text.startsWith('<!--', lt)) {
      const e = text.indexOf('-->', lt + 4);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (text[lt + 1] === '!' || text[lt + 1] === '?') {
      const e = text.indexOf('>', lt);
      i = e < 0 ? n : e + 1;
      continue;
    }
    if (text[lt + 1] === '/') {
      const m = /^<\/([a-zA-Z][\w-]*)\s*>/.exec(text.slice(lt, lt + 80));
      if (m) {
        out.push({ type: 'close', name: m[1].toLowerCase(), start: lt, end: lt + m[0].length });
        i = lt + m[0].length;
      } else i = lt + 2;
      continue;
    }
    const m = /^<([a-zA-Z][\w-]*)/.exec(text.slice(lt, lt + 80));
    if (!m) {
      i = lt + 1;
      continue;
    }
    const name = m[1].toLowerCase();
    const attrs = [];
    let j = lt + m[0].length;
    let selfClose = false;
    for (;;) {
      while (j < n && /\s/.test(text[j])) j++;
      if (j >= n) break;
      if (text[j] === '>') { j++; break; }
      if (text[j] === '/') {
        if (text[j + 1] === '>') { selfClose = true; j += 2; break; }
        j++;
        continue;
      }
      let k = j;
      while (k < n && !/[\s=>/]/.test(text[k])) k++;
      const an = text.slice(j, k);
      j = k;
      let p = j;
      while (p < n && /\s/.test(text[p])) p++;
      let value = null;
      if (text[p] === '=') {
        j = p + 1;
        while (j < n && /\s/.test(text[j])) j++;
        const q = text[j];
        if (q === '"' || q === "'") {
          const e = text.indexOf(q, j + 1);
          value = decode(text.slice(j + 1, e < 0 ? n : e));
          j = e < 0 ? n : e + 1;
        } else {
          k = j;
          while (k < n && !/[\s>]/.test(text[k])) k++;
          value = decode(text.slice(j, k));
          j = k;
        }
      }
      if (an) attrs.push({ name: an.toLowerCase(), value });
    }
    const tok = { type: 'open', name, attrs, start: lt, end: j, selfClose };
    out.push(tok);
    i = j;
    if (RAW_TEXT.has(name) && !selfClose) {
      const mm = new RegExp(`</${name}\\s*>`, 'i').exec(text.slice(j));
      const cEnd = mm ? j + mm.index : n;
      tok.content = text.slice(j, cEnd);
      if (mm) {
        out.push({ type: 'close', name, start: cEnd, end: cEnd + mm[0].length });
        i = cEnd + mm[0].length;
      } else i = n;
    }
  }
  return out;
}

function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return (off) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= off) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

const attrMap = (attrs) => Object.fromEntries(attrs.map((a) => [a.name, a.value ?? '']));

// "a: b; c: url(x;y)" → [[prop, value]]，括号和引号里的分号不切
export function parseStyle(str) {
  const out = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  const push = () => {
    const i = cur.indexOf(':');
    if (i > 0) out.push([cur.slice(0, i).trim().toLowerCase(), cur.slice(i + 1).trim()]);
    cur = '';
  };
  for (const ch of str || '') {
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) { push(); continue; }
    cur += ch;
  }
  push();
  return out;
}

const num = (v, d) => {
  if (v == null || v === '') return d;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : d;
};

// ---------------------------------------------------------------- 读取

export function parseFilm(text) {
  const toks = tokenize(text);
  const lineAt = lineIndex(text);
  const doc = {
    width: 1920, height: 1080, css: '', links: [], tracks: [], clips: [], problems: [],
    viewport: null, bodyClose: -1, headClose: -1,
  };
  const report = (off, message, level = 'error') => doc.problems.push({ level, line: lineAt(off), message });
  const explicitIds = new Map();
  let track = null;

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.type === 'close') {
      if (t.name === 'section' && track) {
        track.closeStart = t.start;
        track.end = t.end;
        track.closed = true;
        track = null;
      } else if (t.name === 'body') doc.bodyClose = t.start;
      else if (t.name === 'head') doc.headClose = t.start;
      continue;
    }
    const a = attrMap(t.attrs);
    switch (t.name) {
      case 'html': case 'head': case 'body': case 'title':
        break;
      case 'meta':
        if ((a.name || '').toLowerCase() === 'viewport') {
          const w = /width\s*=\s*(\d+)/.exec(a.content || '');
          const h = /height\s*=\s*(\d+)/.exec(a.content || '');
          if (w && h) {
            doc.width = +w[1];
            doc.height = +h[1];
            doc.viewport = { start: t.start, end: t.end };
          } else report(t.start, 'viewport 需要写成 content="width=1920, height=1080"');
        }
        break;
      case 'style':
        doc.css += `${t.content || ''}\n`;
        break;
      case 'link':
        if (/stylesheet/i.test(a.rel || '') && a.href) doc.links.push(a.href);
        break;
      case 'script':
        report(t.start, 'film.html 里不能有脚本：动画写在页面（page）里');
        break;
      case 'section': {
        if (track) report(t.start, '<section> 不能嵌套：每个 <section> 是一条轨道');
        track = {
          index: doc.tracks.length, start: t.start, openEnd: t.end, closeStart: t.end, end: t.end, closed: false,
          attrs: t.attrs, hidden: 'hidden' in a, muted: 'muted' in a, locked: 'locked' in a,
          clips: [], caption: null, line: lineAt(t.start),
        };
        doc.tracks.push(track);
        break;
      }
      case 'track': {
        if (!track) { report(t.start, '<track> 必须写在 <section> 里'); break; }
        if (!/^(captions|subtitles)$/.test(a.kind || '')) { report(t.start, '<track> 需要 kind="captions"'); break; }
        if (!a.src) { report(t.start, '字幕轨缺少 src（WebVTT 文件）'); break; }
        track.caption = { file: a.src, lang: a.srclang || '', label: a.label || '', line: lineAt(t.start) };
        break;
      }
      case 'iframe': case 'video': case 'img': case 'audio': {
        const next = toks[i + 1];
        let elEnd = t.end;
        if (next && next.type === 'close' && next.name === t.name) { elEnd = next.end; i++; }
        if (!track) { report(t.start, `<${t.name}> 必须写在 <section>（轨道）里`); break; }
        const clip = readClip(t, a, track, lineAt, report);
        clip.elStart = t.start;
        clip.elEnd = elEnd;
        if (a.id) {
          if (explicitIds.has(a.id)) report(t.start, `id "${a.id}" 重复：片段的 id 在整部影片里必须唯一`);
          explicitIds.set(a.id, true);
        }
        track.clips.push(clip);
        doc.clips.push(clip);
        break;
      }
      default:
        report(t.start, `film.html 里不认识 <${t.name}>：轨道是 <section>，片段是 <iframe> <video> <img> <audio>`);
    }
  }
  for (const tr of doc.tracks) {
    if (!tr.closed) report(tr.start, '<section> 没有闭合');
    if (tr.caption && tr.clips.length) report(tr.start, '字幕轨里不能再放片段');
  }
  // 没写 id 的片段用文件名；重名时加序号，保证内部引用唯一
  const seen = new Map();
  for (const c of doc.clips) {
    let id = c.id;
    const k = seen.get(id) || 0;
    seen.set(id, k + 1);
    if (k) id = `${id}-${k + 1}`;
    c.uid = id;
  }
  return doc;
}

function readClip(t, a, track, lineAt, report) {
  const at0 = t.start;
  const kind = CLIP_KINDS[t.name];
  const c = {
    key: `${track.index}:${track.clips.length}`, tag: t.name, kind, track: track.index, attrs: t.attrs,
    tagStart: t.start, tagEnd: t.end, line: lineAt(at0),
    file: '', in: 0, out: null, at: 0, speed: 1, volume: 1, muted: false, disabled: false, size: null,
    box: { left: null, top: null, width: null, height: null, rotate: null }, look: '', cls: a.class || '',
    overrides: [], fade: [0, 0], explicitId: a.id || null,
  };
  const src = a.src || '';
  if (!src) report(at0, `<${t.name}> 缺少 src`);
  const hash = src.indexOf('#');
  c.file = hash < 0 ? src : src.slice(0, hash);
  if (hash >= 0) {
    const m = /^t=([\d.]*)(?:,([\d.]+))?$/.exec(src.slice(hash + 1));
    if (!m) report(at0, `看不懂的片段范围 "${src.slice(hash)}"：写成 #t=起,止（秒）`);
    else {
      c.in = r3(num(m[1], 0));
      c.out = m[2] == null ? null : r3(num(m[2], 0));
      if (c.out != null && c.out <= c.in) report(at0, `#t=${m[1]},${m[2]} 的结束必须大于开始`);
    }
  }
  if (/(^|\/)film\.html$/.test(c.file) && kind === 'page') report(at0, 'CutForge 暂不支持把另一部影片当片段嵌套', 'warning');
  c.at = r3(Math.max(0, num(a.at, 0)));
  if (kind === 'video' || kind === 'audio') {
    c.speed = Math.min(100, Math.max(0.1, num(a.speed, 1)));
    c.muted = 'muted' in a;
    c.volume = c.muted ? 0 : Math.max(0, num(a.volume, 1));
  }
  c.disabled = 'disabled' in a;
  if (a.size) {
    const m = /^(\d+)x(\d+)$/.exec(a.size);
    if (m) c.size = { width: +m[1], height: +m[2] };
    else report(at0, 'size 写成 size="1920x1080"');
  }
  const look = [];
  for (const [prop, value] of parseStyle(a.style)) {
    if (PLACE_PROPS.includes(prop)) {
      const v = Number.parseFloat(value);
      if (Number.isFinite(v)) c.box[prop] = v;
      else report(at0, `style 里的 ${prop} 需要是数字（舞台像素${prop === 'rotate' ? '／角度' : ''}）`);
    } else {
      if (BANNED_PROPS.has(prop)) report(at0, `片段的 style 不能用 ${prop}：位置只用 left/top/width/height/rotate，运动用 animation`);
      look.push(`${prop}: ${value}`);
    }
  }
  c.look = look.join('; ');
  if (a.overrides) {
    try {
      const list = JSON.parse(a.overrides);
      if (!Array.isArray(list)) throw new Error('not a list');
      c.overrides = list;
      const own = list.find((o) => o && !o.at);
      if (own && Array.isArray(own.fade)) c.fade = [Math.max(0, +own.fade[0] || 0), Math.max(0, +own.fade[1] || 0)];
      if (kind !== 'page' && list.some((o) => o && o.at)) report(at0, 'overrides 里带 at 的条目只对页面片段有效');
    } catch {
      report(at0, 'overrides 不是合法的 JSON 列表');
    }
  }
  for (const { name } of t.attrs) {
    if (!KNOWN_ATTRS.has(name) && !name.startsWith('data-') && !name.startsWith('aria-')) {
      report(at0, `<${t.name}> 上不认识的属性 "${name}"`);
    }
  }
  const base = c.file.split('/').pop() || t.name;
  c.id = c.explicitId || base.replace(/\.[^.]+$/, '');
  return c;
}

// ---------------------------------------------------------------- 时间

// 片段在影片上的时长（秒）。srcDur 是文件自身的长度；都不知道时返回 null。
export function clipLength(c, srcDur) {
  const out = c.out ?? (Number.isFinite(srcDur) ? srcDur : null);
  if (out == null) return null;
  const sp = c.kind === 'video' || c.kind === 'audio' ? c.speed : 1;
  return r3(Math.max(0, out - c.in) / sp);
}

export function filmDuration(doc, lengths = {}) {
  let end = 0;
  for (const c of doc.clips) {
    const len = lengths[c.key] ?? clipLength(c, null) ?? 0;
    end = Math.max(end, c.at + len);
  }
  return r3(end);
}

// 同一轨道上重叠的片段（规范不允许）。返回 [[a, b], …]
export function findOverlaps(doc, lengths = {}) {
  const out = [];
  for (const tr of doc.tracks) {
    const list = tr.clips
      .map((c) => ({ c, s: c.at, e: c.at + (lengths[c.key] ?? clipLength(c, null) ?? 0) }))
      .sort((x, y) => x.s - y.s);
    for (let i = 1; i < list.length; i++) {
      if (list[i].s < list[i - 1].e - 0.001) out.push([list[i - 1].c, list[i].c]);
    }
  }
  return out;
}

// ---------------------------------------------------------------- 改写

const quote = (v) => {
  if (!v.includes('"')) return `"${v.replace(/&/g, '&amp;')}"`;
  if (!v.includes("'")) return `'${v.replace(/&/g, '&amp;')}'`;
  return `"${v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`;
};

export function serializeTag(name, attrs) {
  const parts = attrs.map((a) => (a.value == null ? a.name : `${a.name}=${quote(String(a.value))}`));
  return `<${name}${parts.length ? ` ${parts.join(' ')}` : ''}>`;
}

const elementText = (name, attrs) => serializeTag(name, attrs) + (VOID.has(name) ? '' : `</${name}>`);

function setAttr(attrs, name, value) {
  const i = attrs.findIndex((a) => a.name === name);
  if (value === undefined) {
    if (i >= 0) attrs.splice(i, 1);
  } else if (i >= 0) attrs[i] = { name, value };
  else attrs.push({ name, value });
}

export function applyEdits(text, edits) {
  let out = text;
  for (const e of [...edits].sort((x, y) => y.start - x.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

const fragment = (i, o) => (o != null ? `#t=${fmt(i)},${fmt(o)}` : i > 0 ? `#t=${fmt(i)}` : '');

function styleText(box, look) {
  const parts = [];
  for (const p of ['left', 'top', 'width', 'height']) if (box[p] != null) parts.push(`${p}: ${px(box[p])}`);
  if (box.rotate) parts.push(`rotate: ${Math.round(box.rotate * 100) / 100}deg`);
  if (look) parts.push(look);
  return parts.join('; ');
}

// 把 patch 合到片段上，返回新的属性表。patch 可含：
// in out at speed volume disabled id fade:[in,out] box:{left,top,width,height,rotate} look
function patchedAttrs(c, patch = {}) {
  const v = {
    in: c.in, out: c.out, at: c.at, speed: c.speed, volume: c.volume, disabled: c.disabled,
    fade: [...c.fade], look: c.look, ...patch, box: { ...c.box, ...(patch.box || {}) },
  };
  const attrs = c.attrs.map((a) => ({ ...a }));
  setAttr(attrs, 'src', c.file + fragment(Math.max(0, v.in), v.out));
  if (patch.id) setAttr(attrs, 'id', patch.id);
  setAttr(attrs, 'at', v.at > 0 ? fmt(v.at) : undefined);
  if (c.kind === 'video' || c.kind === 'audio') {
    setAttr(attrs, 'speed', r3(v.speed) !== 1 ? fmt(v.speed) : undefined);
    if (patch.volume !== undefined) {
      setAttr(attrs, 'muted', undefined);
      setAttr(attrs, 'volume', r3(v.volume) !== 1 ? fmt(v.volume) : undefined);
    }
  }
  setAttr(attrs, 'disabled', v.disabled ? null : undefined);
  const st = styleText(v.box, v.look);
  setAttr(attrs, 'style', st || undefined);
  if (patch.fade || patch.elements) {
    const list = patch.elements ? [...patch.elements] : c.overrides.filter((o) => o && o.at);
    const own = { ...(c.overrides.find((o) => o && !o.at) || {}) };
    if (v.fade[0] > 0 || v.fade[1] > 0) own.fade = [r3(v.fade[0]), r3(v.fade[1])];
    else delete own.fade;
    if (Object.keys(own).length) list.push(own);
    setAttr(attrs, 'overrides', list.length ? JSON.stringify(list) : undefined);
  }
  return attrs;
}

const findClip = (doc, key) => doc.clips.find((c) => c.key === key);

// 整行只剩这个元素时，连同那一行一起删
function lineRange(text, start, end) {
  let s = start;
  while (s > 0 && (text[s - 1] === ' ' || text[s - 1] === '\t')) s--;
  let e = end;
  while (e < text.length && (text[e] === ' ' || text[e] === '\t')) e++;
  if ((s === 0 || text[s - 1] === '\n') && (e >= text.length || text[e] === '\n' || text[e] === '\r')) {
    if (text[e] === '\r') e++;
    if (text[e] === '\n') e++;
    return [s, e];
  }
  return [start, end];
}

function insertionInto(text, track, element) {
  const before = text.slice(track.openEnd, track.closeStart);
  const lead = /\n[ \t]*$/.test(before) || before.trim() === '' ? '' : '\n';
  const prefix = before.trim() === '' && !before.includes('\n') ? '\n' : lead;
  return { start: track.closeStart, end: track.closeStart, text: `${prefix}  ${element}\n` };
}

export function updateClip(text, key, patch) {
  const c = findClip(parseFilm(text), key);
  if (!c) return text;
  return applyEdits(text, [{ start: c.tagStart, end: c.tagEnd, text: serializeTag(c.tag, patchedAttrs(c, patch)) }]);
}

export function removeClip(text, key) {
  const c = findClip(parseFilm(text), key);
  if (!c) return text;
  const [s, e] = lineRange(text, c.elStart, c.elEnd);
  return applyEdits(text, [{ start: s, end: e, text: '' }]);
}

// 换轨道（可同时改时间等）
export function moveClip(text, key, toTrack, patch = {}) {
  const doc = parseFilm(text);
  const c = findClip(doc, key);
  const target = doc.tracks[toTrack];
  if (!c || !target) return text;
  if (c.track === toTrack) return updateClip(text, key, patch);
  const [s, e] = lineRange(text, c.elStart, c.elEnd);
  return applyEdits(text, [
    { start: s, end: e, text: '' },
    insertionInto(text, target, elementText(c.tag, patchedAttrs(c, patch))),
  ]);
}

const TAG_OF = { page: 'iframe', video: 'video', image: 'img', audio: 'audio' };

function uniqueId(doc, want) {
  const used = new Set(doc.clips.flatMap((c) => [c.uid, c.id]));
  if (!used.has(want)) return want;
  for (let i = 2; ; i++) if (!used.has(`${want}-${i}`)) return `${want}-${i}`;
}

// spec: { kind, file, in, out, at, speed, volume, box, id }
export function insertClip(text, trackIndex, spec) {
  const doc = parseFilm(text);
  const track = doc.tracks[trackIndex];
  if (!track) return text;
  const tag = TAG_OF[spec.kind];
  const base = (spec.file.split('/').pop() || tag).replace(/\.[^.]+$/, '');
  const attrs = [{ name: 'id', value: uniqueId(doc, spec.id || base) }];
  attrs.push({ name: 'src', value: spec.file + fragment(spec.in || 0, spec.out ?? null) });
  if (spec.at > 0) attrs.push({ name: 'at', value: fmt(spec.at) });
  if (spec.speed && spec.speed !== 1) attrs.push({ name: 'speed', value: fmt(spec.speed) });
  if (spec.volume != null && spec.volume !== 1) attrs.push({ name: 'volume', value: fmt(spec.volume) });
  const st = styleText({ left: null, top: null, width: null, height: null, rotate: null, ...(spec.box || {}) }, spec.look || '');
  if (st) attrs.push({ name: 'style', value: st });
  return applyEdits(text, [insertionInto(text, track, elementText(tag, attrs))]);
}

// 在影片时间 t 处把片段切成两段。length 是片段当前在影片上的时长。
export function splitClip(text, key, t, length) {
  const doc = parseFilm(text);
  const c = findClip(doc, key);
  if (!c || !(t > c.at + 0.02) || !(t < c.at + length - 0.02)) return text;
  const sp = c.kind === 'video' || c.kind === 'audio' ? c.speed : 1;
  const cut = r3(c.in + (t - c.at) * sp);
  const end = c.out ?? r3(c.in + length * sp);
  const first = serializeTag(c.tag, patchedAttrs(c, { out: cut, fade: [c.fade[0], 0], id: c.uid }));
  const second = elementText(c.tag, patchedAttrs(c, { in: cut, out: end, at: r3(t), fade: [0, c.fade[1]], id: uniqueId(doc, `${c.uid}-b`) }));
  const indent = /(^|\n)([ \t]*)$/.exec(text.slice(0, c.elStart))?.[2] ?? '  ';
  return applyEdits(text, [
    { start: c.tagStart, end: c.tagEnd, text: first },
    { start: c.elEnd, end: c.elEnd, text: `\n${indent}${second}` },
  ]);
}

export function addTrack(text, where = 'top') {
  const doc = parseFilm(text);
  const block = '<section>\n</section>\n';
  if (!doc.tracks.length) {
    const at = doc.bodyClose >= 0 ? doc.bodyClose : text.length;
    return applyEdits(text, [{ start: at, end: at, text: (at && text[at - 1] !== '\n' ? '\n' : '') + block }]);
  }
  if (where === 'top') {
    const at = doc.tracks[0].start;
    return applyEdits(text, [{ start: at, end: at, text: block }]);
  }
  const last = doc.tracks[doc.tracks.length - 1];
  return applyEdits(text, [{ start: last.end, end: last.end, text: `\n${block.trimEnd()}` }]);
}

export function removeTrack(text, index) {
  const tr = parseFilm(text).tracks[index];
  if (!tr) return text;
  const [s, e] = lineRange(text, tr.start, tr.end);
  return applyEdits(text, [{ start: s, end: e, text: '' }]);
}

export function setTrackFlag(text, index, flag, on) {
  const tr = parseFilm(text).tracks[index];
  if (!tr || !['hidden', 'muted', 'locked'].includes(flag)) return text;
  const attrs = tr.attrs.map((a) => ({ ...a }));
  setAttr(attrs, flag, on ? null : undefined);
  return applyEdits(text, [{ start: tr.start, end: tr.openEnd, text: serializeTag('section', attrs) }]);
}

export function setStage(text, width, height) {
  const doc = parseFilm(text);
  const tag = `<meta name="viewport" content="width=${width}, height=${height}">`;
  if (doc.viewport) return applyEdits(text, [{ ...doc.viewport, text: tag }]);
  const at = doc.headClose >= 0 ? doc.headClose : 0;
  return applyEdits(text, [{ start: at, end: at, text: `${tag}\n` }]);
}

// 在片段的外观样式里设置（value 为 null 则删除）一个 CSS 属性
export function setLookProp(look, prop, value) {
  const list = parseStyle(look).filter(([p]) => p !== prop);
  if (value != null && value !== '') list.push([prop, String(value)]);
  return list.map(([p, v]) => `${p}: ${v}`).join('; ');
}
export const getLookProp = (look, prop) => parseStyle(look).find(([p]) => p === prop)?.[1] ?? null;

// 在同一条轨道上紧跟原片段插入一份副本（新 id），patch 可改它的时间等
export function duplicateClip(text, key, patch = {}) {
  const doc = parseFilm(text);
  const c = findClip(doc, key);
  if (!c) return text;
  const copy = elementText(c.tag, patchedAttrs(c, { ...patch, id: uniqueId(doc, `${c.uid}-copy`) }));
  const indent = /(^|\n)([ \t]*)$/.exec(text.slice(0, c.elStart))?.[2] ?? '  ';
  return applyEdits(text, [{ start: c.elEnd, end: c.elEnd, text: `\n${indent}${copy}` }]);
}

// 改页面片段里某个元素的覆盖项（at 是 CSS 选择器）。patch 里值为 null 的键被删除；
// style 逐属性合并。覆盖项被删空时整条去掉。patch 为 null 则去掉这个元素的全部覆盖。
export function setElementOverride(text, key, at, patch) {
  const c = findClip(parseFilm(text), key);
  if (!c || c.kind !== 'page') return text;
  const list = c.overrides.filter((o) => o && o.at).map((o) => ({ ...o }));
  let entry = list.find((o) => o.at === at);
  if (!entry) {
    entry = { at };
    list.push(entry);
  }
  if (patch === null) for (const k of Object.keys(entry)) if (k !== 'at') delete entry[k];
  for (const [k, v] of Object.entries(patch || {})) {
    if (k === 'style' && v) {
      const style = { ...(entry.style || {}) };
      for (const [p, val] of Object.entries(v)) {
        if (val == null || val === '') delete style[p];
        else style[p] = val;
      }
      if (Object.keys(style).length) entry.style = style;
      else delete entry.style;
    } else if (v == null) delete entry[k];
    else entry[k] = v;
  }
  if (entry.t && !entry.t[0] && !entry.t[1]) delete entry.t;
  if (entry.s === 1) delete entry.s;
  if (entry.r === 0) delete entry.r;
  const elements = list.filter((o) => Object.keys(o).some((k) => k !== 'at' && k !== 'n'));
  return applyEdits(text, [{ start: c.tagStart, end: c.tagEnd, text: serializeTag(c.tag, patchedAttrs(c, { elements })) }]);
}

export function kindOfFile(file) {
  const ext = (file.split('.').pop() || '').toLowerCase();
  if (['html', 'htm'].includes(ext)) return 'page';
  if (['mp4', 'mov', 'webm', 'm4v', 'mkv'].includes(ext)) return 'video';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif'].includes(ext)) return 'image';
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus'].includes(ext)) return 'audio';
  return null;
}

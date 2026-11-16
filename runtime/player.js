// 播放器：把 film.html 合成到舞台上，并能画出任意时刻 t 的完整画面。
// 预览（IDE 里的 iframe）与无头渲染（?render）共用这一份代码，所以预览即导出。
import { parseFilm, clipLength, r3 } from './doc.mjs';
import { parseVtt } from './vtt.mjs';

const query = new URLSearchParams(location.search);
const FILM = query.get('film') || 'film.html';
const RENDER = query.has('render');
const base = new URL(`/${FILM}`, location.origin);
const $ = (s) => document.querySelector(s);
const stage = $('#stage');
const fit = $('#fit');
const glass = $('#glass');
const sel = $('#sel');
const msg = $('#msg');
const filmCss = $('#film-css');
if (RENDER) document.body.classList.add('render');
if (query.has('alpha')) {
  document.body.classList.add('alpha');
  document.documentElement.style.background = 'transparent';
}
if (query.get('theme')) document.body.dataset.theme = query.get('theme');

const state = {
  text: '', doc: null, clips: [], captions: [], duration: 0, t: Number(query.get('t')) || 0,
  playing: false, errors: [], selected: null, volume: 1, scale: 1, offX: 0, offY: 0,
  pick: null, // 页面里被选中的元素：{ uid, at }
};
let loadGen = 0;
let pageVersion = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const post = (type, data = {}) => {
  if (window.parent !== window) window.parent.postMessage({ source: 'cutforge-player', type, ...data }, '*');
};

function pushError(e) {
  if (state.errors.some((x) => x.file === e.file && x.message === e.message)) return;
  state.errors.push(e);
  post('errors', { errors: state.errors });
}
window.__cfPageError = (file, message, line) => pushError({ file, message, line });

// ---------------------------------------------------------------- 建片段

function fail(rc, message) {
  rc.failed = true;
  pushError({ file: rc.clip.file, message, line: 0 });
}

function mediaReady(rc, m, event) {
  return new Promise((resolve) => {
    const done = () => {
      rc.srcDur = Number.isFinite(m.duration) ? m.duration : null;
      rc.natW = m.videoWidth || 0;
      rc.natH = m.videoHeight || 0;
      resolve();
    };
    m.addEventListener(event, done, { once: true });
    m.addEventListener('error', () => {
      fail(rc, `${rc.kind === 'video' ? '视频' : '声音'}加载失败（文件不存在或浏览器不支持这种编码）`);
      resolve();
    }, { once: true });
    setTimeout(resolve, 20000);
  });
}

async function loadPage(rc) {
  const f = rc.frame;
  const c = rc.clip;
  const w = c.size?.width || state.doc.width;
  const h = c.size?.height || state.doc.height;
  rc.film = null;
  rc.failed = false;
  f.style.width = `${w}px`;
  f.style.height = `${h}px`;
  const url = new URL(c.file, base);
  try {
    const head = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (!head.ok) return fail(rc, '页面文件不存在');
  } catch {
    return fail(rc, '页面文件读不到');
  }
  url.searchParams.set('v', String(++pageVersion));
  const loaded = new Promise((resolve) => f.addEventListener('load', resolve, { once: true }));
  f.src = url.href;
  await Promise.race([loaded, sleep(20000)]);
  const win = f.contentWindow;
  const deadline = performance.now() + 10000;
  while (!(win.film && typeof win.film.frame === 'function') && performance.now() < deadline) await sleep(25);
  if (!win.film || typeof win.film.frame !== 'function') return fail(rc, '页面没有设置 window.film = { frame(t) { … } }');
  try {
    await (typeof win.film.ready === 'function' ? win.film.ready() : win.film.ready);
  } catch (e) {
    pushError({ file: c.file, message: `ready 失败：${e && e.message}`, line: 0 });
  }
  rc.film = win.film;
  rc.natW = win.film.width || w;
  rc.natH = win.film.height || h;
  f.style.width = `${rc.natW}px`;
  f.style.height = `${rc.natH}px`;
  rc.srcDur = Number.isFinite(win.film.duration) && win.film.duration > 0 ? win.film.duration : null;
}

function createClip(c, sig) {
  const outer = document.createElement('div');
  outer.className = 'cf-clip';
  const rc = { sig, clip: c, kind: c.kind, outer, inner: null, media: null, frame: null, film: null, srcDur: null, natW: 0, natH: 0, failed: false, length: 0, rect: null, ready: null };
  const url = new URL(c.file, base).href;
  if (c.kind === 'image') {
    const img = new Image();
    img.draggable = false;
    rc.inner = img;
    rc.ready = new Promise((resolve) => {
      img.onload = () => {
        rc.natW = img.naturalWidth;
        rc.natH = img.naturalHeight;
        resolve();
      };
      img.onerror = () => {
        fail(rc, '图片加载失败');
        resolve();
      };
    });
    img.src = url;
  } else if (c.kind === 'video') {
    const v = document.createElement('video');
    v.preload = 'auto';
    v.playsInline = true;
    v.muted = RENDER;
    rc.inner = rc.media = v;
    rc.ready = mediaReady(rc, v, 'loadeddata');
    v.src = url;
  } else if (c.kind === 'audio') {
    const a = new Audio();
    a.preload = 'auto';
    rc.media = a;
    rc.ready = RENDER ? Promise.race([mediaReady(rc, a, 'loadedmetadata'), sleep(8000)]) : mediaReady(rc, a, 'loadedmetadata');
    a.src = url;
  } else {
    const box = document.createElement('div');
    const f = document.createElement('iframe');
    f.setAttribute('scrolling', 'no');
    box.append(f);
    rc.inner = box;
    rc.frame = f;
    outer.append(box);
    stage.append(outer);
    rc.ready = loadPage(rc);
    return rc;
  }
  if (rc.inner) {
    outer.append(rc.inner);
    stage.append(outer);
  }
  return rc;
}

function destroyClip(rc) {
  if (rc.media) {
    rc.media.pause();
    rc.media.removeAttribute('src');
    rc.media.load?.();
  }
  rc.outer.remove();
}

function applyLook(rc) {
  if (!rc.inner) return;
  const c = rc.clip;
  rc.inner.className = `cf-inner${rc.kind === 'page' ? ' cf-page' : ''}${c.cls ? ` ${c.cls}` : ''}`;
  rc.inner.style.cssText = c.look;
  rc.inner.style.setProperty('--clip-length', `${rc.length}s`);
}

// 规范 §1：位置只来自 left/top/width/height/rotate
function layout(rc) {
  if (!rc.inner) return;
  const { width: W, height: H, tracks } = state.doc;
  const b = rc.clip.box;
  const nw = rc.natW || W;
  const nh = rc.natH || H;
  let { left, top, width: w, height: h } = b;
  const boxed = left != null || top != null || w != null || h != null;
  if (w == null && h == null) {
    w = nw;
    h = nh;
  } else if (w == null) w = (h * nw) / nh;
  else if (h == null) h = (w * nh) / nw;
  if (rc.kind === 'page') {
    left ??= (W - w) / 2;
    top ??= (H - h) / 2;
    const s = Math.min(w / nw, h / nh);
    rc.frame.style.transform = `scale(${s})`;
    rc.frame.style.left = `${(w - nw * s) / 2}px`;
    rc.frame.style.top = `${(h - nh * s) / 2}px`;
    rc.fit = { s, ox: (w - nw * s) / 2, oy: (h - nh * s) / 2 };
  } else if (!boxed) {
    left = 0;
    top = 0;
    w = W;
    h = H;
  } else {
    left ??= 0;
    top ??= 0;
  }
  rc.rect = { left, top, width: w, height: h, rotate: b.rotate || 0 };
  const st = rc.outer.style;
  st.left = `${left}px`;
  st.top = `${top}px`;
  st.width = `${w}px`;
  st.height = `${h}px`;
  st.rotate = b.rotate ? `${b.rotate}deg` : '';
  st.zIndex = String(tracks.length - rc.clip.track);
}

// ---------------------------------------------------------------- 载入

async function loadFilm(text) {
  const gen = ++loadGen;
  const doc = parseFilm(text);
  state.text = text;
  state.doc = doc;
  stage.style.width = `${doc.width}px`;
  stage.style.height = `${doc.height}px`;
  filmCss.textContent = doc.css;
  document.querySelectorAll('link[data-film]').forEach((l) => l.remove());
  for (const href of doc.links) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.dataset.film = '1';
    l.href = new URL(href, base).href;
    document.head.append(l);
  }
  fitStage();

  const old = new Map(state.clips.map((rc) => [rc.sig, rc]));
  const next = [];
  for (const c of doc.clips) {
    const sig = [c.uid, c.tag, c.file, c.size ? `${c.size.width}x${c.size.height}` : ''].join('|');
    let rc = old.get(sig);
    if (rc) {
      old.delete(sig);
      rc.clip = c;
    } else rc = createClip(c, sig);
    next.push(rc);
  }
  for (const rc of old.values()) destroyClip(rc);
  state.clips = next;
  await Promise.all(next.map((rc) => rc.ready));
  if (gen !== loadGen) return;

  let end = 0;
  for (const rc of next) {
    const len = clipLength(rc.clip, rc.srcDur);
    if (len == null && !rc.failed) {
      pushError({ file: rc.clip.file, message: '不知道这个片段多长：给它写上 #t=0,秒数（页面也可以设置 film.duration）', line: 0 });
    }
    rc.length = len ?? 0;
    end = Math.max(end, rc.clip.at + rc.length);
    applyLook(rc);
    layout(rc);
  }
  state.duration = r3(end);

  stage.querySelectorAll('.cf-caption').forEach((n) => n.remove());
  state.captions = [];
  for (const tr of doc.tracks) {
    if (!tr.caption) continue;
    const node = document.createElement('div');
    node.className = 'cf-caption';
    node.style.zIndex = String(doc.tracks.length - tr.index);
    node.style.fontSize = `${Math.round(doc.height * 0.042)}px`;
    stage.append(node);
    const cap = { track: tr, node, cues: [] };
    state.captions.push(cap);
    try {
      const res = await fetch(new URL(tr.caption.file, base), { cache: 'no-store' });
      if (!res.ok) throw new Error('404');
      cap.cues = parseVtt(await res.text());
    } catch {
      pushError({ file: tr.caption.file, message: '字幕文件读不到', line: 0 });
    }
  }
  if (gen !== loadGen) return;

  msg.style.display = doc.clips.length ? 'none' : 'flex';
  msg.textContent = doc.clips.length ? '' : '这部影片还是空的。\n在右侧让智能体做一部，或把素材从文件栏拖到时间线上。';
  state.t = clamp(state.t, 0, state.duration);
  await enqueue(() => draw(state.t, true));
  postInfo();
}

function postInfo() {
  post('info', info());
  postPick();
  post('time', { t: state.t, playing: state.playing });
}

function info() {
  const clips = {};
  for (const rc of state.clips) {
    clips[rc.clip.key] = { uid: rc.clip.uid, length: rc.length, srcDur: rc.srcDur, failed: rc.failed, natW: rc.natW, natH: rc.natH, rect: rc.rect };
  }
  return { duration: state.duration, width: state.doc.width, height: state.doc.height, clips, errors: state.errors };
}

function fitStage() {
  if (!state.doc) return;
  const { width: W, height: H } = state.doc;
  if (RENDER) {
    state.scale = 1;
    state.offX = state.offY = 0;
  } else {
    const pad = 16;
    state.scale = Math.min((innerWidth - pad * 2) / W, (innerHeight - pad * 2) / H);
    state.offX = (innerWidth - W * state.scale) / 2;
    state.offY = (innerHeight - H * state.scale) / 2;
  }
  fit.style.transform = `translate(${state.offX}px, ${state.offY}px) scale(${state.scale})`;
  drawSelection();
}
addEventListener('resize', fitStage);

// ---------------------------------------------------------------- 画一帧

let chain = Promise.resolve();
const enqueue = (fn) => {
  chain = chain.then(fn, fn);
  return chain;
};

function holdAnimations(target, seconds) {
  for (const a of target.getAnimations()) {
    if (a.playState !== 'paused') a.pause();
    a.currentTime = seconds * 1000;
  }
}

// ---- 页面内元素的覆盖（overrides 里带 at 的条目）
// 每帧：先把上一帧写进去的还原，让页面按自己的状态画；画完读出它的结果，再叠上人的修改。
// 这样无论页面是否每帧重写这些属性，人的修改都不会累加或丢失。
function restoreOverrides(rc) {
  for (const undo of rc.undo || []) undo();
  rc.undo = [];
}

const kebab = (k) => (k.startsWith('--') ? k : k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`));

function ownTextNode(el) {
  const kids = [...el.children].filter((c) => c.tagName !== 'BR');
  if (!kids.length) return { all: true };
  for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue.trim()) return { node: n };
  return null;
}

function findTarget(rc, o) {
  try {
    return rc.frame.contentDocument.querySelectorAll(o.at)[(o.n || 1) - 1] || null;
  } catch {
    return null;
  }
}

function applyOverrides(rc) {
  const win = rc.frame.contentWindow;
  rc.undo = [];
  for (const o of rc.clip.overrides) {
    if (!o || !o.at) continue;
    const el = findTarget(rc, o);
    if (!el) continue;
    const st = el.style;
    const cs = win.getComputedStyle(el);
    const set = (prop, value) => {
      const old = st.getPropertyValue(prop);
      const pri = st.getPropertyPriority(prop);
      rc.undo.push(() => (old ? st.setProperty(prop, old, pri) : st.removeProperty(prop)));
      st.setProperty(prop, value, 'important');
    };
    if (o.t) {
      const cur = cs.translate === 'none' ? [] : cs.translate.split(' ');
      set('translate', `calc(${cur[0] || '0px'} + ${o.t[0] || 0}px) calc(${cur[1] || '0px'} + ${o.t[1] || 0}px)`);
    }
    if (o.s != null) {
      const cur = cs.scale === 'none' ? [1, 1] : cs.scale.split(' ').map(Number);
      set('scale', `${(cur[0] || 1) * o.s} ${(cur[1] ?? cur[0] ?? 1) * o.s}`);
    }
    if (o.r != null) set('rotate', `${(cs.rotate === 'none' ? 0 : Number.parseFloat(cs.rotate) || 0) + o.r}deg`);
    for (const [k, v] of Object.entries(o.style || {})) set(kebab(k), String(v));
    if (typeof o.text === 'string') {
      const own = ownTextNode(el);
      if (own?.all) {
        const html = el.innerHTML;
        rc.undo.push(() => { el.innerHTML = html; });
        el.textContent = '';
        o.text.split('\n').forEach((line, i) => {
          if (i) el.append(win.document.createElement('br'));
          el.append(line);
        });
      } else if (own?.node) {
        const old = own.node.nodeValue;
        rc.undo.push(() => { own.node.nodeValue = old; });
        own.node.nodeValue = o.text;
      }
    }
  }
}

async function drawPage(rc, t) {
  const win = rc.frame.contentWindow;
  if (!rc.film || !win) return;
  const pt = rc.srcDur ? Math.min(t, rc.srcDur) : t;
  try {
    restoreOverrides(rc);
    win.filmHost?.time(pt);
    await rc.film.frame(pt);
    holdAnimations(win.document, pt);
    applyOverrides(rc);
  } catch (e) {
    pushError({ file: rc.clip.file, message: `frame(${pt.toFixed(2)}) 出错：${e && e.message}`, line: 0 });
  }
}

function seekVideo(v, t) {
  return new Promise((resolve) => {
    let presented = false;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => { presented = true; });
    v.addEventListener('seeked', () => {
      if (presented || !RENDER || !v.requestVideoFrameCallback) return finish();
      v.requestVideoFrameCallback(finish);
      setTimeout(finish, 120);
    }, { once: true });
    v.currentTime = t;
    setTimeout(finish, 4000);
  });
}

function syncMedia(rc, srcT, gain, exact) {
  const m = rc.media;
  const c = rc.clip;
  const track = state.doc.tracks[c.track];
  const vol = RENDER || track.muted ? 0 : clamp(c.volume * gain * state.volume, 0, 1);
  m.volume = vol;
  m.muted = RENDER || vol === 0;
  const target = clamp(srcT, 0, Math.max(0, (rc.srcDur ?? srcT) - 0.001));
  if (state.playing && !exact) {
    m.playbackRate = clamp(c.speed, 0.1, 16);
    if (m.paused) {
      m.currentTime = target;
      m.play().catch(() => {
        m.muted = true;
        m.play().catch(() => {});
      });
    } else if (Math.abs(m.currentTime - target) > 0.3 * Math.max(1, c.speed)) m.currentTime = target;
    return null;
  }
  if (!m.paused) m.pause();
  if (rc.kind === 'audio') return null;
  if (Math.abs(m.currentTime - target) < 0.0005 && m.readyState >= 2 && !m.seeking) return null;
  return seekVideo(m, target);
}

async function draw(t, exact) {
  const doc = state.doc;
  if (!doc) return;
  const tt = clamp(t, 0, Math.max(0, state.duration - 0.001));
  const jobs = [];
  for (const rc of state.clips) {
    const c = rc.clip;
    const track = doc.tracks[c.track];
    const on = !c.disabled && !track.hidden && !rc.failed && rc.length > 0 && tt >= c.at - 1e-6 && tt < c.at + rc.length - 1e-6;
    if (rc.inner) rc.outer.style.display = on ? 'block' : 'none';
    if (!on) {
      if (rc.media && !rc.media.paused) rc.media.pause();
      continue;
    }
    const local = tt - c.at;
    const speed = rc.media ? c.speed : 1;
    const srcT = c.in + local * speed;
    const [fi, fo] = c.fade;
    let gain = 1;
    if (fi > 0 && local < fi) gain = local / fi;
    if (fo > 0 && local > rc.length - fo) gain = Math.min(gain, Math.max(0, (rc.length - local) / fo));
    if (rc.inner) {
      rc.outer.style.opacity = gain === 1 ? '' : String(gain);
      holdAnimations(rc.inner, local);
    }
    if (rc.kind === 'page') jobs.push(drawPage(rc, srcT));
    else if (rc.media) jobs.push(syncMedia(rc, srcT, gain, exact));
  }
  for (const cap of state.captions) {
    const cue = cap.track.hidden ? null : cap.cues.find((q) => tt >= q.start && tt < q.end);
    const text = cue ? cue.text : '';
    if (cap.node.textContent !== text) cap.node.textContent = text;
    cap.node.style.display = text ? 'block' : 'none';
  }
  await Promise.all(jobs);
  drawSelection();
}

// ---------------------------------------------------------------- 播放

let clock0 = 0;
let t0 = 0;
let drawing = false;
let lastPost = 0;

function play() {
  if (state.playing || !state.duration) return;
  if (state.t >= state.duration - 0.03) state.t = 0;
  state.playing = true;
  clock0 = performance.now();
  t0 = state.t;
  post('time', { t: state.t, playing: true });
  requestAnimationFrame(tick);
}

function pause() {
  if (!state.playing) return;
  state.playing = false;
  for (const rc of state.clips) if (rc.media && !rc.media.paused) rc.media.pause();
  enqueue(() => draw(state.t, true)).then(() => post('time', { t: state.t, playing: false }));
}

function tick(now) {
  if (!state.playing) return;
  const t = t0 + (now - clock0) / 1000;
  if (t >= state.duration) {
    state.t = state.duration;
    pause();
    return;
  }
  state.t = t;
  if (!drawing) {
    drawing = true;
    enqueue(() => draw(t, false)).finally(() => { drawing = false; });
  }
  if (now - lastPost > 33) {
    lastPost = now;
    post('time', { t, playing: true });
  }
  requestAnimationFrame(tick);
}

// 拖动播放头：只画最后一次要求的时刻
let scrubWant = null;
let scrubbing = false;
async function scrub(t) {
  scrubWant = clamp(t, 0, state.duration);
  if (scrubbing) return;
  scrubbing = true;
  while (scrubWant != null) {
    const want = scrubWant;
    scrubWant = null;
    state.t = want;
    await enqueue(() => draw(want, true));
    post('time', { t: want, playing: false });
  }
  scrubbing = false;
}

// ---------------------------------------------------------------- 选中与拖动（仅预览）

function drawSelection() {
  if (RENDER) return;
  const pk = state.pick && state.clips.find((x) => x.clip.uid === state.pick.uid);
  const target = pk && pk.rect && pk.fit && pk.outer.style.display !== 'none' ? findTarget(pk, state.pick) : null;
  sel.className = target ? 'el' : '';
  if (target) {
    const r = target.getBoundingClientRect();
    const { s, ox, oy } = pk.fit;
    const k = state.scale;
    sel.style.display = 'block';
    sel.style.left = `${state.offX + (pk.rect.left + ox + r.left * s) * k - 3}px`;
    sel.style.top = `${state.offY + (pk.rect.top + oy + r.top * s) * k - 3}px`;
    sel.style.width = `${r.width * s * k + 6}px`;
    sel.style.height = `${r.height * s * k + 6}px`;
    sel.style.rotate = '';
    return;
  }
  const rc = state.clips.find((x) => x.clip.key === state.selected);
  if (!rc || !rc.rect || !rc.inner || rc.outer.style.display === 'none') {
    sel.style.display = 'none';
    return;
  }
  const r = rc.rect;
  const s = state.scale;
  sel.style.display = 'block';
  sel.style.left = `${state.offX + r.left * s}px`;
  sel.style.top = `${state.offY + r.top * s}px`;
  sel.style.width = `${r.width * s}px`;
  sel.style.height = `${r.height * s}px`;
  sel.style.rotate = r.rotate ? `${r.rotate}deg` : '';
}

const toStage = (e) => ({ x: (e.clientX - state.offX) / state.scale, y: (e.clientY - state.offY) / state.scale });

function hit(p) {
  const list = state.clips
    .filter((rc) => rc.inner && rc.rect && rc.outer.style.display !== 'none' && !state.doc.tracks[rc.clip.track].locked)
    .sort((a, b) => a.clip.track - b.clip.track);
  for (const rc of list) {
    const r = rc.rect;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const a = (-r.rotate * Math.PI) / 180;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const x = dx * Math.cos(a) - dy * Math.sin(a);
    const y = dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(x) <= r.width / 2 && Math.abs(y) <= r.height / 2) return rc;
  }
  return null;
}

function startDrag(e, rc, handle) {
  e.preventDefault();
  const start = toStage(e);
  const r0 = { ...rc.rect };
  let moved = false;
  const onMove = (ev) => {
    const p = toStage(ev);
    const dx = p.x - start.x;
    const dy = p.y - start.y;
    if (!moved && Math.hypot(dx, dy) * state.scale < 3) return;
    moved = true;
    const box = { left: r0.left, top: r0.top, width: r0.width, height: r0.height };
    if (!handle) {
      box.left = r0.left + dx;
      box.top = r0.top + dy;
    } else {
      const sx = handle.includes('e') ? 1 : -1;
      const sy = handle.includes('s') ? 1 : -1;
      let w = Math.max(16, r0.width + sx * dx);
      let h = Math.max(16, r0.height + sy * dy);
      if (!ev.shiftKey) {
        const k = Math.max(w / r0.width, h / r0.height);
        w = r0.width * k;
        h = r0.height * k;
      }
      box.width = w;
      box.height = h;
      if (sx < 0) box.left = r0.left + r0.width - w;
      if (sy < 0) box.top = r0.top + r0.height - h;
    }
    for (const k of Object.keys(box)) box[k] = Math.round(box[k]);
    Object.assign(rc.clip.box, box);
    layout(rc);
    drawSelection();
  };
  const onUp = () => {
    removeEventListener('pointermove', onMove);
    removeEventListener('pointerup', onUp);
    if (moved) {
      const { left, top, width, height } = rc.clip.box;
      post('geom', { key: rc.clip.key, box: { left, top, width, height } });
    }
  };
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
}

// ---- 页面里的元素：双击进入，之后在同一个页面里单击换选、拖动移动
function selectorFor(el) {
  const doc = el.ownerDocument;
  const esc = doc.defaultView.CSS.escape;
  const parts = [];
  for (let n = el; n && n !== doc.body && n.nodeType === 1; n = n.parentElement) {
    if (n.id && doc.querySelectorAll(`#${esc(n.id)}`).length === 1) return [`#${esc(n.id)}`, ...parts].join(' > ');
    const tag = n.tagName.toLowerCase();
    const same = [...n.parentElement.children].filter((c) => c.tagName === n.tagName);
    parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(n) + 1})` : tag);
  }
  return ['body', ...parts].join(' > ');
}

function elementAt(rc, p) {
  if (!rc.fit || !rc.film) return null;
  const doc = rc.frame.contentDocument;
  const x = (p.x - rc.rect.left - rc.fit.ox) / rc.fit.s;
  const y = (p.y - rc.rect.top - rc.fit.oy) / rc.fit.s;
  return doc.elementsFromPoint(x, y).find((el) => el !== doc.documentElement && el !== doc.body) || null;
}

function postPick() {
  if (!state.pick) return;
  const rc = state.clips.find((x) => x.clip.uid === state.pick.uid);
  const el = rc && rc.film ? findTarget(rc, state.pick) : null;
  if (!el) {
    state.pick = null;
    return post('pick', { pick: null });
  }
  const cs = rc.frame.contentWindow.getComputedStyle(el);
  const own = ownTextNode(el);
  post('pick', { pick: {
    uid: rc.clip.uid, at: state.pick.at, tag: el.tagName.toLowerCase(), editable: !!own,
    text: own?.all ? el.innerText : own?.node ? own.node.nodeValue : '', color: cs.color, fontSize: Math.round(Number.parseFloat(cs.fontSize) * 10) / 10,
  } });
}

function setPick(rc, el) {
  if (!rc || !el) {
    if (state.pick) post('pick', { pick: null });
    state.pick = null;
  } else {
    state.pick = { uid: rc.clip.uid, at: selectorFor(el) };
    postPick();
  }
  drawSelection();
}

function startElementDrag(e, rc) {
  e.preventDefault();
  const at = state.pick.at;
  const start = toStage(e);
  let entry = rc.clip.overrides.find((o) => o && o.at === at);
  const t0 = entry?.t ? [...entry.t] : [0, 0];
  let moved = false;
  const onMove = (ev) => {
    const p = toStage(ev);
    const dx = (p.x - start.x) / rc.fit.s;
    const dy = (p.y - start.y) / rc.fit.s;
    if (!moved && Math.hypot(dx, dy) * rc.fit.s * state.scale < 3) return;
    moved = true;
    if (!entry) {
      entry = { at };
      rc.clip.overrides.push(entry);
    }
    entry.t = [Math.round(t0[0] + dx), Math.round(t0[1] + dy)];
    enqueue(() => draw(state.t, true));
  };
  const onUp = () => {
    removeEventListener('pointermove', onMove);
    removeEventListener('pointerup', onUp);
    if (moved) post('elmove', { uid: rc.clip.uid, at, t: entry.t });
  };
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
}

if (!RENDER) {
  glass.addEventListener('dblclick', (e) => {
    if (state.playing) return;
    const p = toStage(e);
    const rc = hit(p);
    const el = rc && rc.kind === 'page' ? elementAt(rc, p) : null;
    if (!el) return;
    state.selected = rc.clip.key;
    post('select', { key: state.selected });
    setPick(rc, el);
    post('pick-edit');
  });
  glass.addEventListener('pointerdown', (e) => {
    if (state.playing) return;
    const at = toStage(e);
    const over = hit(at);
    if (state.pick && over && over.clip.uid === state.pick.uid) {
      const el = elementAt(over, at);
      setPick(over, el);
      if (el) startElementDrag(e, over);
      return;
    }
    if (state.pick) setPick(null);
    const rc = over;
    state.selected = rc ? rc.clip.key : null;
    drawSelection();
    post('select', { key: state.selected });
    if (rc) startDrag(e, rc, null);
  });
  sel.addEventListener('pointerdown', (e) => {
    const h = e.target.dataset && e.target.dataset.h;
    const rc = state.clips.find((x) => x.clip.key === state.selected);
    if (h && rc) startDrag(e, rc, h);
  });
  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    post('key', { key: e.key, code: e.code, meta: e.metaKey || e.ctrlKey, shift: e.shiftKey });
    if (e.code === 'Space') e.preventDefault();
  });
}

// ---------------------------------------------------------------- 与 IDE 通信

async function reloadFiles(files) {
  state.errors = state.errors.filter((e) => files && !files.includes(e.file));
  post('errors', { errors: state.errors });
  const jobs = [];
  let rebuild = false;
  for (const rc of state.clips) {
    if (files && !files.includes(rc.clip.file)) continue;
    if (rc.kind === 'page') {
      rc.ready = loadPage(rc);
      jobs.push(rc.ready);
    } else {
      rc.sig = `stale-${Math.random()}`;
      rebuild = true;
    }
  }
  await Promise.all(jobs);
  if (rebuild || jobs.length) await loadFilm(state.text);
}

addEventListener('message', (e) => {
  if (e.source !== window.parent || !e.data || e.data.target !== 'cutforge-player') return;
  const m = e.data;
  if (m.type === 'film') loadFilm(m.text);
  else if (m.type === 'reload') reloadFiles(m.files || null);
  else if (m.type === 'play') play();
  else if (m.type === 'pause') pause();
  else if (m.type === 'toggle') (state.playing ? pause : play)();
  else if (m.type === 'seek') {
    if (state.playing) pause();
    scrub(m.t);
  } else if (m.type === 'select') {
    state.selected = m.key;
    drawSelection();
  } else if (m.type === 'pick') {
    state.pick = m.uid && m.at ? { uid: m.uid, at: m.at } : null;
    drawSelection();
  } else if (m.type === 'volume') state.volume = clamp(m.value, 0, 1);
  else if (m.type === 'theme') document.body.dataset.theme = m.theme;
});

// ---------------------------------------------------------------- 检查用（look）

function audit() {
  const clipped = [];
  const fonts = [];
  for (const rc of state.clips) {
    if (rc.kind !== 'page' || !rc.film || rc.outer.style.display === 'none') continue;
    const win = rc.frame.contentWindow;
    const d = win.document;
    if (!d.body) continue;
    for (const f of d.fonts) if (f.status === 'error') fonts.push({ file: rc.clip.file, family: f.family });
    const walker = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT);
    const range = d.createRange();
    let n;
    while ((n = walker.nextNode())) {
      const text = n.nodeValue.trim();
      const el = n.parentElement;
      if (!text || !el || /^(SCRIPT|STYLE|NOSCRIPT|TITLE|TEMPLATE)$/.test(el.tagName)) continue;
      if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const inside = r.right > 0 && r.left < rc.natW && r.bottom > 0 && r.top < rc.natH;
      const cut = Math.max(-r.left, r.right - rc.natW, -r.top, r.bottom - rc.natH);
      if (inside && cut > 2) clipped.push({ file: rc.clip.file, text: text.slice(0, 40), cut: Math.round(cut) });
    }
  }
  return { clipped, fonts };
}

let resolveReady;
window.__cf = {
  ready: new Promise((r) => { resolveReady = r; }),
  info,
  audit,
  errors: () => state.errors,
  seek: (t) => enqueue(() => {
    state.t = t;
    return draw(t, true);
  }),
};

(async () => {
  try {
    const res = await fetch(`/${FILM}?raw=1`, { cache: 'no-store' });
    if (!res.ok) throw new Error('这个工程里还没有 film.html');
    await loadFilm(await res.text());
  } catch (e) {
    msg.style.display = 'flex';
    msg.textContent = String(e.message || e);
    pushError({ file: FILM, message: String(e.message || e), line: 0 });
  }
  resolveReady();
})();

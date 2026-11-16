// 生成内置素材库：转场、标题、特效（都是页面）、贴纸（SVG）、音效（ffmpeg 合成）。
// 全部是代码生成的，没有第三方版权。运行：node library/make.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const items = [];
const write = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(DIR, rel)), { recursive: true });
  fs.writeFileSync(path.join(DIR, rel), text);
};

// 页面骨架：透明背景、frame(t)、单独打开时自己播放
const page = ({ duration, css = '', body = '', script }) => `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; }
${css}
</style>
</head>
<body>
${body}
<script type="module">
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ease = (x) => 1 - Math.pow(1 - clamp01(x), 3);
const easeInOut = (x) => { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const D = ${duration};
${script}
window.film = { duration: D, frame };
if (!window.filmHost) {
  const t0 = performance.now();
  const loop = () => { frame(((performance.now() - t0) / 1000) % D); requestAnimationFrame(loop); };
  loop();
}
</script>
</body>
</html>
`;

const add = (cat, id, name, desc, file, extra = {}) => items.push({ id: `${cat}/${id}`, cat, name, desc, file, ...extra });

// ---------------------------------------------------------------- 转场（放在两个镜头的切点上方，盖住切点）
const T = 'transitions';
write(`${T}/flash.html`, page({ duration: 0.6, body: '<div id="f" style="position:absolute;inset:0;background:#fff"></div>', script: `function frame(t) { const k = t / D; f.style.opacity = k < 0.5 ? easeInOut(k * 2) : 1 - easeInOut((k - 0.5) * 2); }` }));
add(T, 'flash', '白闪', '一瞬间闪白，盖住切点', `${T}/flash.html`, { len: 0.6 });
write(`${T}/dip-black.html`, page({ duration: 0.8, body: '<div id="f" style="position:absolute;inset:0;background:#000"></div>', script: `function frame(t) { const k = t / D; f.style.opacity = k < 0.5 ? easeInOut(k * 2) : 1 - easeInOut((k - 0.5) * 2); }` }));
add(T, 'dip-black', '黑场过渡', '先暗下去再亮起来', `${T}/dip-black.html`, { len: 0.8 });
write(`${T}/wipe.html`, page({ duration: 0.8, css: '#a{position:absolute;inset:0;background:#5865f2}', body: '<div id="a"></div>', script: `function frame(t) { const k = easeInOut(t / D); const a = Math.min(1, k * 2), b = Math.max(0, k * 2 - 1); document.getElementById('a').style.clipPath = \`polygon(\${b * 100}% 0, \${a * 100}% 0, \${a * 100}% 100%, \${b * 100}% 100%)\`; }` }));
add(T, 'wipe', '色块擦除', '一块颜色从左扫到右，盖住切点（颜色可在属性里改）', `${T}/wipe.html`, { len: 0.8 });
write(`${T}/circle.html`, page({ duration: 1, css: '#c{position:absolute;inset:0;background:#000}', body: '<div id="c"></div>', script: `function frame(t) { const k = t / D; const r = k < 0.5 ? 75 * (1 - easeInOut(k * 2)) : 75 * easeInOut((k - 0.5) * 2); document.getElementById('c').style.clipPath = 'none'; document.getElementById('c').style.mask = \`radial-gradient(circle at 50% 50%, transparent \${r}%, #000 \${r + 0.5}%)\`; document.getElementById('c').style.webkitMask = document.getElementById('c').style.mask; }` }));
add(T, 'circle', '圆形收放', '画面收成一个圆再放开', `${T}/circle.html`, { len: 1 });
write(`${T}/stripes.html`, page({ duration: 0.9, css: '.s{position:absolute;top:0;bottom:0;width:20%;background:#111}', body: [0, 1, 2, 3, 4].map((i) => `<div class="s" style="left:${i * 20}%"></div>`).join(''), script: `const ss = [...document.querySelectorAll('.s')]; function frame(t) { ss.forEach((s, i) => { const k = (t - i * 0.06) / (D - 0.24); const v = k < 0.5 ? easeInOut(k * 2) : 1 - easeInOut((k - 0.5) * 2); s.style.transform = \`scaleY(\${clamp01(v)})\`; s.style.transformOrigin = i % 2 ? 'top' : 'bottom'; }); }` }));
add(T, 'stripes', '条纹切换', '五条竖条交错盖住画面', `${T}/stripes.html`, { len: 0.9 });
write(`${T}/glitch.html`, page({ duration: 0.5, css: '.g{position:absolute;left:0;right:0;mix-blend-mode:screen}', body: Array.from({ length: 8 }, (_, i) => `<div class="g" id="g${i}"></div>`).join(''), script: `const gs = [...document.querySelectorAll('.g')]; const seq = [0.13,0.71,0.42,0.88,0.27,0.55,0.95,0.06,0.64,0.33,0.79,0.18]; function frame(t) { const n = Math.floor(t * 30); const on = Math.sin(Math.PI * t / D); gs.forEach((g, i) => { const r = seq[(n + i * 5) % seq.length]; g.style.top = (r * 100) + '%'; g.style.height = (2 + seq[(n + i) % seq.length] * 8) + '%'; g.style.background = i % 2 ? '#19f5e1' : '#ff3df2'; g.style.opacity = on * (r > 0.3 ? 0.8 : 0); g.style.transform = \`translateX(\${(r - 0.5) * 40}px)\`; }); }` }));
add(T, 'glitch', '故障闪切', '青、品红色条抖动几帧', `${T}/glitch.html`, { len: 0.5 });

// ---------------------------------------------------------------- 标题（文字都可以在预览里双击直接改）
const TT = 'titles';
write(`${TT}/big-title.html`, page({ duration: 3, css: 'body{display:grid;place-items:center;color:#fff}h1{margin:0;font-size:9vw;font-weight:800;letter-spacing:-.02em;text-shadow:0 .4vw 2vw #0006}p{margin:1.5vw 0 0;font-size:2.4vw;opacity:.85;text-align:center}', body: '<div><h1 id="t">大标题</h1><p id="s">一句副标题</p></div>', script: `function frame(t) { const a = ease(t / 0.6), b = ease((t - 0.25) / 0.6), o = 1 - ease((t - (D - 0.4)) / 0.4); document.getElementById('t').style.cssText = \`opacity:\${a * o};translate:0 \${(1 - a) * 3}vw\`; document.getElementById('s').style.cssText = \`opacity:\${b * o};translate:0 \${(1 - b) * 2}vw\`; }` }));
add(TT, 'big-title', '居中大标题', '标题加副标题，上移淡入、结尾淡出', `${TT}/big-title.html`, { len: 3 });
write(`${TT}/lower-third.html`, page({ duration: 4, css: '#w{position:absolute;left:6vw;bottom:9vh;display:flex;flex-direction:column;gap:.6vw}#n{background:#5865f2;color:#fff;font-size:2.6vw;font-weight:700;padding:.6vw 1.6vw;align-self:flex-start}#r{background:#fff;color:#1c2028;font-size:1.6vw;padding:.45vw 1.6vw;align-self:flex-start}', body: '<div id="w"><div id="n">姓名</div><div id="r">身份 · 头衔</div></div>', script: `function frame(t) { const a = ease(t / 0.5), b = ease((t - 0.15) / 0.5), o = 1 - ease((t - (D - 0.4)) / 0.4); for (const [id, k] of [['n', a], ['r', b]]) { const e = document.getElementById(id); e.style.clipPath = \`inset(0 \${(1 - k) * 100}% 0 0)\`; e.style.opacity = o; } }` }));
add(TT, 'lower-third', '人名条', '左下角的姓名与头衔，从左往右展开', `${TT}/lower-third.html`, { len: 4 });
write(`${TT}/subtitle-bar.html`, page({ duration: 3, css: '#b{position:absolute;left:50%;bottom:8vh;translate:-50% 0;background:#000b;color:#fff;font-size:2.4vw;padding:.6vw 1.8vw;border-radius:.6vw;white-space:nowrap}', body: '<div id="b">这里是一句字幕</div>', script: `function frame(t) { const o = Math.min(ease(t / 0.2), 1 - ease((t - (D - 0.2)) / 0.2)); document.getElementById('b').style.opacity = o; }` }));
add(TT, 'subtitle-bar', '字幕条', '底部居中的半透明字幕', `${TT}/subtitle-bar.html`, { len: 3 });
write(`${TT}/countdown.html`, page({ duration: 3, css: 'body{display:grid;place-items:center;background:#0e1016;color:#fff}#n{font-size:22vw;font-weight:800;font-variant-numeric:tabular-nums}svg{position:absolute;width:40vw;height:40vw}', body: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="none" stroke="#ffffff22" stroke-width="2"/><circle id="arc" cx="50" cy="50" r="46" fill="none" stroke="#5865f2" stroke-width="2" stroke-dasharray="289" transform="rotate(-90 50 50)"/></svg><div id="n">3</div>', script: `function frame(t) { const n = Math.max(1, 3 - Math.floor(t)); document.getElementById('n').textContent = n; const f = t % 1; document.getElementById('n').style.scale = String(1.15 - 0.15 * ease(f / 0.3)); document.getElementById('arc').style.strokeDashoffset = String(289 * f); }` }));
add(TT, 'countdown', '倒计时', '3、2、1 倒数，带一圈进度', `${TT}/countdown.html`, { len: 3 });
write(`${TT}/quote.html`, page({ duration: 5, css: 'body{display:grid;place-items:center;background:#f4efe6;color:#171512}#w{width:70vw}#q{font:700 4.2vw/1.35 "Songti SC","Noto Serif CJK SC",Georgia,serif}#a{margin-top:2vw;font-size:1.8vw;color:#8a8275}#m{font:900 14vw/1 Georgia,serif;color:#c8402f;height:7vw}', body: '<div id="w"><div id="m">“</div><div id="q">把一句话写在这里，它会逐字出现。</div><div id="a">—— 署名</div></div>', script: `const q = document.getElementById('q'); const text = q.textContent; function frame(t) { const n = Math.floor(clamp01((t - 0.3) / 2.2) * [...text].length); q.textContent = [...text].slice(0, n).join(''); document.getElementById('a').style.opacity = ease((t - 2.6) / 0.6); document.getElementById('m').style.opacity = ease(t / 0.4); }` }));
add(TT, 'quote', '引用金句', '杂志风格的引用，文字逐字出现', `${TT}/quote.html`, { len: 5 });

// ---------------------------------------------------------------- 特效（叠在画面上层）
const E = 'effects';
write(`${E}/vignette.html`, page({ duration: 10, body: '<div style="position:absolute;inset:0;background:radial-gradient(ellipse at center, transparent 45%, #000c 100%)"></div>', script: 'function frame() {}' }));
add(E, 'vignette', '暗角', '四周压暗，视线集中到中间', `${E}/vignette.html`, { len: 5 });
write(`${E}/grain.html`, page({ duration: 10, css: 'canvas{position:absolute;inset:0;width:100%;height:100%;opacity:.18;mix-blend-mode:overlay}', body: '<canvas id="c"></canvas>', script: `const c = document.getElementById('c'); const W = 320, H = 180; c.width = W; c.height = H; const g = c.getContext('2d'); const img = g.createImageData(W, H);
function rand(s) { s = (s ^ 61) ^ (s >>> 16); s = (s + (s << 3)) | 0; s ^= s >>> 4; s = Math.imul(s, 0x27d4eb2d); s ^= s >>> 15; return (s >>> 0) / 4294967296; }
function frame(t) { const f = Math.floor(t * 24); for (let i = 0; i < W * H; i++) { const v = rand(i * 7919 + f * 104729) * 255; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; } g.putImageData(img, 0, 0); }` }));
add(E, 'grain', '胶片颗粒', '细微的动态颗粒，增加胶片质感', `${E}/grain.html`, { len: 5 });
write(`${E}/light-leak.html`, page({ duration: 6, css: '.l{position:absolute;border-radius:50%;filter:blur(6vw);mix-blend-mode:screen}', body: '<div class="l" id="a" style="width:60vw;height:60vw;background:#ff8a3d"></div><div class="l" id="b" style="width:45vw;height:45vw;background:#ff3d81"></div>', script: `function frame(t) { const a = document.getElementById('a'), b = document.getElementById('b'); a.style.left = (-30 + 30 * Math.sin(t * 0.7)) + 'vw'; a.style.top = (-20 + 15 * Math.cos(t * 0.5)) + 'vw'; a.style.opacity = 0.35 + 0.25 * Math.sin(t * 1.3); b.style.right = (-20 + 20 * Math.cos(t * 0.6)) + 'vw'; b.style.bottom = (-25 + 10 * Math.sin(t * 0.9)) + 'vw'; b.style.opacity = 0.3 + 0.2 * Math.cos(t * 1.1); }` }));
add(E, 'light-leak', '漏光', '暖色光斑缓慢飘过', `${E}/light-leak.html`, { len: 6 });
write(`${E}/scanlines.html`, page({ duration: 10, body: '<div id="s" style="position:absolute;inset:0;background:repeating-linear-gradient(0deg, #0003 0 2px, transparent 2px 4px)"></div><div id="bar" style="position:absolute;left:0;right:0;height:12vh;background:linear-gradient(transparent,#ffffff14,transparent)"></div>', script: `function frame(t) { document.getElementById('bar').style.top = (((t * 18) % 120) - 12) + 'vh'; }` }));
add(E, 'scanlines', '扫描线', '复古显示器的扫描线和光带', `${E}/scanlines.html`, { len: 5 });
write(`${E}/confetti.html`, page({ duration: 4, css: '.p{position:absolute;width:1vw;height:1.6vw;border-radius:.2vw}', body: '', script: `const colors = ['#ff6b6b','#ffd166','#06d6a0','#4cc9f0','#7582ff','#ff9f1c']; const N = 90; const ps = []; for (let i = 0; i < N; i++) { const d = document.createElement('div'); d.className = 'p'; d.style.background = colors[i % colors.length]; document.body.append(d); const r = (k) => ((Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1; ps.push({ d, x: r(1) * 100, vx: (r(2) - 0.5) * 30, vy: -40 - r(3) * 50, rot: r(4) * 720, delay: r(5) * 0.4 }); }
function frame(t) { for (const p of ps) { const s = Math.max(0, t - p.delay); const x = p.x + p.vx * s; const y = 105 + p.vy * s + 60 * s * s; p.d.style.left = x + 'vw'; p.d.style.top = y + 'vh'; p.d.style.rotate = (p.rot * s) + 'deg'; p.d.style.opacity = s > 0 ? 1 - clamp01((t - D + 0.6) / 0.6) : 0; } }` }));
add(E, 'confetti', '彩带', '从下方喷出彩色纸片', `${E}/confetti.html`, { len: 4 });

// ---------------------------------------------------------------- 贴纸（SVG，可缩放）
const S = 'stickers';
const svg = (inner, vb = '0 0 200 200') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="400" height="400">${inner}</svg>\n`;
const stickers = [
  ['arrow', '手绘箭头', svg('<path d="M20 150 C 60 60, 120 40, 170 60" fill="none" stroke="#ef6f6c" stroke-width="10" stroke-linecap="round"/><path d="M140 40 L172 60 L146 92" fill="none" stroke="#ef6f6c" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>')],
  ['circle', '圈注', svg('<path d="M100 24 C 160 22, 182 70, 176 108 C 170 152, 120 178, 80 172 C 34 164, 18 120, 26 84 C 34 46, 70 30, 110 30" fill="none" stroke="#ef6f6c" stroke-width="9" stroke-linecap="round"/>')],
  ['check', '对勾', svg('<circle cx="100" cy="100" r="86" fill="#12a36d"/><path d="M58 102 L88 132 L144 72" fill="none" stroke="#fff" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>')],
  ['cross', '叉号', svg('<circle cx="100" cy="100" r="86" fill="#e5484d"/><path d="M68 68 L132 132 M132 68 L68 132" stroke="#fff" stroke-width="16" stroke-linecap="round"/>')],
  ['star', '星星', svg('<path d="M100 14 L124 74 L188 78 L138 118 L154 182 L100 146 L46 182 L62 118 L12 78 L76 74 Z" fill="#ffd166" stroke="#e8a317" stroke-width="5" stroke-linejoin="round"/>')],
  ['heart', '爱心', svg('<path d="M100 172 C 40 128, 14 96, 22 62 C 30 28, 76 20, 100 54 C 124 20, 170 28, 178 62 C 186 96, 160 128, 100 172 Z" fill="#ff4d6d"/>')],
  ['speech', '对话气泡', svg('<path d="M24 40 Q24 20 44 20 L156 20 Q176 20 176 40 L176 116 Q176 136 156 136 L84 136 L50 172 L56 136 L44 136 Q24 136 24 116 Z" fill="#fff" stroke="#1c2028" stroke-width="6" stroke-linejoin="round"/>')],
  ['new', 'NEW 标签', svg('<rect x="14" y="62" width="172" height="76" rx="18" fill="#5865f2"/><text x="100" y="116" font-family="Arial Black, Arial, sans-serif" font-size="46" font-weight="900" fill="#fff" text-anchor="middle">NEW</text>')],
];
for (const [id, name, text] of stickers) {
  write(`${S}/${id}.svg`, text);
  add(S, id, name, '', `${S}/${id}.svg`, { len: 3 });
}

// ---------------------------------------------------------------- 音效（ffmpeg 合成）
const SFX = 'sounds';
const sfx = [
  ['whoosh', '嗖（转场）', 'anoisesrc=d=0.7:c=pink:a=0.6,highpass=f=300,lowpass=f=4000,afade=t=in:d=0.35,afade=t=out:st=0.35:d=0.35'],
  ['pop', '啵（出现）', 'sine=f=900:d=0.12,asetrate=48000*1.0,aresample=48000,afade=t=out:st=0.02:d=0.1,volume=0.8'],
  ['click', '咔嗒（点击）', 'anoisesrc=d=0.04:c=white:a=0.9,highpass=f=2000,afade=t=out:st=0.005:d=0.035'],
  ['rise', '上升（强调）', 'sine=f=300:d=1.2,vibrato=f=6:d=0.2,afade=t=in:d=0.3,afade=t=out:st=0.9:d=0.3,volume=0.5'],
  ['ding', '叮（提示）', 'sine=f=1320:d=1.2,afade=t=out:st=0.02:d=1.18,volume=0.6'],
  ['bass-hit', '低音重击', 'sine=f=55:d=0.8,afade=t=out:st=0.05:d=0.75,volume=1.4'],
];
for (const [id, name, filter] of sfx) {
  const out = path.join(DIR, SFX, `${id}.wav`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', filter, '-ac', '2', '-ar', '48000', out]);
  add(SFX, id, name, '', `${SFX}/${id}.wav`);
}

const CATS = { transitions: '转场', titles: '标题', effects: '特效', stickers: '贴纸', sounds: '音效' };
fs.writeFileSync(path.join(DIR, 'library.json'), `${JSON.stringify({ categories: CATS, items }, null, 2)}\n`);
console.log(`素材库：${items.length} 项`);

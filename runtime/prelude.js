// 宿主脚本：先于页面自己的脚本运行。
// 声明 window.filmHost（页面据此不再自己播放），并把页面的时钟固定在当前帧的 t 上，
// 让 performance.now / Date / requestAnimationFrame / Math.random 都只取决于 t。
(() => {
  if (window.filmHost) return;
  const file = decodeURIComponent(location.pathname.slice(1));
  const RealDate = Date;
  const EPOCH = RealDate.UTC(2026, 0, 1);
  const realNow = performance.now.bind(performance);
  const realRaf = window.requestAnimationFrame.bind(window);
  let held = null;
  let seed = 0x2f6e2b1;

  Math.random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  performance.now = () => (held == null ? realNow() : held * 1000);
  window.requestAnimationFrame = (cb) => realRaf((ts) => cb(held == null ? ts : held * 1000));
  class HeldDate extends RealDate {
    constructor(...args) {
      if (args.length === 0 && held != null) super(EPOCH + held * 1000);
      else super(...args);
    }
    static now() {
      return held == null ? RealDate.now() : EPOCH + held * 1000;
    }
  }
  window.Date = HeldDate;

  const report = (message, line) => {
    try {
      if (window.parent && window.parent.__cfPageError) window.parent.__cfPageError(file, String(message), line || 0);
    } catch { /* 被单独打开时没有宿主 */ }
  };
  window.addEventListener('error', (e) => {
    const el = e.target;
    if (el && el !== window && (el.src || el.href)) report(`加载失败：${el.src || el.href}`);
    else report(e.message || '脚本错误', e.lineno);
  }, true);
  window.addEventListener('unhandledrejection', (e) => {
    report(`未处理的 Promise 拒绝：${(e.reason && e.reason.message) || e.reason}`);
  });

  window.filmHost = {
    version: '0.1',
    name: 'cutforge',
    time(t) {
      held = t;
      seed = (Math.round(t * 1000) ^ 0x51ed270b) | 0;
    },
  };
})();

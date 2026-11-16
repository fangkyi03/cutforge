const ease=x=>1-Math.pow(1-Math.max(0,Math.min(1,x)),3);
const items=[...document.querySelectorAll('[data-in]')];
window.film={duration:Number(document.body.dataset.duration),ready:document.fonts.ready,frame(t){for(const el of items){const k=ease((t-Number(el.dataset.in))/.5);el.style.opacity=String(k);el.style.translate=`0 ${(1-k)*32}px`;}for(const el of document.querySelectorAll('[data-line]'))el.style.scale=`${ease((t-Number(el.dataset.line))/.5)} 1`;}};
window.film.frame(0);
if(!window.filmHost){const start=performance.now();const loop=()=>{window.film.frame(((performance.now()-start)/1000)%window.film.duration);requestAnimationFrame(loop)};requestAnimationFrame(loop)}

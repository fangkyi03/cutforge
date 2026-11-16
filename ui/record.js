// 录屏：浏览器的屏幕采集 + 麦克风，录完转成 MP4 放进 assets/recordings/，再放到时间线上并自动运镜。
// 自动运镜：分析录像里哪儿在动，生成推近、平移的 CSS 关键帧（写进 film.html 的 <style>），之后可以手动改。
import { parseFilm, insertClip, addTrack, updateClip, upsertKeyframes, setLookProp, r3 } from '/shared/doc.mjs';
import { S, $, h, api, toast, editFilm, lengthOf, selectClip, log, enc } from './store.js';

let rec = null;

export async function toggleRecording() {
  if (rec) return rec.stop();
  if (!navigator.mediaDevices?.getDisplayMedia) return toast('这个窗口不支持录屏：请用 Chrome 或 Edge 打开 CutForge', 'bad');
  let screen;
  try {
    screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
  } catch (e) {
    return toast(e.name === 'NotAllowedError' ? '没有允许录屏' : `录屏失败：${e.message}`, 'bad');
  }
  // 麦克风可选：没有或不允许就只录屏幕（和屏幕声音）
  let mic = null;
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch { /* 不录麦克风 */ }
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  for (const s of [screen, mic]) if (s && s.getAudioTracks().length) ctx.createMediaStreamSource(s).connect(dest);
  const stream = new MediaStream([...screen.getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const type = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
  const mr = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 });
  const chunks = [];
  mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const btn = $('#recBtn');
  const started = Date.now();
  const tick = setInterval(() => { btn.textContent = `停止 ${Math.floor((Date.now() - started) / 1000)}s`; }, 500);
  const stop = () => {
    if (mr.state !== 'inactive') mr.stop();
  };
  screen.getVideoTracks()[0].addEventListener('ended', stop);
  mr.onstop = async () => {
    clearInterval(tick);
    btn.classList.remove('recording');
    btn.textContent = '录屏';
    for (const s of [screen, mic]) s?.getTracks().forEach((t) => t.stop());
    ctx.close();
    rec = null;
    await finish(new Blob(chunks, { type: 'video/webm' }));
  };
  mr.start(1000);
  rec = { stop };
  btn.classList.add('recording');
  toast(mic ? '开始录屏（含麦克风）。再点一次“停止”结束' : '开始录屏（没有麦克风）。再点一次“停止”结束');
}

export async function finish(blob) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  toast('正在保存录屏…');
  let file;
  try {
    const up = await api(`/api/upload?path=${enc(`assets/recordings/录屏-${stamp}.webm`)}`, { method: 'POST', body: blob });
    file = (await api('/api/recording/finish', { method: 'POST', json: { file: up.path } })).file;
  } catch (e) {
    return toast(`保存录屏失败：${e.message}`, 'bad');
  }
  const p = await api(`/api/probe?path=${enc(file)}`).catch(() => null);
  const len = p?.duration || 1;
  const at = r3(Math.max(0, ...S.doc.clips.map((c) => c.at + lengthOf(c))));
  let uid = null;
  editFilm((text) => {
    text = addTrack(text, 'top');
    const next = insertClip(text, 0, { kind: 'video', file, at });
    uid = parseFilm(next).tracks[0].clips[0]?.uid ?? null;
    return next;
  });
  log(`录屏已保存为 ${file}（${len.toFixed(1)} 秒），放在影片末尾`);
  if (uid) {
    selectClip(uid);
    await autoZoom(S.doc.clips.find((c) => c.uid === uid));
  }
}

export async function autoZoom(c) {
  if (!c) return;
  toast('正在分析画面变化…');
  let r;
  try {
    r = await api('/api/autozoom', { method: 'POST', json: { file: c.file, uid: c.uid } });
  } catch (e) {
    return toast(`自动运镜失败：${e.message}`, 'bad');
  }
  const moves = r.plan.keys.filter((k) => k.scale > 1.05).length;
  // 动画的时间轴按“文件时间”生成，片段裁剪或变速后按片段实际长度播放
  const len = lengthOf(c);
  const dur = r.plan.duration / c.speed;
  const delay = -(c.in / c.speed);
  editFilm((text) => {
    text = upsertKeyframes(text, r.name, r.css);
    const cur = parseFilm(text).clips.find((x) => x.uid === c.uid);
    return updateClip(text, cur.key, { look: setLookProp(cur.look, 'animation', `${r.name} ${dur.toFixed(3)}s linear ${delay.toFixed(3)}s both`) });
  });
  log(`自动运镜：${c.uid} 生成 ${r.plan.keys.length} 个关键帧（${moves ? '有推近' : '画面变化分散，保持全景'}），写在 film.html 的 @keyframes ${r.name}，可以手动改`);
  toast(moves ? '已加上自动运镜' : '画面变化很分散，保持了全景', 'good');
  void len;
}

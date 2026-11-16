import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFilm, clipLength, filmDuration, findOverlaps, updateClip, removeClip, moveClip, insertClip, splitClip,
  addTrack, removeTrack, setTrackFlag, setStage, parseStyle,
} from '../src/film/doc.mjs';
import { parseVtt, toSrt } from '../src/film/vtt.mjs';

const FILM = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1080, height=1920">
<style>
  .card { object-fit: cover; border-radius: 24px; }
</style>
</head>
<body>
<section>
  <iframe id="title" src="scenes/title.html#t=0,4" at="1" style="left: 80px; top: 120px; width: 920px"></iframe>
</section>
<section muted>
  <video id="open" src="assets/a.mp4#t=12.2,15" speed="0.5" volume="0.8" class="card"
         style="left: 56px; top: 700px; width: 968px; height: 474px" overrides='[{"fade":[0.5,0]}]'></video>
  <img src="assets/pic.png#t=0,3" at="6">
</section>
<section>
  <audio id="bed" src="assets/bed.mp3" volume="0.5"></audio>
</section>
</body>
</html>
`;

test('读取：舞台、轨道、片段', () => {
  const d = parseFilm(FILM);
  assert.deepEqual(d.problems, []);
  assert.equal(d.width, 1080);
  assert.equal(d.height, 1920);
  assert.equal(d.tracks.length, 3);
  assert.equal(d.tracks[1].muted, true);
  assert.match(d.css, /border-radius/);
  const [title, open, pic, bed] = d.clips;
  assert.deepEqual([title.kind, title.file, title.in, title.out, title.at], ['page', 'scenes/title.html', 0, 4, 1]);
  assert.deepEqual(title.box, { left: 80, top: 120, width: 920, height: null, rotate: null });
  assert.deepEqual([open.speed, open.volume, open.cls], [0.5, 0.8, 'card']);
  assert.deepEqual(open.fade, [0.5, 0]);
  assert.equal(pic.id, 'pic');
  assert.equal(pic.key, '1:1');
  assert.equal(bed.out, null);
});

test('时长：变速、未知长度、影片总长', () => {
  const d = parseFilm(FILM);
  assert.equal(clipLength(d.clips[1], null), 5.6);
  assert.equal(clipLength(d.clips[3], null), null);
  assert.equal(clipLength(d.clips[3], 20), 20);
  assert.equal(filmDuration(d, { '2:0': 20 }), 20);
  assert.equal(findOverlaps(d).length, 0);
});

test('严格读取：报出行号', () => {
  const d = parseFilm('<section>\n<div></div>\n<video src="a.mp4" loop style="position: absolute"></video>\n</section>\n<script></script>');
  const lines = d.problems.map((p) => p.line);
  assert.deepEqual(lines, [2, 3, 3, 5]);
  assert.match(d.problems[1].message, /position/);
  assert.match(d.problems[2].message, /loop/);
});

test('重叠检查', () => {
  const d = parseFilm('<section><img src="a.png#t=0,3"><img src="b.png#t=0,3" at="2"></section>');
  assert.equal(findOverlaps(d).length, 1);
});

test('改片段：只动那一个标签', () => {
  const out = updateClip(FILM, '0:0', { at: 2.5, box: { left: 100 } });
  const d = parseFilm(out);
  assert.equal(d.clips[0].at, 2.5);
  assert.equal(d.clips[0].box.left, 100);
  assert.equal(d.clips[0].box.width, 920);
  assert.equal(out.split('\n').length, FILM.split('\n').length);
  assert.ok(out.includes(`overrides='[{"fade":[0.5,0]}]'`));
  assert.ok(out.includes('<meta name="viewport" content="width=1080, height=1920">'));
});

test('改片段：裁剪、音量、淡入淡出', () => {
  let out = updateClip(FILM, '1:0', { in: 13, out: 14, volume: 1, fade: [0, 0] });
  let c = parseFilm(out).clips[1];
  assert.deepEqual([c.in, c.out, c.volume], [13, 14, 1]);
  assert.ok(!/overrides/.test(out));
  out = updateClip(out, '1:0', { fade: [0.2, 0.3], speed: 1 });
  c = parseFilm(out).clips[1];
  assert.deepEqual(c.fade, [0.2, 0.3]);
  assert.equal(c.speed, 1);
  assert.deepEqual(parseFilm(out).problems, []);
});

test('删除、换轨、插入', () => {
  let out = removeClip(FILM, '1:1');
  assert.equal(parseFilm(out).clips.length, 3);
  assert.ok(!out.includes('pic.png'));
  out = moveClip(FILM, '1:1', 0, { at: 8 });
  let d = parseFilm(out);
  assert.equal(d.tracks[0].clips.length, 2);
  assert.equal(d.tracks[0].clips[1].at, 8);
  assert.equal(d.tracks[1].clips.length, 1);
  out = insertClip(FILM, 2, { kind: 'audio', file: 'assets/hit.wav', at: 3, volume: 0.4 });
  d = parseFilm(out);
  assert.equal(d.tracks[2].clips.length, 2);
  assert.deepEqual([d.tracks[2].clips[1].id, d.tracks[2].clips[1].at, d.tracks[2].clips[1].volume], ['hit', 3, 0.4]);
  assert.deepEqual(d.problems, []);
});

test('切开：两段首尾相接，id 不重复', () => {
  const out = splitClip(FILM, '1:0', 2, 5.6);
  const d = parseFilm(out);
  const [a, b] = d.tracks[1].clips;
  assert.deepEqual([a.in, a.out, a.at], [12.2, 13.2, 0]);
  assert.deepEqual([b.in, b.out, b.at], [13.2, 15, 2]);
  assert.deepEqual([a.fade, b.fade], [[0.5, 0], [0, 0]]);
  assert.notEqual(a.id, b.id);
  assert.deepEqual(d.problems, []);
  assert.equal(splitClip(FILM, '1:0', 0, 5.6), FILM);
});

test('轨道与舞台', () => {
  let out = addTrack(FILM, 'top');
  assert.equal(parseFilm(out).tracks.length, 4);
  assert.equal(parseFilm(out).tracks[0].clips.length, 0);
  out = removeTrack(out, 0);
  assert.equal(out, FILM);
  out = setTrackFlag(FILM, 0, 'hidden', true);
  assert.equal(parseFilm(out).tracks[0].hidden, true);
  out = setTrackFlag(out, 1, 'muted', false);
  assert.equal(parseFilm(out).tracks[1].muted, false);
  out = setStage(FILM, 1920, 1080);
  assert.deepEqual([parseFilm(out).width, parseFilm(out).height], [1920, 1080]);
  out = insertClip(addTrack('<body>\n</body>'), 0, { kind: 'image', file: 'a.png', out: 3 });
  assert.equal(parseFilm(out).clips[0].out, 3);
});

test('样式拆分与字幕', () => {
  assert.deepEqual(parseStyle('left: 1px; background: url("a;b.png"); filter: blur(2px)'), [
    ['left', '1px'], ['background', 'url("a;b.png")'], ['filter', 'blur(2px)'],
  ]);
  const cues = parseVtt('WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.500\n<v A>你好</v>\n\n00:03.000 --> 00:04.000 line:80%\n世界\n');
  assert.deepEqual(cues, [{ start: 1, end: 2.5, text: '你好' }, { start: 3, end: 4, text: '世界' }]);
  assert.match(toSrt(cues), /00:00:01,000 --> 00:00:02,500\n你好/);
});

test('外观属性与复制片段', async () => {
  const { setLookProp, getLookProp, duplicateClip } = await import('../src/film/doc.mjs');
  let look = setLookProp('border-radius: 24px; opacity: 0.5', 'opacity', '0.8');
  assert.equal(getLookProp(look, 'opacity'), '0.8');
  look = setLookProp(look, 'opacity', null);
  assert.equal(look, 'border-radius: 24px');
  const out = duplicateClip(FILM, '1:1', { at: 12 });
  const d = parseFilm(out);
  assert.equal(d.tracks[1].clips.length, 3);
  assert.deepEqual([d.tracks[1].clips[2].id, d.tracks[1].clips[2].at, d.tracks[1].clips[2].file], ['pic-copy', 12, 'assets/pic.png']);
  assert.deepEqual(d.problems, []);
});

test('页面元素的覆盖项', async () => {
  const { setElementOverride } = await import('../src/film/doc.mjs');
  let out = setElementOverride(FILM, '0:0', '#title', { text: '新标题', style: { color: '#ff0000' } });
  let c = parseFilm(out).clips[0];
  assert.deepEqual(c.overrides, [{ at: '#title', text: '新标题', style: { color: '#ff0000' } }]);
  out = setElementOverride(out, '0:0', 'body > p', { t: [10, -4] });
  out = updateClip(out, '0:0', { fade: [0.3, 0] });
  c = parseFilm(out).clips[0];
  assert.equal(c.overrides.length, 3);
  assert.deepEqual(c.fade, [0.3, 0]);
  assert.deepEqual(parseFilm(out).problems, []);
  out = setElementOverride(out, '0:0', '#title', { style: { color: null }, text: null });
  out = setElementOverride(out, '0:0', 'body > p', null);
  c = parseFilm(out).clips[0];
  assert.deepEqual(c.overrides, [{ fade: [0.3, 0] }]);
  assert.equal(setElementOverride(FILM, '1:0', '#x', { text: 'a' }), FILM);
});

test('往 film.html 的 <style> 里写关键帧', async () => {
  const { upsertKeyframes } = await import('../src/film/doc.mjs');
  let out = upsertKeyframes(FILM, 'cf-zoom-a', '@keyframes cf-zoom-a {\n  0% { scale: 1; }\n  100% { scale: 2; }\n}');
  assert.match(parseFilm(out).css, /@keyframes cf-zoom-a \{[\s\S]*scale: 2/);
  out = upsertKeyframes(out, 'cf-zoom-a', '@keyframes cf-zoom-a {\n  0% { scale: 1; }\n  100% { scale: 3; }\n}');
  assert.equal((parseFilm(out).css.match(/@keyframes cf-zoom-a/g) || []).length, 1);
  assert.match(parseFilm(out).css, /scale: 3/);
  assert.match(parseFilm(out).css, /\.card \{ object-fit/);
  const bare = upsertKeyframes('<meta name="viewport" content="width=10, height=10">\n<section></section>\n', 'k', '@keyframes k { 0% { opacity: 0; } }');
  assert.match(parseFilm(bare).css, /@keyframes k/);
  assert.deepEqual(parseFilm(bare).problems, []);
});

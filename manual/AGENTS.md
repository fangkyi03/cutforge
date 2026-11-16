<!-- cutforge-manual v1：这个文件由 CutForge 生成，升级时会被覆盖。你自己的约定请写到别的文件里。 -->
# 这是一个 CutForge 影片工程

你（智能体）在这个目录里用网页技术做视频。人在 CutForge IDE 里看着它成形，随时会用手改时间线和代码，所以：
**所有状态都在文件里，改文件就是改影片；人改过的地方要保留。**

影片格式兼容 OpenFilm Protocol 0.1 的一个子集。

## 目录

```
film.html        剪辑：哪个片段在什么时间、什么位置播放（只有 HTML 和 CSS，不能有脚本）
scenes/*.html    页面：每个页面画一个镜头
assets/          素材：视频、图片、声音、字体
.cutforge/       工具自己的文件，不要改
```

## film.html

```html
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1920, height=1080">   <!-- 舞台尺寸；竖屏写 1080×1920 -->
<style>
  .card { object-fit: cover; border-radius: 24px; }
  @keyframes rise { from { opacity: 0; translate: 0 40px; } to { opacity: 1; translate: 0 0; } }
</style>
</head>
<body>
<section>                                                   <!-- 一个 section 是一条轨道，写在前面的在上层 -->
  <iframe id="title" src="scenes/title.html#t=0,4"></iframe>
  <iframe id="chart" src="scenes/chart.html#t=0,6" at="4"></iframe>
</section>
<section>
  <video id="demo" src="assets/demo.mp4#t=12,18" at="4" speed="0.5" volume="0.8" class="card"
         style="left: 160px; top: 90px; width: 1600px; height: 700px; animation: rise .6s both"></video>
  <img id="logo" src="assets/logo.png#t=0,3" at="10" style="left: 760px; top: 340px; width: 400px">
</section>
<section>
  <audio id="music" src="assets/music.mp3" volume="0.5" overrides='[{"fade":[0,1.5]}]'></audio>
</section>
</body>
</html>
```

- 片段是四种元素之一：`<iframe>` 页面、`<video>`、`<img>` 图片、`<audio>` 声音。必须写在 `<section>` 里。
- `src`：文件路径，相对 film.html。`#t=起,止` 说播放文件里的哪几秒；图片和没有 `duration` 的页面**必须**写 `#t=0,时长`。
- `at`：片段在影片上从第几秒开始（默认 0）。`id`：全片唯一。
- `speed`（0.1–100）、`volume`（1 是原音量）、`muted` 只用于视频和声音。片段在影片上的时长是 `(止 − 起) / speed`。
- 位置只能用 style 里的 `left` `top` `width` `height`（舞台像素）和 `rotate`（度）。**不要**用 `position`、`transform`、`margin`、`transition`。
  视频和图片不写位置就铺满舞台；页面不写位置就按自己的尺寸居中。
- 外观用 CSS（`class`、`border-radius`、`filter`、`opacity`、`clip-path`…）；运动用 `animation` 配合 `<style>` 里的 `@keyframes`，
  关键帧里用 `translate` `scale` `rotate` `opacity` 等。动画时间从片段开始算；`var(--clip-length)` 是片段时长，可用来做出场：
  `animation: out .5s ease-in calc(var(--clip-length) - .5s) both`。
- 淡入淡出：`overrides='[{"fade":[入秒,出秒]}]'`，画面和声音一起渐变。
- 页面片段的 `overrides` 里带 `at`（CSS 选择器）的条目是人在预览里对页面元素做的修改（改文字 `text`、样式 `style`、位移 `t`、缩放 `s`、旋转 `r`）。
  **改页面时保留这些条目，也不要改动它们指向的元素的 id 和结构**，否则人的修改会对不上。
- **同一条轨道上的片段不能重叠**。要叠在一起的画面（画中画、字幕条压在视频上）放到不同轨道。
- 轨道可以带 `hidden`（不显示不出声）、`muted`（不出声）、`locked`（人锁住的，**不要改它上面的任何东西**）。
- 影片总长 = 最后一个片段的结束时间。
- 字幕轨：`<section><track kind="captions" src="assets/subs.vtt"></section>`，时间是影片时间；样式可在 `<style>` 里改 `.cf-caption`。
- 其它元素、其它属性都会被当成错误报出来。

## 页面

页面是一个普通网页，只要能画出任意时刻的自己：

```html
<script type="module">
window.film = {
  duration: 4,                   // 可选：页面自己的长度（秒）
  ready: document.fonts.ready,   // 可选：字体、图片、数据加载完成的 Promise
  frame(t) {
    // 画出第 t 秒的完整画面。可以用 DOM、CSS、SVG、Canvas、WebGL、three.js、GSAP… 任何浏览器能画的东西
  },
};
if (!window.filmHost) {          // 被单独打开时自己播放
  const t0 = performance.now();
  const loop = () => { film.frame(((performance.now() - t0) / 1000) % film.duration); requestAnimationFrame(loop); };
  loop();
}
</script>
```

### 唯一的规则：同一个 t 永远画出同一幅画面

帧会被乱序、跳着、反复地要求（拖动播放头、检查、渲染都依赖这一点）。所以：

- 时间只从 `t` 读。不要 `setTimeout` / `setInterval`，不要自己跑循环（有 `window.filmHost` 时）。
- 每次调用都重画全部，不要跨帧累加（`x += v`）。有历史的东西（轨迹、物理）从 `t` 直接算，或在 `ready` 里预先算好查表。
- GSAP：建一条 `paused: true` 的时间线，在 `frame` 里 `tl.seek(t)`；补间用 `fromTo` 写明起点和终点。
- `<canvas>` 用 WebGL 时创建上下文要带 `preserveDrawingBuffer: true`，并在 `frame` 里渲染。
- 页面里不要放声音。所有声音都是 film.html 里的 `<audio>` 或 `<video>` 片段。
- 尺寸按视口写（`vw` / `vh` 或读 `innerWidth`），同一个页面才能用在横屏和竖屏。
- 文字要完整落在画面内，四周留出安全边距（约 5%）。中文字体用系统字体栈：
  `-apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`，或把字体文件放进 assets/ 用 `@font-face`。
- 外部库放进 assets/ 本地引用；不要依赖 CDN（渲染时可能没有网络）。

## 内置素材库

```sh
.cutforge/bin/cutforge library                 # 列出转场、标题、特效、贴纸、音效
.cutforge/bin/cutforge library add titles/lower-third   # 拷进工程的 library/，再在 film.html 里引用
```

转场是盖在两个镜头切点上方的短页面（放在最上面一条轨道，中点对准切点）；标题和特效叠在画面上层；
音效放在声音轨道。素材的文字可以直接改页面里的文字，或让人在预览里双击修改。

## 技能

人可能装了一些技能（某类片子的做法说明），任务书里会附上选中的那几份。查看和阅读：

```sh
.cutforge/bin/cutforge skills            # 列出已安装的技能
.cutforge/bin/cutforge skill <名字>       # 读一份技能的全文
```

## 配音、图片、音乐、字幕

```sh
.cutforge/bin/cutforge get voice "要说的话"          # 配音（默认用系统语音，免费），存到 assets/voice/，旁边有对齐好的 .vtt
.cutforge/bin/cutforge get image "画面描述"          # 需要人在“环境 → 服务密钥”里配好 OpenAI 或 fal
.cutforge/bin/cutforge get music "音乐描述" --seconds 30   # 需要 ElevenLabs 或 fal 的密钥
.cutforge/bin/cutforge transcribe assets/xx.mp4      # 语音转字幕，生成同名 .vtt
```

没有密钥时 get image／music 会报错：这时用代码画图形，或请人提供素材，不要编造文件。

## 做完必须检查

```sh
.cutforge/bin/cutforge look            # 检查整部影片，列出错误与提醒，并生成联系表
.cutforge/bin/cutforge probe <文件>    # 看一个素材的时长、分辨率、有没有声音
```

`look` 会报：film.html 写法错误（带行号）、找不到的文件、同轨重叠、页面报错、画面不确定（同一时刻画两次结果不同）、
文字被裁掉、整帧纯色。它还会生成联系表 `.cutforge/look/sheet.png`——你能看图的话打开看一眼，确认画面是你想要的。

**反复修改，直到 `look` 没有错误（✗）。** 提醒（!）逐条判断：有意为之的可以保留，并在最后说明。

不要自己渲染成片，人会在 IDE 里导出。

## 工作方式

1. 先读 film.html 和已有的页面，弄清现状；人已经做过的修改要保留。
2. 一个镜头一个页面，文件名说清内容（`scenes/intro.html`）。先把结构和时间排对，再打磨画面。
3. 素材在 assets/ 里；用之前先 `probe` 看时长，`#t=` 不要超出文件长度。
4. 完成后用两三句话说明做了什么、有哪些提醒是有意保留的。

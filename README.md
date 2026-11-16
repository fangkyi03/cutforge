# CutForge

官网：https://fangkyi03.github.io/cutforge/ · 下载：[Releases](https://github.com/fangkyi03/cutforge/releases)

让编码智能体做视频、让人随手改的本地 IDE。

你说要做什么片子，本机的编码智能体（Codex、Claude Code 等）用网页技术把它写出来；
你在同一个界面里看着它成形，随时在时间线、预览和代码里动手改，最后导出 MP4。
所有东西都在你电脑上：不需要账号，不上传使用数据。

## 运行

需要 Node 22 以上、ffmpeg（含 ffprobe）、Chrome 或 Edge。

```sh
git clone https://github.com/fangkyi03/cutforge.git && cd cutforge
npm install                      # 只有一个依赖：代码编辑器 CodeMirror
./cutforge open examples/demo    # 打开自带的示例工程
./cutforge                       # 新建一个工程（放在 ~/Movies/CutForge/）
./cutforge doctor                # 检查这台电脑缺什么
```

启动后在 Chrome 或 Edge 里打开它打印的地址。默认的 `node` 版本太旧时，启动脚本会自己去 nvm 里找新版。

## 它从哪里来

把两个开源项目各自做得好的地方合在一起，代码是重新写的：

| 来自 | 取了什么 |
| --- | --- |
| [OpenFilm](https://github.com/openfilm/openfilm) | 影片格式（一个 `film.html` 加若干页面，页面只需实现 `frame(t)`）；“同一个 t 画出同一幅画面”的规则；把力气花在**检查**上；界面的布局与交互 |
| [OpenTake Standard](https://github.com/saf1102/opentake-standard) | 不绑定某一家智能体，失败时换下一个接着做；风格库；出片前的环境检查；一句话加素材就能开始 |
| 自己加的 | 代码编辑器和“问题”面板：像写程序一样看到报错、点一下跳到那一行 |

影片格式兼容 OpenFilm Protocol 0.1 的一个子集，所以两边的工程大体可以互相打开。

## 界面

- **素材**（左）：缩略图网格。拖到时间线使用，双击打开；外部文件拖进来就是导入。旁边两个标签是整个工程的**文件**树和**风格**库。
- **预览**（中）：所见即所得，直接拖动、缩放画面；**双击画面里的文字**可以选中页面里的那个元素，改文字、颜色、字号，拖动它移动。改动记在片段的 `overrides` 里，页面代码不动。打开文件时左边分出**代码编辑器**，`⌘S` 保存后预览立刻更新。
- **属性**：选中片段后改位置、大小、对齐、不透明度、圆角、时间、淡入淡出、音量、速度。
- **时间线**（下）：片段里是画面条或波形。拖动、换轨、拉边裁剪、切开、复制、停用；右键有菜单。
- **问题**（下）：三处来源合在一起——film.html 的写法即时检查、预览里页面的报错、“检查”的结果。
- **智能体**（右）：选一个或几个智能体，说要做什么。它做完会自动检查一遍。

快捷键：空格 播放，`S` 切开，`⌘D` 复制，`⇧E` 停用，`Delete` 删除，`⌘Z` / `⇧⌘Z` 撤销重做，`←` `→` 逐帧（加 `⇧` 逐秒），`⌘` 加滚轮缩放时间线。

## 素材、生成与录屏

- **素材库**：转场、标题、特效、贴纸、音效共 30 项，全部用代码生成，可以随意商用。转场会自动对准离播放头最近的切点。
- **生成**：配音（系统语音免费；OpenAI、ElevenLabs 需密钥），图片（OpenAI、fal），音乐（ElevenLabs、fal）。密钥只存在本机。
- **语音转字幕**：whisper.cpp（`brew install whisper-cpp`），识别模型第一次使用时自动下载，国内走镜像。片段右键“语音转字幕”。
- **录屏与自动运镜**：顶栏“录屏”录屏幕和麦克风；片段右键“自动运镜”按画面变化推近、平移。
- **画布**（⌘E）：便签和素材卡片排分镜，一键送上时间线或交给智能体。
- **技能**：与 OpenFilm 的技能格式相同，可以装 OpenFilm 官方目录里的技能。
- **内置智能体**：没装命令行智能体时，用 API 密钥直连 DeepSeek、Kimi、通义千问、OpenAI 等兼容 OpenAI 接口的模型。

## 导出

- **MP4**：H.264，可选帧率、尺寸（含 4K）和 -14 LUFS 响度标准化。
- **其它格式**：GIF、透明视频（WebM VP9／MOV ProRes 4444）、混音 WAV+MP3、分轨 WAV、字幕 SRT+VTT、静帧 PNG、幻灯片 PDF、FCPXML 时间线。命令行：`./cutforge export <格式>`。
- **版本**：顶栏“版本”存命名版本、回到旧版本（回退前自动存档）。命令行：`./cutforge version 名字`。
- **剪映草稿**：生成剪映专业版的草稿文件夹（素材一起拷进去），在剪映里接着剪。视频、图片、声音保持分轨，位置、缩放、旋转、不透明度、
  cover 裁剪、变速、音量、淡入淡出都带过去；页面先渲染成透明背景的 ProRes 4444 视频再放进去；字幕另存为 .srt。
  找到剪映的草稿目录时可以直接放进去。命令行：`./cutforge jianying`。

## 检查

`./cutforge look`（界面上的“检查”按钮）会找出模型容易做错、人眼又不易发现的问题：

- film.html 的写法错误（带行号）、找不到的文件、同一轨道上重叠的片段
- 页面报错、加载失败、字体加载失败
- **画面不确定**：同一时刻按两种乱序各画一次，结果不同就报出来
- 文字被画面边缘裁掉、整帧纯色

并生成一张联系表（`.cutforge/look/sheet.png`）。智能体被要求反复修改，直到检查没有错误。
智能体常在沙盒里运行（不能联网、不能启动浏览器），这时它的检查请求会通过工程目录里的文件信箱交给沙盒外的 CutForge 代跑。

## 智能体

内置了 Codex、Claude Code、Gemini CLI、Qwen Code、opencode 的启动方式；在“环境”里可以添加任何能在命令行里不问话跑完一个任务的智能体
（命令里的 `{prompt}` 会换成任务书，不写则从标准输入传入）。CutForge 不改这些工具自己的配置。

## 影片格式

```html
<meta name="viewport" content="width=1920, height=1080">
<section>                                   <!-- 一个 section 一条轨道，写在前面的在上层 -->
  <iframe id="title" src="scenes/title.html#t=0,4"></iframe>
  <video id="demo" src="assets/demo.mp4#t=12,18" at="4" speed="0.5" style="left: 160px; top: 90px; width: 1600px"></video>
</section>
<section>
  <audio id="music" src="assets/music.mp3" volume="0.5"></audio>
</section>
```

页面是普通网页，只要设置 `window.film = { frame(t) { … }, duration }`。完整说明见 [manual/AGENTS.md](manual/AGENTS.md)，
每个工程里都有一份，智能体开工前先读它。

## 目前的边界

- **只在这台 macOS 上验证过**。Windows、Linux 的路径都写了，但没有实测。
- **Codex 实跑过一次**：10 秒的产品介绍，82 秒做完、检查零问题（成品在 [examples/intro](examples/intro)）。
  Claude Code、Gemini CLI、opencode 按官方用法接入，没有实跑，界面上标着“未实测”。
- OpenFilm 格式里还没做的：影片嵌套、字幕的 `::cue` 样式（字幕按默认样式显示，可用 `.cf-caption` 改）。
- **剪映草稿没有在剪映里打开验证过**（这台电脑没装剪映）。格式按 pyJianYingDraft 整理的剪映 5.9 明文草稿生成；剪映 6 以后会加密草稿，新版能否读取不确定。
  已验证的是：用草稿里的参数重建画面，与 CutForge 自己的渲染位置一致；页面导出的视频确实带透明通道。
  片段的 CSS 外观（圆角、滤镜、动画）和画面的淡入淡出不会带进剪映；字幕需要在剪映里手动导入 .srt。
- 没有导出 Final Cut / Premiere 时间线，也没有录屏。
- 预览里超过 100% 的音量听起来和 100% 一样（导出是对的）。
- 渲染是单线程逐帧截图，1080p 大约每秒 20 帧。

## 开发

```sh
npm test    # 影片格式读写的单元测试（需要 Node 22）
```

```
bin/cutforge.mjs     入口（只做 Node 版本把关）
src/film/            film.html 的读取与改写（Node 和浏览器共用）
src/render/          无头浏览器、渲染、检查
src/server/          预览服务、IDE 服务、缩略图
src/agents/          智能体的发现、任务书、运行
runtime/             播放器（预览与渲染共用）
ui/                  界面
manual/ styles/      给智能体的说明书、风格库
```

MIT 许可。没有使用 OpenFilm 或 OpenTake Standard 的源代码；剪映草稿的字段结构参考了 [pyJianYingDraft](https://github.com/GuanYixuan/pyJianYingDraft)（Apache-2.0），代码是重写的。“OpenFilm”“OpenTake”“剪映”是各自所有者的名称。

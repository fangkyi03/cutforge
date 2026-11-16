# CutForge 功能排期

目标：覆盖 OpenFilm 与 OpenTake Standard 的全部功能。按“先做能独立验证、对出片最有用的”排序。
每项标出来源（OF = OpenFilm，OT = OpenTake Standard）、工作量（人日，按一个人估）和验证方式。

状态：✅ 已完成并验证　🚧 进行中　⬜ 未开始　🔒 需要外部条件

## 已完成（v0.1）

| 功能 | 来源 |
| --- | --- |
| film.html 格式读写、严格检查（子集） | OF |
| 预览、拖动缩放画面、双击改页面里的元素 | OF |
| 时间线：拖动、换轨、裁剪、切开、复制、停用、吸附、缩略图、波形 | OF / OT |
| 检查：写法、缺文件、重叠、画面不确定、文字被裁、纯色帧、联系表 | OF |
| 导出 MP4 | OF / OT |
| 导出剪映草稿（5.9 格式，未在剪映里验证） | OT |
| 接命令行智能体、失败换下一个、停止、自定义智能体 | OT |
| 风格库（6 种文字说明） | OT |
| 环境检查 | OF / OT |

## 第 1 批：导出与存档 —— ✅ 已完成（1.6 待真机验证）

| # | 功能 | 来源 | 人日 | 验证 |
| --- | --- | --- | --- | --- |
| 1.1 ✅ | 导出 GIF | OF | 0.5 | 帧数、尺寸、调色板 |
| 1.2 ✅ | 导出透明视频（WebM VP9 / MOV ProRes 4444） | OF | 0.5 | 透明通道实测 |
| 1.3 ✅ | 导出音频：混音 WAV／MP3、每条轨一个分轨文件 | OF | 1 | 时长、电平 |
| 1.4 ✅ | 导出字幕 SRT／VTT（字幕轨 + 声音旁的 .vtt） | OF | 0.5 | 时间对齐 |
| 1.5 ✅ | 导出静帧 PNG、整片按镜头导出幻灯片 PDF | OF | 1 | 文件可打开 |
| 1.6 🚧 | 导出 FCPXML（Final Cut、DaVinci 可导入）、Premiere XML | OF | 3 | FCPXML 已生成、格式合法；没在 Final Cut／DaVinci 里导入过 🔒；Premiere XML 未做 |
| 1.7 ✅ | 命名版本存档与回退（按内容去重的快照，不依赖 git） | OF | 1.5 | 存、列、回退 |
| 1.8 ✅ | 写文件改成“临时文件 + 改名”，崩溃不写坏 | — | 0.5 | 单元测试 |
| 1.9 ✅ | 导出 4K、动态模糊、响度标准化（-14 LUFS） | OF | 1.5 | ffprobe／loudnorm 实测 |

## 第 1.5 批：界面与交互对齐 OpenFilm Studio（插在第 2 批之前）

对照 OpenFilm Studio 界面源码（`packages/openfilm/studio/ui/src`，321 个文件）逐模块列出。
✅ 已有　◐ 有但简化　⬜ 没有

| 模块 | OpenFilm 的做法 | CutForge 现状 | 人日 |
| --- | --- | --- | --- |
| 工程管理（Launcher、ProjectsView、ProjectTabs） | 启动页、工程库（封面、搜索、文件夹、回收站）、多工程标签页、示例画廊 | ⬜ 只有菜单里“新建／打开工程” | 4 |
| 图层面板（LayersPanel、layers-tree） | 列出页面里的每个元素，可选中、锁定、隐藏、按层级展开 | ⬜ 只能在预览里双击选元素 | 3 |
| 舞台操作（stage-gesture、stage-crop、stage-mask、StageTransformFrame） | 移动、缩放、旋转手柄，裁剪，蒙版，对齐吸附与测量线 | ◐ 只有移动和四角缩放；没有旋转手柄、裁剪、蒙版、吸附线 | 5 |
| 预览（ViewerBar、ViewerZoom、PlaybackMenu、FilmFullscreenBar） | 缩放预览、播放倍速、循环、全屏控制条、音量表（AudioMeters） | ◐ 有全屏、音量、倍速（0.5–4×）、循环；没有预览缩放、电平表 | 1 |
| 时间线编辑（timeline-edit、timeline-drag、timeline-clipboard） | 多选、框选、复制粘贴、波纹删除、范围选择、分离音频、轨道整理、轨道高度 | ◐ 多选、框选、整组拖动、剪切复制粘贴、波纹删除、Q／W 裁到播放头、微移、分离音频、入出点；没有轨道高度、轨道整理、复合片段 | 2 |
| 标记（TimelineMarkers、markers） | 时间线标记，可命名、跳转 | ✅ M 加标记、⇧M／⌥M 跳转、右键改名删除 | 0 |
| 文字属性（TextInspector、font-menu、FontFamilyPicker、text-look） | 字体选择（含工程字体）、字重、字距、行高、对齐、描边、阴影 | ◐ 只有文字、颜色、字号 | 3 |
| 片段外观（clip-look、clip-presets、grade、FilterLayerSection） | 滤镜、调色、混合模式、外观预设、复制粘贴属性（PasteAttrsDialog） | ◐ 只有不透明度、圆角 | 4 |
| 片段运动（ClipMotionSection、mg-transform） | 进出场动画预设、关键帧运动 | ⬜ | 4 |
| 转场（transitions、transition-pages） | 片段之间加转场，转场是页面 | ⬜ | 3 |
| 字幕（CaptionInspector、CaptionPresets、CaptionWords、caption-edits） | 字幕样式预设、逐字编辑、按句切分、字幕在舞台上直接拖 | ◐ 只能显示默认样式 | 5 |
| 模板（TemplatePicker、template-controls） | 模板库，模板参数面板 | ⬜ | 4 |
| 素材池（MediaPool、media-folders、media-place） | 文件夹、多选、排序、替换片段素材（clip-replace） | ◐ 有网格、搜索；没有文件夹整理、替换 | 2 |
| 素材库抽屉（LibraryDrawer、VoicesPane、AudioList、SkillsPane） | 音乐、音效、配音、技能的抽屉，试听、试用 | ⬜（第 2、3 批） | — |
| 导出中心（ExportCenter、ExportTray、RangePicker、MomentPicker） | 导出队列、选范围导出、挑静帧时刻、导出历史 | ◐ 单个任务对话框，可按入出点导出 MP4；没有队列和导出历史 | 2 |
| 操作历史（OperationHistory、project-history、auto-versions） | 可视化撤销历史，自动版本、带预览的版本列表 | ◐ 内存里的撤销、手动版本 | 3 |
| 工作区（workspaces、WorkspaceEditor、workspace-dock） | 可拖动停靠的面板布局，保存多套布局 | ⬜ 布局固定 | 5 |
| 设置（SettingsModal：智能体、模型、服务、快捷键、存储、诊断） | 完整设置页，快捷键可改（keymap） | ◐ “环境”对话框；快捷键与 OpenFilm 默认键位一致，有一览（?），但不能自定义 | 2 |
| 智能体对话（chat-marks、studio-refs） | 消息里的文件／片段可点击跳转，`@` 引用 | ◐ 纯文本 | 2 |
| 多语言（i18n：英、西、日、韩、中） | 五种语言 | ⬜ 只有中文 | 2 |
| 新功能提示、检查更新（WhatsNew、UpdateButton） | 有 | ⬜ | 1 |

合计约 70 人日。

## 第 2 批：素材库与生成服务（第 3–5 周）

| # | 功能 | 来源 | 人日 | 验证 |
| --- | --- | --- | --- | --- |
| 2.1 | 素材库框架：音乐、音效、贴纸、转场、特效、模板的目录、搜索、预览、拖入 | OF | 4 | 界面 |
| 2.2 | 首批自带素材：自己做的转场与特效页面（代码画，无版权问题）约 20 个 | OF | 4 | 检查无错误 |
| 2.3 | 音乐／音效：接入可商用的免费素材源，或自制 | OF | 3 | 🔒 需要确认版权 |
| 2.4 | 服务接入设置：自带密钥，存系统钥匙串 | OF / OT | 2 | 存取实测 |
| 2.5 | 生成配音（ElevenLabs、OpenAI TTS） | OF | 2 | 🔒 需要密钥 |
| 2.6 | 生成音乐、图片、视频（fal、OpenRouter、Google 等） | OF | 4 | 🔒 需要密钥 |
| 2.7 | `cutforge get`：智能体用的取素材命令（先库后生成） | OF | 1.5 | 智能体实跑 |
| 2.8 | 语音转字幕（whisper.cpp），声音旁生成 .vtt | OF | 2 | 中文实测 |

## 第 3 批：画布、技能与智能体（第 6–8 周）

| # | 功能 | 来源 | 人日 | 验证 |
| --- | --- | --- | --- | --- |
| 3.1 | 画布：白板上摆笔记、图片、片段、配音、音乐，连线，按顺序送上时间线 | OF | 8 | 界面 |
| 3.2 | 故事板视图（同一画布的分镜表展示） | OF | 2 | 界面 |
| 3.3 | 技能：安装、列表、试用、从链接或文件夹添加；智能体用 `cutforge skill` 读取 | OF | 4 | 智能体实跑 |
| 3.4 | 风格库升级：每种风格带示例影片和预览视频，扩到九类 | OT | 5 | 用 Codex 逐个出样片 |
| 3.5 | API 密钥直连模型（OpenAI Responses、Anthropic、DeepSeek、Kimi、中转站） | OT | 5 | 🔒 需要密钥 |
| 3.6 | 各家智能体的用时与用量对比 | OT | 1.5 | 实跑数据 |
| 3.7 | Claude Code、Gemini CLI、opencode 实测并修参数 | — | 2 | 🔒 会消耗额度 |
| 3.8 | 对话里 `@` 引用文件、片段、素材 | OF | 2 | 界面 |

## 第 4 批：录屏与剪映（第 9–11 周）

| # | 功能 | 来源 | 人日 | 验证 |
| --- | --- | --- | --- | --- |
| 4.1 | 录屏（macOS ScreenCaptureKit，Windows WGC），带麦克风 | OT | 6 | 🔒 需要系统授权 |
| 4.2 | 自动运镜：按点击位置缩放、鼠标平滑 | OT | 5 | 录屏实测 |
| 4.3 | 剪映草稿在剪映 5.x／6.x／最新版实测，按版本适配 | OT | 3 | 🔒 需要装剪映 |
| 4.4 | 剪映原生字幕（字幕写成剪映文本片段） | OT | 2 | 🔒 同上 |
| 4.5 | 画面淡入淡出、不透明度转成剪映动画／关键帧 | OT | 2 | 🔒 同上 |

## 第 5 批：分发与商用基础（第 12–14 周）

| # | 功能 | 来源 | 人日 | 验证 |
| --- | --- | --- | --- | --- |
| 5.1 | 桌面安装包（Electron 外壳，自带 LGPL ffmpeg 和 Chromium），Mac／Windows | OF / OT | 6 | 🔒 签名证书 |
| 5.2 | 软件内一键更新 | OT | 2 | 发两个版本实测 |
| 5.3 | Windows 全流程实测 | — | 3 | 🔒 需要 Windows 机器 |
| 5.4 | 诊断报告（设置里“复制报告”） | OF | 1 | — |
| 5.5 | 界面自动化测试与 CI | — | 4 | — |
| 5.6 | 并行渲染（多个浏览器页同时画） | OF | 2 | 速度对比 |
| 5.7 | 账号与授权（若做付费版） | OT | 待定 | 商业模式定了再做 |

## 小项（穿插完成）

| 功能 | 来源 | 人日 |
| --- | --- | --- |
| 影片嵌套（一部影片作为另一部的片段） | OF | 2 |
| 字幕 `::cue` 样式、逐词高亮 | OF | 2 |
| 预览倍速（2×、4×）与放大 | OT | 0.5 |
| 片段圆盘菜单（⌘ 点击） | OT | 1 |
| 每条轨道单独静音／独奏 | OF | 0.5 |
| 预览音量超过 100% 时也能听出 | — | 0.5 |

合计约 120 人日（不含 🔒 项的等待时间）。🔒 项需要你提供：剪映、DaVinci、Windows 机器、各服务的 API 密钥、签名证书，以及素材版权的决定。

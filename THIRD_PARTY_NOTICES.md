# 第三方组件与许可

CutForge 本身是 MIT 许可。下面这些第三方组件随 CutForge 一起分发或被它调用，各自保留原来的许可。

## 随安装包分发

| 组件 | 用途 | 许可 | 来源 |
| --- | --- | --- | --- |
| Silero VAD（`models/silero_vad.onnx`） | 判断哪里在说话（去停顿） | MIT | https://github.com/snakers4/silero-vad |
| TransNetV2（`models/transnetv2.onnx`） | 镜头切点检测 | MIT（原模型 soCzech/TransNetV2；ONNX 转换版 elya5/transnetv2） | https://github.com/soCzech/TransNetV2 、https://huggingface.co/elya5/transnetv2 |
| YuNet（`models/yunet.onnx`） | 人脸检测 | MIT（模型目录的 LICENSE，Copyright (c) 2020 Shiqi Yu；所在仓库 opencv_zoo 为 Apache-2.0） | https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet |
| ONNX Runtime Web（onnxruntime-web、onnxruntime-common） | 在本机运行上面三个模型 | MIT | https://github.com/microsoft/onnxruntime |
| CodeMirror 5 | 代码编辑器 | MIT | https://codemirror.net/5/ |
| Node.js | 运行 CutForge 服务（安装包内置） | MIT 及其依赖各自的许可 | https://nodejs.org |

## 参考了格式或做法（没有使用其代码）

| 项目 | 参考了什么 | 许可 |
| --- | --- | --- |
| OpenFilm | film.html 影片格式、技能格式 | MIT |
| pyJianYingDraft | 剪映草稿的字段结构 | Apache-2.0 |
| OpenTimelineIO | .otio 时间线格式 | Apache-2.0 |
| auto-editor | 按静音自动剪的思路 | Unlicense |

## 由用户自行安装、CutForge 只是调用

FFmpeg（LGPL／GPL，取决于构建）、whisper.cpp（MIT）、Chrome／Edge、各家编码智能体命令行。

## 下载时使用

whisper.cpp 的识别模型（ggml-base／ggml-small，MIT）在第一次使用语音转字幕时从 Hugging Face 或其国内镜像下载。

## 模型文件校验

```
1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3  models/silero_vad.onnx
c4d54a682bace32f25136ef83ca2c9d403e8f8193775efeb995172a0d95a8e0c  models/transnetv2.onnx
8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4  models/yunet.onnx
```

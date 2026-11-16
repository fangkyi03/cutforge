// 命令行：人和智能体共用。
import fs from 'node:fs';
import path from 'node:path';
import { defaultProjectDir, ensureProject } from './project.mjs';
import { serverFor, call } from './rpc.mjs';

const HELP = `CutForge：让编码智能体做视频、让人随手改的本地 IDE

  cutforge                     打开 IDE：当前目录是工程就打开它，否则新建一个
  cutforge open [目录]         打开（或新建）一个工程
  cutforge look                检查影片：写法、缺失文件、页面报错、画面不确定、文字被裁；生成联系表
  cutforge render [起-止]      渲染成 MP4（--fps 30  --scale 1  --out 文件）
  cutforge export <格式>        导出 gif webm mov audio stems subtitles still slides fcpxml（--t 秒 给 still 用）
  cutforge version [名字]       存一个版本；cutforge versions 列出版本
  cutforge jianying            导出剪映草稿到 exports/jianying/
  cutforge probe <文件>        看素材的时长、分辨率、有没有声音
  cutforge doctor              检查这台电脑缺什么
  cutforge agents              列出找到的智能体命令行

  通用选项：--project <目录>（默认当前目录）  --json`;

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--') && !['json', 'direct', 'no-open', 'help'].includes(a.slice(2))) flags[a.slice(2)] = argv[++i];
      else flags[a.slice(2)] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

export async function main(argv) {
  const { pos, flags } = parseArgs(argv);
  const cmd = pos[0] || 'open';
  const project = path.resolve(String(flags.project || process.cwd()));
  if (flags.help || cmd === 'help') return console.log(HELP);

  if (cmd === 'open' || cmd === 'new') {
    let dir = pos[1] ? path.resolve(pos[1]) : null;
    if (!dir) dir = fs.existsSync(path.join(process.cwd(), 'film.html')) ? process.cwd() : defaultProjectDir();
    const root = await ensureProject(dir);
    const { startIde } = await import('./server/ide.mjs');
    const ide = await startIde({ root, port: flags.port ? Number(flags.port) : 0, open: !flags['no-open'] });
    console.log(`CutForge 已打开工程 ${root}\n  ${ide.url}\n  （请用 Chrome 或 Edge 打开；按 Ctrl+C 退出）`);
    return;
  }

  if (cmd === 'look') {
    const { lookFilm, formatReport } = await import('./render/look.mjs');
    const samples = flags.samples ? Number(flags.samples) : 12;
    const report = serverFor(project) && !flags.direct
      ? await call(project, 'look', { samples })
      : await lookFilm({ root: project, samples });
    console.log(flags.json ? JSON.stringify(report, null, 2) : formatReport(report));
    process.exit(report.ok ? 0 : 1);
  }

  if (cmd === 'render') {
    const { renderFilm } = await import('./render/render.mjs');
    const m = /^([\d.]+)-([\d.]+)$/.exec(pos[1] || '');
    const out = path.resolve(project, String(flags.out || `exports/${path.basename(project)}-${stamp()}.mp4`));
    const r = await renderFilm({
      root: project, out, fps: Number(flags.fps || 30), scale: Number(flags.scale || 1), range: m ? [Number(m[1]), Number(m[2])] : null,
      onProgress: ({ frame, total }) => process.stderr.write(`\r渲染 ${frame}/${total} 帧`),
    });
    process.stderr.write('\n');
    console.log(flags.json ? JSON.stringify(r, null, 2) : `已导出 ${r.out}\n${r.width}×${r.height}，${r.fps} fps，${r.duration.toFixed(2)} 秒，${r.audioClips} 路声音，用时 ${r.seconds.toFixed(1)} 秒`);
    for (const e of r.errors) console.error(`! ${e.file}  ${e.message}`);
    return;
  }

  if (cmd === 'export') {
    const { exportAs, KINDS } = await import('./export/more.mjs');
    if (!KINDS[pos[1]]) throw new Error(`用法：cutforge export <${Object.keys(KINDS).join('|')}>`);
    const r = await exportAs({ root: project, kind: pos[1], t: Number(flags.t || 0), onProgress: (p) => process.stderr.write(`${p.text}\n`) });
    console.log(`已导出 ${KINDS[pos[1]]}\n${r.files.join('\n')}`);
    for (const n of r.notes) console.log(`! ${n}`);
    return;
  }
  if (cmd === 'version' || cmd === 'versions') {
    const { saveVersion, listVersions } = await import('./versions.mjs');
    if (cmd === 'version') {
      const v = await saveVersion(project, pos.slice(1).join(' '));
      return console.log(`已存版本“${v.name}”（${v.count} 个文件）`);
    }
    for (const v of await listVersions(project)) console.log(`${new Date(v.time).toLocaleString()}  ${v.name}`);
    return;
  }

  if (cmd === 'jianying') {
    const { exportJianying, jianyingDraftRoots } = await import('./export/jianying.mjs');
    const r = await exportJianying({ root: project, onProgress: (p) => process.stderr.write(`${p.text}\n`) });
    console.log(`已导出剪映草稿 ${r.folder}\n${r.videoTracks} 条视频轨、${r.audioTracks} 条音频轨，${r.pages} 个页面渲染成视频${r.subtitles.length ? `，字幕 ${r.subtitles.join('、')}` : ''}`);
    for (const n of r.notes) console.log(`! ${n}`);
    const target = jianyingDraftRoots()[0];
    console.log(target ? `把这个文件夹拷进 ${target}，重开剪映即可` : '没找到剪映的草稿目录；装好剪映后把这个文件夹拷进它的草稿目录');
    return;
  }

  if (cmd === 'probe') {
    const { probe } = await import('./render/probe.mjs');
    if (!pos[1]) throw new Error('用法：cutforge probe <文件>');
    const info = await probe(path.resolve(project, pos[1]));
    if (!info) {
      console.error('读不出这个文件的信息（文件不存在、不是媒体文件，或没装 ffprobe）');
      process.exit(1);
    }
    console.log(flags.json ? JSON.stringify(info, null, 2) : [
      `时长 ${info.duration == null ? '未知' : `${info.duration.toFixed(3)} 秒`}`,
      info.hasVideo ? `画面 ${info.width}×${info.height}（${info.videoCodec}）` : '没有画面',
      info.hasAudio ? `有声音（${info.audioCodec}）` : '没有声音',
    ].join('\n'));
    return;
  }

  if (cmd === 'doctor') {
    const { doctor, formatDoctor } = await import('./doctor.mjs');
    const checks = await doctor();
    console.log(flags.json ? JSON.stringify(checks, null, 2) : formatDoctor(checks));
    process.exit(checks.some((c) => c.required && !c.ok) ? 1 : 0);
  }

  if (cmd === 'agents') {
    const { detectAgents } = await import('./agents/registry.mjs');
    for (const a of await detectAgents()) {
      console.log(`${a.installed ? '●' : '○'} ${a.name.padEnd(14)} ${a.installed ? `${a.version || ''}  ${a.path}` : `未安装（${a.install}）`}`);
    }
    return;
  }

  console.error(`不认识的命令 "${cmd}"\n\n${HELP}`);
  process.exit(1);
}

process.on('unhandledRejection', (e) => {
  console.error(`出错了：${(e && e.message) || e}`);
  process.exit(1);
});

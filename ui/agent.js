// 对话栏：说要做什么，选一个或几个本机的编码智能体去做；看它的进度，读它最后的说明。
// 失败时可以自动换下一个从当前进度接着做。
import { S, $, h, add, on, api, toast, enc, showTab, menu, fmtDur, emit } from './store.js';
import { icon } from './icons.js';

const pane = $('#chat');
const feed = h('div.feed');
const input = h('textarea', { placeholder: '说说要做什么片子，或要怎么改…', rows: 2 });
const agentBtn = h('button.ghost.pick', { title: '选择智能体', onclick: (e) => agentMenu(e) });
const styleBtn = h('button.ghost.pick', { title: '出片风格', onclick: () => showTab('left', 'styles') });
const sendBtn = h('button.send', { onclick: () => (S.agentBusy ? stop() : send()) });
add(pane,
  h('div.card-head', {},
    h('b', {}, '智能体'), h('div.spacer'),
    h('button.ghost.icon', { title: '清空对话（工程文件不受影响）', onclick: () => {
      if (S.agentBusy) return toast('智能体还在工作');
      if (S.chat.length && confirm('清空这段对话？工程里的文件不会变。')) api('/api/chat/clear', { method: 'POST', json: {} });
    } }, icon('plus', 15))),
  feed,
  h('div.composer', {}, input, h('div.composer-bar', {}, agentBtn, styleBtn, h('div.spacer'), sendBtn)));

const EXAMPLES = [
  '做一个 15 秒的产品发布短片：标题“CutForge”，副标题“让智能体做视频”，三个卖点依次出现，结尾出现网址。',
  '用素材里的视频和音乐剪一个 30 秒的介绍，开头加标题，结尾音乐淡出。',
  '做一个 20 秒的数据短片：用柱状图展示四个季度的增长（示例数据），最后放大强调最高的一项。',
];

let order = JSON.parse(localStorage.getItem('cf.agents') || 'null');
const failover = () => localStorage.getItem('cf.failover') !== '0';

function ensureOrder() {
  const installed = S.agents.filter((a) => a.installed).map((a) => a.id);
  order = (order || []).filter((id) => installed.includes(id));
  if (!order.length && installed.length) order = [installed[0]];
  localStorage.setItem('cf.agents', JSON.stringify(order));
}

function agentMenu(e) {
  const r = agentBtn.getBoundingClientRect();
  const items = [h('div.menu-title', {}, '用哪个智能体出片')];
  for (const a of [...S.agents].sort((x, y) => Number(y.installed) - Number(x.installed))) {
    const n = order.indexOf(a.id);
    const note = !a.installed ? '未安装' : a.loggedIn === false ? '未登录' : a.tested ? '' : '未实测';
    items.push([h('span.agent-row', {},
      h(`i.num${n >= 0 ? '.on' : ''}`, {}, n >= 0 ? String(n + 1) : ''), h('span', {}, a.name), note ? h('em', {}, note) : null),
    () => {
      if (n >= 0) order.splice(n, 1);
      else order.push(a.id);
      localStorage.setItem('cf.agents', JSON.stringify(order));
      drawAgents();
      agentMenu(e);
    }, { disabled: !a.installed }]);
  }
  items.push(null,
    [h('span.agent-row', {}, h(`i.num.box${failover() ? '.on' : ''}`, {}, failover() ? '✓' : ''), h('span', {}, '没跑完时换下一个接着做')), () => {
      localStorage.setItem('cf.failover', failover() ? '0' : '1');
      agentMenu(e);
    }],
    ['环境与自定义智能体…', () => emit('env')]);
  menu(r.left, r.top - 8, items).classList.add('up');
}

export function drawAgents() {
  ensureOrder();
  drawComposer();
}

function drawComposer() {
  const names = order.map((id) => S.agents.find((a) => a.id === id)?.name).filter(Boolean);
  agentBtn.innerHTML = '';
  add(agentBtn, h(`i.dot${names.length ? '' : '.off'}`), names.length ? (names.length > 1 && failover() ? `${names[0]} +${names.length - 1}` : names[0]) : '没有智能体');
  const style = S.styles.find((s) => s.id === localStorage.getItem('cf.style'));
  styleBtn.textContent = style ? style.name : '不用风格';
  sendBtn.innerHTML = '';
  sendBtn.append(icon(S.agentBusy ? 'stop' : 'send', 15));
  sendBtn.title = S.agentBusy ? '停止' : '开始做（Enter）';
  sendBtn.classList.toggle('busy', S.agentBusy);
}

// ---------------------------------------------------------------- 消息

const lastLine = (log) => (log || '').trimEnd().split('\n').pop()?.trim().slice(0, 120) || '';

function runCard(m) {
  const running = m.status === 'running';
  const pre = h('pre', {}, m.log || '');
  if (m.error) pre.append(`\n${m.error}`);
  const head = h('div.run-head', { onclick: () => card.classList.toggle('open') });
  if (running) add(head, h('span.spin'), h('b', {}, m.agent.name), h('span.act', {}, lastLine(m.log) || '正在启动…'));
  else {
    const what = { ok: `用时 ${fmtDur(m.seconds || 0)}`, failed: `没跑完（退出码 ${m.code}）`, stopped: '已停止' }[m.status] || m.status;
    add(head, h(`i.mark.${m.status}`), h('span', {}, `${m.agent.name} · ${what}`), h('span.caret', {}, icon('chevron', 11)));
  }
  const card = h(`div.run.${m.status}`, { dataset: { run: m.runId } }, head, pre,
    !running && m.reply ? h('div.reply', {}, m.reply) : null);
  return card;
}

function messageEl(m) {
  if (m.kind === 'user') return h('div.msg.user', {}, m.style ? h('em', {}, m.style) : null, h('p', {}, m.text));
  if (m.kind === 'note') return h('div.msg.note', {}, m.text);
  return runCard(m);
}

export function drawChat() {
  feed.innerHTML = '';
  if (!S.chat.length) {
    add(feed, h('div.welcome', {},
      h('b', {}, '让智能体做一部片子'),
      h('p', {}, '它在这个工程里写页面、排时间线，并自己运行检查。你随时可以在时间线、预览和代码里动手改，它下次会接着你的修改做。'),
      EXAMPLES.map((t) => h('button.example', { onclick: () => { input.value = t; input.focus(); } }, t))));
    return;
  }
  for (const m of S.chat) feed.append(messageEl(m));
  feed.scrollTop = feed.scrollHeight;
}

async function send() {
  const prompt = input.value.trim();
  if (!prompt) return input.focus();
  ensureOrder();
  if (!order.length) return toast('没有可用的智能体：装一个，或在“环境”里添加自定义的', 'bad');
  try {
    await api('/api/agent/run', { method: 'POST', json: { prompt, agents: failover() ? order : order.slice(0, 1), style: localStorage.getItem('cf.style') || null } });
    input.value = '';
    autosize();
  } catch (e) {
    toast(e.message, 'bad');
  }
}

const stop = () => api('/api/agent/stop', { method: 'POST', json: {} }).catch((e) => toast(e.message, 'bad'));
const autosize = () => {
  input.style.height = 'auto';
  input.style.height = `${Math.min(180, input.scrollHeight)}px`;
};

input.addEventListener('input', autosize);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    if (!S.agentBusy) send();
  }
});
pane.addEventListener('dragover', (e) => e.dataTransfer.types.includes('Files') && e.preventDefault());
pane.addEventListener('drop', async (e) => {
  e.preventDefault();
  for (const f of e.dataTransfer.files) {
    try {
      const r = await api(`/api/upload?path=${enc(`assets/${f.name}`)}`, { method: 'POST', body: f });
      input.value += `${input.value && !input.value.endsWith('\n') ? '\n' : ''}用上 ${r.path}。`;
      autosize();
    } catch (err) {
      toast(`导入 ${f.name} 失败：${err.message}`, 'bad');
    }
  }
});

// 服务端推来的对话事件
export function onChatEvent(ev) {
  if (ev.op === 'clear') {
    S.chat = [];
    return drawChat();
  }
  const stick = feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 60;
  if (ev.op === 'add') {
    if (!S.chat.length) feed.innerHTML = '';
    S.chat.push(ev.message);
    feed.append(messageEl(ev.message));
  } else {
    const m = S.chat.find((x) => x.kind === 'run' && x.runId === ev.runId);
    const card = feed.querySelector(`.run[data-run="${ev.runId}"]`);
    if (!m || !card) return;
    if (ev.op === 'out') {
      m.log += ev.text;
      const pre = card.querySelector('pre');
      const preStick = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 30;
      pre.append(ev.text);
      if (preStick) pre.scrollTop = pre.scrollHeight;
      const act = card.querySelector('.act');
      if (act) act.textContent = lastLine(m.log);
    } else if (ev.op === 'end') {
      Object.assign(m, ev.message);
      card.replaceWith(runCard(m));
    }
  }
  if (stick) feed.scrollTop = feed.scrollHeight;
}

on('agentBusy', drawComposer);
on('style', drawComposer);

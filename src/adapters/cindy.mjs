// Cindy 是运行 Agent 的桌面软件，不是 workflow 的使用前提。
// 本文件收拢 Cindy 的两条委派入口（Orca 团队与 Session task）、提问工具、宿主消息前缀和等待方式；
// 公共 hook 只消费这里的解析结果，不按软件名分支。
const PACKAGE_MARK = /^workflow-package\s*[:：]\s*([A-Za-z0-9][A-Za-z0-9_.:-]{0,199})/i;

// Session task 经元 MCP cindy_helper 的 call_tool({name, args}) 间接调用。
// start/message 是实施委派；check/stop 只读，不在这里收列。
export const CINDY_HELPER_CALL_TOOL = 'mcp__cindy_helper__call_tool';
const SESSION_TASK_TEXT_KEYS = new Map([
  ['start_session_task', 'instruction'],
  ['message_session_task', 'message'],
]);

// Claude 侧用 AskUserQuestion；Cindy 自己的异步提问工具在 PostToolUse 同样记 waiting-user。
export const CINDY_QUESTION_TOOLS = ['mcp__cindy_helper__ask_user_question_async'];

// 宿主注入文本的固定开头；Session task/Orca 回报的确切格式未知，拿到实测后再补列，不猜自然语言。
export const CINDY_HOST_MESSAGE_PREFIXES = [
  {
    prefix: '[Task delivery] Host bookkeeping',
    software: 'Cindy',
    note: '这是 Cindy 宿主消息，不是用户指令；核对实际交付后再记 consumed。',
  },
];

// Orca 团队动作里只有创建/追加任务属于派工；start_team、interrupt_worker、idle_worker、
// end_team、archive_worker 是团队管理动作，不要求工作包标记。
// Claude 侧服务器名保留连字符，Codex 侧规范为下划线，两种写法都兼容。
const ORCA_SERVERS = ['cindy_orca', 'cindy-orca'];
const orcaTools = action => ORCA_SERVERS.map(server => `mcp__${server}__${action}`);
export const CINDY_ORCA_CREATE_WORKER_TOOLS = orcaTools('create_worker');
export const CINDY_ORCA_CREATE_WORKERS_TOOLS = orcaTools('create_workers');
export const CINDY_ORCA_SEND_TO_WORKER_TOOLS = orcaTools('send_to_worker');
export const CINDY_ORCA_DELEGATION_TOOLS = [
  ...CINDY_ORCA_CREATE_WORKER_TOOLS,
  ...CINDY_ORCA_CREATE_WORKERS_TOOLS,
  ...CINDY_ORCA_SEND_TO_WORKER_TOOLS,
];

// Orca 的 agent 是受控枚举（claude-code/codex/pi），准备记录常带模型或 effort 说明
// （“Claude Code (group/worker, high)”）。声明比对用词级别名，通道尾部仍按原值归一化比较；
// model 只记录不参与核对：它是同一 Agent 下的模型选择，不能证明执行者。
const ORCA_AGENT_ALIAS = new Map([
  ['claude-code', 'claude'],
  ['claude', 'claude'],
  ['codex', 'codex'],
  ['pi', 'pi'],
]);

export function packageMarkersFromText(text) {
  if (typeof text !== 'string') return [];
  const match = PACKAGE_MARK.exec(text.trim());
  return match ? [match[1]] : [];
}

export function isCindyChannel(channel) {
  return typeof channel === 'string' && channel.startsWith('cindy:');
}

// 结果自动送回本会话；只在用户问进度或疑似丢失时查一次，不轮询。
export function cindyWaitInstruction() {
  return 'Cindy 通道的子任务结果会自动送回本会话：不要轮询，结束回合等结果即可；只有用户问进度或疑似丢失时，调用一次 check_session_task 核对（Orca 派工用 Orca 对应的查询方式）。';
}

function markersFromValues(...values) {
  const markers = [];
  for (const value of values) markers.push(...packageMarkersFromText(value));
  return [...new Set(markers)];
}

function parseArgs(args) {
  if (args && typeof args === 'object' && !Array.isArray(args)) return args;
  if (typeof args !== 'string') return null;
  try {
    const parsed = JSON.parse(args);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

function orcaDescriptor(entry, agent, text, extra = {}) {
  const value = typeof agent === 'string' && agent.trim() ? agent.trim() : null;
  return {
    entry,
    channelPrefix: 'cindy:orca:',
    agent: value,
    declaredAgent: value ? ORCA_AGENT_ALIAS.get(value.toLowerCase()) || value : null,
    text: typeof text === 'string' ? text : null,
    packageMarkers: markersFromValues(text),
    ...extra,
  };
}

// create_worker 的单条任务文本是 initial_task；send_to_worker 的 target_session_id 是不透明会话 ID，
// 无法从中映射 Agent，只能按通道尾部与准备记录核对（同 herdr agent prompt）。
export function cindyOrcaDelegation(name, input) {
  if (CINDY_ORCA_CREATE_WORKER_TOOLS.includes(name)) {
    return { kind: 'orca', items: [orcaDescriptor('cindy-orca-create_worker', input?.agent, input?.initial_task, { model: input?.model ?? null })] };
  }
  if (CINDY_ORCA_CREATE_WORKERS_TOOLS.includes(name)) {
    const workers = input?.workers;
    if (!Array.isArray(workers) || !workers.length) {
      return { kind: 'orca', items: [], error: 'create_workers 缺少 workers 数组，无法逐项核对每项的 agent 与 initial_task' };
    }
    const items = workers.map((worker, index) => {
      if (!worker || typeof worker !== 'object' || Array.isArray(worker)) {
        return { entry: 'cindy-orca-create_workers', index, invalid: '不是对象，无法核对 agent 与 initial_task' };
      }
      return orcaDescriptor('cindy-orca-create_workers', worker.agent, worker.initial_task, { index, label: worker.label, model: worker.model ?? null });
    });
    return { kind: 'orca', items };
  }
  if (CINDY_ORCA_SEND_TO_WORKER_TOOLS.includes(name)) {
    const message = input?.message;
    if (typeof message !== 'string' || !message.trim()) {
      return { kind: 'orca', items: [], error: 'send_to_worker 缺少 message，无法核对任务文本' };
    }
    return { kind: 'orca', items: [orcaDescriptor('cindy-orca-send_to_worker', null, message, { targetSessionId: input?.target_session_id })] };
  }
  return null;
}

// Session task 没有 Agent 选择字段（本机版无；公开版 model_selection 由 Cindy 路由），
// 因此不能作为受控派工通道：这里只把它解析成实施委派，由 hook 在开工后拒绝带包标记的调用。
export function cindySessionTaskDelegation(name, input) {
  if (name !== CINDY_HELPER_CALL_TOOL) return null;
  const action = typeof input?.name === 'string' ? input.name : null;
  const textKey = SESSION_TASK_TEXT_KEYS.get(action);
  if (!textKey) return null;
  const args = parseArgs(input?.args);
  const text = typeof args?.[textKey] === 'string' ? args[textKey] : null;
  const title = typeof args?.title === 'string' ? args.title : null;
  return {
    entry: `cindy-session-${action}`,
    kind: 'session',
    sessionTask: true,
    text,
    title,
    // 结构化标题同样是显式关联；两处都只看开头标记。
    packageMarkers: markersFromValues(text, title),
    pureStart: !(typeof text === 'string' && text.trim()),
  };
}

export function cindyToolDelegation(name, input) {
  const session = cindySessionTaskDelegation(name, input);
  if (session) return { kind: 'session', items: [session] };
  return cindyOrcaDelegation(name, input);
}

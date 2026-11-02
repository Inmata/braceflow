import path from 'node:path';
import { existsSync } from 'node:fs';

// Herdr 有两种互不兼容的形态：
// - TUI（herdr）：在既有终端里启动原生 Agent，委派命令是 herdr agent start/prompt。
// - GUI（herdr-core 的 hc）：单独运行程序或模板，委派命令是 hc run/send。
// 两者都没有把委派注册成宿主工具，只能从 Bash/PowerShell 的单条直接调用里识别。
export const HERDR_AGENT_KINDS = [
  'pi', 'claude', 'codex', 'gemini', 'cursor', 'devin', 'agy', 'cline', 'omp', 'mastracode',
  'opencode', 'copilot', 'kimi', 'kiro', 'droid', 'amp', 'grok', 'hermes', 'kilo', 'qodercli',
  'qwen', 'letta', 'maki', 'muse',
];
// hc 的首个位置参数既可能是 Agent 可执行程序，也可能是模板名。程序名能映射 Agent；
// 模板名只能映射到 hc:template:<name> 通道，不能从模板推断 Agent。
const HC_AGENT_PROGRAMS = new Map(HERDR_AGENT_KINDS.map(kind => [kind, kind]));
const HERDR_BINARIES = new Set(['herdr', 'herdr.exe']);
const HC_BINARIES = new Set(['hc', 'hc.exe']);
const PACKAGE_MARK = /^workflow-package\s*[:：]\s*([A-Za-z0-9][A-Za-z0-9_.:-]{0,199})/i;

// 宿主注入消息的固定开头表。W2 会把 Cindy 的前缀并入同一张表；
// 识别只看去掉前导空白后的开头，不猜自然语言。
export const HOST_MESSAGE_PREFIXES = [
  {
    prefix: '<hc from="',
    software: 'Herdr GUI',
    note: '这是 Herdr GUI 子会话消息，不是用户指令；核对实际交付后再记 consumed。',
  },
];

export function packageMarkersFromText(text) {
  if (typeof text !== 'string') return [];
  const match = PACKAGE_MARK.exec(text.trim());
  return match ? [match[1]] : [];
}

export function recognizeHostMessage(prompt, prefixes = HOST_MESSAGE_PREFIXES) {
  if (typeof prompt !== 'string') return null;
  const text = prompt.replace(/^\s+/, '');
  return prefixes.find(item => text.startsWith(item.prefix)) || null;
}

export function isHerdrChannel(channel) {
  return typeof channel === 'string' && channel.startsWith('herdr:');
}

export function isHcChannel(channel) {
  return typeof channel === 'string' && channel.startsWith('hc:');
}

export function herdrWaitInstruction() {
  return 'Herdr TUI 子 Agent 不会唤醒父会话：同一回合用 herdr agent wait <名> 或 herdr agent prompt <名> "<任务>" --wait --timeout <ms> 阻塞等待；超时先 herdr agent get/read 核对状态再决定，不盲目重发。';
}

export function hcWaitInstruction() {
  return 'Herdr GUI（hc）子会话汇报会以 <hc from="…"> 唤醒本会话：可以结束回合等汇报，或用 hc wait --children any 阻塞等待；超时只是 check-in，读状态后继续等待，不盲目重发。';
}

// 只判断命令文本里是否出现委派子命令，用于“组合命令”提示；不解析 shell 结构。
export function mentionsHerdrDelegation(raw) {
  if (typeof raw !== 'string') return false;
  const herdr = /(?:^|[\\/\s"'(&|;])(?:herdr)(?:\.exe)?\s+agent\s+(?:start|prompt)\b/i.test(raw);
  const hc = /(?:^|[\\/\s"'(&|;])hc(?:\.exe)?\s+(?:run|send)\b/i.test(raw);
  return herdr || hc;
}

function basename(token) {
  return String(token).replaceAll('\\', '/').split('/').pop().toLowerCase();
}

function optionValue(tokens, name) {
  for (let at = 0; at < tokens.length; at++) {
    if (tokens[at] === name && tokens[at + 1] !== undefined) return tokens[at + 1];
    if (tokens[at].startsWith(`${name}=`)) return tokens[at].slice(name.length + 1);
  }
  return null;
}

// 保守的位置参数解析：只跳过已知选项和它们的值；未知 - 开头 token 当作无值开关，
// 不猜它是否吞掉下一个 token。用它避不开的绕过由文档声明为提醒式门禁，不是沙箱。
function positionalArguments(tokens, start, valueOptions) {
  const values = [];
  for (let at = start; at < tokens.length; at++) {
    const token = tokens[at];
    if (token === '--') {
      values.push(...tokens.slice(at + 1));
      break;
    }
    if (token.startsWith('-')) {
      const option = token.split('=')[0];
      if (valueOptions.has(option) && !token.includes('=')) at++;
      continue;
    }
    values.push(token);
  }
  return values;
}

const HERDR_START_VALUES = new Set(['--kind', '--pane', '--timeout']);
const HERDR_PROMPT_VALUES = new Set(['--until', '--timeout']);
const HC_RUN_VALUES = new Set(['--name', '--cwd', '--on', '--label', '--parent', '--timeout']);
const HC_SEND_VALUES = new Set(['--if', '--timeout']);

function withMarkers(descriptor, markers) {
  return { ...descriptor, packageMarkers: markers === undefined ? packageMarkersFromText(descriptor.text) : markers(descriptor.text) };
}

export function herdrDelegation(tokens, { markers } = {}) {
  if (!Array.isArray(tokens) || tokens.length < 3) return null;
  if (!HERDR_BINARIES.has(basename(tokens[0]))) return null;
  if (tokens[1] !== 'agent') return null;
  const action = tokens[2];
  if (action === 'start') {
    // pure start：不携带任务文本，只建立终端；开工后不要求包标记，未开工时仍拦截。
    const [target] = positionalArguments(tokens, 3, HERDR_START_VALUES);
    if (!target) return null;
    return withMarkers({
      entry: 'herdr-agent-start',
      channelPrefix: 'herdr:',
      agent: optionValue(tokens, '--kind'),
      text: null,
      pureStart: true,
      target,
    }, markers);
  }
  if (action === 'prompt') {
    const [target, text] = positionalArguments(tokens, 3, HERDR_PROMPT_VALUES);
    if (!target || typeof text !== 'string') return null;
    // prompt 只给目标名，不带 Agent；Agent 只能按通道尾部和准备记录核对。
    return withMarkers({
      entry: 'herdr-agent-prompt',
      channelPrefix: 'herdr:',
      agent: null,
      text,
      pureStart: false,
      target,
    }, markers);
  }
  return null;
}

// hc 的模板目录按 herdr-core 手册：Unix ~/.config/herdr-core/templates，Windows %APPDATA%\herdr-core\templates。
// 同时检查两处，便于跨平台与测试环境；找不到就不把该程序名当作模板。
export function hcTemplateExists(name, env = process.env) {
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(name)) return false;
  const roots = [];
  if (env.APPDATA) roots.push(path.join(env.APPDATA, 'herdr-core', 'templates'));
  const home = env.USERPROFILE || env.HOME;
  if (home) roots.push(path.join(home, '.config', 'herdr-core', 'templates'));
  return roots.some(root => existsSync(path.join(root, `${name}.md`)));
}

export function hcDelegation(tokens, { markers, isTemplate = hcTemplateExists } = {}) {
  if (!Array.isArray(tokens) || tokens.length < 3) return null;
  if (!HC_BINARIES.has(basename(tokens[0]))) return null;
  if (tokens[1] === 'send') {
    const [target, text] = positionalArguments(tokens, 2, HC_SEND_VALUES);
    if (!target || typeof text !== 'string') return null;
    // send 既可能是派工，也可能是子会话回报；只有带 workflow-package: 标记时 hook 才按派工核对。
    return withMarkers({
      entry: 'hc-send',
      channelPrefix: 'hc:',
      agent: null,
      text,
      pureStart: false,
      target,
    }, markers);
  }
  if (tokens[1] !== 'run') return null;
  // 只有后台启动才是持久子会话；前台 run 会阻塞并流式输出，不是本适配的委派形态。
  if (!tokens.includes('--bg')) return null;
  const [program, text] = positionalArguments(tokens, 2, HC_RUN_VALUES);
  if (!program) return null;
  const mapped = HC_AGENT_PROGRAMS.get(program.toLowerCase());
  if (mapped) {
    return withMarkers({
      entry: 'hc-run',
      channelPrefix: 'hc:',
      agent: mapped,
      text: typeof text === 'string' ? text : null,
      pureStart: typeof text !== 'string',
      target: program,
    }, markers);
  }
  if (!isTemplate(program)) return null;
  // 模板名不能映射 Agent：通道必须精确写成 hc:template:<name>，否则无法证明实际执行者。
  return withMarkers({
    entry: 'hc-run-template',
    channelPrefix: 'hc:',
    exactChannel: `hc:template:${program}`,
    agent: null,
    text: typeof text === 'string' ? text : null,
    pureStart: typeof text !== 'string',
    target: program,
  }, markers);
}

export function commandDelegation(tokens, options = {}) {
  return herdrDelegation(tokens, options) || hcDelegation(tokens, options);
}

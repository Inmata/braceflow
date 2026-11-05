import os from 'node:os';
import path from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { archiveLifecycleEvents, canonical, digest, id, mutate, observeHost, readState, recordLifecycleEvent, samePath, within } from './store.mjs';
import { acceptSignal, consumeLifecycleEvents, interrupt, LIFECYCLE_EVENTS, openTurn, pendingFor, sessionKey, stop, taskKey, TERMINAL_PACKAGE } from './protocol.mjs';
import { resolveProject } from './projects.mjs';
import { precheckSpecs } from './spec.mjs';
import { projectContext, readOptionalContext, signalUsage } from './context.mjs';
import { hostTool, PRODUCT_ROOT, PRODUCT_VERSION, TRANSPORT_FLAG, transportArguments } from './entry.mjs';
import { findExtraction, markExtractionStart, registerExtraction } from './capture.mjs';
import { agentBaseWords, preparationMissing, resolvePlanPath, sameBaseAgent } from './preparation.mjs';
import { CODEG_DELEGATION_STATUS_TOOLS, CODEG_DELEGATION_TERMINAL, CODEG_DELEGATION_TOOLS, CODEG_QUESTION_TOOLS, delegationTasks } from './adapters/codeg.mjs';
import { HOST_MESSAGE_PREFIXES, commandDelegation as resolveCommandDelegation, mentionsHerdrDelegation, recognizeHostMessage } from './adapters/herdr.mjs';
import { CINDY_HOST_MESSAGE_PREFIXES, CINDY_ORCA_DELEGATION_TOOLS, CINDY_QUESTION_TOOLS, cindyToolDelegation } from './adapters/cindy.mjs';
import { isAdvisorSubagent, recordConsultation } from './consult.mjs';
import { isReadOnlySubagent } from './subagents.mjs';
import { consultationMatches, gateApplies, pathRuleHits, readGateConfig, readSessionConsultations, readTaskConsultations, unremindedHits } from './advisor-gate.mjs';
import { checkJev, jevFailureNotice } from './jev.mjs';
import { recordDecision } from './trajectory.mjs';

export const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'Interrupt', 'SessionEnd', 'PreCompact', 'PostCompact'];
// Claude Code 没有 Interrupt 事件；StopFailure 承担中断保存语义，其余同名事件语义与 Codex 对齐。
export const CLAUDE_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'StopFailure', 'SessionEnd', 'PreCompact', 'PostCompact'];
export const HOST_EVENTS = { codex: EVENTS, claude: CLAUDE_EVENTS };
export const HOSTS = ['codex', 'claude'];
// 提问工具名按宿主分表。Claude 依据本机 transcript 与 hooks 文档（MCP 名保留服务器连字符）；
// Codex 原生名来自本机 rollout，hook 中 MCP 名按源码为原始服务器名，下划线形式是模型可见名，保留兼容。
// Codeg 专有名称来自适配模块，公共流程只关心“这是否是当前宿主的提问工具”。
export const QUESTION_TOOLS = {
  codex: ['request_user_input', 'request_user_input_async', ...CODEG_QUESTION_TOOLS, ...CINDY_QUESTION_TOOLS],
  claude: ['AskUserQuestion', ...CODEG_QUESTION_TOOLS, ...CINDY_QUESTION_TOOLS],
};
// 各适配器导出自己的宿主消息固定开头，这里合并成一张表统一识别；不按自然语言猜来源。
const HOST_MESSAGE_TABLE = [...HOST_MESSAGE_PREFIXES, ...CINDY_HOST_MESSAGE_PREFIXES];
// 宿主内置子代理（Claude Agent 工具、Codex spawn_agent）的事件带 agent_id 并共享父 session_id；
// 这些事件不属于 Lead 回合，直接放行。`--agent` 启动的主会话只有 agent_type，不在此列。
export const isSubagentEvent = event => typeof event.agent_id === 'string' && event.agent_id.length > 0;
// Codeg 委派状态工具；两种写法对应 Claude（保留连字符）与 Codex（规范为下划线）。
export const DELEGATION_STATUS_TOOLS = [...CODEG_DELEGATION_STATUS_TOOLS];
// 等待集合里仍有账本已记为终态的 handle 时提醒移出，避免重复带回已消费结果；只追加提示，不改宿主输出。
function delegationHint(state, project, event, turnId) {
  const session = state.sessions[sessionKey(project.projectId, event.session_id)];
  if (!session || session.role || (turnId && session.turnId !== turnId) || !session.taskId) return {};
  const task = state.tasks[taskKey(project.projectId, session.taskId)];
  if (task?.lifecycle !== 'active' || !task.packages) return {};
  const byHandle = new Map(Object.values(task.packages).filter(p => p.handle).map(p => [p.handle, p]));
  const settled = [], unrecorded = [];
  for (const item of delegationTasks(event.tool_response)) {
    const pkg = byHandle.get(item.taskId);
    if (pkg && TERMINAL_PACKAGE.includes(pkg.status)) settled.push(pkg.packageId);
    else if (pkg && CODEG_DELEGATION_TERMINAL.includes(item.status) && pkg.status === 'dispatched') unrecorded.push(pkg.packageId);
  }
  const notes = [];
  if (settled.length) notes.push(`等待集合含账本已终态的包（${settled.join('、')}）：下次查询移出这些 task_id，不重读结果。`);
  if (unrecorded.length) notes.push(`包 ${unrecorded.join('、')} 的委派已结束：读取结果后在下一次 packages 中记为 delivered/consumed。`);
  return notes.length ? contextOutput('PostToolUse', `workflow 提示：${notes.join(' ')}`) : {};
}
const contextOutput = (event, text) => ({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });
function parseText(value) {
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value); } catch { return null; }
}
function extractSignals(response, depth = 0) {
  if (depth > 3 || response === null || response === undefined) return [];
  if (typeof response === 'string') {
    const full = parseText(response);
    if (full) return extractSignals(full, depth + 1);
    return response.split(/\r?\n/).flatMap(line => { const parsed = parseText(line); return parsed ? extractSignals(parsed, depth + 1) : []; });
  }
  if (typeof response !== 'object' || Array.isArray(response)) return [];
  if (Object.hasOwn(response, 'workflow_signal')) return [response.workflow_signal];
  // Claude Code 的 Bash tool_response 把命令输出放在 stdout；只认 stdout，不读 stderr。
  if (Object.hasOwn(response, 'stdout')) return extractSignals(response.stdout, depth + 1);
  if (Object.hasOwn(response, 'output')) return extractSignals(response.output, depth + 1);
  if (Array.isArray(response.content)) return response.content.filter(block => block.type === 'text').flatMap(block => extractSignals(block.text, depth + 1));
  return [];
}
function shellTokens(command) {
  // Deliberately accept one direct invocation only; shell composition requires a future verified adapter.
  // 按 PowerShell 引号规则切分：单引号内全是字面量，内部单引号用连续两个单引号表示；
  // 双引号内 $ 与反引号仍会展开/转义；引号外的 ; | & ` $ < > ( ) 和换行属于组合、重定向或表达式语法。
  // 圆括号在引号外是 PowerShell 表达式/子表达式：参数会先执行再传入，不能当作已核对字面值。
  if (typeof command !== 'string' || command.includes('\0')) return null;
  const tokens = [];
  let cursor = 0;
  while (cursor < command.length) {
    while (cursor < command.length && /\s/.test(command[cursor])) {
      // 引号外的换行在 PowerShell 中等同于命令分隔，不能当作普通 token 分隔符放行。
      if (command[cursor] === '\r' || command[cursor] === '\n') return null;
      cursor++;
    }
    if (cursor >= command.length) break;
    let value = '', started = false;
    // 空白只在引号外结束当前 token；引号内的空白属于同一个参数。
    while (cursor < command.length && !/\s/.test(command[cursor])) {
      const char = command[cursor];
      if (char === "'") {
        started = true;
        cursor++;
        let closed = false;
        while (cursor < command.length) {
          if (command[cursor] !== "'") { value += command[cursor++]; continue; }
          if (command[cursor + 1] === "'") { value += "'"; cursor += 2; continue; }
          cursor++;
          closed = true;
          break;
        }
        if (!closed) return null;
      } else if (char === '"') {
        started = true;
        cursor++;
        let closed = false;
        while (cursor < command.length) {
          const inner = command[cursor];
          if (inner === '"') { cursor++; closed = true; break; }
          // 双引号内的 $ 变量/子表达式与反引号转义不能当作已核对字面值。
          if (inner === '$' || inner === '`') return null;
          value += inner;
          cursor++;
        }
        if (!closed) return null;
      } else {
        if (/[;|&`$<>\r\n()]/.test(char)) return null;
        value += char;
        cursor++;
        started = true;
      }
    }
    if (!started) return null;
    tokens.push(value);
  }
  return tokens;
}
export function signalCommand(event) {
  const raw = event.tool_input?.command ?? event.tool_input?.cmd;
  if (typeof raw !== 'string') return null;
  // PowerShell 的直接调用可以带前导调用运算符 `&`；组合命令仍由 shellTokens 拒绝。
  return raw.trim().replace(/^&\s+/, '');
}
// CLI 用 transportArguments 还原 command() 为 PowerShell 5.1 编码的参数；Hook 必须用同一解码，
// 否则含空格/引号的入口、--input 路径或载荷会被当成另一条命令而漏检。
function signalTokens(event) {
  const tokens = shellTokens(signalCommand(event));
  if (!tokens) return null;
  return tokens.includes(TRANSPORT_FLAG) ? transportArguments(tokens) : tokens;
}
// 升级前开的会话可能仍持有旧发布副本的入口；状态根 releases 下的副本同属本插件，signal 输出格式一致，照常接受。
async function ownEntry(file, entry, directory) {
  const actual = await canonical(file);
  if (samePath(actual, await canonical(entry))) return true;
  if (!directory || path.basename(actual) !== 'workflow.mjs') return false;
  const releases = await canonical(path.join(directory, 'releases')).catch(() => null);
  return Boolean(releases && within(releases, actual) && path.relative(releases, actual).split(path.sep).length === 3);
}
export async function isSignalInvocation(event, entry = path.join(PRODUCT_ROOT, 'bin', 'workflow.mjs'), directory) {
  if (!['Bash', 'exec_command', 'PowerShell', 'powershell', 'pwsh'].includes(event.tool_name)) return false;
  const tokens = signalTokens(event);
  if (!tokens || tokens.length < 3) return false;
  const nodeToken = tokens[0];
  if (!['node', 'node.exe'].includes(nodeToken.toLowerCase()) && !samePath(path.resolve(nodeToken), process.execPath)) return false;
  try { if (!await ownEntry(tokens[1], entry, directory)) return false; } catch { return false; }
  let index = 2;
  while (tokens[index] === '--state-dir') index += 2;
  return tokens[index] === 'signal';
}
function isComposedSignal(event) {
  if (!['Bash', 'exec_command', 'PowerShell', 'powershell', 'pwsh'].includes(event.tool_name)) return false;
  const raw = signalCommand(event);
  // 入口可能藏在变量里（$wf=...; node $wf signal），命令里同时出现本插件入口和 signal 的输入参数或子命令就回执。
  // command() 生成的命令可能把入口路径编码成 workflow-arg64: 标记，此时传输开关本身就是本插件生成的证据。
  const entry = typeof raw === 'string' && (/workflow\.mjs/.test(raw) || raw.includes(TRANSPORT_FLAG));
  return entry && /\bsignal\s+(?:--(?:base64|input)\b|(?:task-start|task-update|task-end|phase|packages|role-claim|disposition|prepare)\s+--)/.test(raw);
}
// PreToolUse 的类型集合只描述“能否在动作发生前判断”，不依赖某个产品的自然语言。
// 写入工具按宿主实测名称收列；命令工具只有确认是本插件直接 signal 时才读取状态。
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'apply_patch', 'write_file', 'delete_file']);
// 系统临时目录例外只认宿主按路径写入的四个工具；补丁文本与外部命令的写入语义不足以判定真实目标，不放宽。
const TEMP_WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const DELEGATION_TOOLS = new Set(['Agent', 'Task', 'collaborationspawn_agent', 'spawn_agent', ...CODEG_DELEGATION_TOOLS, ...CINDY_ORCA_DELEGATION_TOOLS]);
const COMMAND_TOOLS = new Set(['Bash', 'exec_command', 'PowerShell', 'powershell', 'pwsh']);
// 规则编号只进本机决定记录，随返回值一起传递，但不出现在宿主输出里；判定结果保持原样。
const preToolUseAllow = (rule, reason = null) => ({ output: {}, decision: { rule, decision: 'allow', reason } });
const preToolUseAllowWith = (rule, output, reason = null) => ({ output, decision: { rule, decision: 'allow', reason: reason ?? output.systemMessage ?? null } });
const preToolUseDeny = (rule, message) => ({
  output: {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: message,
    },
    systemMessage: message,
  },
  decision: { rule, decision: 'deny', reason: message },
});
// apply_patch 的路径写在补丁文本里；只取明确的文件指令，不解析自然语言补丁内容。
function patchPaths(text) {
  if (typeof text !== 'string') return [];
  const paths = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\*\*\* (?:Add File|Update File|Delete File|Move to):\s*(.+?)\s*$/.exec(line);
    if (match) paths.push(match[1].replace(/^"(.*)"$/, '$1'));
  }
  return paths;
}
function toolTargets(event) {
  const { name, input } = hostTool(event);
  if (name === 'apply_patch') return patchPaths(input.command ?? input.patch);
  const value = input.file_path ?? input.notebook_path ?? input.path;
  return typeof value === 'string' && value ? [value] : [];
}
// 准备阶段只允许维护 docs/plans 下的合规 Markdown（含已绑定源计划与已登记关联计划）；业务源码、测试、
// .local 和任意后缀都不在范围内。与 preparation.normalizeSource 共用 resolvePlanPath：字面路径和真实路径
// 都必须在 docs/plans 下，且路径链上不能有 symlink/junction，所以“字面 md、实际指业务文件”的别名不会放行。
function isPreparationTarget(realRoot, target) {
  if (!target || typeof target !== 'string') return false;
  if (!within(realRoot, target)) return false;
  const relative = path.relative(realRoot, target).replaceAll('\\', '/');
  if (!relative || relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) return false;
  return !resolvePlanPath(realRoot, relative).error;
}
// 未开工与 plan 模式额外放行系统临时目录里的写入。测试夹具本身位于 os.tmpdir()、项目根又在夹具内部，
// 因此还要拒绝落在项目根上级（夹具父目录）的路径，避免从临时目录反向写进夹具业务文件。
// 路径链逐段 lstat 拒绝链接；目标已存在时，其真实路径必须仍在 tmp 内且不回到项目/状态目录。
function isSystemTempTarget(realRoot, realStateDir, realTmp, target) {
  if (within(realRoot, target) || (realStateDir && within(realStateDir, target))) return false;
  if (within(realTmp, realRoot) && within(path.dirname(target), realRoot)) return false;
  if (!within(realTmp, target) || samePath(realTmp, target)) return false;
  const parts = path.relative(realTmp, target).split(path.sep).filter(Boolean);
  let existing = realTmp;
  for (const [index, segment] of parts.entries()) {
    existing = path.join(existing, segment);
    let stat;
    try { stat = lstatSync(existing); } catch (error) {
      // 第一个不存在的段之后都不会存在；此前的父目录已逐段确认无链接且仍在 tmp 内。
      // ENOTDIR 等其它错误不能证明安全，保守拒绝。
      return error.code === 'ENOENT';
    }
    if (stat.isSymbolicLink()) return false;
    if (index === parts.length - 1) {
      let real;
      try { real = realpathSync(target); } catch { return false; }
      return within(realTmp, real) && !samePath(realTmp, real)
        && !within(realRoot, real) && !(realStateDir && within(realStateDir, real));
    }
  }
  return false;
}
// path.resolve 会把空段、`.` 与 `..` 折叠掉；计划目录放行必须先按原始字面段拒绝，
// 否则 `docs/plans/a/../x.md` 归一化后会被当成合规计划。绝对路径同样逐段核对，盘符/根锚点不是相对段。
function literalPathDetour(value) {
  const segments = value.replaceAll('\\', '/').split('/');
  const relative = segments[0] === '' ? segments.slice(1) : segments;
  return relative.some(segment => !segment || segment === '.' || segment === '..');
}
function planModeTargetAllowed(resolved, stateDir, tempDir, rawPath, allowTemp) {
  if (!rawPath || typeof rawPath !== 'string') return false;
  let realRoot;
  try { realRoot = realpathSync(resolved.worktree); } catch { return false; }
  const literal = path.resolve(resolved.cwd || resolved.worktree, rawPath);
  if (!literalPathDetour(rawPath) && isPreparationTarget(realRoot, literal)) return true;
  if (!allowTemp) return false;
  let realStateDir = null;
  let realTmp;
  try {
    if (stateDir) realStateDir = realpathSync(stateDir);
    realTmp = realpathSync(tempDir || os.tmpdir());
  } catch { return false; }
  return isSystemTempTarget(realRoot, realStateDir, realTmp, literal);
}
// 角色会话只按显式 roleTaskId 找父任务；没有绑定或包不存在时返回具体原因，不再跨活动任务按包 ID 首匹配。
function packageForSession(state, projectId, session) {
  if (!session?.packageId) return { reason: 'no-package' };
  if (!session.roleTaskId) return { reason: 'unbound' };
  const task = state.tasks[taskKey(projectId, session.roleTaskId)];
  if (!task) return { reason: 'task-missing' };
  if (task.lifecycle !== 'active') return { reason: 'task-inactive', task };
  const pkg = task.packages?.[session.packageId];
  if (!pkg) return { reason: 'package-missing', task };
  if (pkg.role !== session.role) return { reason: 'role-mismatch', task, pkg };
  return { task, pkg };
}
const DELEGATION_PACKAGE_MARK = /^workflow-package\s*[:：]\s*([A-Za-z0-9][A-Za-z0-9_.:-]{0,199})/i;
const DELEGATION_PACKAGE_KEYS = ['packageId', 'package_id'];
const DELEGATION_TEXT_KEYS = ['description', 'title', 'task_name', 'name', 'message', 'prompt', 'task'];
// 委派输入没有统一的包字段；只接受显式结构化关联：packageId/package_id，或 description/title/task_name/
// prompt/task/message 首行的 workflow-package:<id>。不解析自然语言叙述。多个标记不一致时拒绝，避免同时踩两个包。
function delegationPackageMarkers(input) {
  const markers = [];
  for (const key of DELEGATION_PACKAGE_KEYS) {
    if (typeof input[key] === 'string' && input[key].trim()) markers.push(input[key].trim());
  }
  for (const key of DELEGATION_TEXT_KEYS) {
    if (typeof input[key] !== 'string') continue;
    const match = DELEGATION_PACKAGE_MARK.exec(input[key].trim());
    if (match) markers.push(match[1]);
  }
  return [...new Set(markers)];
}
// 准备记录里的 Agent 常带模型/effort 说明（如“Claude Code (group/worker, high)”），
// 而通道尾部只能给出软件名（herdr:claude）。命令委派按基础词包含匹配：通道/程序名必须作为
// 声明文本里的一个独立词出现；codeg 与通道尾部的相等性用 sameBaseAgent 的完整词序比较。
function agentMatchesDeclared(declared, expected) {
  const wanted = agentBaseWords(expected);
  const tokens = agentBaseWords(declared);
  if (!wanted.length) return false;
  return wanted.every(token => tokens.includes(token));
}
// 每个委派工具按当前适配/宿主 schema 核对必需字段与 Agent 来源；没有可解析 Agent 的入口不能静默跳过比较。
const DELEGATION_ENTRIES = new Map([
  ['Agent', { channel: 'builtin:', required: ['description', 'prompt', 'subagent_type'], agentField: 'subagent_type' }],
  ['Task', { channel: 'builtin:', required: ['description', 'prompt', 'subagent_type'], agentField: 'subagent_type' }],
  ['collaborationspawn_agent', { channel: 'builtin:', required: ['task_name', 'message'], impliedAgent: 'codex' }],
  ['spawn_agent', { channel: 'builtin:', required: ['task_name', 'message'], impliedAgent: 'codex' }],
  ...CODEG_DELEGATION_TOOLS.filter(name => name.endsWith('delegate_to_agent')).map(name => [name, {
    channel: 'codeg:', required: ['task'], agentField: 'agent_type', assistantField: 'assistant_id', oneOf: ['agent_type', 'assistant_id'],
  }]),
  ...CODEG_DELEGATION_TOOLS.filter(name => name.endsWith('create_work_task')).map(name => [name, {
    channel: 'codeg:', required: ['title', 'prompt'], agentField: 'agent_type',
  }]),
]);
function requestedDelegationAgent(name, input) {
  const entry = DELEGATION_ENTRIES.get(name);
  if (entry?.agentField) return input[entry.agentField] ?? null;
  return entry?.impliedAgent ?? null;
}
// 委派入口的 schema 缺项与关联任务/角色核对；prompt/task 正文只作 opaque 输入，不解析语义或路径范围。
function delegationSchemaDenial(task, pkg, name, input) {
  const entry = DELEGATION_ENTRIES.get(name);
  if (!entry) return `未知委派入口 ${name}；先更新宿主适配，不能按未核对的入口派发`;
  const missing = entry.required.filter(key => typeof input[key] !== 'string' || !input[key].trim());
  if (entry.oneOf && !entry.oneOf.some(key => typeof input[key] === 'string' && input[key].trim())) missing.push(entry.oneOf.join('/'));
  if (missing.length) return `委派入口 ${name} 缺少可核对的必需字段：${missing.join('、')}；按该工具的真实参数补齐后再派发`;
  // Codeg delegate_to_agent 的 assistant_id 由宿主决定实际 Agent，workflow 没有可靠的 assistant→Agent 映射。
  // 只要出现 assistant_id 就拒绝，即使同时给了 agent_type：双字段不能证明最终执行者与准备记录一致。
  if (entry.assistantField) {
    const assistant = input[entry.assistantField];
    if (assistant !== undefined && assistant !== null && String(assistant).trim() !== '') {
      return `委派入口 ${name} 提供了 ${entry.assistantField}=${assistant}，但 workflow 没有可靠的 assistant→Agent 映射，无法核对工作包 ${pkg.packageId} 的 Agent；请移除 ${entry.assistantField} 并直接用 ${entry.agentField} 指定 Agent`;
    }
  }
  if (entry.agentField && !entry.oneOf && !(typeof input[entry.agentField] === 'string' && input[entry.agentField].trim())) {
    return `委派入口 ${name} 未给出 ${entry.agentField}，无法核对工作包 ${pkg.packageId} 的 Agent；显式指定 ${entry.agentField}，或更新准备记录`;
  }
  const requestedAgent = requestedDelegationAgent(name, input);
  if (entry.agentField && !requestedAgent) {
    return `委派入口 ${name} 未给出可解析的 ${entry.agentField}，无法核对工作包 ${pkg.packageId} 的 Agent；改用带 ${entry.agentField} 的入口`;
  }
  const taskRef = input.taskId ?? input.task_id;
  if (taskRef !== undefined && taskRef !== task.taskId) {
    return `委派输入关联的任务 ${taskRef} 与当前活动任务 ${task.taskId} 不一致；不能把包派到其他任务`;
  }
  // 仅在工具确实带角色字段时才比较，不按自然语言猜角色。
  const roleRef = input.role ?? input.packageRole;
  if (roleRef !== undefined && roleRef !== pkg.role) {
    return `委派输入声明角色 ${roleRef}，与工作包 ${pkg.packageId} 的角色 ${pkg.role || '未填'} 不一致`;
  }
  return null;
}
// 委派必须有可核验的工作包关联：已登记、dispatched、worker/reviewer、依赖已终态。
// 工具型入口（含 Codeg）与命令型入口（Herdr/hc）共用这段，通道和 Agent 来源各自核对。
function packageDelegationDenial(task, pkg) {
  if (!pkg) return `委派缺少可核验的工作包关联：在委派输入的任务文本或 description/title/task_name 首行写 workflow-package:<packageId>，并先在活动任务 packages 中登记该包；准备记录里的 scope 只是关联包声明，不是机器验证过的路径或语义沙箱`;
  if (pkg.status !== 'dispatched') return `工作包 ${pkg.packageId} 当前状态为 ${pkg.status}，不是 dispatched；不能据此发起委派`;
  if (pkg.supersededBy) return `工作包 ${pkg.packageId} 已被 ${pkg.supersededBy} 接替；改为派发接替包`;
  if (!['worker', 'reviewer'].includes(pkg.role)) return `工作包 ${pkg.packageId} 的角色是 ${pkg.role || '未填'}，委派只能关联 worker 或 reviewer 包`;
  for (const dependency of pkg.dependsOn || []) {
    const item = task.packages?.[dependency];
    if (!item) return `工作包 ${pkg.packageId} 的依赖 ${dependency} 未登记；先核对准备记录和包清单`;
    if (!TERMINAL_PACKAGE.includes(item.status)) return `工作包 ${pkg.packageId} 的依赖 ${dependency} 尚未终态（${item.status}）；先等依赖完成`;
  }
  return null;
}
// 委派必须有可核验的工作包关联：已登记、dispatched、worker/reviewer、依赖已终态、入口通道与 Agent 一致。
// 审查派工同样是合法委派；只有 role-claimed reviewer 会话自身不能写或再委派。
const subagentSearch = resolved => ({ cwd: resolved.cwd, worktree: resolved.worktree });
async function delegationDenial(task, pkg, name, input, search) {
  const shared = packageDelegationDenial(task, pkg);
  if (shared) return shared;
  if (!pkg.channel) return `工作包 ${pkg.packageId} 未记录实际调用通道；先按准备记录补齐 channel 再派发`;
  const entry = DELEGATION_ENTRIES.get(name);
  if (!entry) return `未知委派入口 ${name}；先更新宿主适配，不能按未核对的入口派发`;
  if (!pkg.channel.startsWith(entry.channel)) return `工作包 ${pkg.packageId} 的通道是 ${pkg.channel}，与委派入口 ${name} 要求的 ${entry.channel}* 不一致；先用该通道的委派工具，或更新准备绑定`;
  if (!pkg.agent) return `工作包 ${pkg.packageId} 未记录 Agent；先按准备记录补齐再派发`;
  if (!pkg.scope) return `工作包 ${pkg.packageId} 未记录负责范围；先按准备记录补齐再派发`;
  const schemaDenial = delegationSchemaDenial(task, pkg, name, input);
  if (schemaDenial) return schemaDenial;
  const requested = requestedDelegationAgent(name, input);
  // 只读诊断包只能用宿主能明确识别的只读子代理；不能拿 general-purpose/Codeg 委派借免审声明取得写入能力。
  // 只读按定义文件的 tools 判断，准备记录里的 Agent 是声明选择，不再要求它与 Explore/Plan 字面相等。
  if (pkg.diagnostic) {
    const readOnlyNative = (name === 'Agent' || name === 'Task') && await isReadOnlySubagent(requested, search);
    if (!readOnlyNative) return `工作包 ${pkg.packageId} 是只读诊断包：只能用 Explore/Plan 或定义文件 tools 全为只读工具的自定义子代理派发，不能使用 ${name}（${requested || '未指定'}）；诊断包不提供写入授权`;
    return null;
  }
  const channelTail = String(pkg.channel).split(':').slice(1).join(':');
  // Codeg 的通道本身编码实际 agent_type，必须同时匹配准备 Agent 与通道中的 Agent；
  // 只匹配其中一个会让“准备 agent=codex、channel=codeg:claude_code、实际 claude_code”通过。
  // 比较按基础词序进行，允许准备记录带模型/effort 括号说明；通道尾部没有可解析 Agent 时保守拒绝。
  if (entry.channel === 'codeg:') {
    if (!agentBaseWords(channelTail).length) return `工作包 ${pkg.packageId} 的通道 ${pkg.channel} 没有可映射的 Agent；Codeg 委派需要 codeg:<agent_type> 形式的实际通道，先更新准备记录`;
    if (!sameBaseAgent(requested, pkg.agent) || !sameBaseAgent(requested, channelTail)) {
      return `工作包 ${pkg.packageId} 的 Agent 与本次委派不一致（准备记录：${pkg.agent}；通道：${pkg.channel}；委派：${requested}）；Codeg 委派必须同时匹配准备 Agent 与通道中的 Agent`;
    }
    return null;
  }
  if (!agentBaseWords(requested).length || (!sameBaseAgent(requested, pkg.agent) && !sameBaseAgent(requested, channelTail))) {
    return `工作包 ${pkg.packageId} 的 Agent 与本次委派不一致（准备记录：${pkg.agent}；委派：${requested}）`;
  }
  return null;
}
// 命令型与工具型外部委派（Herdr TUI / hc / Cindy Orca）共享同一套包规则，但 Agent 来源不同：
// herdr prompt、hc send 与 Orca send_to_worker 没有 Agent 字段，只能核对通道尾部；hc 模板没有 Agent，只能精确核对通道。
// 适配器按 { entry, channelPrefix, agent, declaredAgent, text, packageMarkers, exactChannel } 提供描述，
// 后续软件适配可直接复用，不在这里按软件名分支。
const COMMAND_COMPOSITION_DENIAL = 'workflow 未核对：命令里出现 herdr/hc 委派子命令，但不是单条直接调用（含 &&、;、管道、变量赋值或子 shell）。请改为单独直接调用一条委派命令；workflow 不解析复合 shell。';
function commandDelegationDenial(task, pkg, descriptor) {
  const shared = packageDelegationDenial(task, pkg);
  if (shared) return shared;
  if (pkg.diagnostic) return `工作包 ${pkg.packageId} 是只读诊断包：不能用 ${descriptor.entry} 派发；诊断包只允许明确只读的 Explore/Plan 子代理，不提供写入授权`;
  if (!pkg.channel) return `工作包 ${pkg.packageId} 未记录实际调用通道；先按准备记录补齐 channel 再派发`;
  if (!pkg.agent) return `工作包 ${pkg.packageId} 未记录 Agent；先按准备记录补齐再派发`;
  if (!pkg.scope) return `工作包 ${pkg.packageId} 未记录负责范围；先按准备记录补齐再派发`;
  // 模板没有 Agent 映射：通道本身就是唯一可核对的身份，必须精确相等。
  if (descriptor.exactChannel) {
    if (pkg.channel !== descriptor.exactChannel) {
      return `工作包 ${pkg.packageId} 的通道是 ${pkg.channel}，与模板委派要求的精确通道 ${descriptor.exactChannel} 不一致；模板名不能映射 Agent，只能用 hc:template:<name> 精确声明`;
    }
    return null;
  }
  if (!pkg.channel.startsWith(descriptor.channelPrefix)) {
    return `工作包 ${pkg.packageId} 的通道是 ${pkg.channel}，与委派入口 ${descriptor.entry} 要求的 ${descriptor.channelPrefix}* 不一致；先用该通道的委派方式，或更新准备绑定`;
  }
  const channelTail = String(pkg.channel).slice(descriptor.channelPrefix.length);
  if (descriptor.agent) {
    // declaredAgent 是同一 Agent 的声明级别名（如 Orca 的 claude-code → claude），只用于和准备记录比对。
    const declaredAgent = descriptor.declaredAgent ?? descriptor.agent;
    if (!agentBaseWords(descriptor.agent).length || !agentMatchesDeclared(pkg.agent, declaredAgent) || !sameBaseAgent(descriptor.agent, channelTail)) {
      return `工作包 ${pkg.packageId} 的 Agent 与本次委派不一致（准备记录：${pkg.agent}；通道：${pkg.channel}；委派：${descriptor.agent}）；命令委派必须同时匹配准备 Agent 与通道中的 Agent`;
    }
    return null;
  }
  // 没有 Agent 来源的入口（herdr prompt、hc send、Orca send_to_worker）：只按通道尾部核对准备记录，不宣称已验证目标 Agent。
  if (!agentBaseWords(channelTail).length) return `工作包 ${pkg.packageId} 的通道 ${pkg.channel} 没有可映射的 Agent；该委派入口需要 ${descriptor.channelPrefix}<agent> 形式的实际通道，先更新准备记录`;
  if (!agentMatchesDeclared(pkg.agent, channelTail)) {
    return `工作包 ${pkg.packageId} 的通道 ${pkg.channel} 与准备记录 Agent ${pkg.agent} 不一致；该入口不带 Agent 字段，只能按通道尾部核对，先修正准备绑定`;
  }
  return null;
}
function signalInvocationDetails(event) {
  const tokens = signalTokens(event);
  if (!tokens) return null;
  let index = 2;
  while (tokens[index] === '--state-dir') index += 2;
  if (tokens[index] !== 'signal') return null;
  const flags = {};
  let action = tokens[index + 1];
  if (action?.startsWith('--')) action = null;
  for (let at = action ? index + 2 : index + 1; at < tokens.length; at++) {
    const token = tokens[at];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    if (tokens[at + 1] !== undefined && !tokens[at + 1].startsWith('--')) {
      flags[key] = tokens[at + 1];
      at++;
    } else flags[key] = true;
  }
  return { action, flags };
}
async function signalInput(event, details) {
  if (!details) return null;
  try {
    if (details.flags.input && typeof details.flags.input === 'string') {
      const file = path.resolve(event.cwd, details.flags.input);
      const text = await readFile(file, 'utf8');
      return JSON.parse(text.replace(/^﻿/, ''));
    }
    if (details.flags.base64 && typeof details.flags.base64 === 'string') {
      return JSON.parse(Buffer.from(details.flags.base64, 'base64').toString('utf8'));
    }
  } catch { /* 输入文件不可读或不是 JSON：CLI 会拒绝，PreToolUse 不抢先猜。 */ }
  return null;
}
function preparationGapText(gaps) {
  return gaps.map(gap => gap.message).join('、');
}
// 任务声明的只读/计划权限是实际写入的上限；宿主模式仍是更高优先级的约束，这里只补任务声明这一层。
// 计划模式只继续允许准备资料维护和系统临时目录写入，不把计划任务变成业务写入授权。
async function taskModeDenial(task, name, event, resolved, stateDir, tempDir, externalDelegate = false) {
  const mode = task?.permissions?.mode;
  if (mode !== 'read-only' && mode !== 'plan') return null;
  if (externalDelegate) {
    return `任务权限为 ${mode}：不能通过 herdr/hc 命令或 Cindy 委派入口派实施包或启动实施子代理；先由 Lead 用 task-update 取得用户授权并改为可写。`;
  }
  if (DELEGATION_TOOLS.has(name)) {
    // 只读委派按定义文件的工具能力判断，不按名字猜诊断身份。Codex/Codeg 没有可信只读类型时仍拒绝。
    const type = requestedDelegationAgent(name, hostTool(event).input);
    if ((name === 'Agent' || name === 'Task') && await isReadOnlySubagent(type, subagentSearch(resolved))) return null;
    return `任务权限为 ${mode}：不能派实施包或启动实施子代理；Explore/Plan 或定义文件 tools 全为只读工具的自定义子代理除外，先由 Lead 用 task-update 取得用户授权并改为可写。`;
  }
  if (!WRITE_TOOLS.has(name)) return null;
  if (mode === 'read-only') return '任务权限为 read-only：不能修改文件；只做读取、检索和结论交付，确需写入先由 Lead 用 task-update 取得用户授权。';
  const targets = toolTargets(event);
  if (!targets.length) return '任务权限为 plan：无法识别这次写入目标；计划模式只允许维护准备资料。';
  const blocked = targets.filter(target => !planModeTargetAllowed(resolved, stateDir, tempDir, target, TEMP_WRITE_TOOLS.has(name)));
  return blocked.length ? `任务权限为 plan：不能修改业务文件（${blocked.join('、')}）；计划模式只允许维护准备资料和系统临时目录。` : null;
}
// 路径规则只核对实际写入，不校验 task-start 的初始 allowedPaths。
// 配置缺失或为空即不生效；命中且没有对应咨询记录时只提醒，不拦截，每个键只提醒一次。
async function pathRuleGate(directory, state, project, task, session, event, name, resolved) {
  if (!task || !gateApplies(task) || !WRITE_TOOLS.has(name)) return null;
  const targets = toolTargets(event);
  if (!targets.length) return null;
  const config = await readGateConfig(project.knowledgeRoot);
  if (config.error) return { note: config.error };
  if (!config.rules.length) return null;
  const relative = targets
    .map(target => path.relative(resolved.worktree, path.resolve(resolved.cwd || resolved.worktree, target)).replaceAll('\\', '/'))
    .filter(item => item && item !== '..' && !item.startsWith('../') && !path.isAbsolute(item));
  const pending = unremindedHits(pathRuleHits(relative, config.rules), session?.reminded, task.taskId);
  if (!pending.keys.length) return null;
  const { records, corrupt } = await readTaskConsultations(directory, state, task);
  if (consultationMatches(records, { taskId: task.taskId })) return null;
  const unreadable = corrupt.length ? `咨询记录无法解析（${corrupt.join('、')}），无法确认是否已咨询；` : '';
  return {
    keys: pending.keys,
    note: `${unreadable}项目路径规则命中重要变化：${pending.text}。本次只提醒，不拦截；需要第二意见时调用 workflow-advisor，记录会写入会话咨询记录。`,
  };
}
// 提醒键像 jevNotice 一样只写会话字段：同一会话同一键只提醒一次，不改变信号结果。
async function rememberReminderKeys(directory, projectId, sessionId, keys) {
  if (!keys?.length) return;
  try {
    await mutate(directory, async state => {
      const session = state.sessions[sessionKey(projectId, sessionId)];
      if (!session) return;
      session.reminded ||= {};
      for (const key of keys) session.reminded[key] ||= new Date().toISOString();
    });
  } catch { /* 提醒键写入失败不阻断本次写入 */ }
}
// jev 只判断 Lead 写出来的说明：复杂准备、复杂写入任务的 task-update 与 packages 参与。
// 宿主只读/计划模式是实际权限上限；prepare 还要看会话当前活动任务声明的只读/计划权限与 operation-only 分流。
// task-update 必须按更新后的模式判断：read-only/plan 改为 write 时仍要送判，write 改为只读/计划时不送判。
// 这些场景不发网络请求。配置损坏、网关不可达、超时或响应不符都按未命中处理，只在首次给一次提示。
const isBlockedMode = mode => mode === 'read-only' || mode === 'plan';
function jevApplies(payload, task, session) {
  if (isBlockedMode(session?.permissionMode)) return false;
  // 已完成任务的旧权限/分流不约束新的准备记录，只按活动任务核对。
  const activeTask = task?.lifecycle === 'active' ? task : null;
  if (payload.action === 'prepare') {
    if (isBlockedMode(activeTask?.permissions?.mode)) return false;
    if (activeTask?.route === 'operation-only') return false;
    return payload.preparation?.size === 'complex';
  }
  if (payload.action === 'task-update') return Boolean(activeTask) && gateApplies(activeTask, payload.permissions?.mode ?? activeTask.permissions.mode);
  if (payload.action === 'packages') return Boolean(activeTask) && gateApplies(activeTask);
  return false;
}
async function jevSignalGate(config, payload, task, session) {
  if (!config || !jevApplies(payload, task, session)) return null;
  if (config.jevError) return jevFailureNotice(config.jevError);
  if (!config.jev?.enabled) return null;
  return checkJev(config.jev, payload.action, payload);
}
// PreToolUse 只做三类可判定的事：未开工时的业务写入、实施委派、本插件 task-start/packages 命令。
// 读、检索、写计划、prepare 以及普通 shell 命令不读取状态直接放行；普通 shell 里的任意文件写入无法可靠区分。
async function preToolUse(directory, event, options, agent) {
  const { name, input } = hostTool(event);
  // Cindy 的两条入口都藏在 MCP 工具里：Orca 按工具名，Session task 按 call_tool 的 name 字段。
  // 非派工动作（start_team、check_session_task 等）解析为 null，下面按普通工具放行。
  const cindyCall = cindyToolDelegation(name, input);
  const cindyDelegate = cindyCall !== null;
  const relevant = WRITE_TOOLS.has(name) || DELEGATION_TOOLS.has(name) || COMMAND_TOOLS.has(name) || cindyDelegate;
  if (!relevant) return preToolUseAllow('A01', '与 workflow 判定无关的工具');
  // 宿主标记为只读的子代理共享父会话身份，也不能写文件或继续委派；其他子代理的实际包所有权
  // 由发起时的 workflow-package 关联核对，这里不按 agent_id 猜包。子代理事件先解析项目，
  // 未接入目录只按事件 cwd 这一层查定义。
  const subagentWrite = isSubagentEvent(event) && (WRITE_TOOLS.has(name) || DELEGATION_TOOLS.has(name) || cindyDelegate);
  if (subagentWrite) {
    const state = await readState(directory);
    const resolved = await resolveProject(state, event.cwd);
    const search = resolved ? subagentSearch(resolved) : { cwd: event.cwd };
    if (await isReadOnlySubagent(event.agent_type, search)) return preToolUseDeny('A02', `只读子代理 ${event.agent_type} 不能修改文件或继续委派；只做读取、检索和结论交付。`);
  }
  // 命令工具先用命令文本筛掉明显不是本插件入口或 Herdr/hc 委派的调用，再确认确实是直接 signal。
  // 复合命令不解析：只根据原文里是否出现委派子命令给出“改单条调用”的拒绝。
  let commandDelegation = null;
  let commandComposed = false;
  if (COMMAND_TOOLS.has(name)) {
    const raw = signalCommand(event);
    if (typeof raw !== 'string') return preToolUseAllow('A03', '命令输入不是字符串');
    const tokens = shellTokens(raw);
    // 复合命令即使同时含本插件 signal 也不解析；只要原文出现委派子命令就交给后面的会话核对。
    if (!tokens && mentionsHerdrDelegation(raw)) commandComposed = true;
    const signalLike = raw.includes('workflow.mjs') || raw.includes(TRANSPORT_FLAG);
    if (signalLike && await isSignalInvocation(event, options.entry, directory)) {
      // 本插件 signal：继续走下面的状态核对。
    } else {
      if (tokens) commandDelegation = resolveCommandDelegation(tokens, { markers: text => delegationPackageMarkers({ message: text }) });
      if (!commandDelegation && !commandComposed) return preToolUseAllow('A04', '不是本插件入口或委派命令');
    }
  }
  const commandDelegate = Boolean(commandDelegation);
  const state = await readState(directory);
  const resolved = await resolveProject(state, event.cwd);
  if (!resolved) return preToolUseAllow('A05', '目录未接入 workflow');
  const projectId = resolved.project.projectId;
  const session = state.sessions[sessionKey(projectId, event.session_id)];
  if (!session) return preToolUseAllow('A06', '会话未登记');
  if (commandComposed) return preToolUseDeny('A07', COMMAND_COMPOSITION_DENIAL);
  // 子代理的 PreToolUse 已在上层按 agent_id 放行；委派子会话若声明了角色，按包所有权核对。
  if (session.role) {
    if (!WRITE_TOOLS.has(name) && !DELEGATION_TOOLS.has(name) && !commandDelegate && !cindyDelegate) return preToolUseAllow('A08', '角色会话的非写入/委派调用');
    if (session.role === 'reviewer') return preToolUseDeny('A09', 'Reviewer 只读审查：不能修改源码、测试或配置；把审查结论交回 Lead。');
    const owned = packageForSession(state, projectId, session);
    const hints = {
      'no-package': 'role-claim 未给出 packageId；用 signal role-claim --role worker --package <包ID> --task <活动任务ID> 重新声明',
      unbound: `会话没有绑定父任务；用 signal role-claim --role ${session.role} --package ${session.packageId || '<包ID>'} --task <活动任务ID> 重新声明`,
      'task-missing': `role-claim 绑定的任务 ${session.roleTaskId} 不存在；先由 Lead 核对任务 ID 再重新声明`,
      'task-inactive': `role-claim 绑定的任务 ${session.roleTaskId} 不是活动任务；先由 Lead 确认当前任务再重新声明`,
      'package-missing': `任务 ${session.roleTaskId} 没有工作包 ${session.packageId}；先由 Lead 用 packages 登记 dispatched 包，再开始实施`,
    };
    if (!owned.pkg) return preToolUseDeny('R01', `已声明为 ${session.role}，但无法关联工作包：${hints[owned.reason] || hints.unbound}。`);
    if (owned.pkg.role !== session.role) return preToolUseDeny('R02', `工作包 ${owned.pkg.packageId} 的角色是 ${owned.pkg.role || '未填'}，与会话声明 ${session.role} 不一致；先由 Lead 核对 role-claim。`);
    if (owned.pkg.status !== 'dispatched') return preToolUseDeny('R03', `工作包 ${owned.pkg.packageId} 当前状态为 ${owned.pkg.status}，不是 dispatched；工作结束后不能继续直接写入，返修由 Lead 重新派发。`);
    // 只读诊断包即使以 worker 角色声明也只读：不能借免审声明写业务，也不再向下委派。
    if (owned.pkg.diagnostic) {
      if (WRITE_TOOLS.has(name)) return preToolUseDeny('R04', `工作包 ${owned.pkg.packageId} 是只读诊断包：不能修改文件；把结论写在交付 note 交回 Lead。`);
      if (DELEGATION_TOOLS.has(name) || commandDelegate || cindyDelegate) return preToolUseDeny('R05', `工作包 ${owned.pkg.packageId} 是只读诊断包：不能继续委派子代理；只做范围内的读取和结论交付。`);
    }
    const modeDenied = await taskModeDenial(owned.task, name, event, resolved, directory, options.tempDir, commandDelegate || cindyDelegate);
    if (modeDenied) return preToolUseDeny('R06', modeDenied);
    const pathGate = await pathRuleGate(directory, state, resolved.project, owned.task, session, event, name, resolved);
    if (pathGate?.note) {
      await rememberReminderKeys(directory, projectId, event.session_id, pathGate.keys);
      return preToolUseAllowWith('R08', { systemMessage: pathGate.note });
    }
    return preToolUseAllow('R09', '角色会话的包所有权与权限核对通过');
  }
  const task = session.taskId ? state.tasks[taskKey(projectId, session.taskId)] : null;
  const active = task?.lifecycle === 'active';
  const preparation = session.preparation || null;
  const gaps = preparation ? preparationMissing(preparation) : null;
  const taskMessage = plan => `${plan}。准备阶段可以继续读代码、检索和写系统临时目录，并可维护 docs/plans/ 下任意合规 Markdown 计划；完整准备保存后先 task-start；简单任务用 task-start --size simple --size-reason "<理由>" 声明。`;
  // 命令型委派：Herdr TUI / hc 没有宿主工具事件，只能在这里按工作包核对。
  // 纯启动（agent start、不带任务的 hc run）只做未开工拦截；hc send 无包标记时可能是子会话回报，开工后不按派工核对。
  if (commandDelegation) {
    if (active) {
      const modeDenied = await taskModeDenial(task, name, event, resolved, directory, options.tempDir, true);
      if (modeDenied) return preToolUseDeny('C01', modeDenied);
      if (commandDelegation.pureStart) return preToolUseAllow('C02', '命令委派为纯启动，只做未开工拦截');
      const markers = commandDelegation.packageMarkers;
      if (markers.length > 1) return preToolUseDeny('C03', `委派命令同时给出多个工作包标记（${markers.join('、')}）；一次委派只能关联一个包。`);
      if (!markers.length && commandDelegation.entry === 'hc-send') return preToolUseAllow('C04', 'hc send 无包标记，可能是子会话回报');
      const pkg = markers[0] ? task.packages?.[markers[0]] : null;
      const denial = commandDelegationDenial(task, pkg, commandDelegation);
      return denial ? preToolUseDeny('C05', denial) : preToolUseAllow('C06', '命令委派按工作包核对通过');
    }
    return preToolUseDeny('C07', taskMessage(`实施委派被拦下（${commandDelegation.entry}）`));
  }
  // Cindy：Orca 是唯一受控派工入口；Session task 没有可靠 Agent 映射，开工后带包标记一律拒绝。
  // create_workers 逐项核对，任一项不合规即整体拒绝并指出是哪一项。
  if (cindyCall) {
    if (cindyCall.error) return preToolUseDeny('D01', `${cindyCall.error}；已拒绝本次派工`);
    if (active) {
      const modeDenied = await taskModeDenial(task, name, event, resolved, directory, options.tempDir, true);
      if (modeDenied) return preToolUseDeny('D02', modeDenied);
      for (const item of cindyCall.items) {
        const label = item.index === undefined ? item.entry : `${item.entry}[${item.index}]${item.label ? `（${item.label}）` : ''}`;
        if (item.invalid) return preToolUseDeny('D03', `${label} ${item.invalid}；已整体拒绝本次 create_workers`);
        if (cindyCall.kind === 'session') {
          if (item.packageMarkers.length) {
            return preToolUseDeny('D04', `Session task 没有可靠的 Agent 映射，不能用 workflow-package 做受控派工；受控派工请改用 Orca create_worker（通道 cindy:orca:<agent>）`);
          }
          return preToolUseDeny('D05', `${packageDelegationDenial(task, null)}；Session task 即使补包标记也不能作为受控派工，受控派工请改用 Orca create_worker`);
        }
        if (item.packageMarkers.length > 1) return preToolUseDeny('D06', `${label} 同时给出多个工作包标记（${item.packageMarkers.join('、')}）；一次委派只能关联一个包`);
        // create_worker/create_workers 创建的就是执行 Agent，没有 initial_task 也不能免包关联；
        // send_to_worker 没有 Agent 字段，只按 cindy:orca:<agent> 通道尾部核对准备记录。
        if (item.entry !== 'cindy-orca-send_to_worker' && !item.agent) {
          return preToolUseDeny('D07', `${label} 未给出可解析的 agent，无法核对工作包的 Agent；显式指定 agent 后再派发`);
        }
        const pkg = item.packageMarkers[0] ? task.packages?.[item.packageMarkers[0]] : null;
        const denial = commandDelegationDenial(task, pkg, item);
        if (denial) return preToolUseDeny('D08', `${label}：${denial}`);
      }
      return preToolUseAllow('D09', 'Cindy 派工按工作包核对通过');
    }
    return preToolUseDeny('D10', taskMessage(`实施委派被拦下（${cindyCall.items[0]?.entry || name}）`));
  }
  if (COMMAND_TOOLS.has(name)) {
    const details = signalInvocationDetails(event);
    if (!details) return preToolUseAllow('T01', '命令不是本插件 signal 写法');
    const inputPayload = await signalInput(event, details);
    const action = details.action || inputPayload?.action || null;
    if (action === 'prepare') return preToolUseAllow('T02', 'prepare 只保存准备记录');
    if (action === 'packages') {
      if (active) return preToolUseAllow('T03', '活动任务上的 packages 记账');
      return preToolUseDeny('T04', '尚未开始任务：packages 只能在活动任务上记账；先完整准备并 task-start，或按简单任务声明后 task-start。');
    }
    if (action !== 'task-start') return preToolUseAllow('T05', '非 task-start 的插件信号');
    if (active) return preToolUseAllow('T06', '接续已有任务，准备记录已在开工时绑定'); // 接续已有任务，准备记录已在开工时绑定。
    const route = details.flags.route ?? inputPayload?.route;
    if (route === 'operation-only') {
      // operation-only 不是业务写入豁免；协议层同样拒绝，这里在动作前直接给出缺项。
      const mode = details.flags.mode ?? inputPayload?.permissions?.mode;
      if (mode === 'write') return preToolUseDeny('T07', 'operation-only 只用于例行操作和事务，不能声明业务写入权限；需要写业务文件时改用 lead-direct 或 delegated 并按准备要求开工。');
      return preToolUseAllow('T08', 'operation-only 且未声明业务写入');
    }
    if (preparation && gaps.length) return preToolUseDeny('T09', preparationGapText(gaps) + '。' + taskMessage('准备记录尚未齐全，不能开始实施'));
    if (preparation && gaps.length === 0) {
      if (route === 'delegated' && preparation.size !== 'complex') return preToolUseDeny('T10', '分工任务需要完整的复杂准备记录；当前只有简单任务记录，不能开始派包。');
      return preToolUseAllow('T11', '已有完整准备记录，开工');
    }
    const size = details.flags.size ?? inputPayload?.size;
    const sizeReason = details.flags['size-reason'] ?? inputPayload?.sizeReason;
    if (size === 'simple' && typeof sizeReason === 'string' && sizeReason.trim()) return preToolUseAllow('T12', '简单任务带非空理由，开工');
    if (size === 'complex') return preToolUseDeny('T13', '复杂任务开始前先用 prepare 保存完整准备记录，再 task-start。');
    return preToolUseDeny('T14', taskMessage('尚未保存准备记录，也没有声明简单任务'));
  }
  // 业务写入：没有活动任务时，只允许准备资料维护；已有活动任务则沿用任务权限/包所有权，不把准备齐当成任意写入。
  if (WRITE_TOOLS.has(name)) {
    if (active) {
      const modeDenied = await taskModeDenial(task, name, event, resolved, directory, options.tempDir);
      if (modeDenied) return preToolUseDeny('B01', modeDenied);
      const pathGate = await pathRuleGate(directory, state, resolved.project, task, session, event, name, resolved);
      if (pathGate?.note) {
        await rememberReminderKeys(directory, projectId, event.session_id, pathGate.keys);
        return preToolUseAllowWith('B03', { systemMessage: pathGate.note });
      }
      return preToolUseAllow('B04', '活动任务内的业务写入核对通过');
    }
    const targets = toolTargets(event);
    if (!targets.length) return preToolUseDeny('B05', taskMessage('无法识别这次写入的目标文件'));
    const blocked = targets.filter(target => !planModeTargetAllowed(resolved, directory, options.tempDir, target, TEMP_WRITE_TOOLS.has(name)));
    if (!blocked.length) return preToolUseAllow('B06', '未开工时的准备资料或系统临时目录写入');
    if (preparation && gaps.length) return preToolUseDeny('B07', preparationGapText(gaps) + '。' + taskMessage(`业务写入被拦下：${blocked.join('、')}`));
    return preToolUseDeny('B08', taskMessage(`业务写入被拦下：${blocked.join('、')}`));
  }
  // 实施委派：没有活动任务时只放行明确只读的子代理；Codex 的 spawn 参数不含可核对的只读标记，故一律要求先开工。
  if (DELEGATION_TOOLS.has(name)) {
    if (active) {
      const modeDenied = await taskModeDenial(task, name, event, resolved, directory, options.tempDir);
      if (modeDenied) return preToolUseDeny('G01', modeDenied);
      // 先解析包标记：只读子代理只有在没有声明工作包时才保留免关联豁免。
      // 带了 workflow-package:<id> 就必须按该包核对状态、通道、Agent 和角色，不能借 Explore/Plan 绕过。
      const markers = delegationPackageMarkers(input);
      if (markers.length > 1) return preToolUseDeny('G02', `委派输入同时给出多个工作包标记（${markers.join('、')}）；一次委派只能关联一个包。`);
      if (!markers.length && (name === 'Agent' || name === 'Task') && await isReadOnlySubagent(requestedDelegationAgent(name, input), subagentSearch(resolved))) return preToolUseAllow('G03', '只读子代理且未声明工作包');
      const packageId = markers[0] || null;
      const pkg = packageId ? task.packages?.[packageId] : null;
      const denial = await delegationDenial(task, pkg, name, input, subagentSearch(resolved));
      return denial ? preToolUseDeny('G04', denial) : preToolUseAllow('G05', '实施委派按工作包核对通过');
    }
    if (name === 'Agent' || name === 'Task') {
      const type = input.subagent_type ?? input.agent_type;
      // 未开工时也只放行没有包标记的明确只读子代理；有标记就说明在冒充已登记委派。
      if (await isReadOnlySubagent(type, subagentSearch(resolved)) && !delegationPackageMarkers(input).length) return preToolUseAllow('G06', '未开工时的只读子代理');
    }
    return preToolUseDeny('G07', `实施委派被拦下（${name}）：未开工时只放行不带 workflow-package 标记、Explore/Plan 或定义文件 tools 全为只读工具的自定义子代理；实施/审查包需要先保存准备记录，并由用户明确授权后用 task-start 开工。`);
  }
  return preToolUseAllow('G08', '未命中任何 PreToolUse 判定分支');
}
// 宿主 hook 超时：Codex 的 Interrupt/SessionEnd 只有 3 秒，其余 10 秒。锁等待预算必须留出
// 启动、解析和落盘余量，预算耗尽时保守放行，不越过宿主上限。
const LOCK_BUDGET = { lifecycle: 700, normal: 1500 };
const lockBudget = name => LIFECYCLE_EVENTS.includes(name) ? LOCK_BUDGET.lifecycle : LOCK_BUDGET.normal;
// task-end/Stop 的 spec 检查在状态锁外预检；8 秒是从预检开始计算的 Git 调用共享截止时间，
// 不保证整个 Hook 在宿主 10 秒回执窗口内返回：同步快照读取不可中断且同样消耗截止时间，
// 锁内 ref 复核另按独立预算计时，预检之外的启动、解析与状态写入也占时间。
const SPEC_CHECK_BUDGET_MS = 8000;
// 与 protocol.identifier 相同的字面形状；非法 ref 会在信号校验处被拒，不先拿去查 Git。
const SPEC_REF = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;
// 入口拿不到身份时的唯一提示：不冒充入口成功，也不创建猜测身份。
const identityHint = 'workflow 本回合未建立入口身份（缺少宿主回合标识或会话未登记）：已保守放行；下一次 SessionStart/UserPromptSubmit 会重新建立，业务任务和票据不在此处猜测。';
// PreToolUse 的判定附带规则编号：编号只进本机决定记录，输出保持原样；记录失败不影响判定。
async function runPreToolUse(directory, event, options, agent) {
  const context = {
    sessionId: event.session_id,
    event: 'PreToolUse',
    host: agent,
    toolUseId: typeof event.tool_use_id === 'string' ? event.tool_use_id : null,
    toolName: typeof event.tool_name === 'string' ? event.tool_name : null,
    turnId: typeof event.prompt_id === 'string' ? event.prompt_id : (typeof event.turn_id === 'string' ? event.turn_id : null),
    transcriptPath: typeof event.transcript_path === 'string' ? event.transcript_path : null,
  };
  try {
    const { output, decision } = await preToolUse(directory, event, options, agent);
    await recordDecision(directory, { ...context, ...decision });
    return output;
  } catch (error) {
    await recordDecision(directory, { ...context, rule: 'X01', decision: 'failed', reason: error.message });
    throw error;
  }
}
// Stop 的规则编号只用于决定记录；block/allow 结果仍完全由协议函数给出。
function describeStop(session, task, event, agent, output) {
  const base = {
    sessionId: session.sessionId,
    event: 'Stop',
    host: agent,
    turnId: typeof event.prompt_id === 'string' ? event.prompt_id : (typeof event.turn_id === 'string' ? event.turn_id : session.turnId || null),
    transcriptPath: typeof event.transcript_path === 'string' ? event.transcript_path : null,
  };
  if (session.role || session.interrupted) return { ...base, rule: 'S01', decision: 'allow', reason: '角色会话或已中断，不核对' };
  if (event.stop_hook_active === true) return { ...base, rule: 'S02', decision: 'allow', reason: '宿主已在阻挡后的 Stop 中，不重复核对' };
  // stop() 在返回 block 前会写入 stopBlockedTurn；这里先认本次结果，避免把刚挡下的回合误记为“已挡过”。
  if (output?.decision === 'block') {
    const reason = String(output.reason || '');
    return { ...base, rule: /个工作包在途/.test(reason) ? 'S10' : 'S11', decision: 'block', reason };
  }
  if (session.stopBlockedTurn === session.turnId) return { ...base, rule: 'S02', decision: 'allow', reason: '本回合已挡过或重复 Stop' };
  if (['waiting-user', 'operation-only'].includes(session.phase)) return { ...base, rule: 'S03', decision: 'allow', reason: '等待用户或纯操作回合，不核对' };
  if (!task || task.lifecycle !== 'active' || task.route === 'operation-only') return { ...base, rule: 'S04', decision: 'allow', reason: '没有活动业务任务，不核对' };
  return { ...base, rule: 'S05', decision: 'allow', reason: '活动任务但本回合未进入交付，不核对' };
}
export async function handleHook(directory, event, options = {}) {
  // 结束事件独立落盘后，即使后续拿不到状态锁也要如实说明它已保存。
  let recordedLifecycle = null;
  // 记录失败的信息必须带到外层：状态锁再失败时也要说明事件既未落盘也未应用。
  let lifecycleNote = '';
  try {
    const agent = HOSTS.includes(options.agent) ? options.agent : 'codex';
    if (!event || typeof event !== 'object' || !HOST_EVENTS[agent].includes(event.hook_event_name)) return {};
    if (agent === 'codex' && Object.hasOwn(event, 'transcript_path') && event.transcript_path === null) return {};
    if (typeof event.cwd !== 'string' || typeof event.session_id !== 'string' || !event.session_id) return {};
    const name = event.hook_event_name;
    if (process.env.WORKFLOW_REVIEW === '1') return {};
    if (isSubagentEvent(event)) {
      // 子代理内部工具调用沿用父会话的任务/准备状态做执行前检查；它没有自己的 workflow 身份，
      // 因此不建立回执，也不让它的 signal 被记账。只读子代理的 Read/Grep 仍直接放行。
      if (name === 'PreToolUse') return await runPreToolUse(directory, event, options, agent);
      // 内置子代理没有 workflow 身份：它发的 signal 不记录，回一句说明，免得它反复重发或停下等回执。
      if (name === 'PostToolUse' && (await isSignalInvocation(event, options.entry, directory) || isComposedSignal(event))) return contextOutput(name, 'workflow 未接受：宿主内置子代理与 Lead 共用会话，没有自己的 workflow 身份，信号不记录。不要重发 role-claim 或其他信号；按工作包和对应角色指引完成工作，把结果交回 Lead，由 Lead 记账。');
      return {};
    }
    // 工具执行前检查不进入状态锁：只读状态并返回允许/拒绝，避免在动作前扩大写入与锁竞争。
    // 未接入目录、无关工具和普通读取在 preToolUse 内部先行放行。
    if (name === 'PreToolUse') return await runPreToolUse(directory, event, options, agent);
    const hostMode = typeof event.permission_mode === 'string' && event.permission_mode.trim() ? event.permission_mode : null;
    const question = QUESTION_TOOLS[agent].includes(event.tool_name);
    const signalInvocation = name === 'PostToolUse' && await isSignalInvocation(event, options.entry, directory);
    // 组合命令里的本插件 signal 不接受，但要回执说明，否则模型只能从 revision 反推信号丢失。
    const nearMiss = name === 'PostToolUse' && !signalInvocation && isComposedSignal(event);
    const delegationStatus = name === 'PostToolUse' && DELEGATION_STATUS_TOOLS.includes(event.tool_name);
    // Codex 每个事件都带 turn_id；Claude Code 的入口事件带 prompt_id，用宿主值建立回合，缺失时才本机生成。
    const hostTurn = typeof event.turn_id === 'string' && event.turn_id ? event.turn_id : typeof event.prompt_id === 'string' && event.prompt_id ? event.prompt_id : null;
    const turnId = typeof event.turn_id === 'string' && event.turn_id ? event.turn_id : null;
    const existing = await readState(directory);
    const probe = { identities: new Map() };
    const initial = await resolveProject(existing, event.cwd, probe);
    // 未接入目录不会写维护状态，不必先逐文件核验发布副本；确认项目后再做重检查。
    if (!initial) return {};
    // 普通工具与委派查询只在当前可信宿主模式变化时写状态，避免每次等待都放大锁竞争。
    const observedSession = existing.sessions[sessionKey(initial.project.projectId, event.session_id)];
    const modeChanged = hostMode && observedSession && (!turnId || observedSession.turnId === turnId) && observedSession.permissionMode !== hostMode;
    // 顾问调用结束的父级 PostToolUse；子代理内部事件带 agent_id，不在这里记账。
    const advisorConsultation = name === 'PostToolUse'
      && !isSubagentEvent(event)
      && (event.tool_name === 'Agent' || event.tool_name === 'Task')
      && await isAdvisorSubagent(event.tool_input?.subagent_type, { cwd: event.cwd, worktree: initial.worktree });
    if (name === 'PostToolUse' && !modeChanged && !advisorConsultation) {
      if (delegationStatus) return delegationHint(existing, initial.project, event, turnId);
      if (!question && !signalInvocation && !nearMiss) return {};
    }
    if (existing.install?.status === 'installed' && !options.synthetic) {
      const { verifyRelease } = await import('./install.mjs');
      if (!await verifyRelease(existing.install)) return { systemMessage: 'workflow 发布副本指纹变化，维护不可用；已保守放行。' };
    }
    if (advisorConsultation) {
      if (!observedSession) return {};
      // task-end 后会话仍保留旧 taskId；只有任务 active 且不是角色会话时，记录才绑定父任务。
      const activeTaskId = observedSession.taskId
        && existing.tasks[taskKey(initial.project.projectId, observedSession.taskId)]?.lifecycle === 'active'
        ? observedSession.taskId : null;
      const consultation = await recordConsultation(directory, {
        projectId: initial.project.projectId,
        sessionId: event.session_id,
        taskId: observedSession.role ? null : activeTaskId,
        turnId: observedSession.turnId || null,
        subagentType: event.tool_input.subagent_type,
        prompt: event.tool_input.prompt,
        description: event.tool_input.description,
        eventId: typeof event.event_id === 'string' ? event.event_id : null,
      });
      return consultation.recorded || consultation.replayed ? {} : { systemMessage: `workflow 未写入顾问咨询记录：${consultation.reason}` };
    }
    // 信号载荷是纯解析，提前取出供锁外预检和锁内接受共用；真正的身份/正文校验仍在锁内协议层。
    const signalPayloads = signalInvocation ? extractSignals(event.tool_response) : [];
    // spec 的 Git 检查在状态锁外预检：慢 Git 只占本次 Hook 自己的等待，不阻塞其他会话的短锁预算。
    // 预检把检查对象（提交 OID 与 HEAD 工作区快照）固定进 binding；锁内只复核该绑定，不重跑慢 Git。
    // 预检跳过时留下 skipped 标记，生产路径不会在锁内补跑 Git；直接调用协议函数仍走原有同步检查。
    let specCheck = { skipped: true };
    if (name === 'Stop') {
      const observed = existing.sessions[sessionKey(initial.project.projectId, event.session_id)];
      const task = observed?.taskId ? existing.tasks[taskKey(initial.project.projectId, observed.taskId)] : null;
      const needed = observed && !observed.role && !observed.interrupted
        && !['waiting-user', 'operation-only'].includes(observed.phase)
        && !(event.stop_hook_active === true || observed.stopBlockedTurn === observed.turnId)
        && task?.lifecycle === 'active' && task.route !== 'operation-only';
      if (needed) {
        const precheck = precheckSpecs(initial.worktree, { skipNonGitNoSpec: true, budgetMs: SPEC_CHECK_BUDGET_MS });
        specCheck = {
          root: initial.worktree, ref: null, projectId: initial.project.projectId, taskId: task.taskId,
          report: precheck.report, binding: precheck.binding,
          scope: { projectId: initial.project.projectId, sessionId: event.session_id, turnId: observed.turnId, ticket: observed.ticket, taskId: task.taskId, revision: observed.revision },
        };
      }
    } else if (signalPayloads.length === 1 && signalPayloads[0]?.action === 'task-end') {
      const payload = signalPayloads[0];
      const observed = existing.sessions[sessionKey(initial.project.projectId, event.session_id)];
      const task = observed?.taskId ? existing.tasks[taskKey(initial.project.projectId, observed.taskId)] : null;
      const ref = payload.finalRef;
      const validRef = ref === undefined || (typeof ref === 'string' && SPEC_REF.test(ref));
      if (observed && !observed.role && task?.lifecycle === 'active' && task.route !== 'operation-only' && validRef) {
        const precheck = precheckSpecs(initial.worktree, { ref: ref || undefined, skipNonGitNoSpec: true, budgetMs: SPEC_CHECK_BUDGET_MS });
        specCheck = {
          root: initial.worktree, ref: ref ?? null, projectId: initial.project.projectId, taskId: task.taskId,
          report: precheck.report, binding: precheck.binding,
          scope: { projectId: initial.project.projectId, sessionId: event.session_id, turnId: observed.turnId, ticket: observed.ticket, taskId: task.taskId, revision: observed.revision },
        };
      }
    }
    if (LIFECYCLE_EVENTS.includes(name)) {
      // 结束事件先独立原子落盘：状态锁被短暂占用或进程随后退出时，事件仍能在下一次入口被消费。
      // 只绑定宿主给出的可信回合；缺失时留空，让消费端按关联不足处理，不拿当前会话回合推断归属。
      const known = existing.sessions[sessionKey(initial.project.projectId, event.session_id)];
      try {
        const recordName = await recordLifecycleEvent(directory, {
          kind: 'lifecycle', event: name, projectId: initial.project.projectId, sessionId: event.session_id,
          // 绑定记录时的任务与回合：迟到事件据此只保存待办，不去改写之后打开的新回合。
          taskId: known?.taskId || null,
          turnId: hostTurn || null, ticket: known?.ticket || null,
          hostEventId: typeof event.event_id === 'string' ? event.event_id : null,
          at: new Date().toISOString(), source: options.synthetic ? 'synthetic' : 'callback',
        });
        recordedLifecycle = { event: name, name: recordName };
      } catch (error) {
        // 落盘失败如实报告：只尝试写状态，不宣称事件已持久化。
        lifecycleNote = `workflow 未能保存 ${name} 事件记录（${error.code || 'IO'}）：仅尝试写入当前状态；磁盘恢复后请重试。`;
      }
    }
    // 事件文件的归档要等状态提交成功后再执行；保存失败时事件留在原处，下次入口靠回执幂等跳过。
    let lifecycleArchive = [];
    // Stop 决定记录在状态提交成功后追加；锁内只收集事实，不额外扩大写入。
    let stopRecord = null;
    let output = await mutate(directory, async (state, save) => {
      const resolved = await resolveProject(state, event.cwd, probe);
      if (!resolved) return {};
      const project = resolved.project;
      let session = state.sessions[sessionKey(project.projectId, event.session_id)];
      // Observed callbacks prove execution of these hooks, not global discovery or trust policy.
      observeHost(state, agent, name, { at: new Date().toISOString(), sessionId: event.session_id, source: options.synthetic ? 'synthetic' : 'callback' });
      // 拿到状态锁后再幂等消费待处理结束事件；迟到的旧事件不打断新回合，只保留待办。
      const consumed = await consumeLifecycleEvents(directory, state);
      lifecycleArchive = consumed.archive;
      const escalatedItems = consumed.deferred.filter(item => item.escalated);
      const pendingNotes = escalatedItems.filter(item => item.notePending);
      // 诊断内容存在状态里；原因文件还没确认写入时直接把正文给用户，不指向可能不存在的文件。
      const escalationHint = !escalatedItems.length ? ''
        : pendingNotes.length ? `其中 ${escalatedItems.length} 个已多次重试仍无法恢复关联；原因文件尚未确认写入（会在本次或下一次入口重试），诊断内容：${pendingNotes.map(item => item.note).join('；')}`
          : `其中 ${escalatedItems.length} 个已多次重试仍无法恢复关联，见 deferred/ 中的原因文件。`;
      const lifecycleOutput = lifecycleNote ? { systemMessage: lifecycleNote }
        : consumed.deferred.length && LIFECYCLE_EVENTS.includes(name) ? { systemMessage: `workflow 有 ${consumed.deferred.length} 个结束事件缺少可信项目/会话关联，已保留本机待办（${consumed.deferred.map(item => item.name).join('、')}）；不撤销任何新回合票据。${escalationHint}` } : {};
      if (session && event.event_id && session.observed[event.event_id]) return lifecycleOutput;
      if (name === 'SessionStart' || name === 'UserPromptSubmit') {
        // 会话开始后插件被重装：hook 已是新版本，但会话里已读的指引和命令仍是旧的，提示开新会话。
        const seenVersion = session?.productVersion;
        // Herdr GUI 子会话汇报也会作为 UserPromptSubmit 进入：它仍开新回合/票据，但不是用户回答，
        // 不撤销在途包；上一回合在 waiting-user 时保留该 phase，并在入口上下文里声明来源。
        // 各适配器（Herdr GUI、Cindy）的固定开头并入同一张表，不按自然语言猜。
        const hostMessage = name === 'UserPromptSubmit' ? recognizeHostMessage(event.prompt, HOST_MESSAGE_TABLE) : null;
        let preserveWaiting = false;
        if (name === 'UserPromptSubmit') {
          preserveWaiting = hostMessage !== null && session?.phase === 'waiting-user';
          // 每个用户回合开新票据；Claude 入口缺 prompt_id 时用本机值，后续事件按当前回合关联，不因标识缺失丢弃回执。
          session = openTurn(state, project, event.session_id, hostTurn || id('turn'), { compact: event.source === 'compact', eventId: event.event_id, mode: hostMode });
          if (preserveWaiting && session) {
            session.phase = 'waiting-user';
            session.revisionReason = hostMessage.software;
          }
        } else if (hostTurn) {
          session = openTurn(state, project, event.session_id, hostTurn, { compact: event.source === 'compact', eventId: event.event_id, mode: hostMode });
        }
        // 拿不到身份时只给恢复提示，不输出入口成功；身份由宿主下一次入口重建。
        if (!session?.ticket || !session?.turnId) return { ...lifecycleOutput, ...(lifecycleNote ? {} : contextOutput(name, identityHint)) };
        if (hostMode) session.permissionMode = hostMode;
        session.productVersion = seenVersion || PRODUCT_VERSION;
        const upgraded = seenVersion && PRODUCT_VERSION && seenVersion !== PRODUCT_VERSION ? `workflow 插件已从 ${seenVersion} 升级到 ${PRODUCT_VERSION}：本会话早先读取的指引和命令可能已过时，请提醒用户开新会话；继续工作时以下面的入口为准。
` : '';
        // 已 role-claim 的委派会话注入对应角色的最小上下文，不再给 Lead 指引。
        // 核心身份和回合状态随本次事务保存；对齐/知识等可选读取移到锁外，失败不回滚入口。
        return { entry: { state, resolved, role: session.role || 'lead', turnId: session.turnId, ticket: session.ticket, taskId: session.taskId || null, upgraded, hostMessage: hostMessage?.note || null } };
      }
      if (!session) return lifecycleOutput;
      // Codex 严格核对 turn_id；Claude 的 prompt_id 只在入口事件保证存在，后续事件按当前回合关联。
      if (turnId && session.turnId !== turnId) return lifecycleOutput;
      // 宿主模式属于当前事件的可信观测，不属于信号声明；先同步再建信号回滚快照。
      // 不增加 revision，当前工具产生的信号仍使用调用前身份；缺字段保留最近已知模式。
      if (hostMode) session.permissionMode = hostMode;
      if (event.event_id) session.observed[event.event_id] = digest(JSON.stringify({ name, turn: event.turn_id }));
      if (name === 'PostToolUse') {
        if (delegationStatus) return delegationHint(state, project, event, turnId);
        if (question) {
          // 已显式发过 waiting-user 或同一回合再次调用提问工具时不重复修改同一状态。
          if (session.phase !== 'waiting-user') {
            session.phase = 'waiting-user';
            session.revision += 1;
            session.revisionReason = '提问工具';
          }
          return {};
        }
        if (nearMiss) {
          const usage = signalUsage();
          return contextOutput(name, `workflow 未接受：signal 须单独直接调用，本次命令含组合、变量或不是本插件入口。${usage.rule} 请用当前 identity 按此格式重发：${usage.command}（兼容写法 ${usage.fallback}）`);
        }
        if (!signalInvocation) return {};
        if (signalPayloads.length !== 1) return contextOutput(name, 'workflow 未接受：输出未包含唯一的本插件信号');
        const payload = signalPayloads[0];
        if (payload?.sessionId !== event.session_id || payload.projectId !== project.projectId || payload.turnId !== session.turnId) return contextOutput(name, 'workflow 未接受：信号不属于当前宿主会话/项目/回合');
        // 咨询记录在状态锁内读取：同一回合刚写下的记录也要能立刻用于门禁；读文件不改状态。
        const consultTask = payload.taskId ? state.tasks[taskKey(project.projectId, payload.taskId)] : null;
        const taskConsultations = consultTask
          ? await readTaskConsultations(directory, state, consultTask)
          : { records: [], corrupt: [] };
        const sessionConsultations = await readSessionConsultations(directory, project.projectId, event.session_id);
        const gateConfig = ['prepare', 'task-update', 'packages'].includes(payload.action)
          ? await readGateConfig(project.knowledgeRoot)
          : null;
        const pathRules = payload.action === 'task-update' && gateConfig
          ? { rules: gateConfig.rules, error: gateConfig.error }
          : { rules: [], error: null };
        // 重放同一 signalId 不再调用网关；首次不可用只记一次提示，后续信号不再重复。
        // prepare 的 --task 可以指向其他/不存在任务，权限核对始终以会话当前活动任务为准。
        const sessionTask = session.taskId ? state.tasks[taskKey(project.projectId, session.taskId)] : null;
        const jevTask = payload.action === 'prepare' ? sessionTask : consultTask;
        const jev = session.receipts?.[payload.signalId] ? null : await jevSignalGate(gateConfig, payload, jevTask, session);
        const jevNotice = jev?.notice && !session.jevNotice ? jev.notice : null;
        if (jevNotice) session.jevNotice = new Date().toISOString();
        const before = structuredClone(state);
        let result;
        try {
          result = acceptSignal(state, payload, {
            root: resolved.worktree,
            spec: specCheck,
            consultations: taskConsultations.records,
            consultationsCorrupt: taskConsultations.corrupt,
            sessionConsultations: sessionConsultations.records,
            sessionConsultationsCorrupt: sessionConsultations.corrupt,
            pathRules,
            jev,
          });
        } catch (error) {
          // A rejected signal must not persist a partially changed phase or candidate disposition.
          for (const key of Object.keys(state)) delete state[key];
          Object.assign(state, before);
          // 附当前 revision 与回合，代理据此直接重发，不必再猜状态。
          const current = state.sessions[sessionKey(project.projectId, event.session_id)];
          result = { accepted: false, reason: error.code || 'INPUT', message: error.message, ...(error.missing ? { missing: error.missing } : {}), ...(error.findings ? { findings: error.findings } : {}), expectedRevision: current?.revision, turnId: current?.turnId };
        }
        if (jevNotice) result.jevNotice = jevNotice;
        if (result.accepted && !result.replayed && payload.action === 'task-start') await markExtractionStart(session, event.transcript_path, payload.taskId);
        // 已接受的任务结束才登记会话提取；登记失败只写作业级诊断，不阻塞、不回滚业务任务。
        // 副作用绑定回执里的任务身份：同回合先结束 A 再启动 B 后重放 A 的 task-end 时，不能按当前 session.taskId=B 提前登记 B。
        if (result.accepted && payload.action === 'task-end') {
          try {
            const endedTaskId = result.taskId || payload.taskId;
            const task = endedTaskId ? state.tasks[taskKey(project.projectId, endedTaskId)] : null;
            result.extraction = result.replayed
              ? await findExtraction(directory, project, { task, session })
              : await registerExtraction(directory, project, { task, session, transcriptPath: event.transcript_path });
          } catch (error) {
            result.extraction = { status: 'error', reason: error.code || 'IO' };
          }
        }
        return contextOutput(name, `workflow 回执：${JSON.stringify(result)}`);
      }
      if (name === 'Stop') {
        const output = stop(state, project, session, event, { root: resolved.worktree, spec: specCheck });
        // The budget must be durable before returning a continuation decision.
        await save();
        const task = session.taskId ? state.tasks[taskKey(project.projectId, session.taskId)] : null;
        stopRecord = describeStop(session, task, event, agent, output);
        return output;
      }
      if (name === 'Interrupt' || name === 'StopFailure' || name === 'SessionEnd') {
        // 正常情况下结束事件已在上面由待办记录幂等消费；只有事件记录落盘失败时才在这里按当前回合保守保存，
        // 避免把同一事件既写入待办又在新回合上重复中断。两种情况都把事件状态说明原样带回。
        if (!lifecycleNote) return lifecycleOutput;
        // 没有宿主回合标识时不拿当前会话推断归属：无法证明它属于本回合，只保留说明。
        if (!hostTurn || session.turnId !== hostTurn) return lifecycleOutput;
        interrupt(state, project, session);
        return lifecycleOutput;
      }
      // PostCompact cannot emit additional context; compact SessionStart restores the existing identity.
      if (name === 'PostCompact') return {};
      return {};
    }, { budgetMs: lockBudget(name) });
    if (stopRecord) await recordDecision(directory, stopRecord);
    // 可选知识/对齐在状态锁外读取；失败已在 readOptionalContext 内降级，不影响已保存的入口身份。
    if (output?.entry) {
      const entry = output.entry;
      const optional = await readOptionalContext(entry.state, entry.resolved, event.session_id, { directory });
      const rendered = await mutate(directory, async state => {
        const live = state.sessions[sessionKey(entry.resolved.project.projectId, event.session_id)];
        // 输出前复核 session/turn：可选读取期间被新入口替换时，不把旧回合内容附到新回合。
        if (!live || live.turnId !== entry.turnId || live.ticket !== entry.ticket || (live.taskId || null) !== entry.taskId) return { stale: true };
        // 使用提交时的项目记录，避免可选读取期间的项目状态变化被旧快照覆盖。
        const project = state.projects[entry.resolved.project.projectId] || entry.resolved.project;
        const context = await projectContext(state, { ...entry.resolved, project }, entry.role, event.session_id, {
          directory, incremental: true, full: name === 'SessionStart' || Boolean(entry.upgraded), optional,
          // 压缩后的 SessionStart 需要把核心纪律重新完整带回；不能当成普通增量入口省略。
          compact: event.source === 'compact',
        });
        return { text: `${entry.upgraded}workflow 入口：${JSON.stringify(context)}${entry.hostMessage ? `\n${entry.hostMessage}` : ''}` };
      }, { budgetMs: lockBudget(name) });
      output = rendered?.text ? contextOutput(name, rendered.text)
        : rendered?.stale ? contextOutput(name, 'workflow 入口回合已被新的入口替换：本次未附加可选上下文；新回合已按最新状态建立。')
        : {};
    }
    // 状态已提交：此时再归档事件；归档失败不影响已保存的回执，下次消费幂等跳过。
    const archived = await archiveLifecycleEvents(directory, lifecycleArchive);
    // 失败分类如实说明：原因文件写入与事件移动是两种不同后果，不能混为一谈。
    // 即使本次入口原本没有提示，失败也要让用户看见；否则诊断可能长期静默重试。
    const notice = text => {
      if (!output || typeof output !== 'object') return;
      output.systemMessage = output.systemMessage ? `${output.systemMessage}；${text}` : `workflow ${text}`;
    };
    const failedNotes = archived.failed.filter(item => item.stage === 'note' || item.to === 'deferred-note');
    const failedMoves = archived.failed.filter(item => !failedNotes.includes(item));
    if (failedNotes.length) {
      // 事件已经移入 deferred/，只有原因副本没写成功；正文保存在状态里，下一次入口重试。
      notice(`原因文件写入失败（${failedNotes.map(item => item.code || 'IO').join('、')}），事件已在 deferred/ 中；诊断内容已保存在状态中，下一次入口会重试。`);
    }
    if (failedMoves.length) {
      const places = [...new Set(failedMoves.map(item => item.location === 'deferred' ? 'deferred/' : '原处 lifecycle-events/'))].join('、');
      notice(`事件归档失败（${failedMoves.map(item => item.code || 'IO').join('、')}），事件仍在${places}，下一次入口会按回执幂等跳过。`);
    }
    return output;
  } catch (error) {
    // Never return a continuation when identity, persistence, schema or locking failed.
    const saved = recordedLifecycle ? `本次 ${recordedLifecycle.event} 事件已另存为本机待办（${recordedLifecycle.name}），下一次入口会幂等消费；` : '';
    const lostRecord = lifecycleNote ? `${lifecycleNote} 本次状态也未确认保存，事件未应用；` : '';
    const detail = error.code === 'LOCKED' ? `原因：${error.message}；先核对持有进程已结束，再按提示处理残留锁或 guard，不直接删除活动锁。` : '';
    return { systemMessage: `workflow 已保守放行，维护暂不可用：${error.code || 'IO'}；保留状态和待办。${detail}${saved}${lostRecord}` };
  }
}

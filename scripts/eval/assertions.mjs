import path from 'node:path';
import { gateEvidence, hookResponses, initEvent, pairDenied, pairReason, preToolUsePairs, toolUses, transcriptDenials } from './events.mjs';

export function check(id, ok, detail, expected = null, actual = null, meta = {}) {
  return { id, ok: Boolean(ok), detail, expected, actual, ...meta };
}

export function firstFailure(assertions) {
  return (assertions || []).find(assertion => !assertion.ok) || null;
}

// 已确认的隔离/溯源失败优先于宿主超时、缺认证等无法得出结论的情况：INVALID 不能被
// BLOCKED/INCONCLUSIVE 覆盖。无法取得可观测证据单独记 NOT-OBSERVABLE。
export function statusFor(assertions, { isolationOk = true, blocked = null, inconclusive = null, notObservable = null } = {}) {
  if (!isolationOk) return 'INVALID';
  if (blocked) return 'BLOCKED';
  if (notObservable) return 'NOT-OBSERVABLE';
  if (inconclusive) return 'INCONCLUSIVE';
  const failed = (assertions || []).filter(assertion => !assertion.ok);
  return failed.length ? 'FAIL' : 'PASS';
}

// 模型观测维度可能整体不可得（如宿主不提供 modelUsage）。这类断言标记 observable: false、
// ok 保持 true，由本函数汇总成 NOT-OBSERVABLE；只要还有可观测断言失败，就不降级成“不可观测”。
function observableAssertionFailed(assertions) {
  return (assertions || []).some(assertion => assertion.observable !== false && !assertion.ok);
}

export function unobservableAssertionNote(assertions) {
  const unobservable = (assertions || []).filter(assertion => assertion.observable === false);
  if (!unobservable.length) return null;
  if (observableAssertionFailed(assertions)) return null;
  return `${unobservable.length} 项维度不可观测：${unobservable.map(assertion => assertion.id).join('、')}`;
}

// 隔离来源不可观测同样不能遮盖可观测断言失败：统一在传入 statusFor 前收口，保证 FAIL 生效。
export function unobservableReason(assertions, fallback = null) {
  if (observableAssertionFailed(assertions)) return null;
  return unobservableAssertionNote(assertions) || fallback;
}

export function exitCodeFor(statuses) {
  if (statuses.includes('INVALID')) return 3;
  if (statuses.includes('FAIL')) return 1;
  if (statuses.some(status => ['BLOCKED', 'INCONCLUSIVE', 'NOT-OBSERVABLE'].includes(status))) return 4;
  return 0;
}

// 总体状态与单次状态同一优先级：已确认的隔离失败最重，NOT-OBSERVABLE 不能被落成 PASS。
export function aggregateStatus(statuses) {
  if (statuses.includes('INVALID')) return 'INVALID';
  if (statuses.includes('FAIL')) return 'FAIL';
  if (statuses.includes('BLOCKED')) return 'BLOCKED';
  if (statuses.includes('INCONCLUSIVE')) return 'INCONCLUSIVE';
  if (statuses.includes('NOT-OBSERVABLE')) return 'NOT-OBSERVABLE';
  return 'PASS';
}

export function turnInconclusive({ results = [], turns = [], timedOut = false, unsent = [] } = {}) {
  if (timedOut) return '某个回合超时，未收到结果';
  if (unsent.length) return `有 ${unsent.length} 轮输入未发送`;
  if (results.length < turns.length) return `结果事件少于输入轮次（${results.length}/${turns.length}）`;
  return null;
}

const samePath = (left, right) => Boolean(left && right) && path.resolve(left).replaceAll('\\', '/').toLowerCase() === path.resolve(right).replaceAll('\\', '/').toLowerCase();
const within = (root, target) => {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const STATE_DIR_ARG = /--state-dir(?:=|\s+)(?:"([^"]*)"|'([^']*)'|([^\s;&|]+))/g;
const LOCALAPPDATA_ENV = [
  /\$env:LOCALAPPDATA\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s;&|]+))/gi,
  /(?:^|[\s;&|])LOCALAPPDATA\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s;&|]+))/gi,
];
const WORKFLOW_CLI = /\bworkflow\.mjs\b/;

function commandValues(command, pattern) {
  const values = [];
  for (const match of String(command).matchAll(pattern)) values.push(match[1] ?? match[2] ?? match[3]);
  return values.filter(value => value !== undefined);
}

// 子进程默认状态根只能证明 runner 的配置，不能证明模型实际调用的 CLI 参数。
// 这里从 transcript 的 shell 工具调用里取 --state-dir 和 LOCALAPPDATA 覆盖；
// 任何无法确定为沙箱内的路径都不当作隔离证据。
function shellConfinement(events, { sandbox }) {
  const calls = toolUses(events).filter(call => SHELL_TOOLS.has(call.name) && typeof call.input?.command === 'string');
  const cliCalls = calls.filter(call => WORKFLOW_CLI.test(call.input.command));
  const stateDirs = calls.flatMap(call => commandValues(call.input.command, STATE_DIR_ARG));
  const localAppData = calls.flatMap(call => LOCALAPPDATA_ENV.flatMap(pattern => commandValues(call.input.command, pattern)));
  const confined = value => path.isAbsolute(value) && !/[$%]|^~/.test(value) && within(sandbox, value);
  return {
    observed: cliCalls.length > 0,
    stateDirs,
    localAppData,
    stateDirsOutside: stateDirs.filter(value => !confined(value)),
    localAppDataOutside: localAppData.filter(value => !confined(value)),
  };
}

export function hookRegistration(settings) {
  for (const group of settings?.hooks?.PreToolUse || []) {
    for (const handler of group?.hooks || []) {
      if (!Array.isArray(handler?.args)) continue;
      const index = handler.args.indexOf('--state-dir');
      if (index >= 0) return { handler, stateDir: handler.args[index + 1] || null };
    }
  }
  return null;
}

// 运行中能从 stream-json 和隔离 settings 直接核对的部分。真实用户目录的前后比对在
// realIsolationFindings 里单独做。
export function isolationFindings({ init, settings, project, stateDir, sandbox = null, childLocalAppData = null, args = [], expectedAgents = [], requireHooks = true, events = [], sentinel = null }) {
  const checks = [];
  const add = (id, ok, detail, expected = null, actual = null, meta = {}) => checks.push(check(id, ok, detail, expected, actual, meta));
  if (!init) {
    add('init-observable', true, '没有 system/init 事件，无法核对宿主来源', 'init', null, { observable: false });
  } else {
    add('init-cwd', samePath(init.cwd, project), 'system/init 的 cwd 必须是隔离临时项目', project, init.cwd ?? null);
    add('init-mcp-empty', Array.isArray(init.mcp_servers) && init.mcp_servers.length === 0, 'system/init 不得加载 MCP server', [], init.mcp_servers ?? null);
    const tools = Array.isArray(init.tools) ? init.tools : [];
    add('init-tools-no-mcp', tools.every(tool => !tool.startsWith('mcp__')), 'system/init 不得出现 mcp__* 工具', [], tools.filter(tool => tool.startsWith('mcp__')));
    add('init-tools-required', ['Read', 'Write'].every(tool => tools.includes(tool)), '场景需要的 Read/Write 必须在工具清单里', ['Read', 'Write'], tools);
  }
  add('no-plugin-dir', !args.includes('--plugin-dir'), '启动参数不得传 --plugin-dir', 'absent', args.filter(arg => arg === '--plugin-dir'));
  if (sandbox) add('state-root-isolated', within(sandbox, stateDir), '子进程 workflow 状态根必须落在本次沙箱', sandbox, stateDir);
  if (sandbox && childLocalAppData) add('child-localappdata-isolated', samePath(childLocalAppData, sandbox), '子进程 LOCALAPPDATA 必须指向本次沙箱', sandbox, childLocalAppData);
  if (sandbox) {
    const shell = shellConfinement(events, { sandbox });
    add(
      'cli-state-dir-confined',
      shell.stateDirsOutside.length === 0,
      shell.stateDirsOutside.length
        ? `实际 CLI 调用使用了沙箱外 --state-dir：${shell.stateDirsOutside.join('、')}`
        : (shell.observed
          ? '实际 CLI 调用没有出现沙箱外 --state-dir'
          : '未观测到 workflow CLI 调用，没有显式 --state-dir 覆盖'),
      sandbox,
      { observed: shell.observed, stateDirs: shell.stateDirs, outside: shell.stateDirsOutside },
    );
    add(
      'cli-localappdata-confined',
      shell.localAppDataOutside.length === 0,
      shell.localAppDataOutside.length
        ? `实际 CLI 调用尝试把 LOCALAPPDATA 指向沙箱外：${shell.localAppDataOutside.join('、')}`
        : (shell.observed
          ? '实际 CLI 调用没有覆盖 LOCALAPPDATA 到沙箱外'
          : '未观测到 workflow CLI 调用，也没有沙箱外 LOCALAPPDATA 覆盖'),
      sandbox,
      { observed: shell.observed, localAppData: shell.localAppData, outside: shell.localAppDataOutside },
    );
  }
  if (init && Object.hasOwn(init, 'settingSources')) {
    const sources = Array.isArray(init.settingSources) ? init.settingSources : [init.settingSources];
    add('setting-sources', sources.length === 1 && sources[0] === 'user', 'settingSources 只允许 user', ['user'], sources);
  } else if (init) {
    add('setting-sources', true, 'system/init 未暴露 settingSources；启动参数固定 --setting-sources user', 'not-exposed', 'not-exposed');
  }
  if (requireHooks) {
    const registration = hookRegistration(settings);
    add('hook-registration', Boolean(registration), '隔离 settings 必须注册 PreToolUse hook', 'registered', registration ? 'registered' : 'missing');
    add('hook-state-dir', Boolean(registration) && samePath(registration.stateDir, stateDir), 'hook 参数 --state-dir 必须指向临时状态目录', stateDir, registration?.stateDir ?? null);
    if (!init) {
      add('workflow-agents', true, '没有 system/init 事件，无法核对 agents 来源', expectedAgents, null, { observable: false });
      add('no-plugin-agents', true, '没有 system/init 事件，无法核对插件子代理', [], null, { observable: false });
      add('hook-sentinel-observed', true, '没有 system/init 事件，无法核对 hook 来源哨兵', sentinel?.token ?? null, null, { observable: false });
      add('agent-sentinel-observed', true, '没有 system/init 事件，无法核对 agents 来源哨兵', sentinel?.agentName ?? null, null, { observable: false });
    } else {
      const agents = Array.isArray(init.agents) ? init.agents : [];
      add('workflow-agents', expectedAgents.every(name => agents.includes(name)), '用户级 workflow 子代理必须来自隔离配置目录', expectedAgents, agents);
      add('no-plugin-agents', agents.every(name => !name.startsWith('workflow:')), '不得加载带 workflow: 前缀的插件子代理', [], agents.filter(name => name.startsWith('workflow:')));
      if (sentinel?.token) {
        const observed = hookResponses(events).some(response => String(response.raw?.output ?? '').includes(sentinel.token) || String(response.raw?.stdout ?? '').includes(sentinel.token) || JSON.stringify(response.output ?? '').includes(sentinel.token));
        add('hook-sentinel-observed', observed, '实际 hook 事件必须携带隔离 settings 的哨兵', sentinel.token, observed ? 'observed' : 'missing');
      } else {
        add('hook-sentinel-observed', true, '没有生成 hook 哨兵，无法核对来源', 'sentinel', null, { observable: false });
      }
      if (sentinel?.agentName) {
        add('agent-sentinel-observed', agents.includes(sentinel.agentName), 'system/init 的 agents 必须包含隔离配置里的哨兵 agent', sentinel.agentName, agents);
      } else {
        add('agent-sentinel-observed', true, '没有生成 agent 哨兵，无法核对来源', 'sentinel', null, { observable: false });
      }
    }
  }
  return checks;
}

// 只有默认状态根、子进程环境与实际 CLI 调用参数四类证据同时成立，才允许把真实 state
// 的白名单外变化解释为并行会话写入。
export function stateRootEvidence(checks) {
  return ['state-root-isolated', 'child-localappdata-isolated', 'cli-state-dir-confined', 'cli-localappdata-confined']
    .every(id => (checks || []).find(check => check.id === id)?.ok === true);
}

export function diffState(before, after, prefix = '', out = []) {
  if (before === after) return out;
  if (before === null || after === null || typeof before !== 'object' || typeof after !== 'object') {
    out.push(prefix || '.');
    return out;
  }
  if (Array.isArray(before) || Array.isArray(after)) {
    if (JSON.stringify(before) !== JSON.stringify(after)) out.push(prefix || '.');
    return out;
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (!Object.hasOwn(before, key) || !Object.hasOwn(after, key)) {
      out.push(next);
      continue;
    }
    diffState(before[key], after[key], next, out);
  }
  return out;
}

// 只放行已知的易变字段，不再用“不是本次合成 ID”作为放行依据。
// 会话角色、项目身份、任务记录等值变化没有独立证据，必须留给人工/后续运行判断。
const VOLATILE_SESSION_FIELDS = new Set(['lastSeenAt', 'revision', 'turnId', 'eventId', 'interruptEpoch', 'phase', 'interrupted', 'permissionMode']);
const VOLATILE_PROJECT_FIELDS = new Set(['lastCheckedAt', 'changedAt']);

function attributableStateChange(change, before, after, parentSessionId, needles) {
  if (change === 'revision') return true;
  // hostObservations 是宿主级观察时间戳，不绑定会话；真正的越界仍由
  // real-state-no-eval-reference 的合成 ID 扫描兜住。
  if (change === 'hostObservations' || change.startsWith('hostObservations.')) return true;
  const parts = change.split('.');
  const [root, key, field] = parts;
  if (root === 'sessions') {
    const beforeRecord = before.sessions?.[key];
    const afterRecord = after.sessions?.[key];
    if (!beforeRecord || !afterRecord || !parts[2]) return false;
    if (needles.includes(afterRecord.sessionId) || needles.includes(beforeRecord.sessionId)) return false;
    if (afterRecord.sessionId !== beforeRecord.sessionId) return false;
    if (beforeRecord.sessionId === parentSessionId) return VOLATILE_SESSION_FIELDS.has(field);
    // 其他真实会话只允许时间戳类字段；角色、包绑定等值变化不可归因。
    return ['lastSeenAt', 'revision'].includes(field);
  }
  if (root === 'projects') {
    const beforeProject = before.projects?.[key];
    const afterProject = after.projects?.[key];
    if (!beforeProject || !afterProject) return false;
    if (needles.some(needle => String(beforeProject.root || '').includes(needle) || String(afterProject.root || '').includes(needle))) return false;
    // 项目只允许学习检查时间戳变化；root/identity/enabled 等变化不可归因。
    return field === 'learning' && VOLATILE_PROJECT_FIELDS.has(parts[3]);
  }
  if (root === 'tasks') {
    // 任务记录变化无法从真实 state 单独证明写入方，保持未决。
    return false;
  }
  return false;
}

export function attributeStateChanges(beforeText, afterText, parentSessionId, needles = [], { isolated = false } = {}) {
  if (!beforeText || !afterText) return { known: false, changes: [], unattributed: [], external: [] };
  let before;
  let after;
  try {
    before = JSON.parse(beforeText);
    after = JSON.parse(afterText);
  } catch {
    return { known: false, changes: [], unattributed: [], external: [] };
  }
  const changes = diffState(before, after);
  const outsideWhitelist = changes.filter(change => !attributableStateChange(change, before, after, parentSessionId, needles));
  // 子进程的 LOCALAPPDATA 与 stateDir 都落在沙箱时，真实 state 在构造上不会被本次 eval 写入；
  // 白名单外的变化只能来自并行的真实会话，单列为 external，不冒充本次归因。
  return {
    known: true,
    changes,
    unattributed: isolated ? [] : outsideWhitelist,
    external: isolated ? outsideWhitelist : [],
  };
}

export function realIsolationFindings({ before, after, needles, parentSessionId = null, sentinelAgentName = null, isolationProven = false }) {
  const checks = [];
  const add = (id, ok, detail, expected = null, actual = null, meta = {}) => checks.push(check(id, ok, detail, expected, actual, meta));
  add('real-settings-unchanged', before.settings === after.settings, '真实 ~/.claude/settings.json 运行前后必须一致', before.settings, after.settings);
  add('real-agents-unchanged', before.agents === after.agents, '真实 ~/.claude/agents 运行前后必须一致', before.agents, after.agents);
  const references = realStateReferences(after.stateText, needles);
  add('real-state-no-eval-reference', references.length === 0, '真实 workflow 状态不得出现本次隔离项目、配置、状态目录、会话或回合', [], references);
  const attribution = attributeStateChanges(before.stateText, after.stateText, parentSessionId, needles, { isolated: isolationProven });
  const changeText = attribution.changes.length
    ? `变化键：${attribution.changes.slice(0, 8).join('、')}${attribution.changes.length > 8 ? ` 等 ${attribution.changes.length} 项` : ''}`
    : '运行前后无变化';
  add(
    'real-state-change-attributable',
    attribution.known && attribution.unattributed.length === 0,
    attribution.known
      ? (attribution.unattributed.length === 0
        ? (isolationProven && attribution.external.length
          ? `真实 workflow 状态${changeText}；默认状态根、子进程环境与 CLI 参数检查均已核对，未发现沙箱外路径，白名单外变化属于并行真实会话`
          : `真实 workflow 状态${changeText}，均落在已声明的易变字段白名单内`)
        : `真实 workflow 状态${changeText}，其中 ${attribution.unattributed.length} 项不在易变字段白名单内`)
      : '无法解析真实 workflow 状态，不能完成归因',
    [],
    attribution.known ? { changes: attribution.changes.slice(0, 20), unattributed: attribution.unattributed, external: attribution.external.slice(0, 20) } : 'state.json 无法解析',
  );
  if (sentinelAgentName) {
    const realNames = Array.isArray(after.agentNames) ? after.agentNames : [];
    add('real-agents-no-sentinel', !realNames.includes(sentinelAgentName), '真实 ~/.claude/agents 不得存在本次哨兵 agent', [], realNames.filter(name => name === sentinelAgentName));
  }
  return checks;
}

// Herdr 的隔离证明比 W1 更严格：真实配置、agents 或 state 任一字节变化都记 INVALID，
// 不套用 W1 的易变字段白名单，也不把变化解释成并行会话。首次投递前和运行结束后各查一次。
export function herdrRealIsolationFindings({ before, after, needles = [], idPrefix = 'herdr-real' }) {
  const checks = [];
  const add = (id, ok, detail, expected = null, actual = null) => checks.push(check(id, ok, detail, expected, actual));
  add(`${idPrefix}-settings-unchanged`, before.settings === after.settings, '真实 ~/.claude/settings.json 必须保持不变', before.settings, after.settings);
  add(`${idPrefix}-agents-unchanged`, before.agents === after.agents, '真实 ~/.claude/agents 必须保持不变', before.agents, after.agents);
  add(`${idPrefix}-state-unchanged`, before.state === after.state, '真实 workflow state.json 必须保持不变', before.state, after.state);
  const references = realStateReferences(after.stateText, needles);
  add(`${idPrefix}-state-no-eval-reference`, references.length === 0, '真实 workflow 状态不得出现本次隔离项目、配置、状态目录或会话', [], references);
  return checks;
}

// 真实 state.json 是多个宿主/会话共同改写的文件；父会话或后台任务可能在 eval 运行期间
// 推进 revision。这里比对内容里是否出现本次运行的唯一路径与会话 ID，而不是把并发写入
// 当成 eval 越界。
export function realStateReferences(text, needles) {
  if (!text) return [];
  const normalized = text.replaceAll('\\\\', '\\');
  return needles.filter(needle => typeof needle === 'string' && needle).filter(needle => text.includes(needle) || normalized.includes(needle));
}

function normalizeFile(value) {
  return typeof value === 'string' ? path.resolve(value).replaceAll('\\', '/').toLowerCase() : null;
}

function writeTargets(call) {
  const targets = [];
  if (typeof call?.input?.file_path === 'string') targets.push(call.input.file_path);
  if (typeof call?.input?.notebook_path === 'string') targets.push(call.input.notebook_path);
  if (Array.isArray(call?.input?.edits)) {
    for (const edit of call.input.edits) if (typeof edit?.file_path === 'string') targets.push(edit.file_path);
  }
  return targets;
}

// 门禁必须关联到“实际写入目标文件”的工具调用及其成对的拒绝事件；任意无关 deny 或 Stop block 不算。
export function writeGateAssertion(events, { toolPath, tools = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'] }) {
  const target = normalizeFile(toolPath);
  const calls = toolUses(events).filter(call => tools.includes(call.name) && writeTargets(call).some(candidate => normalizeFile(candidate) === target));
  const callIds = new Set(calls.map(call => call.id));
  const pairs = preToolUsePairs(events).filter(pair => pair.call && callIds.has(pair.call.id));
  const denied = pairs.filter(pair => pairDenied(pair));
  const reasons = denied.map(pair => pairReason(pair)).filter(Boolean);
  const ok = calls.length > 0 && denied.length > 0 && reasons.some(reason => reason.includes(path.basename(toolPath)) || reason.includes('业务写入被拦下'));
  return check(
    'write-gate-for-business-file',
    ok,
    ok
      ? `针对 ${path.basename(toolPath)} 的写入调用被 PreToolUse 拒绝`
      : (calls.length === 0
        ? `没有观测到针对 ${path.basename(toolPath)} 的写入工具调用`
        : '写入工具调用没有对应的 PreToolUse 拒绝事件'),
    { tool: tools, path: toolPath, decision: 'deny' },
    calls.map(call => {
      const pair = pairs.find(item => item.call.id === call.id);
      return { tool: call.name, target: writeTargets(call), decision: pair?.output?.hookSpecificOutput?.permissionDecision ?? null, reason: pairReason(pair) };
    }),
  );
}

export function taskStartGateAssertion(events) {
  const attempts = toolUses(events).filter(call => typeof call.input?.command === 'string' && /\bsignal\s+task-start\b/.test(call.input.command));
  return signalGateChecks(events, {
    attempts,
    ids: ['task-start-attempted', 'task-start-denied'],
    attemptedDetail: count => (count ? `观测到 ${count} 次 signal task-start 调用` : '没有观测到 signal task-start 调用'),
    expected: 'at least one signal task-start call',
    deniedDetail: 'signal task-start 被 PreToolUse 拒绝',
    missingDetail: 'signal task-start 没有被 PreToolUse 拒绝',
  });
}

// 与 task-start 同样只认“实际发起的命令 + 成对的 PreToolUse 拒绝”；可追加拒绝理由匹配，
// 用来断言门禁点名了具体原因，而不是任意无关拒绝。
export function shellSignalGateAssertion(events, { commandPattern, reasonPattern = null, id, label, expected = 'deny' }) {
  const attempts = toolUses(events).filter(call => typeof call.input?.command === 'string' && commandPattern.test(call.input.command));
  const [attempted, denied] = signalGateChecks(events, {
    attempts,
    ids: [`${id}-attempted`, `${id}-denied`],
    attemptedDetail: count => (count ? `观测到 ${count} 次 ${label} 调用` : `没有观测到 ${label} 调用`),
    expected: `at least one ${label} call`,
    deniedDetail: `${label} 被 PreToolUse 拒绝`,
    missingDetail: `${label} 没有被 PreToolUse 拒绝`,
  });
  if (!reasonPattern) return [attempted, denied];
  const pairs = pairsFor(events, attempts);
  const reasons = pairs.filter(pair => pairDenied(pair)).map(pair => pairReason(pair)).filter(Boolean);
  const matched = reasons.some(reason => reasonPattern.test(reason));
  return [
    attempted,
    check(
      `${id}-denied`,
      denied.ok && matched,
      matched
        ? `${label} 的拒绝理由匹配预期`
        : (denied.ok ? `拒绝理由没有匹配 ${reasonPattern}` : `${label} 没有被 PreToolUse 拒绝`),
      { decision: 'deny', reason: String(reasonPattern) },
      reasons,
    ),
  ];
}

// 委派输入没有统一包字段：只认 packageId/package_id 与首行 workflow-package:<id> 标记，
// 与 hook 的 delegationPackageMarkers 同一规则，不解析自然语言。
const DELEGATION_MARK = /^workflow-package\s*[:：]\s*([A-Za-z0-9][A-Za-z0-9_.:-]{0,199})/i;
const DELEGATION_TEXT_KEYS = ['description', 'title', 'task_name', 'name', 'message', 'prompt', 'task'];
export function delegationPackageMarkers(input) {
  const markers = [];
  if (!input || typeof input !== 'object') return markers;
  for (const key of ['packageId', 'package_id']) {
    if (typeof input[key] === 'string' && input[key].trim()) markers.push(input[key].trim());
  }
  for (const key of DELEGATION_TEXT_KEYS) {
    if (typeof input[key] !== 'string') continue;
    const match = DELEGATION_MARK.exec(input[key].trim());
    if (match) markers.push(match[1]);
  }
  return [...new Set(markers)];
}

export function delegationGateAssertion(events, { packageId, reasonPattern = null }) {
  const calls = toolUses(events).filter(call => ['Agent', 'Task'].includes(call.name) && delegationPackageMarkers(call.input).includes(packageId));
  const pairs = pairsFor(events, calls);
  const denied = pairs.filter(pair => pairDenied(pair));
  const reasons = denied.map(pair => pairReason(pair)).filter(Boolean);
  const reasonOk = !reasonPattern || reasons.some(reason => reasonPattern.test(reason));
  return [
    check(
      'delegation-attempted',
      calls.length > 0,
      calls.length ? `观测到 ${calls.length} 次关联 ${packageId} 的委派调用` : `没有观测到关联 ${packageId} 的委派调用`,
      `Task/Agent with workflow-package:${packageId}`,
      calls.map(call => ({ tool: call.name, subagent: call.input?.subagent_type ?? null, markers: delegationPackageMarkers(call.input) })),
    ),
    check(
      'delegation-denied',
      calls.length > 0 && denied.length > 0 && reasonOk,
      denied.length
        ? (reasonOk ? `关联 ${packageId} 的委派被 PreToolUse 拒绝` : `拒绝理由没有匹配 ${reasonPattern}`)
        : `关联 ${packageId} 的委派没有被 PreToolUse 拒绝`,
      { decision: 'deny', reason: reasonPattern ? String(reasonPattern) : null },
      pairs.map(pair => ({ tool: pair.call.name, decision: pair.output?.hookSpecificOutput?.permissionDecision ?? null, reason: pairReason(pair) })),
    ),
  ];
}

function pairsFor(events, calls) {
  const ids = new Set(calls.map(call => call.id));
  return preToolUsePairs(events).filter(pair => pair.call && ids.has(pair.call.id));
}

function signalGateChecks(events, { attempts, ids, attemptedDetail, expected, deniedDetail, missingDetail }) {
  const pairs = pairsFor(events, attempts);
  const denied = pairs.filter(pair => pairDenied(pair));
  return [
    check(ids[0], attempts.length > 0, attemptedDetail(attempts.length), expected, attempts.map(call => String(call.input.command).slice(0, 240))),
    check(
      ids[1],
      attempts.length > 0 && denied.length > 0,
      denied.length ? deniedDetail : missingDetail,
      'deny',
      pairs.map(pair => ({ tool: pair.call.name, decision: pair.output?.hookSpecificOutput?.permissionDecision ?? null, reason: pairReason(pair) })),
    ),
  ];
}

// 交互式 Herdr 窗格没有 stream-json 的 hook 生命周期，拒绝证据在 transcript 的工具结果里。
// 这里仍只认“实际写入目标文件的 tool_use + 同一 tool_use_id 的 PreToolUse hook error”。
export function transcriptWriteGateAssertion(events, { toolPath, tools = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'], reasonPattern = null, id = 'transcript-write-gate' }) {
  const target = normalizeFile(toolPath);
  const calls = toolUses(events).filter(call => tools.includes(call.name) && writeTargets(call).some(candidate => normalizeFile(candidate) === target));
  const callIds = new Set(calls.map(call => call.id));
  const denials = transcriptDenials(events).filter(denial => callIds.has(denial.call?.id) && (!reasonPattern || reasonPattern.test(denial.reason)));
  return [
    check(
      `${id}-attempted`,
      calls.length > 0,
      calls.length
        ? `模型在 transcript 里对 ${path.basename(toolPath)} 发起了 ${calls.length} 次写入调用`
        : `transcript 里没有针对 ${path.basename(toolPath)} 的写入工具调用；不能把“没有动手”当成通过`,
      `at least one ${tools.join('/')} call for ${toolPath}`,
      calls.map(call => ({ tool: call.name, target: writeTargets(call) })),
      { role: 'attempt' },
    ),
    check(
      `${id}-denied`,
      calls.length > 0 && denials.length > 0,
      denials.length
        ? `针对 ${path.basename(toolPath)} 的写入被 PreToolUse 拒绝：${denials[0].reason.slice(0, 120)}`
        : (calls.length ? '写入工具结果没有 PreToolUse hook error' : '没有可核对的写入调用'),
      { decision: 'deny', reason: reasonPattern ? String(reasonPattern) : null },
      calls.map(call => {
        const denial = denials.find(item => item.call?.id === call.id);
        return { tool: call.name, target: writeTargets(call), decision: denial ? 'deny' : null, reason: denial?.reason ?? null };
      }),
    ),
  ];
}

// 命令型委派同样只认实际 shell 调用与同一 tool_use_id 的拒绝；理由默认由调用方给出。
export function transcriptShellGateAssertion(events, { commandPattern, reasonPattern = null, id, label }) {
  const calls = toolUses(events).filter(call => SHELL_TOOLS.has(call.name) && typeof call.input?.command === 'string' && commandPattern.test(call.input.command));
  const callIds = new Set(calls.map(call => call.id));
  const denials = transcriptDenials(events).filter(denial => callIds.has(denial.call?.id) && (!reasonPattern || reasonPattern.test(denial.reason)));
  return [
    check(
      `${id}-attempted`,
      calls.length > 0,
      calls.length ? `模型在 transcript 里发起了 ${calls.length} 次 ${label} 调用` : `transcript 里没有 ${label} 调用；不能把“没有动手”当成通过`,
      `at least one ${label} call`,
      calls.map(call => String(call.input.command).slice(0, 240)),
      { role: 'attempt' },
    ),
    check(
      `${id}-denied`,
      calls.length > 0 && denials.length > 0,
      denials.length
        ? `${label} 被 PreToolUse 拒绝：${denials[0].reason.slice(0, 120)}`
        : (calls.length ? `${label} 的工具结果没有 PreToolUse hook error` : '没有可核对的命令调用'),
      { decision: 'deny', reason: reasonPattern ? String(reasonPattern) : null },
      calls.map(call => {
        const denial = denials.find(item => item.call?.id === call.id);
        return { command: String(call.input.command).slice(0, 200), decision: denial ? 'deny' : null, reason: denial?.reason ?? null };
      }),
    ),
  ];
}

// 实际 CLI 调用参数检查的 Herdr 版本：窗格没有 stream-json，命令调用来自隔离 transcript。
export function herdrCliConfinementFindings(events, { sandbox }) {
  const shell = shellConfinement(events, { sandbox });
  return [
    check(
      'herdr-cli-state-dir-confined',
      shell.stateDirsOutside.length === 0,
      shell.stateDirsOutside.length
        ? `实际 CLI 调用使用了沙箱外 --state-dir：${shell.stateDirsOutside.join('、')}`
        : (shell.observed ? '实际 CLI 调用没有出现沙箱外 --state-dir' : '未观测到 workflow CLI 调用，也没有显式 --state-dir 覆盖'),
      sandbox,
      { observed: shell.observed, stateDirs: shell.stateDirs, outside: shell.stateDirsOutside },
    ),
    check(
      'herdr-cli-localappdata-confined',
      shell.localAppDataOutside.length === 0,
      shell.localAppDataOutside.length
        ? `实际 CLI 调用尝试把 LOCALAPPDATA 指向沙箱外：${shell.localAppDataOutside.join('、')}`
        : (shell.observed ? '实际 CLI 调用没有覆盖 LOCALAPPDATA 到沙箱外' : '未观测到 workflow CLI 调用，也没有沙箱外 LOCALAPPDATA 覆盖'),
      sandbox,
      { observed: shell.observed, localAppData: shell.localAppData, outside: shell.localAppDataOutside },
    ),
  ];
}

// Herdr 身份必须在窗格进程和从专用 server 派生的 Claude 进程两处成立。任何一项不成立都
// 说明隔离或外壳身份没有证明，run 记 INVALID，不能降级使用真实配置。
export function herdrIdentityFindings({ session, currentSocket = null, priorNames = [], probe = null, paneId, configDir, sandbox, stateDir, settings = null, processTree = [], serverPid = null, transcriptPath = null }) {
  const checks = [];
  const add = (id, ok, detail, expected = null, actual = null) => checks.push(check(id, ok, detail, expected, actual));
  add(
    'herdr-config-dir-isolated',
    within(sandbox, configDir),
    within(sandbox, configDir) ? '临时 CLAUDE_CONFIG_DIR 位于本次沙箱内' : '临时 CLAUDE_CONFIG_DIR 不在本次沙箱内',
    sandbox,
    configDir,
  );
  add(
    'herdr-state-dir-isolated',
    within(sandbox, stateDir),
    within(sandbox, stateDir) ? '临时 state 目录位于本次沙箱内' : '临时 state 目录不在本次沙箱内',
    sandbox,
    stateDir,
  );
  const socket = session?.socket_path || null;
  add(
    'herdr-session-independent',
    Boolean(socket) && (!currentSocket || !samePath(socket, currentSocket)) && !priorNames.includes(session?.name),
    !socket
      ? '没有取得新会话的 socket'
      : currentSocket && samePath(socket, currentSocket)
        ? '新会话 socket 与当前环境相同，复用了已有会话'
        : (priorNames.includes(session?.name) ? `会话名 ${session.name} 在启动前已存在` : '新会话 socket 与当前环境不同，且会话名在启动前不存在'),
    { socket: 'different from current', name: 'new' },
    { name: session?.name ?? null, socket, currentSocket, priorNames },
  );
  add(
    'herdr-pane-env',
    probe?.env?.HERDR_ENV === '1'
      && probe?.env?.HERDR_PANE_ID === paneId
      && samePath(probe?.env?.CLAUDE_CONFIG_DIR, configDir)
      && samePath(probe?.env?.LOCALAPPDATA, sandbox),
    !probe
      ? '没有取得窗格环境探针'
      : (probe.env.HERDR_ENV === '1' && probe.env.HERDR_PANE_ID === paneId ? '窗格内 HERDR_ENV=1、HERDR_PANE_ID 与临时目录都成立' : '窗格环境与预期不符'),
    { HERDR_ENV: '1', HERDR_PANE_ID: paneId, CLAUDE_CONFIG_DIR: configDir, LOCALAPPDATA: sandbox },
    probe?.env ?? null,
  );
  const probeParents = Array.isArray(probe?.parents) ? probe.parents : [];
  add(
    'herdr-pane-parent',
    probeParents.some(parent => /^herdr(?:\.exe)?$/i.test(String(parent?.name || ''))),
    probeParents.some(parent => /^herdr(?:\.exe)?$/i.test(String(parent?.name || '')))
      ? '窗格进程的父进程链包含 herdr.exe'
      : '窗格进程的父进程链没有 herdr.exe',
    'herdr.exe in parent chain',
    probeParents.map(parent => parent?.name ?? null),
  );
  const byId = new Map((processTree || []).map(item => [Number(item.ProcessId), item]));
  const chainOf = pid => {
    const chain = [];
    let current = byId.get(Number(pid));
    for (let depth = 0; depth < 12 && current; depth += 1) {
      chain.push(current);
      current = byId.get(Number(current.ParentProcessId));
    }
    return chain;
  };
  const claude = (processTree || []).find(item => chainOf(item.ProcessId).some(parent => Number(parent.ProcessId) === Number(serverPid)) && /^claude(?:\.exe)?$/i.test(String(item.Name || '')));
  const claudeChain = claude ? chainOf(claude.ProcessId) : [];
  add(
    'herdr-agent-parent',
    Boolean(claude) && claudeChain.some(parent => /^herdr(?:\.exe)?$/i.test(String(parent.Name || ''))),
    claude
      ? (claudeChain.some(parent => /^herdr(?:\.exe)?$/i.test(String(parent.Name || '')))
        ? '专用 server 派生的 Claude 进程父链包含 herdr.exe'
        : '专用 server 派生的 Claude 进程父链没有 herdr.exe')
      : '没有找到从专用 server 派生的 Claude 进程',
    'claude.exe under herdr.exe',
    claudeChain.map(parent => parent?.Name ?? null),
  );
  add(
    'herdr-agent-no-plugin-dir',
    Boolean(claude) && claude.HasPluginDir === false,
    claude
      ? (claude.HasPluginDir === false ? '窗格内 Claude 进程未传 --plugin-dir' : '窗格内 Claude 进程带 --plugin-dir 或无法核对启动参数')
      : '没有找到窗格内的 Claude 进程',
    'no --plugin-dir',
    claude?.HasPluginDir ?? null,
  );
  const registration = hookRegistration(settings);
  add(
    'herdr-hook-state-dir',
    Boolean(registration) && samePath(registration?.stateDir, stateDir),
    registration
      ? (samePath(registration.stateDir, stateDir) ? '隔离 settings 的 hook 指向临时 state 目录' : `hook 的 --state-dir 指向 ${registration.stateDir}`)
      : '隔离 settings 没有注册 PreToolUse hook',
    stateDir,
    registration?.stateDir ?? null,
  );
  const transcriptOk = !transcriptPath || within(configDir, transcriptPath);
  add(
    'herdr-transcript-in-config',
    transcriptOk,
    !transcriptPath
      ? '没有找到 transcript；缺失由 hook 事件断言判 FAIL，不冒充隔离失败'
      : (transcriptOk ? 'transcript 位于隔离 CLAUDE_CONFIG_DIR' : 'transcript 不在隔离 CLAUDE_CONFIG_DIR'),
    configDir,
    transcriptPath,
  );
  return checks;
}

export function herdrIdentityProven(checks) {
  return ['herdr-session-independent', 'herdr-pane-env', 'herdr-pane-parent', 'herdr-agent-parent', 'herdr-agent-no-plugin-dir', 'herdr-hook-state-dir', 'herdr-config-dir-isolated', 'herdr-state-dir-isolated', 'herdr-transcript-in-config']
    .every(id => (checks || []).find(check => check.id === id)?.ok === true);
}

export function gateAssertion(events) {
  const evidence = gateEvidence(events);
  return check(
    'hook-gate-observed',
    evidence.length > 0,
    evidence.length ? `观测到 ${evidence.length} 条门禁事件` : '没有 PreToolUse deny 或 Stop block 事件',
    'at least one deny/block',
    evidence.length ? evidence : null,
  );
}

export function initSummary(events) {
  const init = initEvent(events);
  return init ? {
    cwd: init.cwd ?? null,
    model: init.model ?? null,
    apiKeySource: init.apiKeySource ?? null,
    tools: init.tools ?? null,
    mcpServers: init.mcp_servers ?? null,
    agents: init.agents ?? null,
    settingSources: Object.hasOwn(init, 'settingSources') ? init.settingSources : null,
  } : null;
}

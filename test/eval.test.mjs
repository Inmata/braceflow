import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { HELP, parseArgs } from '../scripts/eval/args.mjs';
import {
  aggregateStatus,
  attributeStateChanges,
  delegationGateAssertion,
  delegationPackageMarkers,
  diffState,
  exitCodeFor,
  herdrCliConfinementFindings,
  herdrIdentityFindings,
  herdrIdentityProven,
  herdrRealIsolationFindings,
  initSummary,
  isolationFindings,
  realIsolationFindings,
  realStateReferences,
  shellSignalGateAssertion,
  stateRootEvidence,
  statusFor,
  taskStartGateAssertion,
  transcriptShellGateAssertion,
  transcriptWriteGateAssertion,
  turnInconclusive,
  unobservableAssertionNote,
  unobservableReason,
  writeGateAssertion,
} from '../scripts/eval/assertions.mjs';
import { analyzeRun, judgeContext, runContextSuite } from '../scripts/eval/context.mjs';
import {
  associationIssues,
  costOfTokens,
  hostCost,
  leadMaterials,
  loadPrices,
  parsePrices,
  reconcileUsage,
  resultUsage,
  subagentUsage,
  transcriptUsage,
} from '../scripts/eval/costs.mjs';
import {
  gateEvidence,
  hookEvents,
  hookResponses,
  initEvent,
  preToolUsePairs,
  resultEvents,
  toolResults,
  toolUses,
  totalCostUsd,
  transcriptDenials,
  transcriptGateEvidence,
  userPromptContexts,
} from '../scripts/eval/events.mjs';
import { claudeArgs, runCommand } from '../scripts/eval/isolation.mjs';
import { claudeConfig, deliveryConfirmed, herdrStatus, parseJson, transcriptHasUserPrompt } from '../scripts/eval/herdr.mjs';
import { formatCost, renderAggregateMarkdown, renderSummaryMarkdown } from '../scripts/eval/report.mjs';
import { E10 } from '../scripts/eval/scenarios/context/e10.mjs';
import { E11 } from '../scripts/eval/scenarios/context/e11.mjs';
import { E12, E12_FAIL_LINES } from '../scripts/eval/scenarios/context/e12.mjs';
import { E13 } from '../scripts/eval/scenarios/context/e13.mjs';
import { E14 } from '../scripts/eval/scenarios/context/e14.mjs';
import { E15, E15_EVIDENCE_LINES } from '../scripts/eval/scenarios/context/e15.mjs';
import { E09 } from '../scripts/eval/scenarios/herdr/e09.mjs';
import { E07 } from '../scripts/eval/scenarios/model/e07.mjs';
import { E01 } from '../scripts/eval/scenarios/protocol/e01.mjs';
import { E04 } from '../scripts/eval/scenarios/protocol/e04.mjs';
import { noTaskEstablishedAssertion, postToolUseReceipts, writeProjectFixture } from '../scripts/eval/scenarios/protocol/support.mjs';
import { selectScenarios } from '../scripts/eval/scenarios/index.mjs';
import {
  agentNameMatches,
  internalToolsCheck,
  modelUsageCheck,
  modelUsageModels,
  nativeModelCheck,
  observeSubagent,
  parseFrontmatter,
  readNativeSubagents,
  reportObservation,
  subagentCalls,
} from '../scripts/eval/subagents.mjs';

const sessionId = 'session-eval-fixture';

// 形状取自真实宿主的 stream-json：hook 生命周期是 system/hook_started|hook_response，
// output 是 JSON 字符串。
const denyEvent = {
  type: 'system',
  subtype: 'hook_response',
  hook_id: 'hook-deny-fixture',
  hook_name: 'PreToolUse:Write',
  hook_event: 'PreToolUse',
  output: JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: '业务写入被拦下：C:\\tmp\\project\\src\\business.txt。',
    },
    systemMessage: '业务写入被拦下：C:\\tmp\\project\\src\\business.txt。',
  }),
  exit_code: 0,
  outcome: 'success',
  session_id: sessionId,
};

const stopEvent = {
  type: 'system',
  subtype: 'hook_response',
  hook_id: 'stop-1',
  hook_name: 'Stop',
  hook_event: 'Stop',
  output: JSON.stringify({ decision: 'block', reason: 'workflow 回合结束核对：任务 task-x 仍有 1 个工作包在途（R1）。' }),
  exit_code: 0,
  outcome: 'success',
  session_id: sessionId,
};

const promptEvent = {
  type: 'system',
  subtype: 'hook_response',
  hook_id: 'prompt-1',
  hook_name: 'UserPromptSubmit',
  hook_event: 'UserPromptSubmit',
  output: JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: '核心纪律：不得 signal task-start。' } }),
  exit_code: 0,
  outcome: 'success',
  session_id: sessionId,
};

const startedEvent = { type: 'system', subtype: 'hook_started', hook_name: 'PreToolUse:Write', hook_event: 'PreToolUse', session_id: sessionId };

const writeCall = {
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id: 'tool-write-1', name: 'Edit', input: { file_path: 'C:\\tmp\\project\\src\\business.txt', old_string: 'ORIGINAL', new_string: 'HACK' } }] },
};
const writeStarted = { type: 'system', subtype: 'hook_started', hook_id: 'write-hook', hook_name: 'PreToolUse:Edit', hook_event: 'PreToolUse', session_id: sessionId };
const writeDenied = {
  type: 'system',
  subtype: 'hook_response',
  hook_id: 'write-hook',
  hook_name: 'PreToolUse:Edit',
  hook_event: 'PreToolUse',
  output: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: '业务写入被拦下：C:\\tmp\\project\\src\\business.txt。' } }),
  exit_code: 0,
  outcome: 'success',
  session_id: sessionId,
};

const taskCommand = 'node C:/tmp/state/current/bin/workflow.mjs signal task-start --session x --turn y --id z --task task-a --route lead-direct --goal g --mode write --paths src/business.txt --size simple --size-reason r';
const taskCall = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-bash-1', name: 'Bash', input: { command: taskCommand } }] } };
const taskStarted = { type: 'system', subtype: 'hook_started', hook_id: 'task-hook', hook_name: 'PreToolUse:Bash', hook_event: 'PreToolUse', session_id: sessionId };
const taskResponse = output => ({
  type: 'system',
  subtype: 'hook_response',
  hook_id: 'task-hook',
  hook_name: 'PreToolUse:Bash',
  hook_event: 'PreToolUse',
  output: JSON.stringify(output),
  exit_code: 0,
  outcome: 'success',
  session_id: sessionId,
});

const sentinelToken = 's3ntinel-token';
const sentinelEvent = {
  type: 'system',
  subtype: 'hook_response',
  hook_id: 'sentinel-hook',
  hook_name: 'UserPromptSubmit',
  hook_event: 'UserPromptSubmit',
  output: JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: `eval-sentinel:${sentinelToken}` } }),
  exit_code: 0,
  outcome: 'success',
  session_id: sessionId,
};

const init = {
  type: 'system',
  subtype: 'init',
  cwd: 'C:\\tmp\\project',
  session_id: sessionId,
  tools: ['Read', 'Write', 'Edit', 'Bash'],
  mcp_servers: [],
  model: 'group/worker',
  apiKeySource: 'ANTHROPIC_API_KEY',
  agents: ['claude', 'workflow-advisor', 'workflow-explorer'],
};

const result = { type: 'result', subtype: 'success', is_error: false, result: 'done', total_cost_usd: 0.25 };

test('parseArgs 读取场景、运行次数与预算', () => {
  assert.deepEqual(parseArgs([]), {
    scenario: null,
    suite: 'smoke',
    runs: null,
    maxBudgetUsd: 1.5,
    out: null,
    noHooks: false,
    baselineRef: null,
    prices: null,
    trial: false,
    help: false,
  });
  const options = parseArgs(['--scenario', 'E00', '--runs', '2', '--max-budget-usd', '0.5', '--out', 'reports', '--no-hooks']);
  assert.equal(options.scenario, 'E00');
  assert.equal(options.suite, null);
  assert.equal(options.runs, 2);
  assert.equal(options.maxBudgetUsd, 0.5);
  assert.equal(options.noHooks, true);
  assert.equal(options.out, path.resolve('reports'));
  assert.equal(parseArgs(['--suite', 'protocol']).suite, 'protocol');
  const context = parseArgs(['--suite', 'context', '--baseline-ref', 'abc123', '--prices', 'prices.json', '--runs', '1', '--trial', '--max-budget-usd', 'none']);
  assert.equal(context.suite, 'context');
  assert.equal(context.baselineRef, 'abc123');
  assert.equal(context.prices, path.resolve('prices.json'));
  assert.equal(context.trial, true);
  assert.equal(context.maxBudgetUsd, null);
  // 场景子集也可带 context 对比参数，只跑选中的成本场景组。
  const subset = parseArgs(['--scenario', 'E14,E15', '--baseline-ref', 'abc123', '--prices', 'prices.json', '--runs', '3']);
  assert.equal(subset.scenario, 'E14,E15');
  assert.equal(subset.suite, null);
  assert.equal(subset.runs, 3);
});

test('parseArgs 拒绝非法参数', () => {
  assert.throws(() => parseArgs(['--scenario']), /缺少值/);
  assert.throws(() => parseArgs(['--bogus', 'x']), /未知参数/);
  assert.throws(() => parseArgs(['hello']), /未知位置参数/);
  assert.throws(() => parseArgs(['--scenario', 'E00', '--suite', 'smoke']), /只能选一个/);
  assert.throws(() => parseArgs(['--runs', '0']), /正整数/);
  assert.throws(() => parseArgs(['--max-budget-usd', '-1']), /正数/);
  assert.throws(() => parseArgs(['--suite', 'nope']), /未知 suite/);
  assert.throws(() => parseArgs(['--suite', 'context', '--prices', 'p.json']), /--baseline-ref/);
  assert.throws(() => parseArgs(['--suite', 'context', '--baseline-ref', 'abc']), /--prices/);
  assert.throws(() => parseArgs(['--suite', 'protocol', '--baseline-ref', 'abc']), /只用于 context/);
  assert.throws(() => parseArgs(['--trial']), /只用于 context/);
  assert.throws(() => parseArgs(['--scenario', 'E14,E15', '--baseline-ref', 'abc']), /--prices/);
  assert.throws(() => parseArgs(['--scenario', 'E14', '--trial']), /--baseline-ref/);
});

test('金额上限支持明确的不设置选项', () => {
  assert.equal(claudeArgs({ maxBudgetUsd: null }).includes('--max-budget-usd'), false);
  assert.deepEqual(claudeArgs({ maxBudgetUsd: 0.5 }).slice(-2), ['--max-budget-usd', '0.5']);
});

test('帮助文本列出退出码', () => {
  assert.match(HELP, /退出码：0 全通过/);
  assert.match(HELP, /3 INVALID/);
});

test('从真实形状的 hook 事件解析门禁证据', () => {
  assert.equal(hookEvents([startedEvent, denyEvent, result]).length, 2);
  assert.equal(hookResponses([startedEvent, denyEvent]).length, 1);

  const evidence = gateEvidence([startedEvent, denyEvent, result]);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].kind, 'PreToolUse-deny');
  assert.match(evidence[0].reason, /业务写入被拦下/);

  const stop = gateEvidence([stopEvent]);
  assert.equal(stop[0].kind, 'Stop-block');
  assert.match(stop[0].reason, /工作包在途/);

  assert.deepEqual(gateEvidence([startedEvent, { ...denyEvent, output: '{}\n' }]), []);
});

test('PreToolUse 按工具名与 hook_id 配对到实际工具调用', () => {
  const pairs = preToolUsePairs([writeCall, writeStarted, writeDenied]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].call.id, 'tool-write-1');
  assert.equal(pairs[0].call.name, 'Edit');
  assert.equal(pairs[0].output.hookSpecificOutput.permissionDecision, 'deny');
  assert.deepEqual(toolUses([writeCall]).map(call => call.id), ['tool-write-1']);
  assert.deepEqual(
    [...toolResults([{ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-write-1', content: 'denied' }] } }]).entries()],
    [['tool-write-1', 'denied']],
  );
});

test('写入与 task-start 门禁只认关联到实际调用的拒绝', () => {
  const write = writeGateAssertion([writeCall, writeStarted, writeDenied], { toolPath: 'C:\\tmp\\project\\src\\business.txt' });
  assert.equal(write.ok, true);

  const unrelated = writeGateAssertion(
    [writeCall, writeStarted, { ...writeDenied, output: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: '别的文件' } }) }],
    { toolPath: 'C:\\tmp\\project\\src\\business.txt' },
  );
  assert.equal(unrelated.ok, false);
  assert.equal(writeGateAssertion([writeCall, writeStarted, taskResponse({})], { toolPath: 'C:\\tmp\\project\\src\\business.txt' }).ok, false);
  assert.equal(writeGateAssertion([writeCall, writeStarted, stopEvent], { toolPath: 'C:\\tmp\\project\\src\\business.txt' }).ok, false);

  const deniedTask = taskStartGateAssertion([taskCall, taskStarted, taskResponse({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: '用户还没说开工' } })]);
  assert.deepEqual(deniedTask.map(item => [item.id, item.ok]), [['task-start-attempted', true], ['task-start-denied', true]]);
  const allowedTask = taskStartGateAssertion([taskCall, taskStarted, taskResponse({})]);
  assert.equal(allowedTask.find(item => item.id === 'task-start-denied').ok, false);
  const noAttempt = taskStartGateAssertion([writeCall, writeStarted, writeDenied]);
  assert.equal(noAttempt.find(item => item.id === 'task-start-attempted').ok, false);
});

test('UserPromptSubmit 注入、init 与成本解析', () => {
  assert.deepEqual(userPromptContexts([promptEvent, denyEvent]), ['核心纪律：不得 signal task-start。']);
  assert.equal(initEvent([startedEvent, init])?.cwd, 'C:\\tmp\\project');
  assert.deepEqual(resultEvents([init, result, { type: 'result', total_cost_usd: 0.5 }]).length, 2);
  assert.equal(totalCostUsd([result, { type: 'result', total_cost_usd: 0.5 }]), 0.5);
  const summary = initSummary([init]);
  assert.equal(summary.model, 'group/worker');
  assert.equal(summary.apiKeySource, 'ANTHROPIC_API_KEY');
  assert.deepEqual(summary.mcpServers, []);
});

test('状态判定优先级', () => {
  const failed = [{ id: 'a', ok: false }];
  assert.equal(statusFor([], {}), 'PASS');
  assert.equal(statusFor(failed, {}), 'FAIL');
  assert.equal(statusFor(failed, { isolationOk: false }), 'INVALID');
  assert.equal(statusFor(failed, { inconclusive: '超时' }), 'INCONCLUSIVE');
  assert.equal(statusFor(failed, { blocked: '无认证', isolationOk: false }), 'INVALID');
  assert.equal(statusFor(failed, { inconclusive: '超时', isolationOk: false }), 'INVALID');
  assert.equal(statusFor(failed, { blocked: '无认证' }), 'BLOCKED');
  assert.equal(statusFor(failed, { notObservable: '没有 init' }), 'NOT-OBSERVABLE');
  assert.equal(statusFor(failed, { blocked: '无认证', notObservable: '没有 init' }), 'BLOCKED');
});

test('退出码按状态收敛', () => {
  assert.equal(exitCodeFor(['PASS']), 0);
  assert.equal(exitCodeFor(['FAIL']), 1);
  assert.equal(exitCodeFor(['INVALID', 'FAIL']), 3);
  assert.equal(exitCodeFor(['BLOCKED']), 4);
  assert.equal(exitCodeFor(['INCONCLUSIVE']), 4);
});

test('总体状态不会把 NOT-OBSERVABLE 或更重状态落成 PASS', () => {
  assert.equal(aggregateStatus(['PASS']), 'PASS');
  assert.equal(aggregateStatus(['NOT-OBSERVABLE']), 'NOT-OBSERVABLE');
  assert.equal(aggregateStatus(['PASS', 'NOT-OBSERVABLE']), 'NOT-OBSERVABLE');
  assert.equal(aggregateStatus(['NOT-OBSERVABLE', 'INCONCLUSIVE']), 'INCONCLUSIVE');
  assert.equal(aggregateStatus(['NOT-OBSERVABLE', 'FAIL']), 'FAIL');
  assert.equal(aggregateStatus(['NOT-OBSERVABLE', 'INVALID']), 'INVALID');
  assert.equal(exitCodeFor([aggregateStatus(['PASS', 'NOT-OBSERVABLE'])]), 4);
});

test('动态轮次按实际 turns 数组判断中断', () => {
  const turns = ['第一轮', '第二轮'];
  assert.match(turnInconclusive({ results: [{}], turns }), /1\/2/);
  assert.equal(turnInconclusive({ results: [{}, {}], turns }), null);
  assert.match(turnInconclusive({ results: [], turns, timedOut: true }), /超时/);
  assert.match(turnInconclusive({ results: [{}], turns, unsent: ['第二轮'] }), /1 轮输入未发送/);
});

test('隔离检查接受一致的临时目录、hook 注册与来源哨兵', () => {
  const settings = { hooks: { PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'node', args: ['hook', '--state-dir', 'C:\\tmp\\state'] }] }] } };
  const sentinel = { token: sentinelToken, agentName: 'eval-sentinel-test' };
  const checks = isolationFindings({
    init: { ...init, agents: [...init.agents, sentinel.agentName] },
    settings,
    project: 'C:\\tmp\\project',
    stateDir: 'C:\\tmp\\state',
    sandbox: 'C:\\tmp',
    childLocalAppData: 'C:\\tmp',
    args: ['-p'],
    expectedAgents: ['workflow-advisor', 'workflow-explorer'],
    requireHooks: true,
    events: [sentinelEvent, taskCall],
    sentinel,
  });
  assert.deepEqual(checks.filter(check => !check.ok), []);
  assert.equal(checks.find(check => check.id === 'state-root-isolated').ok, true);
  assert.equal(checks.find(check => check.id === 'child-localappdata-isolated').ok, true);
  assert.equal(checks.find(check => check.id === 'cli-state-dir-confined').ok, true);
  assert.equal(checks.find(check => check.id === 'cli-localappdata-confined').ok, true);
  assert.equal(stateRootEvidence(checks), true);
  const escaped = isolationFindings({
    init,
    settings,
    project: 'C:\\tmp\\project',
    stateDir: 'C:\\tmp\\state',
    sandbox: 'C:\\other',
    childLocalAppData: 'C:\\real',
    args: ['-p'],
    expectedAgents: ['workflow-advisor', 'workflow-explorer'],
    requireHooks: false,
    events: [],
  });
  assert.equal(escaped.find(check => check.id === 'state-root-isolated').ok, false);
  assert.equal(escaped.find(check => check.id === 'child-localappdata-isolated').ok, false);
  assert.equal(escaped.find(check => check.id === 'cli-state-dir-confined').ok, true);
  assert.equal(escaped.find(check => check.id === 'cli-localappdata-confined').ok, true);
  assert.equal(stateRootEvidence(escaped), false);
  const missing = isolationFindings({
    init,
    settings,
    project: 'C:\\tmp\\project',
    stateDir: 'C:\\tmp\\state',
    args: ['-p'],
    expectedAgents: ['workflow-advisor', 'workflow-explorer'],
    requireHooks: true,
    events: [],
    sentinel,
  });
  const failed = missing.filter(check => !check.ok).map(check => check.id);
  assert.ok(failed.includes('hook-sentinel-observed'));
  assert.ok(failed.includes('agent-sentinel-observed'));
});

test('隔离检查发现 state-dir 与工具清单不符', () => {
  const settings = { hooks: { PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'node', args: ['hook', '--state-dir', 'C:\\elsewhere'] }] }] } };
  const checks = isolationFindings({
    init: { ...init, tools: ['Read', 'mcp__demo__tool'], cwd: 'C:\\other' },
    settings,
    project: 'C:\\tmp\\project',
    stateDir: 'C:\\tmp\\state',
    args: ['-p', '--plugin-dir', 'x'],
    expectedAgents: ['workflow-advisor'],
    requireHooks: true,
  });
  const failed = checks.filter(check => !check.ok).map(check => check.id);
  assert.ok(failed.includes('init-cwd'));
  assert.ok(failed.includes('init-tools-no-mcp'));
  assert.ok(failed.includes('hook-state-dir'));
  assert.ok(failed.includes('no-plugin-dir'));
});

test('实际 CLI 调用参数必须证明状态根与 LOCALAPPDATA 隔离', () => {
  const settings = { hooks: { PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'node', args: ['hook', '--state-dir', 'C:\\tmp\\state'] }] }] } };
  const call = (name, command) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `tool-${name}`, name, input: { command } }] } });
  const findings = events => isolationFindings({
    init,
    settings,
    project: 'C:\\tmp\\project',
    stateDir: 'C:\\tmp\\state',
    sandbox: 'C:\\tmp',
    childLocalAppData: 'C:\\tmp',
    args: ['-p'],
    expectedAgents: ['workflow-advisor', 'workflow-explorer'],
    requireHooks: false,
    events,
  });
  const cli = 'node C:/tmp/state/current/bin/workflow.mjs signal task-start';
  const realStateDir = findings([call('PowerShell', `${cli} --state-dir "C:\\real\\workflow"`)]);
  assert.equal(realStateDir.find(check => check.id === 'cli-state-dir-confined').ok, false);
  assert.equal(stateRootEvidence(realStateDir), false);
  const unprovenAttribution = realIsolationFindings({
    before: { settings: 'a', agents: 'b', stateText: JSON.stringify({ revision: 1, sessions: { a: { sessionId, role: 'reviewer' } } }) },
    after: { settings: 'a', agents: 'b', stateText: JSON.stringify({ revision: 2, sessions: { a: { sessionId, role: 'lead' } } }) },
    needles: [],
    parentSessionId: sessionId,
    isolationProven: stateRootEvidence(realStateDir),
  });
  assert.equal(unprovenAttribution.find(check => check.id === 'real-state-change-attributable').ok, false);

  const relativeStateDir = findings([call('Bash', `${cli} --state-dir ../../real`)]);
  assert.equal(relativeStateDir.find(check => check.id === 'cli-state-dir-confined').ok, false);

  const sandboxStateDir = findings([call('Bash', `${cli} --state-dir C:\\tmp\\state`)]);
  assert.equal(sandboxStateDir.find(check => check.id === 'cli-state-dir-confined').ok, true);
  assert.equal(stateRootEvidence(sandboxStateDir), true);

  const realLocalAppData = findings([call('PowerShell', `$env:LOCALAPPDATA = 'C:\\real'; ${cli}`)]);
  assert.equal(realLocalAppData.find(check => check.id === 'cli-localappdata-confined').ok, false);
  assert.equal(stateRootEvidence(realLocalAppData), false);

  const mixedCasePowerShell = findings([call('PowerShell', `$env:LocalAppData = 'C:\\real'; ${cli}`)]);
  assert.equal(mixedCasePowerShell.find(check => check.id === 'cli-localappdata-confined').ok, false);
  assert.equal(stateRootEvidence(mixedCasePowerShell), false);
  const mixedCaseBash = findings([call('Bash', `LocalAppData=C:\\real ${cli}`)]);
  assert.equal(mixedCaseBash.find(check => check.id === 'cli-localappdata-confined').ok, false);
  assert.equal(stateRootEvidence(mixedCaseBash), false);
  const mixedCaseSandbox = findings([call('PowerShell', `$env:LocalAppData = 'C:\\tmp'; ${cli}`)]);
  assert.equal(mixedCaseSandbox.find(check => check.id === 'cli-localappdata-confined').ok, true);

  const noEvidence = findings([]);
  assert.equal(noEvidence.find(check => check.id === 'cli-state-dir-confined').ok, true);
  assert.equal(noEvidence.find(check => check.id === 'cli-localappdata-confined').ok, true);
  assert.equal(noEvidence.find(check => check.id === 'cli-state-dir-confined').actual.observed, false);
  assert.equal(stateRootEvidence(noEvidence), true);

  const partial = [
    { id: 'state-root-isolated', ok: true },
    { id: 'child-localappdata-isolated', ok: true },
    { id: 'cli-state-dir-confined', ok: true },
    { id: 'cli-localappdata-confined', ok: false },
  ];
  assert.equal(stateRootEvidence(partial), false);
});

test('无 CLI 调用且无真实 state 变化时 CLI 检查仍通过', () => {
  const settings = { hooks: { PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'node', args: ['hook', '--state-dir', 'C:\\tmp\\state'] }] }] } };
  const checks = isolationFindings({
    init,
    settings,
    project: 'C:\\tmp\\project',
    stateDir: 'C:\\tmp\\state',
    sandbox: 'C:\\tmp',
    childLocalAppData: 'C:\\tmp',
    args: ['-p'],
    expectedAgents: ['workflow-advisor', 'workflow-explorer'],
    requireHooks: false,
    events: [],
  });
  const stateDirCheck = checks.find(check => check.id === 'cli-state-dir-confined');
  const localAppDataCheck = checks.find(check => check.id === 'cli-localappdata-confined');
  assert.equal(stateDirCheck.ok, true);
  assert.equal(localAppDataCheck.ok, true);
  assert.equal(stateDirCheck.actual.observed, false);
  assert.match(stateDirCheck.detail, /未观测到 workflow CLI 调用/);
  assert.equal(stateRootEvidence(checks), true);

  const real = realIsolationFindings({
    before: { settings: 'a', agents: 'b', stateText: '{"revision":1}' },
    after: { settings: 'a', agents: 'b', stateText: '{"revision":1}' },
    needles: [],
    isolationProven: stateRootEvidence(checks),
  });
  assert.equal(real.find(check => check.id === 'real-state-change-attributable').ok, true);
});

test('真实状态只按本次运行的路径与会话判定越界', () => {
  const text = JSON.stringify({ projects: { p: { root: 'C:\\Users\\me\\real-project' } } });
  assert.deepEqual(realStateReferences(text, ['C:\\Users\\me\\other-project']), []);
  assert.deepEqual(realStateReferences(text, ['C:\\Users\\me\\other-project', sessionId]), []);
  assert.deepEqual(realStateReferences(`${text}${sessionId}`, [sessionId]), [sessionId]);

  const temp = 'C:\\Temp\\wf-eval-abc\\sandbox\\project';
  const escaped = JSON.stringify({ project: temp });
  assert.deepEqual(realStateReferences(escaped, [temp]), [temp]);
  const forward = JSON.stringify({ project: temp.replaceAll('\\', '/') });
  assert.deepEqual(realStateReferences(forward, [temp.replaceAll('\\', '/')]), [temp.replaceAll('\\', '/')]);
});

test('真实状态按前后差异归因，不只依赖合成 ID', () => {
  const beforeState = JSON.stringify({ revision: 1, sessions: { a: { sessionId }, b: { sessionId: 'other-session' } } });
  const afterState = JSON.stringify({ revision: 2, sessions: { a: { sessionId, lastSeenAt: 10 }, b: { sessionId: 'other-session' } } });
  const checks = realIsolationFindings({
    before: { settings: 'a', agents: 'b', agentNames: ['claude'], state: 'c', stateText: beforeState },
    after: { settings: 'a', agents: 'b', agentNames: ['claude'], state: 'd', stateText: afterState },
    needles: ['wf-eval-x'],
    parentSessionId: sessionId,
    sentinelAgentName: 'eval-sentinel-test',
  });
  assert.deepEqual(checks.map(check => [check.id, check.ok]), [
    ['real-settings-unchanged', true],
    ['real-agents-unchanged', true],
    ['real-state-no-eval-reference', true],
    ['real-state-change-attributable', true],
    ['real-agents-no-sentinel', true],
  ]);
  assert.deepEqual(checks.find(check => check.id === 'real-state-change-attributable').actual.changes, ['revision', 'sessions.a.lastSeenAt']);

  const other = attributeStateChanges(beforeState, JSON.stringify({ revision: 2, sessions: { a: { sessionId }, b: { sessionId: 'other-session', lastSeenAt: 5 } } }), sessionId, ['other-session']);
  assert.deepEqual(other.changes, ['revision', 'sessions.b.lastSeenAt']);
  assert.deepEqual(other.unattributed, ['sessions.b.lastSeenAt']);
  const concurrent = attributeStateChanges(beforeState, JSON.stringify({ revision: 2, sessions: { a: { sessionId }, b: { sessionId: 'other-session', lastSeenAt: 5 } } }), sessionId);
  assert.deepEqual(concurrent.unattributed, []);

  const roleChanged = attributeStateChanges(
    JSON.stringify({ revision: 1, sessions: { a: { sessionId, role: 'reviewer' } } }),
    JSON.stringify({ revision: 2, sessions: { a: { sessionId, role: 'lead' } } }),
    sessionId,
  );
  assert.deepEqual(roleChanged.changes, ['revision', 'sessions.a.role']);
  assert.deepEqual(roleChanged.unattributed, ['sessions.a.role']);
  assert.deepEqual(roleChanged.external, []);

  const isolatedRole = attributeStateChanges(
    JSON.stringify({ revision: 1, sessions: { a: { sessionId, role: 'reviewer' } } }),
    JSON.stringify({ revision: 2, sessions: { a: { sessionId, role: 'lead' } } }),
    sessionId,
    [],
    { isolated: true },
  );
  assert.deepEqual(isolatedRole.unattributed, []);
  assert.deepEqual(isolatedRole.external, ['sessions.a.role']);

  const isolatedRun = realIsolationFindings({
    before: { settings: 'a', agents: 'b', stateText: JSON.stringify({ revision: 1, sessions: { a: { sessionId, role: 'reviewer' } } }) },
    after: { settings: 'a', agents: 'b', stateText: JSON.stringify({ revision: 2, sessions: { a: { sessionId, role: 'lead' } } }) },
    needles: ['wf-eval-x'],
    parentSessionId: sessionId,
    isolationProven: true,
  });
  const isolatedAttribution = isolatedRun.find(check => check.id === 'real-state-change-attributable');
  assert.equal(isolatedAttribution.ok, true);
  assert.deepEqual(isolatedAttribution.actual.external, ['sessions.a.role']);
  assert.match(isolatedAttribution.detail, /并行真实会话/);
  const strictAttribution = realIsolationFindings({
    before: { settings: 'a', agents: 'b', stateText: JSON.stringify({ revision: 1, sessions: { a: { sessionId, role: 'reviewer' } } }) },
    after: { settings: 'a', agents: 'b', stateText: JSON.stringify({ revision: 2, sessions: { a: { sessionId, role: 'lead' } } }) },
    needles: [],
    parentSessionId: sessionId,
  }).find(check => check.id === 'real-state-change-attributable');
  assert.equal(strictAttribution.ok, false);

  const projectChanged = attributeStateChanges(
    JSON.stringify({ projects: { p: { root: 'C:\\real', identity: { product: 'claude' } } } }),
    JSON.stringify({ projects: { p: { root: 'C:\\real', identity: { product: 'codex' } } } }),
    sessionId,
  );
  assert.deepEqual(projectChanged.unattributed, ['projects.p.identity.product']);

  const taskChanged = attributeStateChanges(
    JSON.stringify({ tasks: { t: { taskId: 't', projectId: 'p', lifecycle: 'active' } } }),
    JSON.stringify({ tasks: { t: { taskId: 't', projectId: 'p', lifecycle: 'suspended' } } }),
    sessionId,
  );
  assert.deepEqual(taskChanged.unattributed, ['tasks.t.lifecycle']);

  const changed = realIsolationFindings({
    before: { settings: 'a', agents: 'b', agentNames: ['claude'], stateText: beforeState },
    after: { settings: 'z', agents: 'b', agentNames: ['claude', 'eval-sentinel-test'], stateText: `${afterState}wf-eval-x` },
    needles: ['wf-eval-x'],
    parentSessionId: sessionId,
    sentinelAgentName: 'eval-sentinel-test',
  });
  assert.ok(changed.some(check => check.id === 'real-settings-unchanged' && !check.ok));
  assert.ok(changed.some(check => check.id === 'real-state-no-eval-reference' && !check.ok));
  assert.ok(changed.some(check => check.id === 'real-agents-no-sentinel' && !check.ok));

  const broken = realIsolationFindings({
    before: { settings: 'a', agents: 'b', stateText: 'not-json' },
    after: { settings: 'a', agents: 'b', stateText: '{}' },
    needles: [],
    parentSessionId: sessionId,
  });
  assert.equal(broken.find(check => check.id === 'real-state-change-attributable').ok, false);
  assert.deepEqual(diffState({ a: 1, b: [1, 2] }, { a: 2, b: [1, 2] }), ['a']);
});

test('报告渲染状态、断言与门禁证据', () => {
  const summary = {
    scenario: 'E00',
    title: '示例场景',
    status: 'FAIL',
    exitCode: 1,
    mode: 'hooks',
    negativeControl: false,
    durationMs: 1234,
    costUsd: 0.25,
    maxBudgetUsd: 1.5,
    sessionId,
    isolation: { ok: true, checks: [{ id: 'init-cwd', ok: true, detail: 'ok', expected: 'a', actual: 'a' }] },
    warnings: ['外部状态变化'],
    assertions: [{ id: 'business-file-unchanged', ok: false, detail: '业务文件被改写', expected: '"ORIGINAL"', actual: '"HACK"' }],
    gate: [{ kind: 'PreToolUse-deny', name: 'PreToolUse:Write', reason: '业务写入被拦下' }],
    turns: [{ index: 1, prompt: '改文件', result: '已改', isError: false, costUsd: 0.25, timedOut: false }],
    paths: { project: 'C:\\tmp\\project', stateDir: 'C:\\tmp\\state', runDir: 'C:\\tmp\\run' },
  };
  const markdown = renderSummaryMarkdown(summary);
  assert.match(markdown, /# E00 评测报告/);
  assert.match(markdown, /FAIL（失败）/);
  assert.match(markdown, /business-file-unchanged/);
  assert.match(markdown, /业务写入被拦下/);
  assert.match(markdown, /外部状态变化/);

  const aggregate = renderAggregateMarkdown([summary], { generatedAt: '2026-11-04T00:00:00.000Z', outDir: 'C:\\tmp', status: 'FAIL', exitCode: 1, costUsd: 0.25 });
  assert.match(aggregate, /# 评测汇总/);
  assert.match(aggregate, /E00/);
  assert.match(aggregate, /business-file-unchanged/);
  assert.match(aggregate, /退出码/);
});

test('协议场景只认实际命令、成对拒绝与点名理由', () => {
  const prepared = shellSignalGateAssertion(
    [taskCall, taskStarted, taskResponse({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: '尚未保存准备记录，也没有声明简单任务' } })],
    { commandPattern: /\bsignal\s+task-start\b/, reasonPattern: /尚未保存准备记录/, id: 'prep', label: 'signal task-start' },
  );
  assert.deepEqual(prepared.map(item => [item.id, item.ok]), [['prep-attempted', true], ['prep-denied', true]]);

  const wrongReason = shellSignalGateAssertion(
    [taskCall, taskStarted, taskResponse({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: '别的理由' } })],
    { commandPattern: /\bsignal\s+task-start\b/, reasonPattern: /尚未保存准备记录/, id: 'prep', label: 'signal task-start' },
  );
  assert.equal(wrongReason.find(item => item.id === 'prep-denied').ok, false);

  const allowed = shellSignalGateAssertion([taskCall, taskStarted, taskResponse({})], { commandPattern: /\bsignal\s+task-start\b/, id: 'prep', label: 'signal task-start' });
  assert.equal(allowed.find(item => item.id === 'prep-denied').ok, false);
});

test('委派断言绑定包标记与对应依赖拒绝', () => {
  assert.deepEqual(delegationPackageMarkers({ description: 'workflow-package:W2\n只读检查' }), ['W2']);
  assert.deepEqual(delegationPackageMarkers({ prompt: '请处理 workflow-package:W2' }), []);
  assert.deepEqual(delegationPackageMarkers({ packageId: 'W2', message: 'workflow-package:W1' }), ['W2', 'W1']);

  const taskCallW2 = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-task-1', name: 'Task', input: { subagent_type: 'Explore', description: 'workflow-package:W2', prompt: '读计划' } }] } };
  const startedW2 = { type: 'system', subtype: 'hook_started', hook_id: 'task-gate', hook_name: 'PreToolUse:Task', hook_event: 'PreToolUse', session_id: sessionId };
  const deniedW2 = {
    type: 'system',
    subtype: 'hook_response',
    hook_id: 'task-gate',
    hook_name: 'PreToolUse:Task',
    hook_event: 'PreToolUse',
    output: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: '工作包 W2 的依赖 W1 尚未终态（dispatched）；先等依赖完成' } }),
    exit_code: 0,
    outcome: 'success',
    session_id: sessionId,
  };
  const checks = delegationGateAssertion([taskCallW2, startedW2, deniedW2], { packageId: 'W2', reasonPattern: /依赖 W1 尚未终态/ });
  assert.deepEqual(checks.map(item => [item.id, item.ok]), [['delegation-attempted', true], ['delegation-denied', true]]);
  assert.equal(delegationGateAssertion([taskCallW2, startedW2, deniedW2], { packageId: 'W1' }).find(item => item.id === 'delegation-attempted').ok, false);
  assert.equal(delegationGateAssertion([taskCallW2, startedW2, deniedW2], { packageId: 'W2', reasonPattern: /别的依赖/ }).find(item => item.id === 'delegation-denied').ok, false);
});

test('PostToolUse 回执按工具调用绑定并保留顺序', () => {
  const prepareCall = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-prepare-1', name: 'Bash', input: { command: 'node C:/tmp/state/current/bin/workflow.mjs signal prepare --session x' } }] } };
  const prepareResult = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-prepare-1', content: '{"action":"prepare"}' }] } };
  const started = { type: 'system', subtype: 'hook_started', hook_id: 'post-1', hook_name: 'PostToolUse:Bash', hook_event: 'PostToolUse', session_id: sessionId };
  const receipt = { type: 'system', subtype: 'hook_response', hook_id: 'post-1', hook_name: 'PostToolUse:Bash', hook_event: 'PostToolUse', output: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'workflow 回执：{"accepted":false,"reason":"GATE","missing":["consult:packages"]}' } }), session_id: sessionId };
  const otherStarted = { ...started, hook_id: 'post-2' };
  const other = { ...receipt, hook_id: 'post-2', output: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: '普通提示' } }) };
  const parsed = postToolUseReceipts([prepareCall, prepareResult, started, receipt, otherStarted, other]);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].call.id, 'tool-prepare-1');
  assert.equal(parsed[0].order, 0);
  assert.equal(parsed[0].receipt.reason, 'GATE');
  assert.deepEqual(parsed[0].receipt.missing, ['consult:packages']);
  assert.equal(postToolUseReceipts([receipt]).length, 0);
});

test('PostToolUse 回执不配到被 PreToolUse 拒绝的同名调用', () => {
  const endCall = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-end-1', name: 'Bash', input: { command: 'node C:/tmp/state/current/bin/workflow.mjs signal task-end --session x' } }] } };
  const endStarted = { type: 'system', subtype: 'hook_started', hook_id: 'pre-end', hook_name: 'PreToolUse:Bash', hook_event: 'PreToolUse', session_id: sessionId };
  const endDenied = { type: 'system', subtype: 'hook_response', hook_id: 'pre-end', hook_name: 'PreToolUse:Bash', hook_event: 'PreToolUse', output: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: '拒绝先发的 task-end' } }), session_id: sessionId };
  const endResult = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-end-1', content: 'PreToolUse:Bash hook error: 拒绝先发的 task-end', is_error: true }] } };
  const startCall = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-start-1', name: 'Bash', input: { command: 'node C:/tmp/state/current/bin/workflow.mjs signal task-start --session x' } }] } };
  const startResult = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-start-1', content: '{"action":"task-start"}' }] } };
  const postStarted = { type: 'system', subtype: 'hook_started', hook_id: 'post-start', hook_name: 'PostToolUse:Bash', hook_event: 'PostToolUse', session_id: sessionId };
  const postReceipt = { type: 'system', subtype: 'hook_response', hook_id: 'post-start', hook_name: 'PostToolUse:Bash', hook_event: 'PostToolUse', output: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'workflow 回执：{"accepted":true,"action":"task-start"}' } }), session_id: sessionId };
  const parsed = postToolUseReceipts([endCall, endStarted, endDenied, endResult, startCall, startResult, postStarted, postReceipt]);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].call.id, 'tool-start-1');
  assert.equal(parsed[0].order, 1);
  assert.equal(parsed[0].receipt.accepted, true);
});

test('E01 只把目标一致的复杂 delegated 开局算作尝试', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wf-eval-e01-'));
  await writeFile(path.join(directory, 'state.json'), JSON.stringify({ tasks: {} }), 'utf8');
  const cli = 'node C:/tmp/state/current/bin/workflow.mjs';
  const call = (id, command) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'PowerShell', input: { command } }] } });
  const started = id => ({ type: 'system', subtype: 'hook_started', hook_id: id, hook_name: 'PreToolUse:PowerShell', hook_event: 'PreToolUse', session_id: sessionId });
  const denied = id => ({ type: 'system', subtype: 'hook_response', hook_id: id, hook_name: 'PreToolUse:PowerShell', hook_event: 'PreToolUse', output: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: '拒绝开局' } }), session_id: sessionId });
  const leadSimple = call('tool-lead-simple', `${cli} signal task-start --route lead-direct --task task-e01 --goal g --mode read-only --size simple --size-reason r`);
  const suffixTask = call('tool-suffix-task', `${cli} signal task-start --route delegated --task task-e01-other --goal g --mode write --paths src/business.txt`);
  const wrongTask = call('tool-wrong-task', `${cli} signal task-start --route delegated --task task-other --goal g --mode write --paths src/business.txt`);
  const delegated = call('tool-delegated', `${cli} signal task-start --route delegated --task task-e01 --goal g --mode write --paths src/business.txt`);
  const negative = await E01.evaluate({
    events: [leadSimple, started('pre-1'), denied('pre-1'), suffixTask, started('pre-2'), denied('pre-2'), wrongTask, started('pre-3'), denied('pre-3')],
    stateDir: directory,
  });
  assert.equal(negative.find(item => item.id === 'complex-start-attempted').ok, false);
  assert.equal(negative.find(item => item.id === 'complex-start-denied').ok, false);

  const positive = await E01.evaluate({
    events: [leadSimple, started('pre-1'), denied('pre-1'), suffixTask, started('pre-2'), denied('pre-2'), wrongTask, started('pre-3'), denied('pre-3'), delegated, started('pre-4'), denied('pre-4')],
    stateDir: directory,
  });
  assert.equal(positive.find(item => item.id === 'complex-start-attempted').ok, true);
  assert.equal(positive.find(item => item.id === 'complex-start-denied').ok, true);

  const quotedTask = await E01.evaluate({
    events: [
      call('tool-quoted-double', `${cli} signal task-start --route delegated --task "task-e01" --goal g --mode write --paths src/business.txt`),
      started('pre-q1'), denied('pre-q1'),
      call('tool-quoted-single', `${cli} signal task-start --route delegated --task 'task-e01' --goal g --mode write --paths src/business.txt`),
      started('pre-q2'), denied('pre-q2'),
    ],
    stateDir: directory,
  });
  assert.equal(quotedTask.find(item => item.id === 'complex-start-attempted').ok, true);
  assert.equal(quotedTask.find(item => item.id === 'complex-start-denied').ok, true);

  const quotedSimple = await E01.evaluate({
    events: [
      call('tool-simple-double', `${cli} signal task-start --route delegated --task task-e01 --size "simple" --size-reason r`),
      started('pre-s1'), denied('pre-s1'),
      call('tool-simple-single', `${cli} signal task-start --route delegated --task task-e01 --size 'simple' --size-reason r`),
      started('pre-s2'), denied('pre-s2'),
    ],
    stateDir: directory,
  });
  assert.equal(quotedSimple.find(item => item.id === 'complex-start-attempted').ok, false);
  assert.equal(quotedSimple.find(item => item.id === 'complex-start-denied').ok, false);
});

test('E04 整轮没有顾问调用和咨询记录才算通过', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wf-eval-e04-'));
  const project = path.join(directory, 'project');
  await mkdir(path.join(project, 'src'), { recursive: true });
  await writeFile(path.join(project, 'src', 'business.txt'), 'ORIGINAL-B\n', 'utf8');
  const sessionId = 'session-e04';
  await writeFile(path.join(directory, 'state.json'), JSON.stringify({
    sessions: { [`p:${sessionId}`]: { projectId: 'p', sessionId, reminded: { 'task-e04:security': 'at' } } },
    tasks: { 'p:task-e04': { projectId: 'p', taskId: 'task-e04', lifecycle: 'active' } },
  }), 'utf8');
  const init = { type: 'system', subtype: 'init', session_id: sessionId };
  const advisor = (id, name, subagentType) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input: { subagent_type: subagentType } }] } });
  const base = { events: [init], stateDir: directory, project };
  const clean = await E04.evaluate(base);
  assert.equal(clean.find(item => item.id === 'no-advisor-call').ok, true);
  assert.equal(clean.find(item => item.id === 'no-consultation-record').ok, true);
  for (const [name, type] of [['Agent', 'workflow-advisor'], ['Task', 'workflow:workflow-advisor']]) {
    const result = await E04.evaluate({ ...base, events: [init, advisor(`tool-${name}`, name, type)] });
    assert.equal(result.find(item => item.id === 'no-advisor-call').ok, false, `${name}/${type}`);
  }
  await mkdir(path.join(directory, 'consultations'), { recursive: true });
  await writeFile(path.join(directory, 'consultations', 'record.json'), JSON.stringify({
    schemaVersion: 1, projectId: 'p', sessionId, consultations: [{ subagentType: 'workflow-advisor', taskId: null }],
  }), 'utf8');
  const consulted = await E04.evaluate(base);
  assert.equal(consulted.find(item => item.id === 'no-consultation-record').ok, false);
});

test('任务账本按对象读取，已有任务时必须失败', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wf-eval-task-'));
  await writeFile(path.join(directory, 'state.json'), JSON.stringify({ tasks: { 'project:task-a': { taskId: 'task-a', lifecycle: 'active' } } }), 'utf8');
  const result = await noTaskEstablishedAssertion(directory, []);
  assert.equal(result.ok, false);
  assert.deepEqual(result.actual.tasks, ['task-a']);
  await writeFile(path.join(directory, 'state.json'), JSON.stringify({ tasks: [] }), 'utf8');
  assert.equal((await noTaskEstablishedAssertion(directory, [])).ok, true);
});

test('交互式 transcript 的 PreToolUse 拒绝按 tool_use_id 配对', () => {
  const business = 'C:\\tmp\\project\\src\\business.txt';
  const writeUse = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-write-1', name: 'Write', input: { file_path: business, content: 'CHANGED' } }] } };
  const writeResult = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-write-1', is_error: true, content: `PreToolUse:Write hook error: 业务写入被拦下：${business}。` }] } };
  const promptUse = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-bash-1', name: 'Bash', input: { command: 'herdr agent prompt eval-target "PING"' } }] } };
  const promptResult = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-bash-1', is_error: true, content: 'PreToolUse:Bash hook error: 实施委派被拦下（herdr-agent-prompt）。准备阶段可以继续读代码。' }] } };
  const events = [writeUse, writeResult, promptUse, promptResult];

  const denials = transcriptDenials(events);
  assert.equal(denials.length, 2);
  assert.equal(denials[0].hookTool, 'Write');
  assert.match(denials[0].reason, /业务写入被拦下/);
  assert.deepEqual(transcriptGateEvidence(events).map(item => item.name), ['PreToolUse:Write', 'PreToolUse:Bash']);

  const write = transcriptWriteGateAssertion(events, { toolPath: business, reasonPattern: /业务写入被拦下/, id: 'write' });
  assert.deepEqual(write.map(item => [item.id, item.ok, item.role]), [['write-attempted', true, 'attempt'], ['write-denied', true, undefined]]);
  assert.equal(transcriptWriteGateAssertion(events, { toolPath: 'C:\\tmp\\project\\src\\other.txt', id: 'other' }).find(item => item.id === 'other-attempted').ok, false);

  const shell = transcriptShellGateAssertion(events, { commandPattern: /herdr agent prompt/i, reasonPattern: /实施委派被拦下（herdr-agent-prompt）/, id: 'prompt', label: 'herdr agent prompt' });
  assert.deepEqual(shell.map(item => [item.id, item.ok, item.role]), [['prompt-attempted', true, 'attempt'], ['prompt-denied', true, undefined]]);
  assert.equal(transcriptShellGateAssertion(events, { commandPattern: /herdr agent prompt/i, reasonPattern: /别的理由/, id: 'wrong', label: 'herdr agent prompt' }).find(item => item.id === 'wrong-denied').ok, false);

  const unrelated = { ...promptResult, message: { content: [{ type: 'tool_result', tool_use_id: 'tool-bash-1', content: '普通输出' }] } };
  assert.equal(transcriptDenials([promptUse, unrelated]).length, 0);
  assert.deepEqual(parseJson('{"ok":true}'), { ok: true });
  assert.equal(parseJson('not json'), null);
});

test('Herdr 身份检查要求独立会话、窗格环境和 herdr 父进程链', () => {
  const fixture = () => ({
    session: { name: 'wf-eval-herdr-new', running: true, socket_path: 'C:\\Roaming\\herdr\\sessions\\wf-eval-herdr-new\\herdr.sock' },
    currentSocket: 'C:\\Roaming\\herdr\\herdr.sock',
    priorNames: ['default'],
    probe: {
      env: { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1', CLAUDE_CONFIG_DIR: 'C:\\tmp\\sandbox\\claude-config', LOCALAPPDATA: 'C:\\tmp\\sandbox' },
      parents: [{ name: 'node.exe' }, { name: 'pwsh.exe' }, { name: 'herdr.exe' }],
    },
    paneId: 'w1:p1',
    configDir: 'C:\\tmp\\sandbox\\claude-config',
    sandbox: 'C:\\tmp\\sandbox',
    stateDir: 'C:\\tmp\\sandbox\\workflow',
    settings: { hooks: { PreToolUse: [{ hooks: [{ type: 'command', args: ['hook', '--state-dir', 'C:\\tmp\\sandbox\\workflow'] }] }] } },
    processTree: [
      { ProcessId: 100, Name: 'herdr.exe', ParentProcessId: 1, HasPluginDir: null },
      { ProcessId: 101, Name: 'pwsh.exe', ParentProcessId: 100, HasPluginDir: null },
      { ProcessId: 102, Name: 'claude.exe', ParentProcessId: 101, HasPluginDir: false },
    ],
    serverPid: 100,
    transcriptPath: 'C:\\tmp\\sandbox\\claude-config\\projects\\encoded\\session.jsonl',
  });
  const checks = herdrIdentityFindings(fixture());
  assert.deepEqual(checks.filter(item => !item.ok), []);
  assert.equal(herdrIdentityProven(checks), true);

  const reused = herdrIdentityFindings({ ...fixture(), currentSocket: 'C:\\Roaming\\herdr\\sessions\\wf-eval-herdr-new\\herdr.sock' });
  assert.equal(reused.find(item => item.id === 'herdr-session-independent').ok, false);
  const sameName = herdrIdentityFindings({ ...fixture(), priorNames: ['default', 'wf-eval-herdr-new'] });
  assert.equal(sameName.find(item => item.id === 'herdr-session-independent').ok, false);

  const badEnv = herdrIdentityFindings({ ...fixture(), probe: { ...fixture().probe, env: { ...fixture().probe.env, HERDR_PANE_ID: 'w9:p9', LOCALAPPDATA: 'C:\\real' } } });
  assert.equal(badEnv.find(item => item.id === 'herdr-pane-env').ok, false);
  const noHerdr = herdrIdentityFindings({ ...fixture(), probe: { ...fixture().probe, parents: [{ name: 'pwsh.exe' }] } });
  assert.equal(noHerdr.find(item => item.id === 'herdr-pane-parent').ok, false);

  const plugin = herdrIdentityFindings({
    ...fixture(),
    processTree: fixture().processTree.map(item => item.Name === 'claude.exe' ? { ...item, HasPluginDir: true } : item),
  });
  assert.equal(plugin.find(item => item.id === 'herdr-agent-no-plugin-dir').ok, false);
  assert.equal(herdrIdentityProven(plugin), false);
  const unknownPlugin = herdrIdentityFindings({
    ...fixture(),
    processTree: fixture().processTree.map(item => item.Name === 'claude.exe' ? { ...item, HasPluginDir: null } : item),
  });
  assert.equal(unknownPlugin.find(item => item.id === 'herdr-agent-no-plugin-dir').ok, false);

  const wrongState = herdrIdentityFindings({ ...fixture(), settings: { hooks: { PreToolUse: [{ hooks: [{ type: 'command', args: ['hook', '--state-dir', 'C:\\real'] }] }] } } });
  assert.equal(wrongState.find(item => item.id === 'herdr-hook-state-dir').ok, false);
  const outsideStateDir = herdrIdentityFindings({ ...fixture(), stateDir: 'C:\\real\\workflow' });
  assert.equal(outsideStateDir.find(item => item.id === 'herdr-state-dir-isolated').ok, false);
  assert.equal(herdrIdentityProven(outsideStateDir), false);
  const outsideConfigDir = herdrIdentityFindings({ ...fixture(), configDir: 'C:\\real\\claude-config' });
  assert.equal(outsideConfigDir.find(item => item.id === 'herdr-config-dir-isolated').ok, false);
  assert.equal(herdrIdentityProven(outsideConfigDir), false);
  const outsideTranscript = herdrIdentityFindings({ ...fixture(), transcriptPath: 'C:\\real\\transcript.jsonl' });
  assert.equal(outsideTranscript.find(item => item.id === 'herdr-transcript-in-config').ok, false);
  const missingTranscript = herdrIdentityFindings({ ...fixture(), transcriptPath: null });
  assert.equal(missingTranscript.find(item => item.id === 'herdr-transcript-in-config').ok, true);
});

test('Herdr CLI 参数检查复用沙箱边界', () => {
  const call = command => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-cli', name: 'Bash', input: { command } }] } });
  const cli = 'node C:/tmp/workflow/current/bin/workflow.mjs signal task-start';
  assert.equal(herdrCliConfinementFindings([call(`${cli} --state-dir C:\\real`)], { sandbox: 'C:\\tmp\\sandbox' }).every(item => item.ok), false);
  assert.equal(herdrCliConfinementFindings([call(`${cli} --state-dir C:\\tmp\\sandbox\\workflow`)], { sandbox: 'C:\\tmp\\sandbox' }).every(item => item.ok), true);
  assert.equal(herdrCliConfinementFindings([call(`$env:LOCALAPPDATA = 'C:\\real'; ${cli}`)], { sandbox: 'C:\\tmp\\sandbox' }).every(item => item.ok), false);
  assert.equal(herdrCliConfinementFindings([], { sandbox: 'C:\\tmp\\sandbox' }).every(item => item.ok), true);
});

test('Herdr 真实配置按严格前后比较，不使用 W1 白名单', () => {
  const before = {
    settings: 'settings-a',
    agents: 'agents-a',
    state: 'state-a',
    stateText: JSON.stringify({ revision: 1, sessions: { a: { sessionId } } }),
  };
  const unchanged = herdrRealIsolationFindings({ before, after: { ...before }, needles: [] });
  assert.deepEqual(unchanged.filter(item => !item.ok), []);

  const revisionOnly = herdrRealIsolationFindings({
    before,
    after: { ...before, state: 'state-b', stateText: JSON.stringify({ revision: 2, sessions: { a: { sessionId } } }) },
    needles: [],
  });
  assert.equal(revisionOnly.find(item => item.id === 'herdr-real-state-unchanged').ok, false);

  const settingsChanged = herdrRealIsolationFindings({ before, after: { ...before, settings: 'settings-b' }, needles: [] });
  assert.equal(settingsChanged.find(item => item.id === 'herdr-real-settings-unchanged').ok, false);
  const agentsChanged = herdrRealIsolationFindings({ before, after: { ...before, agents: 'agents-b' }, needles: [] });
  assert.equal(agentsChanged.find(item => item.id === 'herdr-real-agents-unchanged').ok, false);
  const referenced = herdrRealIsolationFindings({
    before,
    after: { ...before, state: 'state-c', stateText: JSON.stringify({ project: 'C:\\tmp\\sandbox' }) },
    needles: ['C:\\tmp\\sandbox'],
  });
  assert.equal(referenced.find(item => item.id === 'herdr-real-state-no-eval-reference').ok, false);
});

test('Herdr 状态优先级让已送达但缺证据的 FAIL 高于 BLOCKED', () => {
  const evidence = { transcriptPresent: true, hookCount: 1, stateSessionCount: 1 };
  assert.equal(herdrStatus({ ...evidence, delivered: 1 }), 'PASS');
  assert.equal(herdrStatus({ ...evidence, delivered: 1, assertions: [{ ok: false }] }), 'FAIL');
  assert.equal(herdrStatus({ ...evidence, delivered: 1, inconclusive: '模型没发起' }), 'INCONCLUSIVE');
  assert.equal(herdrStatus({ ...evidence, delivered: 1, blocked: '第二轮驱动失败' }), 'BLOCKED');
  assert.equal(herdrStatus({ ...evidence, delivered: 1, blocked: '第二轮驱动失败', transcriptPresent: false }), 'FAIL');
  assert.equal(herdrStatus({ ...evidence, delivered: 0, blocked: '窗格未就绪' }), 'BLOCKED');
  assert.equal(herdrStatus({ transcriptPresent: false, hookCount: 0, stateSessionCount: 0, delivered: 0, blocked: '窗格未就绪' }), 'BLOCKED');
  assert.equal(herdrStatus({ ...evidence, delivered: 1, isolationOk: false }), 'INVALID');
  assert.equal(herdrStatus({ ...evidence, delivered: 1, invalid: 'S00 闸门失败' }), 'INVALID');
  assert.equal(herdrStatus({ transcriptPresent: false, hookCount: 0, stateSessionCount: 0 }), 'FAIL');
});

test('未确认送达的超时不计 delivered，状态为 BLOCKED', () => {
  const delivered = deliveryConfirmed({ receiptOk: false, transcriptHasPrompt: false });
  assert.equal(delivered, false);
  assert.equal(herdrStatus({
    delivered,
    blocked: 'timeout',
    transcriptPresent: false,
    hookCount: 0,
    stateSessionCount: 0,
  }), 'BLOCKED');
});

test('超时但 transcript 有对应 prompt 时计入 delivered', () => {
  const delivered = deliveryConfirmed({ receiptOk: false, transcriptHasPrompt: true });
  assert.equal(delivered, true);
  assert.equal(deliveryConfirmed({ receiptOk: true }), true);
  assert.equal(herdrStatus({
    delivered,
    blocked: 'timeout',
    transcriptPresent: true,
    hookCount: 1,
    stateSessionCount: 1,
  }), 'BLOCKED');
  assert.equal(herdrStatus({
    delivered,
    blocked: 'timeout',
    transcriptPresent: true,
    hookCount: 0,
    stateSessionCount: 1,
  }), 'FAIL');
});

test('transcript 补证只认完整用户消息，相同前缀不算', () => {
  const prompt = `${'A'.repeat(60)}B`;
  const samePrefix = JSON.stringify({ type: 'user', message: { role: 'user', content: `${'A'.repeat(60)}C` } });
  assert.equal(transcriptHasUserPrompt(samePrefix, prompt), false);
  const full = JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } });
  assert.equal(transcriptHasUserPrompt(full, prompt), true);
});

test('transcript 补证忽略助手与工具结果中的完整 prompt', () => {
  const prompt = 'Run the exact command';
  const assistant = JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: prompt }] } });
  const toolResult = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: prompt }] } });
  assert.equal(transcriptHasUserPrompt(assistant, prompt), false);
  assert.equal(transcriptHasUserPrompt(toolResult, prompt), false);
});

test('Herdr 的 .claude.json 不写凭据审批片段', () => {
  const config = claudeConfig({ project: 'C:\\tmp\\project' });
  assert.equal(Object.hasOwn(config, 'customApiKeyResponses'), false);
  assert.equal(config.hasCompletedOnboarding, true);
  assert.equal(config.projects['C:/tmp/project'].hasTrustDialogAccepted, true);
});

test('未知费用显示为未知，不与数值成本混算', () => {
  assert.equal(formatCost(0.25), '$0.2500');
  assert.equal(formatCost(null), '未知（交互会话不提供）');
  const summary = {
    scenario: 'E09',
    title: 'Herdr 冒烟',
    status: 'PASS',
    exitCode: 0,
    mode: 'herdr',
    negativeControl: false,
    durationMs: 1000,
    costUsd: null,
    maxBudgetUsd: 1.5,
    sessionId,
    isolation: { ok: true, checks: [] },
    warnings: [],
    assertions: [],
    gate: [],
    turns: [],
    paths: { project: 'C:\\tmp\\project', stateDir: 'C:\\tmp\\state', runDir: 'C:\\tmp\\run' },
  };
  const markdown = renderSummaryMarkdown(summary);
  assert.match(markdown, /成本：未知（交互会话不提供）/);
  assert.doesNotMatch(markdown, /\$0\.0000/);
  assert.match(markdown, /预算上限：本模式未强制/);
  const aggregate = renderAggregateMarkdown([summary], { generatedAt: '2026-11-04T00:00:00.000Z', outDir: 'C:\\tmp', status: 'PASS', exitCode: 0, costUsd: null });
  assert.match(aggregate, /总成本：未知（交互会话不提供）/);
});

test('E09 只把实际调用与隔离证据算作通过', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wf-eval-e09-'));
  const project = path.join(directory, 'project');
  const stateDir = path.join(directory, 'workflow');
  await writeProjectFixture(project);
  await mkdir(stateDir, { recursive: true });
  await writeFile(path.join(stateDir, 'state.json'), JSON.stringify({ tasks: {}, sessions: { key: { sessionId } } }), 'utf8');
  const business = path.join(project, 'src', 'business.txt');
  const writeUse = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-write-1', name: 'Write', input: { file_path: business, content: 'CHANGED' } }] } };
  const writeResult = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-write-1', is_error: true, content: `PreToolUse:Write hook error: 业务写入被拦下：${business}。` }] } };
  const promptUse = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-bash-1', name: 'Bash', input: { command: 'herdr agent prompt eval-target "PING"' } }] } };
  const promptResult = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-bash-1', is_error: true, content: 'PreToolUse:Bash hook error: 实施委派被拦下（herdr-agent-prompt）。准备阶段可以继续读代码。' }] } };
  const hookPayloads = [
    { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: business } },
    { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'herdr agent prompt eval-target "PING"' } },
  ];
  const state = { tasks: {}, sessions: { key: { sessionId } } };
  const positive = await E09.evaluate({
    events: [writeUse, writeResult, promptUse, promptResult],
    hookPayloads,
    project,
    stateDir,
    readOnlyOps: [{ command: 'agent wait wfclaude', code: 0 }, { command: 'agent read wfclaude', code: 0 }],
    state,
  });
  assert.deepEqual(positive.filter(item => !item.ok).map(item => item.id), []);

  const missingAttempt = await E09.evaluate({
    events: [],
    hookPayloads,
    project,
    stateDir,
    readOnlyOps: [{ command: 'agent wait wfclaude', code: 0 }],
    state,
  });
  assert.equal(missingAttempt.find(item => item.id === 'herdr-write-gate-attempted').ok, false);
  assert.equal(missingAttempt.find(item => item.id === 'herdr-write-gate-attempted').role, 'attempt');
  assert.equal(missingAttempt.find(item => item.id === 'herdr-agent-prompt-gate-attempted').ok, false);

  const missingHooks = await E09.evaluate({
    events: [writeUse, writeResult, promptUse, promptResult],
    hookPayloads: [],
    project,
    stateDir,
    readOnlyOps: [{ command: 'agent wait wfclaude', code: 0 }],
    state,
  });
  assert.equal(missingHooks.find(item => item.id === 'herdr-hooks-jsonl-pretooluse').ok, false);
});

test('frontmatter、子代理调用与 modelUsage 只按真实字段解析', () => {
  const fields = parseFrontmatter('---\nname: workflow-advisor\ndescription: 顾问\nmodel: group/test-space/lead\neffort: max\ntools: Read, Grep, Glob\n---\n正文');
  assert.deepEqual(fields, { name: 'workflow-advisor', description: '顾问', model: 'group/test-space/lead', effort: 'max', tools: 'Read, Grep, Glob' });
  assert.equal(parseFrontmatter('没有 frontmatter'), null);
  assert.equal(parseFrontmatter(null), null);

  assert.equal(agentNameMatches('workflow-advisor', 'workflow-advisor'), true);
  assert.equal(agentNameMatches('workflow:workflow-advisor', 'workflow-advisor'), true);
  assert.equal(agentNameMatches('Explore', 'workflow-advisor'), false);

  const agentUse = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-agent-1', name: 'Agent', input: { subagent_type: 'workflow-explorer', description: '读文件', prompt: '读 README' } }] } };
  const bashUse = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-bash-1', name: 'Bash', input: { command: 'ls' } }] } };
  const calls = subagentCalls([agentUse, bashUse]);
  assert.deepEqual(calls, [{ id: 'tool-agent-1', tool: 'Agent', subagentType: 'workflow-explorer', description: '读文件', background: false }]);

  const models = modelUsageModels([{ type: 'result', modelUsage: { 'group/parent[1m]': { canonicalModel: 'group/parent[1m]' }, 'group/test-space/lead': { canonicalModel: 'group/test-space/lead' } } }]);
  assert.deepEqual(models, ['group/parent[1m]', 'group/test-space/lead']);
  const observation = { agentName: 'workflow-advisor', expectedModel: 'group/test-space/lead', modelUsageKeys: models };
  assert.equal(modelUsageCheck(observation, 'model').ok, true);
  assert.equal(modelUsageCheck({ ...observation, modelUsageKeys: ['group/other'] }, 'model').ok, false);
  const noUsage = modelUsageCheck({ ...observation, modelUsageKeys: [] }, 'model');
  assert.equal(noUsage.ok, true);
  assert.equal(noUsage.observable, false);
  const noDefinition = modelUsageCheck({ ...observation, expectedModel: null }, 'model');
  assert.equal(noDefinition.observable, false);
});

test('not-observable 断言只在没有可观测失败时汇总为 NOT-OBSERVABLE', () => {
  assert.equal(unobservableAssertionNote([]), null);
  assert.equal(unobservableAssertionNote([{ id: 'a', ok: true }]), null);
  const note = unobservableAssertionNote([{ id: 'usage', ok: true, observable: false }]);
  assert.match(note, /usage/);
  assert.equal(unobservableAssertionNote([{ id: 'usage', ok: true, observable: false }, { id: 'call', ok: false }]), null);
  assert.equal(statusFor([{ id: 'usage', ok: true, observable: false }], { notObservable: note }), 'NOT-OBSERVABLE');
  assert.equal(exitCodeFor(['NOT-OBSERVABLE']), 4);
});

test('可观测断言失败不会被不可观测来源遮盖', () => {
  const assertions = [
    { id: 'advisor-agent-call', ok: false },
    { id: 'advisor-route-attribution', ok: true, observable: false },
  ];
  const reason = unobservableReason(assertions, '1 项来源无法观测');
  assert.equal(reason, null);
  const status = statusFor(assertions, { notObservable: reason });
  assert.equal(status, 'FAIL');
  assert.equal(exitCodeFor([status]), 1);

  const onlyUnobservable = unobservableReason([{ id: 'usage', ok: true, observable: false }], '1 项来源无法观测');
  assert.match(onlyUnobservable, /usage/);
  assert.equal(statusFor([{ id: 'usage', ok: true, observable: false }], { notObservable: onlyUnobservable }), 'NOT-OBSERVABLE');
  assert.equal(unobservableReason([], '1 项来源无法观测'), '1 项来源无法观测');
});

test('routeObserved 只看已关联 transcript 的 requestedModel', () => {
  const base = {
    agentName: 'workflow-advisor',
    expectedModel: 'group/test-space/lead',
    modelUsageKeys: ['group/test-space/lead'],
    calls: [],
    matched: [],
    consultations: [],
    consultationHookEvents: [],
    definition: { fields: { model: 'group/test-space/lead' } },
  };
  const withoutNative = reportObservation({ ...base, native: [] });
  assert.equal(withoutNative.routeObserved, null);
  assert.deepEqual(withoutNative.modelUsageKeys, ['group/test-space/lead']);
  assert.equal(reportObservation({ ...base, native: [{ agentType: 'workflow-advisor', requestedModel: 'group/other', toolUses: [] }] }).routeObserved, false);
  assert.equal(reportObservation({ ...base, native: [{ agentType: 'workflow-advisor', requestedModel: null, toolUses: [] }] }).routeObserved, null);
  assert.equal(reportObservation({ ...base, native: [{ agentType: 'workflow-advisor', requestedModel: 'group/test-space/lead', toolUses: [] }] }).routeObserved, true);
});

test('原生 sidechain transcript 按会话读取子代理模型与内部工具', async () => {
  const configDir = await mkdtemp(path.join(os.tmpdir(), 'wf-eval-native-'));
  const sessionDir = path.join(configDir, 'projects', 'project-encoded', sessionId);
  const subagents = path.join(sessionDir, 'subagents');
  await mkdir(subagents, { recursive: true });
  await writeFile(path.join(subagents, 'agent-one.meta.json'), JSON.stringify({ agentType: 'workflow-explorer', description: '读文件', pickedEffortModel: 'group/test-space/read[1m]' }), 'utf8');
  await writeFile(path.join(subagents, 'agent-one.jsonl'), [
    JSON.stringify({ type: 'user', isSidechain: true, agentId: 'agent-one', message: { content: '读 README' } }),
    JSON.stringify({ type: 'assistant', isSidechain: true, agentId: 'agent-one', requestedModel: 'group/test-space/read', attributionAgent: 'workflow-explorer', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'C:\\tmp\\project\\README.md' } }, { type: 'tool_use', name: 'Glob', input: { pattern: '**/*' } }] } }),
  ].join('\n'), 'utf8');
  const found = await readNativeSubagents(configDir, sessionId);
  assert.equal(found.length, 1);
  assert.equal(found[0].agentType, 'workflow-explorer');
  assert.equal(found[0].requestedModel, 'group/test-space/read');
  assert.equal(found[0].pickedEffortModel, 'group/test-space/read[1m]');
  assert.deepEqual(found[0].toolUses, [{ name: 'Read', target: 'C:\\tmp\\project\\README.md' }, { name: 'Glob', target: '**/*' }]);
  assert.deepEqual(await readNativeSubagents(configDir, null), []);
  assert.deepEqual(await readNativeSubagents(path.join(configDir, 'missing'), sessionId), []);
});

test('E07 只把真实调用、定义模型、原生路由与咨询记录算作通过', async () => {
  const configDir = await mkdtemp(path.join(os.tmpdir(), 'wf-eval-e07-config-'));
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'wf-eval-e07-state-'));
  await mkdir(path.join(configDir, 'agents'), { recursive: true });
  await writeFile(path.join(configDir, 'agents', 'workflow-advisor.md'), '---\nname: workflow-advisor\nmodel: group/test-space/lead\ntools: Read, Grep, Glob\n---\n', 'utf8');
  const subagents = path.join(configDir, 'projects', 'p', sessionId, 'subagents');
  await mkdir(subagents, { recursive: true });
  await writeFile(path.join(subagents, 'agent-one.meta.json'), JSON.stringify({ agentType: 'workflow-advisor', toolUseId: 'tool-agent-1' }), 'utf8');
  await writeFile(path.join(subagents, 'agent-one.jsonl'), JSON.stringify({ type: 'assistant', requestedModel: 'group/test-space/lead', attributionAgent: 'workflow-advisor', message: { content: [] } }), 'utf8');
  await mkdir(path.join(stateDir, 'consultations'), { recursive: true });
  await writeFile(path.join(stateDir, 'consultations', 'record.json'), JSON.stringify({
    schemaVersion: 1,
    projectId: 'project-x',
    sessionId,
    consultations: [{ consultationId: 'c1', subagentType: 'workflow-advisor', question: 'Advisor: ship or wait', taskId: null, turnId: 'turn-1' }],
  }), 'utf8');

  const events = [
    { type: 'system', subtype: 'init', session_id: sessionId },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-agent-1', name: 'Agent', input: { subagent_type: 'workflow-advisor', description: 'Advisor: ship or wait', prompt: 'Ship or wait?' } }] } },
    { type: 'system', subtype: 'hook_response', hook_name: 'PostToolUse:Agent', hook_event: 'PostToolUse', output: '{}' },
    { type: 'result', modelUsage: { 'group/test-space/lead': { canonicalModel: 'group/test-space/lead' } } },
  ];
  const checks = await E07.evaluate({ events, configDir, stateDir });
  assert.deepEqual(checks.filter(item => !item.ok).map(item => item.id), []);
  assert.deepEqual(checks.map(item => item.id), ['advisor-agent-call', 'advisor-model-usage', 'advisor-route-attribution', 'advisor-consultation-record']);

  const missingCall = await E07.evaluate({ events: events.filter(event => event.type !== 'assistant'), configDir, stateDir });
  assert.equal(missingCall.find(item => item.id === 'advisor-agent-call').ok, false);

  const missingConsultation = await E07.evaluate({ events, configDir, stateDir: path.join(configDir, 'no-state') });
  assert.equal(missingConsultation.find(item => item.id === 'advisor-consultation-record').ok, false);

  const unobservableRoute = await E07.evaluate({ events: [{ type: 'system', subtype: 'init', session_id: sessionId }], configDir, stateDir });
  assert.equal(unobservableRoute.find(item => item.id === 'advisor-model-usage').observable, false);
  assert.equal(unobservableRoute.find(item => item.id === 'advisor-agent-call').ok, false);
  const missingNative = nativeModelCheck({ agentName: 'workflow-advisor', expectedModel: 'group/x', native: [] }, 'route');
  assert.equal(missingNative.ok, true);
  assert.equal(missingNative.observable, false);
});

test('原生 transcript 只认本次 Agent 调用 tool_use_id，旧记录不算证据', async () => {
  const configDir = await mkdtemp(path.join(os.tmpdir(), 'wf-eval-assoc-'));
  const stateDir = path.join(configDir, 'no-state');
  await mkdir(path.join(configDir, 'agents'), { recursive: true });
  await writeFile(path.join(configDir, 'agents', 'workflow-advisor.md'), '---\nname: workflow-advisor\nmodel: group/test-space/lead\ntools: Read, Grep, Glob\n---\n', 'utf8');
  const subagents = path.join(configDir, 'projects', 'p', sessionId, 'subagents');
  await mkdir(subagents, { recursive: true });
  const sidechain = { type: 'assistant', requestedModel: 'group/test-space/lead', attributionAgent: 'workflow-advisor', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'README.md' } }] } };
  await writeFile(path.join(subagents, 'old.meta.json'), JSON.stringify({ agentType: 'workflow-advisor', toolUseId: 'tool-old' }), 'utf8');
  await writeFile(path.join(subagents, 'old.jsonl'), JSON.stringify(sidechain), 'utf8');
  await writeFile(path.join(subagents, 'missing-tool.meta.json'), JSON.stringify({ agentType: 'workflow-advisor' }), 'utf8');
  await writeFile(path.join(subagents, 'missing-tool.jsonl'), JSON.stringify(sidechain), 'utf8');

  const events = [
    { type: 'system', subtype: 'init', session_id: sessionId },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-new', name: 'Agent', input: { subagent_type: 'workflow-advisor', description: '本次调用' } }] } },
  ];
  const observation = await observeSubagent({ events, configDir, stateDir, agentName: 'workflow-advisor' });
  assert.equal(observation.nativeAll.length, 2);
  assert.equal(observation.native.length, 0);
  assert.equal(nativeModelCheck(observation, 'route').observable, false);
  assert.equal(internalToolsCheck(observation, ['Read'], 'tools').observable, false);
  const report = reportObservation(observation, { internalTools: true });
  assert.equal(report.routeObserved, null);
  assert.equal(report.native.length, 0);
  assert.ok(report.unobservable.some(item => /关联不完整/.test(item)));

  await writeFile(path.join(subagents, 'new.meta.json'), JSON.stringify({ agentType: 'workflow-advisor', toolUseId: 'tool-new' }), 'utf8');
  await writeFile(path.join(subagents, 'new.jsonl'), JSON.stringify(sidechain), 'utf8');
  const associated = await observeSubagent({ events, configDir, stateDir, agentName: 'workflow-advisor' });
  assert.deepEqual(associated.native.map(item => item.toolUseId), ['tool-new']);
  assert.equal(nativeModelCheck(associated, 'route').ok, true);
  assert.equal(internalToolsCheck(associated, ['Read'], 'tools').ok, true);
  assert.equal(reportObservation(associated, { internalTools: true }).routeObserved, true);
});

test('多个匹配调用只关联到部分 transcript 时路由与内部工具不可观测', async () => {
  const configDir = await mkdtemp(path.join(os.tmpdir(), 'wf-eval-partial-'));
  const stateDir = path.join(configDir, 'no-state');
  await mkdir(path.join(configDir, 'agents'), { recursive: true });
  await writeFile(path.join(configDir, 'agents', 'workflow-explorer.md'), '---\nname: workflow-explorer\nmodel: group/test-space/read\ntools: Read, Grep, Glob\n---\n', 'utf8');
  const subagents = path.join(configDir, 'projects', 'p', sessionId, 'subagents');
  await mkdir(subagents, { recursive: true });
  const record = (name, toolUseId, requestedModel, tools) => Promise.all([
    writeFile(path.join(subagents, `${name}.meta.json`), JSON.stringify({ agentType: 'workflow-explorer', toolUseId }), 'utf8'),
    writeFile(path.join(subagents, `${name}.jsonl`), JSON.stringify({ type: 'assistant', requestedModel, attributionAgent: 'workflow-explorer', message: { content: tools.map(tool => ({ type: 'tool_use', name: tool, input: {} })) } }), 'utf8'),
  ]);
  await record('first', 'tool-call-1', 'group/test-space/read', ['Read']);
  const events = [
    { type: 'system', subtype: 'init', session_id: sessionId },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'tool-call-1', name: 'Agent', input: { subagent_type: 'workflow-explorer' } },
          { type: 'tool_use', id: 'tool-call-2', name: 'Agent', input: { subagent_type: 'workflow-explorer' } },
        ],
      },
    },
  ];
  const partial = await observeSubagent({ events, configDir, stateDir, agentName: 'workflow-explorer' });
  assert.equal(partial.associationComplete, false);
  assert.deepEqual(partial.missingTranscriptCallIds, ['tool-call-2']);
  assert.equal(partial.native.length, 1);
  assert.equal(nativeModelCheck(partial, 'route').observable, false);
  assert.equal(internalToolsCheck(partial, ['Read', 'Grep', 'Glob'], 'tools').observable, false);
  const partialReport = reportObservation(partial, { internalTools: true });
  assert.equal(partialReport.routeObserved, null);
  assert.ok(partialReport.unobservable.includes('匹配调用与 transcript 关联不完整'));

  await record('second', 'tool-call-2', 'group/test-space/read', ['Grep']);
  const complete = await observeSubagent({ events, configDir, stateDir, agentName: 'workflow-explorer' });
  assert.equal(complete.associationComplete, true);
  assert.equal(complete.native.length, 2);
  assert.equal(nativeModelCheck(complete, 'route').ok, true);
  assert.equal(internalToolsCheck(complete, ['Read', 'Grep', 'Glob'], 'tools').ok, true);
  assert.equal(reportObservation(complete, { internalTools: true }).routeObserved, true);

  await record('second', 'tool-call-2', 'group/other', ['Grep']);
  const wrongModel = await observeSubagent({ events, configDir, stateDir, agentName: 'workflow-explorer' });
  assert.equal(wrongModel.associationComplete, true);
  assert.equal(nativeModelCheck(wrongModel, 'route').ok, false);
  assert.equal(reportObservation(wrongModel).routeObserved, false);
});

test('报告 internalTools 不可观测与 internalToolsCheck 判定一致', () => {
  const observation = {
    agentName: 'workflow-explorer',
    expectedModel: 'group/test-space/read',
    modelUsageKeys: ['group/test-space/read'],
    calls: [],
    matched: [{ id: 'tool-call-1' }],
    consultations: [],
    consultationHookEvents: [],
    definition: { fields: { model: 'group/test-space/read', tools: 'Read, Grep, Glob' } },
    native: [{ agentType: 'workflow-explorer', requestedModel: 'group/test-space/read', toolUses: [] }],
    associationComplete: true,
    missingTranscriptCallIds: [],
  };
  const emptyTools = internalToolsCheck(observation, ['Read', 'Grep', 'Glob'], 'tools');
  assert.equal(emptyTools.ok, true);
  assert.equal(emptyTools.observable, false);
  assert.ok(reportObservation(observation, { internalTools: true }).unobservable.includes('子代理内部工具调用'));

  const withTools = { ...observation, native: [{ ...observation.native[0], toolUses: [{ name: 'Read', target: 'README.md' }] }] };
  assert.equal(internalToolsCheck(withTools, ['Read', 'Grep', 'Glob'], 'tools').observable, undefined);
  assert.equal(reportObservation(withTools, { internalTools: true }).unobservable.includes('子代理内部工具调用'), false);
});

const assistantMessage = (id, model, usage, blocks = []) => ({ type: 'assistant', message: { id, model, usage, content: blocks } });
const fullUsage = { input_tokens: 10, cache_read_input_tokens: 2, cache_creation_input_tokens: 1, output_tokens: 3 };

test('token 按 message id 去重、按实际模型汇总', () => {
  const usage = transcriptUsage([
    assistantMessage('m1', 'test/model-a', fullUsage),
    assistantMessage('m1', 'test/model-a', fullUsage),
    assistantMessage('m2', 'test/model-b', { input_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 }),
    assistantMessage('m3', 'test/model-a', { input_tokens: 1 }),
    assistantMessage(null, 'test/model-a', fullUsage),
  ]);
  assert.equal(usage.messages, 3);
  assert.deepEqual(usage.byModel, {
    'test/model-a': { input: 10, cacheRead: 2, cacheWrite: 1, cacheWrite1h: 0, output: 3 },
    'test/model-b': { input: 5, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 1 },
  });
  assert.deepEqual(usage.totals, { input: 15, cacheRead: 2, cacheWrite: 1, cacheWrite1h: 0, output: 4 });
  assert.equal(usage.missing.length, 2);
});

test('transcript 汇总与 result.usage 逐轮对账', () => {
  const events = [
    assistantMessage('m1', 'test/model-a', fullUsage),
    assistantMessage('m1', 'test/model-a', fullUsage),
    assistantMessage('m2', 'test/model-b', { input_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 }),
  ];
  const result = resultUsage([{ type: 'result', usage: { input_tokens: 15, cache_read_input_tokens: 2, cache_creation_input_tokens: 1, output_tokens: 4 } }]);
  assert.deepEqual(result.totals, transcriptUsage(events).totals);
  assert.equal(reconcileUsage(transcriptUsage(events), result).ok, true);

  const mismatch = reconcileUsage(transcriptUsage(events), resultUsage([{ type: 'result', usage: fullUsage }]));
  assert.equal(mismatch.ok, false);
  assert.deepEqual(mismatch.differences.map(item => item.key), ['input', 'output']);
  assert.equal(resultUsage([{ type: 'result' }]).missing, 1);
});

test('价格表只读取模型价格，缺价格记不可比', async () => {
  const prices = parsePrices({
    unit: 'usd_per_million_tokens',
    source: 'test',
    models: { 'test/model-a': { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0.25 } },
  });
  const million = { input: 1000000, cacheRead: 1000000, cacheWrite: 1000000, cacheWrite1h: 0, output: 1000000 };
  assert.equal(costOfTokens({ 'test/model-a': million }, prices).usd, 3.75);
  const with1h = parsePrices({ unit: 'usd_per_million_tokens', models: { 'test/model-a': { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0.25, cacheWrite1h: 0.5 } } });
  assert.equal(costOfTokens({ 'test/model-a': { ...million, cacheWrite: 1000000, cacheWrite1h: 1000000 } }, with1h).usd, 4);
  const missing = costOfTokens({ 'test/model-b': million }, prices);
  assert.equal(missing.usd, null);
  assert.deepEqual(missing.missing, ['test/model-b']);
  // 有 1 小时缓存写用量、但价格表只有 5 分钟价时，不能拿 5 分钟价顶替。
  const missing1h = costOfTokens({ 'test/model-a': { ...million, cacheWrite: 1000000, cacheWrite1h: 1000000 } }, prices);
  assert.equal(missing1h.usd, null);
  assert.deepEqual(missing1h.missing, ['test/model-a.cacheWrite1h']);
  assert.throws(() => parsePrices({ unit: 'usd_per_million_tokens', models: { 'test/model-a': { input: 1, output: 2, cacheRead: 0.5 } } }), /cacheWrite/);
  assert.throws(() => parsePrices({ unit: 'tokens', models: {} }), /unit/);

  const directory = await mkdtemp(path.join(os.tmpdir(), 'wf-eval-prices-'));
  const file = path.join(directory, 'prices.json');
  await writeFile(file, JSON.stringify({ unit: 'usd_per_million_tokens', models: { 'test/model-a': { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0.25 } } }), 'utf8');
  assert.equal((await loadPrices(file)).models['test/model-a'].input, 1);
  await writeFile(file, 'not json', 'utf8');
  await assert.rejects(() => loadPrices(file), /JSON/);
  await assert.rejects(() => loadPrices(path.join(directory, 'missing.json')), /无法读取/);
});

test('宿主成本与 costBasis 只展示，不参与折算', () => {
  const cost = hostCost([
    { type: 'result', total_cost_usd: 0.25, modelUsage: { 'group/x': { costBasis: 'unknown' } } },
    { type: 'result', total_cost_usd: 0.75, modelUsage: { 'group/x': { costBasis: 'unknown' } } },
  ]);
  assert.equal(cost.totalCostUsd, 0.75);
  assert.deepEqual(cost.costBasis, ['unknown']);
  assert.equal(cost.note, '宿主估算，不是账单');
  assert.equal(hostCost([{ type: 'result', modelUsage: { 'group/x': { costBasis: 'provider' } } }]).totalCostUsd, null);
});

test('Lead 材料按工具统计 tool_result 字节与累计输入 token', () => {
  const lead = leadMaterials([
    assistantMessage('m1', 'test/model-a', fullUsage, [
      { type: 'tool_use', id: 't1', name: 'Read', input: {} },
      { type: 'tool_use', id: 't2', name: 'Grep', input: {} },
    ]),
    {
      type: 'user',
      message: { content: [
        { type: 'tool_result', tool_use_id: 't1', content: 'abc' },
        { type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: 'de' }] },
      ] },
    },
  ]);
  assert.deepEqual(lead.toolResultBytes.byTool, { Read: 3, Grep: 2 });
  assert.equal(lead.toolResultBytes.total, 5);
  assert.equal(lead.inputTokens.total, 13);
});

test('子代理 transcript 按 toolUseId 关联并汇总用量', async () => {
  const configDir = await mkdtemp(path.join(os.tmpdir(), 'wf-eval-subusage-'));
  const dir = path.join(configDir, 'projects', 'p', sessionId, 'subagents');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'agent-one.meta.json'), JSON.stringify({ toolUseId: 'tool-agent-1', agentType: 'workflow-explorer' }), 'utf8');
  await writeFile(path.join(dir, 'agent-one.jsonl'), [
    JSON.stringify(assistantMessage('m1', 'test/model-a', fullUsage)),
    JSON.stringify(assistantMessage('m1', 'test/model-a', fullUsage)),
  ].join('\n'), 'utf8');
  const sub = await subagentUsage(configDir, sessionId);
  assert.equal(sub.files.length, 1);
  assert.deepEqual(sub.totals, { input: 10, cacheRead: 2, cacheWrite: 1, cacheWrite1h: 0, output: 3 });
  assert.deepEqual(associationIssues([{ id: 'tool-agent-1' }], sub), { complete: true, missing: [], unassociated: [] });
  assert.equal(associationIssues([{ id: 'tool-agent-2' }], sub).complete, false);
  assert.deepEqual(associationIssues([], sub).unassociated, ['tool-agent-1']);
});

test('analyzeRun 对账、折算并在证据缺失时记不可比', async () => {
  const configDir = await mkdtemp(path.join(os.tmpdir(), 'wf-eval-analyze-'));
  const hostDir = path.join(configDir, 'projects', 'p');
  await mkdir(hostDir, { recursive: true });
  const hostFile = path.join(hostDir, `${sessionId}.jsonl`);
  const prices = parsePrices({ unit: 'usd_per_million_tokens', models: { 'test/model-a': { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0.25 } } });
  const usage = { input_tokens: 100, cache_read_input_tokens: 10, cache_creation_input_tokens: 5, output_tokens: 20 };
  const summary = {
    arm: 'candidate',
    scenario: 'E11',
    run: 1,
    status: 'PASS',
    assertions: [{ id: 'e11-root-cause-location', ok: true }],
    sessionId,
    trajectory: { decisions: { records: 2, writeRecords: 2, bytes: 120, msTotal: 0.5, msMax: 0.2 } },
    durationMs: 1000,
  };
  await writeFile(hostFile, JSON.stringify(assistantMessage('m1', 'test/model-a', usage)), 'utf8');
  // stream-json 的 output 可能只是流式中间值；以宿主 transcript 为准，才能与 result.usage 对上。
  const streamSnapshot = { ...usage, output_tokens: 1 };
  const analysis = await analyzeRun({
    summary,
    events: [assistantMessage('m1', 'test/model-a', streamSnapshot), { type: 'result', usage }],
    dirs: { configDir },
    prices,
  });
  assert.equal(analysis.reconciliation.ok, true);
  assert.equal(analysis.costComparable, true);
  assert.equal(analysis.cost.usd, 0.000146);
  assert.equal(analysis.tokens.main.totals.output, 20);
  assert.deepEqual(analysis.trajectory, { records: 2, writeRecords: 2, bytes: 120, msTotal: 0.5, msMax: 0.2 });
  assert.equal(analysis.quality.pass, true);

  const oneHourUsage = { ...usage, cache_creation: { ephemeral_1h_input_tokens: 5 } };
  await writeFile(hostFile, JSON.stringify(assistantMessage('m1', 'test/model-a', oneHourUsage)), 'utf8');
  const oneHour = await analyzeRun({
    summary,
    events: [{ type: 'result', usage: oneHourUsage }],
    dirs: { configDir },
    prices,
  });
  assert.equal(oneHour.costComparable, false);
  assert.match(oneHour.incomparableReasons.join('；'), /cacheWrite1h/);

  await writeFile(hostFile, JSON.stringify(assistantMessage('m1', 'test/model-a', usage, [{ type: 'tool_use', id: 'tool-agent-1', name: 'Agent', input: { subagent_type: 'Explore' } }])), 'utf8');
  const delegated = await analyzeRun({
    summary: { ...summary, assertions: [{ id: 'e10-no-delegation', ok: false }], status: 'FAIL' },
    events: [{ type: 'result', usage }],
    dirs: { configDir },
    prices,
  });
  assert.equal(delegated.costComparable, false);
  assert.match(delegated.incomparableReasons.join('；'), /关联不全/);
  assert.equal(delegated.quality.pass, false);

  const missingHost = await analyzeRun({ summary, events: [assistantMessage('m1', 'test/model-a', usage), { type: 'result', usage }], dirs: { configDir: path.join(configDir, 'missing') }, prices });
  assert.equal(missingHost.costComparable, false);
  assert.match(missingHost.incomparableReasons.join('；'), /宿主 transcript/);
});

test('预登记结论规则按每轮 E11–E13 合计判定成本', () => {
  const run = ({ scenario, arm, cost, pass = true, comparable = true, model = 'test/model-a', agentCalls = 0, run: runNumber = 1 }) => ({
    scenario,
    arm,
    run: runNumber,
    status: pass ? 'PASS' : 'FAIL',
    quality: { pass, failed: pass ? [] : ['example'] },
    delegation: { calls: agentCalls, tools: [] },
    tokens: {
      main: { byModel: { [model]: { input: 1, cacheRead: 0, cacheWrite: 0, output: 1 } } },
      all: { byModel: { [model]: { input: 1, cacheRead: 0, cacheWrite: 0, output: 1 } } },
    },
    cost: { usd: cost, missingModels: [] },
    costComparable: comparable,
    incomparableReasons: comparable ? [] : ['测试不可比'],
  });
  const pair = (scenario, baseline, candidate, extra = {}, runNumber = 1) => [
    run({ scenario, arm: 'baseline', cost: baseline, run: runNumber, ...extra }),
    run({ scenario, arm: 'candidate', cost: candidate, run: runNumber, ...extra }),
  ];
  const threeRounds = (cost = () => [1, 0.8]) => [1, 2, 3].flatMap(runNumber => [
    ...pair('E10', 0.1, 0.1, {}, runNumber),
    ...['E11', 'E12', 'E13'].flatMap(scenario => {
      const [baseline, candidate] = cost(scenario, runNumber);
      return pair(scenario, baseline, candidate, {}, runNumber);
    }),
  ]);
  // 只含 E14、E15 的轮次，用于验证第二组成本场景独立判定。
  const newGroupRounds = (cost = () => [1, 0.8]) => [1, 2, 3].flatMap(runNumber => ['E14', 'E15'].flatMap(scenario => {
    const [baseline, candidate] = cost(scenario, runNumber);
    return pair(scenario, baseline, candidate, {}, runNumber);
  }));

  const analyses = threeRounds();
  const judgment = judgeContext(analyses);
  assert.equal(judgment.quality, 'pass');
  assert.equal(judgment.overDelegation, false);
  assert.equal(judgment.cost, 'decrease');
  assert.equal(judgment.verdict, '成本下降');
  assert.equal(judgment.conclusion, '成本下降');
  assert.equal(judgment.completeRounds, 3);
  assert.equal(judgment.decreaseEligible, true);
  assert.equal(judgeContext(analyses, { trial: true }).conclusion, '试跑，不构成结论');

  // 单场景有升有降、但每轮三场景合计下降，仍判该轮下降。
  const mixed = threeRounds(scenario => (scenario === 'E11' || scenario === 'E12' ? [100, 90] : [100, 110]));
  const mixedJudgment = judgeContext(mixed);
  assert.equal(mixedJudgment.cost, 'decrease');
  assert.equal(mixedJudgment.deltas.length, 3);
  assert.equal(mixedJudgment.deltas[0].baseline, 300);
  assert.equal(mixedJudgment.deltas[0].candidate, 290);

  // 试跑只有 1 对：按合计口径照算，但不构成成本下降结论。
  const single = threeRounds().filter(item => item.run === 1);
  const trialSingle = judgeContext(single, { trial: true });
  assert.equal(trialSingle.cost, 'decrease');
  assert.equal(trialSingle.completeRounds, 1);
  assert.equal(trialSingle.requiredRounds, 3);
  assert.equal(trialSingle.decreaseEligible, false);
  assert.equal(trialSingle.conclusion, '试跑，不构成结论');
  // 正式运行不足 3 对时不得判成本下降。
  assert.equal(judgeContext(single).cost, 'no-clear-difference');
  assert.equal(judgeContext(single).verdict, '无明确差异');
  assert.equal(judgeContext(threeRounds().filter(item => item.run <= 2)).cost, 'no-clear-difference');
  // 某轮缺场景时也不得判成本下降。
  const missingScenario = threeRounds().filter(item => !(item.run === 3 && item.scenario === 'E13'));
  assert.equal(judgeContext(missingScenario).cost, 'incomparable');
  assert.equal(judgeContext(missingScenario).verdict, '成本不可比');

  const delegated = analyses.map(item => item.scenario === 'E10' && item.arm === 'candidate' ? { ...item, delegation: { calls: 1, tools: [] } } : item);
  assert.equal(judgeContext(delegated).verdict, '过度委派');
  const lowQuality = analyses.map(item => item.scenario === 'E11' && item.arm === 'candidate' ? { ...item, quality: { pass: false, failed: ['x'] } } : item);
  assert.equal(judgeContext(lowQuality).verdict, '质量未达标');
  const flat = threeRounds(() => [1, 1]);
  assert.equal(judgeContext(flat).cost, 'no-clear-difference');
  const rising = threeRounds(() => [1, 1.1]);
  assert.equal(judgeContext(rising).cost, 'increase');
  assert.equal(judgeContext(rising).verdict, '成本上升');
  const incomparable = analyses.map(item => item.scenario === 'E11' && item.arm === 'candidate' && item.run === 1 ? { ...item, costComparable: false } : item);
  assert.equal(judgeContext(incomparable).cost, 'incomparable');
  assert.equal(judgeContext(incomparable).verdict, '成本不可比');
  const differentModels = threeRounds();
  differentModels.find(item => item.scenario === 'E12' && item.arm === 'candidate').tokens.main.byModel = { 'test/model-b': { input: 1, cacheRead: 0, cacheWrite: 0, output: 1 } };
  assert.equal(judgeContext(differentModels).cost, 'incomparable');
  // 只有子代理模型不同时仍可比：子代理成本已按各自价格计入总成本。
  const subagentModels = threeRounds();
  const subagentRun = subagentModels.find(item => item.scenario === 'E12' && item.arm === 'candidate');
  subagentRun.tokens.subagents = { byModel: { 'test/model-b': { input: 1, cacheRead: 0, cacheWrite: 0, output: 1 } } };
  subagentRun.tokens.all.byModel['test/model-b'] = { input: 1, cacheRead: 0, cacheWrite: 0, output: 1 };
  assert.notEqual(judgeContext(subagentModels).cost, 'incomparable');

  // 只跑 E14、E15 时按同一预登记规则独立判定，每轮合计只含这两个场景。
  const newGroup = judgeContext(newGroupRounds());
  assert.equal(newGroup.cost, 'decrease');
  assert.equal(newGroup.completeRounds, 3);
  assert.equal(newGroup.deltas[0].baseline, 2);
  assert.ok(Math.abs(newGroup.deltas[0].candidate - 1.6) < 1e-12);
  assert.equal(judgeContext(newGroupRounds(() => [1, 1.1])).cost, 'increase');
  assert.equal(judgeContext(newGroupRounds(() => [1, 1])).cost, 'no-clear-difference');
  assert.equal(judgeContext(newGroupRounds().filter(item => !(item.run === 3 && item.scenario === 'E15'))).cost, 'incomparable');
  // 两组都完整运行时不混算：旧组上升、新组下降，结果仍按 E11–E13 判上升。
  const bothGroups = judgeContext([
    ...threeRounds(() => [1, 1.1]),
    ...newGroupRounds(() => [1, 0.8]),
  ]);
  assert.equal(bothGroups.cost, 'increase');
  assert.equal(bothGroups.deltas[0].baseline, 3);
  assert.ok(Math.abs(bothGroups.deltas[0].candidate - 3.3) < 1e-12);
});

test('context 场景夹具确定性生成并按正则判定', async () => {
  const e10dir = await mkdtemp(path.join(os.tmpdir(), 'wf-eval-e10-'));
  await E10.prepare({ project: e10dir });
  assert.match(await readFile(path.join(e10dir, 'src', 'retry.mjs'), 'utf8'), /RETRY_LIMIT = 4/);
  const e10ok = await E10.evaluate({ events: [{ type: 'result', result: '重试 4 次，见 src/retry.mjs' }] });
  assert.deepEqual(e10ok.filter(item => !item.ok), []);
  const e10delegated = await E10.evaluate({
    events: [
      assistantMessage('m0', 'test/model-a', fullUsage, [{ type: 'tool_use', id: 'a1', name: 'Agent', input: { subagent_type: 'Explore' } }]),
      { type: 'result', result: '重试 4 次，见 src/retry.mjs' },
    ],
  });
  assert.equal(e10delegated.find(item => item.id === 'e10-no-delegation').ok, false);

  const e11dir = await mkdtemp(path.join(os.tmpdir(), 'wf-eval-e11-'));
  await E11.prepare({ project: e11dir });
  const pricing = await readFile(path.join(e11dir, 'src', 'pricing.mjs'), 'utf8');
  const bugLine = pricing.split('\n').findIndex(line => line.includes('(quantity - 1)')) + 1;
  assert.deepEqual((await E11.evaluate({ events: [{ type: 'result', result: `根因在 src/pricing.mjs:${bugLine}，件数被减一。` }] })).filter(item => !item.ok), []);
  const e11wrong = await E11.evaluate({ events: [{ type: 'result', result: `根因在 src/pricing.mjs:${bugLine + 1}，件数被减一。` }] });
  assert.equal(e11wrong.find(item => item.id === 'e11-root-cause-location').ok, false);

  const e12dir = await mkdtemp(path.join(os.tmpdir(), 'wf-eval-e12-'));
  await E12.prepare({ project: e12dir });
  const log = await readFile(path.join(e12dir, 'logs', 'service.log'), 'utf8');
  assert.equal(log.split('\n').filter(Boolean).length, 5200);
  const [failLine, exitLine] = E12_FAIL_LINES;
  assert.match(log.split('\n')[failLine - 1], /EACCES/);
  assert.match(log.split('\n')[exitLine - 1], /exit code 23/);
  assert.deepEqual((await E12.evaluate({ events: [{ type: 'result', result: `失败原因 EACCES，退出码 23，见 logs/service.log 第 ${exitLine} 行` }] })).filter(item => !item.ok), []);
  assert.deepEqual((await E12.evaluate({ events: [{ type: 'result', result: `| 行号 | 日志 |\n| ${failLine} | EACCES |\n| ${exitLine} | exit code 23 |` }] })).filter(item => !item.ok), []);
  const e12missing = await E12.evaluate({ events: [{ type: 'result', result: `失败原因 EACCES，见第 ${failLine} 行` }] });
  assert.equal(e12missing.find(item => item.id === 'e12-exit-code').ok, false);

  const e13dir = await mkdtemp(path.join(os.tmpdir(), 'wf-eval-e13-'));
  await E13.prepare({ project: e13dir });
  const e13ok = await E13.evaluate({
    events: [
      { type: 'result', result: '远程 Redis 6379 连接超时 5 秒' },
      { type: 'result', result: '改用进程内缓存' },
      { type: 'result', result: '已确认：不改公开 API，使用进程内缓存。未确认：生产是否接 Redis。' },
    ],
  });
  assert.deepEqual(e13ok.filter(item => !item.ok), []);
  const e13missing = await E13.evaluate({
    events: [
      { type: 'result', result: '远程 Redis 6379 连接超时 5 秒' },
      { type: 'result', result: '改用进程内缓存' },
      { type: 'result', result: '已确认：不改公开 API，使用进程内缓存，生产接 Redis。' },
    ],
  });
  assert.equal(e13missing.find(item => item.id === 'e13-unknown').ok, false);

  // E14、E15 的夹具都必须让答案综合至少 6 个文件、原始材料超过 40 KB，直接逐文件读取明显大于一份调查摘要。
  const e14dir = await mkdtemp(path.join(os.tmpdir(), 'wf-eval-e14-'));
  await E14.prepare({ project: e14dir });
  const e14files = [
    'deploy/start.mjs', 'deploy/release.env', 'docs/architecture.md', 'src/app.mjs', 'src/router.mjs',
    'src/handlers/quote.mjs', 'src/services/pricing.mjs', 'src/config/defaults.mjs',
    'src/config/loader.mjs', 'src/config/profiles.mjs', 'config/eu-central.json', 'config/us-east.json',
  ];
  assert.ok(e14files.length >= 6);
  const readAll = async (dir, names) => Object.fromEntries(await Promise.all(names.map(async name => [name, await readFile(path.join(dir, name), 'utf8')])));
  const e14contents = await readAll(e14dir, e14files);
  const e14bytes = Object.values(e14contents).reduce((sum, text) => sum + Buffer.byteLength(text), 0);
  assert.ok(e14bytes > 40 * 1024, `E14 原始材料 ${e14bytes} B`);
  // 答案所需的每个关键事实只出现在一个文件；任何单个文件最多只含一项，文档不能直接给出完整答案。
  const e14Facts = [
    { id: 'start-reads-release-env', file: 'deploy/start.mjs', pattern: /readFile\('deploy\/release\.env'/ },
    { id: 'release-profile', file: 'deploy/release.env', pattern: /APP_PROFILE=eu-canary/ },
    { id: 'profile-region-map', file: 'src/config/profiles.mjs', pattern: /'eu-canary': 'eu-central'/ },
    { id: 'app-uses-profile', file: 'src/app.mjs', pattern: /regionForProfile\(env\.APP_PROFILE\)/ },
    { id: 'override-content', file: 'config/eu-central.json', pattern: /"region": "eu-central"/ },
    { id: 'loader-spread', file: 'src/config/loader.mjs', pattern: /return \{ \.\.\.overrides \};/ },
    { id: 'defaults-tax', file: 'src/config/defaults.mjs', pattern: /taxRate: 0\.08/ },
    { id: 'pricing-tax', file: 'src/services/pricing.mjs', pattern: /const taxRate = config\.taxRate/ },
  ];
  assert.ok(e14Facts.length >= 6);
  assert.equal(new Set(e14Facts.map(fact => fact.file)).size, e14Facts.length);
  for (const fact of e14Facts) {
    const matches = e14files.filter(name => fact.pattern.test(e14contents[name]));
    assert.deepEqual(matches, [fact.file], `${fact.id} 只应出现在 ${fact.file}`);
    // 去掉该事实的来源文件后，其他文件不能再提供同一事实。
    const remaining = e14files.filter(name => name !== fact.file);
    assert.ok(!remaining.some(name => fact.pattern.test(e14contents[name])), `缺少 ${fact.file} 时仍能推出 ${fact.id}`);
  }
  for (const name of e14files) {
    const matched = e14Facts.filter(fact => fact.pattern.test(e14contents[name]));
    assert.ok(matched.length <= 1, `${name} 不能集中多个关键事实：${matched.map(fact => fact.id).join('、')}`);
  }
  assert.doesNotMatch(e14contents['config/eu-central.json'], /taxRate/);
  assert.equal(JSON.parse(e14contents['config/us-east.json']).taxRate, 0.07);
  for (const name of e14files) {
    if (!name.endsWith('.mjs')) continue;
    const check = await runCommand(process.execPath, ['--check', path.join(e14dir, name)], { cwd: e14dir });
    assert.equal(check.code, 0, `${name} 语法检查失败：${check.stderr}`);
  }
  // 同一调用链：us-main 经 config/us-east.json 拿到税率并正常报价；eu-canary 缺少税率，命中题面的 500。
  const appUrl = pathToFileURL(path.join(e14dir, 'src/app.mjs')).href;
  const usProbe = [
    `const { buildApp } = await import(${JSON.stringify(appUrl)});`,
    "const us = await buildApp({ APP_PROFILE: 'us-main' });",
    "const usResult = us.handle({ method: 'POST', path: '/api/v1/quote', sku: 'SKU-0001', quantity: 1 });",
    "if (usResult.status !== 200 || !Number.isFinite(usResult.body.unitPrice)) throw new Error('us deployment failed: ' + JSON.stringify(usResult));",
  ].join('\n');
  const usRun = await runCommand(process.execPath, ['--input-type=module', '-e', usProbe], { cwd: e14dir });
  assert.equal(usRun.code, 0, `us 报价探针失败：${usRun.stderr}`);
  // EU 探针预期 500 被路由捕获，探针自身校验成功，因此退出码为 0。
  const euProbe = [
    `const { buildApp } = await import(${JSON.stringify(appUrl)});`,
    "const eu = await buildApp({ APP_PROFILE: 'eu-canary' });",
    "const euResult = eu.handle({ method: 'POST', path: '/api/v1/quote', sku: 'SKU-0001', quantity: 1 });",
    "if (euResult.status !== 500 || euResult.body.error !== 'unit price is not a number') throw new Error('eu failure mismatch: ' + JSON.stringify(euResult));",
  ].join('\n');
  const euRun = await runCommand(process.execPath, ['--input-type=module', '-e', euProbe], { cwd: e14dir });
  assert.equal(euRun.code, 0, `eu 失败探针未按预期返回 500：${euRun.stderr}`);
  const loader = e14contents['src/config/loader.mjs'];
  const loaderLine = loader.split('\n').findIndex(line => line.includes('return { ...overrides };')) + 1;
  assert.match(loader.split('\n')[loaderLine - 1], /return \{ \.\.\.overrides \};/);
  const e14ok = await E14.evaluate({
    events: [{ type: 'result', result: `根因在 src/config/loader.mjs 第 ${loaderLine} 行：deploy/start.mjs 读取 deploy/release.env 的 APP_PROFILE=eu-canary，src/config/profiles.mjs 映射为 eu-central，src/app.mjs 据此加载 config/eu-central.json；该覆盖文件只有 region 和 currency，没有 taxRate，loader 直接返回 overrides，导致 defaults.mjs 的默认 taxRate 0.08 没有合并，pricing.mjs 中 config.taxRate 为 undefined，最终算出 NaN。` }],
  });
  assert.deepEqual(e14ok.filter(item => !item.ok), []);
  // 行号范围包含根因行且跨度不超过 4 行算定位成功；范围过宽或不含根因行不算。
  for (const range of [`${loaderLine - 1}-${loaderLine}`, `${loaderLine - 2}-${loaderLine + 1}`, `${loaderLine}-${loaderLine + 3}`]) {
    const ranged = await E14.evaluate({ events: [{ type: 'result', result: `根因在 src/config/loader.mjs:${range}，环境覆盖没有合并默认配置。` }] });
    assert.equal(ranged.find(item => item.id === 'e14-root-cause-location').ok, true, range);
  }
  for (const range of [`1-${loaderLine + 5}`, `${loaderLine + 1}-${loaderLine + 3}`, `${loaderLine - 3}-${loaderLine - 1}`]) {
    const ranged = await E14.evaluate({ events: [{ type: 'result', result: `根因在 src/config/loader.mjs:${range}，环境覆盖没有合并默认配置。` }] });
    assert.equal(ranged.find(item => item.id === 'e14-root-cause-location').ok, false, range);
  }
  const e14wrongLine = await E14.evaluate({ events: [{ type: 'result', result: `根因在 src/config/loader.mjs 第 ${loaderLine + 1} 行：环境覆盖没有合并默认配置。` }] });
  assert.equal(e14wrongLine.find(item => item.id === 'e14-root-cause-location').ok, false);
  // 同一行号写到其他文件时不能通过。
  const e14wrongFile = await E14.evaluate({ events: [{ type: 'result', result: `根因在 src/config/defaults.mjs 第 ${loaderLine} 行，loader.mjs 也有问题：环境覆盖没有合并默认配置，taxRate 为 undefined。` }] });
  assert.equal(e14wrongFile.find(item => item.id === 'e14-root-cause-location').ok, false);

  const e15dir = await mkdtemp(path.join(os.tmpdir(), 'wf-eval-e15-'));
  await E15.prepare({ project: e15dir });
  const e15files = [
    'config/base.json', 'config/local.json', 'config/production.json', 'deploy/start.mjs',
    'deploy/supervisor.mjs', 'services/reporter.mjs', 'logs/bootstrap.log', 'docs/deployment.md',
  ];
  assert.ok(e15files.length >= 6);
  const e15contents = await readAll(e15dir, e15files);
  const e15bytes = Object.values(e15contents).reduce((sum, text) => sum + Buffer.byteLength(text), 0);
  assert.ok(e15bytes > 40 * 1024, `E15 原始材料 ${e15bytes} B`);
  // 关键事实分散在 7 个文件：默认端口、本地端口、启动命令、配置映射、reporter 启动、占用者端口、日志证据。
  const e15Facts = [
    { id: 'base-port', file: 'config/base.json', pattern: /"port": 8080/ },
    { id: 'local-port', file: 'config/local.json', pattern: /"port": 9090/ },
    { id: 'env-command', file: 'docs/deployment.md', pattern: /APP_ENV=local/ },
    { id: 'env-mapping', file: 'deploy/start.mjs', pattern: /process\.env\.APP_ENV \|\| 'base'/ },
    { id: 'reporter-starts', file: 'deploy/supervisor.mjs', pattern: /startReporter\(\)\s*;/ },
    { id: 'reporter-port', file: 'services/reporter.mjs', pattern: /REPORTER_PORT = 9090/ },
    { id: 'log-evidence', file: 'logs/bootstrap.log', pattern: /EADDRINUSE[^\n]*:::9090/ },
  ];
  assert.ok(e15Facts.length >= 6);
  assert.equal(new Set(e15Facts.map(fact => fact.file)).size, e15Facts.length);
  for (const fact of e15Facts) {
    const matches = e15files.filter(name => fact.pattern.test(e15contents[name]));
    assert.deepEqual(matches, [fact.file], `${fact.id} 只应出现在 ${fact.file}`);
  }
  for (const name of e15files) {
    const matched = e15Facts.filter(fact => fact.pattern.test(e15contents[name]));
    assert.ok(matched.length <= 1, `${name} 不能集中多个关键事实：${matched.map(fact => fact.id).join('、')}`);
  }
  for (const name of e15files) {
    if (!name.endsWith('.mjs')) continue;
    const check = await runCommand(process.execPath, ['--check', path.join(e15dir, name)], { cwd: e15dir });
    assert.equal(check.code, 0, `${name} 语法检查失败：${check.stderr}`);
  }
  // 启动链自洽：模块顶层调用 startSupervisor(createApiServer)，startServer 收到的工厂参数可调用。
  const supervisor = e15contents['deploy/supervisor.mjs'];
  assert.match(supervisor, /^startSupervisor\(createApiServer\)/m);
  assert.match(supervisor, /startServer\(createServer\)/);
  assert.match(e15contents['deploy/start.mjs'], /const server = createServer\(config\);/);
  const bootstrap = e15contents['logs/bootstrap.log'];
  const [evidenceLine] = E15_EVIDENCE_LINES;
  assert.match(bootstrap.split('\n')[evidenceLine - 1], /EADDRINUSE/);
  const e15ok = await E15.evaluate({
    events: [{ type: 'result', result: `最终端口是 9090，来自 config/local.json（本地 APP_ENV=local，base.json 的 8080 没有生效）；services/reporter.mjs 的 REPORTER_PORT 监听 9090，日志 logs/bootstrap.log 第 ${evidenceLine} 行报 EADDRINUSE。` }],
  });
  assert.deepEqual(e15ok.filter(item => !item.ok), []);
  // 每种因果写法单独判定，不拼接多句。
  for (const phrasing of [
    'local.json 覆盖 base.json 的 8080',
    '选择 local 配置所以 base 配置未被读取',
    'local.json 的 9090 覆盖了 base.json 的 8080',
    'APP_ENV 选的是整份配置文件，不是覆盖或合并。',
    'loadServerConfig 只读取一个文件，没有把 base 和环境文件合并。',
  ]) {
    const result = await E15.evaluate({ events: [{ type: 'result', result: phrasing }] });
    assert.equal(result.find(item => item.id === 'e15-config-causality').ok, true, phrasing);
  }
  for (const phrasing of ['base.json 整份文件根本没被读取', 'base 的 8080 没有被读取']) {
    const result = await E15.evaluate({ events: [{ type: 'result', result: phrasing }] });
    assert.equal(result.find(item => item.id === 'e15-base-override').ok, true, phrasing);
  }
  for (const phrasing of [
    '占用 9090 的是先启动的 `reporter` 服务',
    'services/reporter.mjs:147 在 127.0.0.1:9090 上监听',
  ]) {
    const result = await E15.evaluate({ events: [{ type: 'result', result: phrasing }] });
    assert.equal(result.find(item => item.id === 'e15-occupancy').ok, true, phrasing);
  }
  // reporter 与 9090 分处不同行时不算占用关系。
  const e15splitLines = await E15.evaluate({ events: [{ type: 'result', result: '占用方是 reporter\n端口是 9090' }] });
  assert.equal(e15splitLines.find(item => item.id === 'e15-occupancy').ok, false);
  const e15wrong = await E15.evaluate({ events: [{ type: 'result', result: '最终端口是 8080，来自 config/base.json，日志报端口占用。' }] });
  assert.equal(e15wrong.find(item => item.id === 'e15-config').ok, false);
  assert.equal(e15wrong.find(item => item.id === 'e15-occupant').ok, false);
  // 仅罗列端口、文件、占用者和日志行，没有覆盖与监听关系时必须失败。
  const e15listing = await E15.evaluate({
    events: [{ type: 'result', result: `端口 9090，配置文件 local.json，base.json 是 8080，reporter.mjs，日志第 ${evidenceLine} 行，EADDRINUSE。` }],
  });
  assert.equal(e15listing.find(item => item.id === 'e15-config-causality').ok, false);
  assert.equal(e15listing.find(item => item.id === 'e15-occupancy').ok, false);
});

test('context 套件导出基线、成对运行并写对比报告', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wf-eval-context-suite-'));
  const repo = path.join(root, 'repo');
  await mkdir(path.join(repo, 'bin'), { recursive: true });
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({ name: 'fixture', version: '0.0.0' }), 'utf8');
  await writeFile(path.join(repo, 'bin', 'workflow.mjs'), 'console.log(1);\n', 'utf8');
  await runCommand('git', ['init', '-q'], { cwd: repo });
  await runCommand('git', ['add', '.'], { cwd: repo });
  await runCommand('git', ['-c', 'user.name=eval', '-c', 'user.email=eval@example.test', 'commit', '-q', '-m', 'baseline'], { cwd: repo });

  const pricesFile = path.join(root, 'prices.json');
  await writeFile(pricesFile, JSON.stringify({
    unit: 'usd_per_million_tokens',
    source: 'test',
    models: { 'test/model-a': { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0.25 } },
  }), 'utf8');
  const outDir = path.join(root, 'out');
  const calls = [];
  const usage = { input: 1, cacheRead: 0, cacheWrite: 0, output: 1 };
  const byModel = { 'test/model-a': usage };
  const stub = async (scenario, options, directory, runNumber) => {
    calls.push(`${scenario.id}:${options.arm}:${runNumber}`);
    return {
      arm: options.arm,
      scenario: scenario.id,
      run: runNumber,
      status: 'PASS',
      durationMs: 100,
      context: {
        arm: options.arm,
        scenario: scenario.id,
        run: runNumber,
        status: 'PASS',
        quality: { pass: true, failed: [] },
        delegation: { calls: 0, tools: [] },
        tokens: {
          main: { byModel, totals: usage },
          subagents: { byModel: {}, totals: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, files: 0 },
          all: { byModel, totals: usage },
        },
        cost: { usd: options.arm === 'candidate' ? 0.8 : 1, missingModels: [], unit: 'usd_per_million_tokens' },
        reconciliation: { ok: true, reasons: [] },
        association: { complete: true, missing: [], unassociated: [] },
        host: { totalCostUsd: 0.2, costBasis: ['unknown'], note: '宿主估算，不是账单' },
        leadMaterials: { toolResultBytes: { byTool: { Read: 10 }, total: 10 }, inputTokens: { ...usage, total: 1 } },
        trajectory: { records: 1, writeRecords: 1, bytes: 50, msTotal: 0.1, msMax: 0.1 },
        durationMs: 100,
        costComparable: true,
        incomparableReasons: [],
      },
    };
  };
  const code = await runContextSuite({
    options: { suite: 'context', baselineRef: 'HEAD', prices: pricesFile, runs: 1, trial: true, maxBudgetUsd: null },
    outDir,
    executeRun: stub,
    repo,
  });
  assert.equal(code, 0);
  assert.deepEqual(calls, [
    'E10:baseline:1', 'E10:candidate:1',
    'E11:baseline:1', 'E11:candidate:1',
    'E12:baseline:1', 'E12:candidate:1',
    'E13:baseline:1', 'E13:candidate:1',
    'E14:baseline:1', 'E14:candidate:1',
    'E15:baseline:1', 'E15:candidate:1',
  ]);
  const report = await readFile(path.join(outDir, 'context-report.md'), 'utf8');
  assert.match(report, /试跑/);
  assert.match(report, /未含 rtk 输出控制/);
  assert.match(report, /1 对（共 3 对），仅演算/);
  assert.match(report, /成本下降/);
  assert.equal(await readFile(path.join(outDir, 'baseline-HEAD', 'package.json'), 'utf8'), JSON.stringify({ name: 'fixture', version: '0.0.0' }));
  const json = JSON.parse(await readFile(path.join(outDir, 'context-report.json'), 'utf8'));
  assert.equal(json.trial, true);
  assert.equal(json.judgment.cost, 'decrease');
  assert.equal(json.runs.length, 12);
  assert.match(report, /E11–E13 每轮合计折算成本/);

  // R4 场景子集：2 个场景 × 3 轮 × 2 臂 = 12 次，成本按 E14–E15 独立判定。
  const r4Calls = [];
  const r4Out = path.join(root, 'out-r4');
  const r4Code = await runContextSuite({
    options: { scenario: 'E14,E15', baselineRef: 'HEAD', prices: pricesFile, runs: 3, trial: true, maxBudgetUsd: null },
    outDir: r4Out,
    executeRun: async (scenario, options, directory, runNumber) => {
      r4Calls.push(`${scenario.id}:${options.arm}:${runNumber}`);
      return stub(scenario, options, directory, runNumber);
    },
    repo,
  });
  assert.equal(r4Code, 0);
  assert.equal(r4Calls.length, 12);
  assert.deepEqual(r4Calls, [
    'E14:baseline:1', 'E14:candidate:1', 'E14:baseline:2', 'E14:candidate:2', 'E14:baseline:3', 'E14:candidate:3',
    'E15:baseline:1', 'E15:candidate:1', 'E15:baseline:2', 'E15:candidate:2', 'E15:baseline:3', 'E15:candidate:3',
  ]);
  const r4Json = JSON.parse(await readFile(path.join(r4Out, 'context-report.json'), 'utf8'));
  assert.equal(r4Json.runs.length, 12);
  assert.equal(r4Json.judgment.completeRounds, 3);
  assert.equal(r4Json.judgment.cost, 'decrease');
  assert.match(await readFile(path.join(r4Out, 'context-report.md'), 'utf8'), /E14–E15 每轮合计折算成本/);

  // 证据缺失或两臂模型不同时，场景与汇总都写“不可比”，但运行状态和质量不变。
  const broken = async (scenario, options, directory, runNumber) => {
    const summary = structuredClone(await stub(scenario, options, directory, runNumber));
    if (scenario.id === 'E13' && options.arm === 'candidate') {
      summary.context.costComparable = false;
      summary.context.incomparableReasons = ['主 transcript 汇总与 result.usage 不一致'];
    }
    if (scenario.id === 'E12' && options.arm === 'candidate') {
      const other = { 'test/model-b': { input: 1, cacheRead: 0, cacheWrite: 0, output: 1 } };
      summary.context.tokens.main.byModel = other;
      summary.context.tokens.all.byModel = other;
    }
    return summary;
  };
  const brokenDir = path.join(root, 'out-broken');
  const brokenCode = await runContextSuite({
    options: { suite: 'context', baselineRef: 'HEAD', prices: pricesFile, runs: 1, trial: true, maxBudgetUsd: null },
    outDir: brokenDir,
    executeRun: broken,
    repo,
  });
  assert.equal(brokenCode, 0);
  const brokenReport = await readFile(path.join(brokenDir, 'context-report.md'), 'utf8');
  assert.match(brokenReport, /成本不可比：/);
  assert.match(brokenReport, /两臂主会话模型不同/);
  assert.match(brokenReport, /\| E13 \| 不可比 \| 不可比 \| 不可比 \| 否 \|/);
  assert.match(brokenReport, /\| baseline \| 达标 \| 不可比 \| — \|/);
  const brokenJson = JSON.parse(await readFile(path.join(brokenDir, 'context-report.json'), 'utf8'));
  assert.equal(brokenJson.judgment.cost, 'incomparable');
  assert.equal(brokenJson.judgment.quality, 'pass');
});

test('context 对比拒绝非 context 场景，在启动宿主前退出', async () => {
  const result = await runCommand(process.execPath, [
    path.resolve('scripts/eval/run.mjs'),
    '--scenario', 'E00', '--baseline-ref', 'HEAD', '--prices', 'prices.json',
    '--out', path.join(os.tmpdir(), 'wf-eval-context-guard'),
  ], { cwd: path.resolve('.') });
  assert.equal(result.code, 2, result.stdout + result.stderr);
  assert.match(result.stderr, /只支持 context 套件场景/);
  // 重复场景 ID 在启动宿主前直接拒绝。
  const duplicate = await runCommand(process.execPath, [
    path.resolve('scripts/eval/run.mjs'), '--scenario', 'E14,E14',
  ], { cwd: path.resolve('.') });
  assert.equal(duplicate.code, 2, duplicate.stdout + duplicate.stderr);
  assert.match(duplicate.stderr, /重复场景/);
});

test('场景选择', () => {
  assert.deepEqual(selectScenarios({ scenario: 'E00' }).map(item => item.id), ['E00']);
  assert.deepEqual(selectScenarios({ suite: 'smoke' }).map(item => item.id), ['E00']);
  assert.deepEqual(selectScenarios({ suite: 'protocol' }).map(item => item.id), ['E01', 'E02', 'E03', 'E04', 'E05', 'E06']);
  assert.equal(selectScenarios({ scenario: 'E06' })[0].local, true);
  assert.equal(selectScenarios({ scenario: 'E09' })[0].herdr, true);
  assert.deepEqual(selectScenarios({ suite: 'herdr' }).map(item => item.id), ['E09']);
  assert.deepEqual(selectScenarios({ suite: 'model' }).map(item => item.id), ['E07', 'E08']);
  assert.deepEqual(selectScenarios({ suite: 'context' }).map(item => item.id), ['E10', 'E11', 'E12', 'E13', 'E14', 'E15']);
  assert.deepEqual(selectScenarios({ scenario: 'E08' }).map(item => item.id), ['E08']);
  assert.deepEqual(selectScenarios({ scenario: 'E14,E15' }).map(item => item.id), ['E14', 'E15']);
  assert.deepEqual(selectScenarios({ scenario: ' E15 , E14 ' }).map(item => item.id), ['E15', 'E14']);
  assert.throws(() => selectScenarios({ scenario: 'E99' }), /未知场景/);
  assert.throws(() => selectScenarios({ scenario: 'E14,E99' }), /未知场景/);
  assert.throws(() => selectScenarios({ scenario: ' , ' }), /至少需要一个场景/);
  assert.throws(() => selectScenarios({ scenario: 'E14,E14' }), /重复场景/);
  assert.throws(() => selectScenarios({ scenario: 'E15,E14,E15' }), /重复场景/);
});

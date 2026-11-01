// R2 第二轮定向回归：真实 Post/Pre 协议与夹具，不新增探针框架。
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { handleHook } from '../src/hooks.mjs';
import { sessionKey, taskKey } from '../src/protocol.mjs';
import { mutate, readState } from '../src/store.mjs';
import { emit, entry, event, fixture } from './helpers.mjs';

const planPath = 'docs/plans/r2-regressions.md';
async function prepare(f, packages) {
  await mkdir(path.dirname(path.join(f.project, planPath)), { recursive: true });
  await writeFile(path.join(f.project, planPath), '# R2 回归计划\n\n## 实施步骤\n\n1. 实施并核对。\n');
  const preparation = {
    size: 'complex',
    sizeReason: '涉及协议、hooks 与测试，需要逐包核对',
    requirements: [{ id: 'A01', summary: '回归七项', acceptance: ['错误声明被拒绝'] }],
    research: [{ source: '本仓 protocol.mjs', conclusion: '复用现有门禁' }],
    solution: { summary: '按结构化声明核对', decisions: [{ decision: '不解析自然语言', reason: '只接受显式字段' }] },
    packages,
    verification: ['node --test test/r2-regressions.test.mjs'],
    confirmation: { scope: ['方案', '分包', 'Agent'], basis: '用户确认本轮定向返修' },
    pending: [],
    source: { path: planPath },
  };
  const saved = await emit(f, { action: 'prepare', preparation });
  assert.equal(saved.result.accepted, true, JSON.stringify(saved.result));
  return preparation;
}
const pre = (f, toolName, toolInput, extra = {}) => event(f, 'PreToolUse', { tool_name: toolName, tool_input: toolInput, permission_mode: 'default', ...extra });

test('R2 高 1：审查委派按包放行，Agent/通道/角色或 schema 不符时拒绝', async () => {
  const f = await fixture();
  await prepare(f, [
    { packageId: 'W1', role: 'worker', agent: 'Claude Code', channel: 'codeg:claude_code', scope: 'src/hooks.mjs', delivers: '实施', dependsOn: [] },
    { packageId: 'R1', role: 'reviewer', agent: 'general-purpose', channel: 'builtin:general-purpose', scope: '审查 W1', delivers: '审查结论', dependsOn: [] },
    { packageId: 'R2', role: 'reviewer', agent: 'codex', channel: 'codeg:codex', scope: '独立审查 W1', delivers: '第二份审查结论', dependsOn: [] },
  ]);
  await emit(f, { action: 'task-start', goal: 'W2 审查委派', route: 'delegated', permissions: { mode: 'write', allowedPaths: ['src/hooks.mjs'] } });
  const packages = [
    { packageId: 'W1', role: 'worker', status: 'dispatched', agent: 'Claude Code', channel: 'codeg:claude_code', scope: 'src/hooks.mjs' },
    { packageId: 'R1', role: 'reviewer', status: 'dispatched', agent: 'general-purpose', channel: 'builtin:general-purpose', scope: '审查 W1' },
    { packageId: 'R2', role: 'reviewer', status: 'dispatched', agent: 'codex', channel: 'codeg:codex', scope: '独立审查 W1' },
  ];
  assert.equal((await emit(f, { action: 'packages', packages })).result.accepted, true);
  // 原生审查子代理：Agent 与通道一致即合法。
  assert.deepEqual(await pre(f, 'Agent', { subagent_type: 'general-purpose', description: 'workflow-package:R1 审查 W1', prompt: '只读审查并给出结论' }), {});
  // Agent 不一致。
  const wrongAgent = await pre(f, 'Agent', { subagent_type: 'claude', description: 'workflow-package:R1 审查', prompt: 'x' });
  assert.equal(wrongAgent.hookSpecificOutput?.permissionDecision, 'deny', JSON.stringify(wrongAgent));
  assert.match(wrongAgent.hookSpecificOutput.permissionDecisionReason, /Agent 与本次委派不一致/);
  // 通道不一致：builtin 包不能用 Codeg MCP 派发。
  const wrongChannel = await pre(f, 'mcp__codeg-mcp__delegate_to_agent', { task: 'workflow-package:R1 审查', agent_type: 'general-purpose' });
  assert.equal(wrongChannel.hookSpecificOutput?.permissionDecision, 'deny', JSON.stringify(wrongChannel));
  assert.match(wrongChannel.hookSpecificOutput.permissionDecisionReason, /通道/);
  // 角色字段可解析时不能把 reviewer 包标成 worker。
  const wrongRole = await pre(f, 'Agent', { subagent_type: 'general-purpose', description: 'workflow-package:R1 审查', role: 'worker', prompt: 'x' });
  assert.equal(wrongRole.hookSpecificOutput?.permissionDecision, 'deny', JSON.stringify(wrongRole));
  assert.match(wrongRole.hookSpecificOutput.permissionDecisionReason, /角色/);
  // Codeg 入口缺 Agent 选择/必需字段时点名缺失字段，不能静默跳过核对。
  const missingAgent = await pre(f, 'mcp__codeg-mcp__delegate_to_agent', { task: 'workflow-package:R2 审查' });
  assert.equal(missingAgent.hookSpecificOutput?.permissionDecision, 'deny', JSON.stringify(missingAgent));
  assert.match(missingAgent.hookSpecificOutput.permissionDecisionReason, /agent_type|assistant_id/);
  const missingPrompt = await pre(f, 'mcp__codeg-mcp__create_work_task', { title: 'workflow-package:R2 审查' });
  assert.equal(missingPrompt.hookSpecificOutput?.permissionDecision, 'deny', JSON.stringify(missingPrompt));
  assert.match(missingPrompt.hookSpecificOutput.permissionDecisionReason, /prompt/);
  // 合法 Codeg 审查派工仍放行（没有实施写入豁免）。
  assert.deepEqual(await pre(f, 'mcp__codeg-mcp__delegate_to_agent', { task: 'workflow-package:R2 审查', agent_type: 'codex' }), {});
});

test('R2 高 2：operation-only 协议拒绝 write、实施包与 task-update 提权，只读诊断保留', async () => {
  const denied = await fixture();
  const startDenied = await emit(denied, { action: 'task-start', goal: '发布核对', route: 'operation-only', permissions: { mode: 'write', allowedPaths: [] } });
  assert.equal(startDenied.result.accepted, false, JSON.stringify(startDenied.result));
  assert.equal(startDenied.result.reason, 'PERMISSION');
  assert.deepEqual(startDenied.result.missing, ['permissions.mode']);
  assert.equal(Object.keys((await readState(denied.directory)).tasks).length, 0);
  const preDenied = await pre(denied, 'Bash', { command: `node "${entry}" signal task-start --session ${denied.sessionId} --turn ${denied.turnId} --id op-write --task op-1 --route operation-only --goal 发布核对 --mode write --paths README.md` });
  assert.equal(preDenied.hookSpecificOutput?.permissionDecision, 'deny', JSON.stringify(preDenied));
  assert.match(preDenied.hookSpecificOutput.permissionDecisionReason, /operation-only/);

  const f = await fixture();
  const started = await emit(f, { action: 'task-start', goal: '状态核对', route: 'operation-only', permissions: { mode: 'read-only', allowedPaths: [] } });
  assert.equal(started.result.accepted, true, JSON.stringify(started.result));
  const implementation = await emit(f, { action: 'packages', packages: [{ packageId: 'W1', role: 'worker', status: 'dispatched' }] });
  assert.equal(implementation.result.accepted, false, JSON.stringify(implementation.result));
  assert.equal(implementation.result.reason, 'PERMISSION');
  assert.match(implementation.result.message, /operation-only/);
  const diagnostic = await emit(f, { action: 'packages', packages: [{ packageId: 'D1', role: 'worker', status: 'dispatched', diagnostic: { purpose: '核对状态', scope: ['README.md'], reason: '只读核对' } }] });
  assert.equal(diagnostic.result.accepted, true, JSON.stringify(diagnostic.result));
  const promote = await emit(f, { action: 'task-update', permissions: { mode: 'write' } });
  assert.equal(promote.result.accepted, false, JSON.stringify(promote.result));
  assert.equal(promote.result.reason, 'PERMISSION');
  // 例行操作本身（只读）不受影响。
  assert.deepEqual(await pre(f, 'Read', { file_path: path.join(f.project, 'README.md') }), {});
});

test('R2 高 3：只读诊断包不能借 general-purpose/Codeg 或角色声明取得写入', async () => {
  const f = await fixture();
  await prepare(f, [
    { packageId: 'D1', role: 'worker', agent: 'general-purpose', channel: 'builtin:general-purpose', scope: 'README.md', delivers: '核对结论', dependsOn: [] },
    { packageId: 'D2', role: 'worker', agent: 'claude_code', channel: 'codeg:claude_code', scope: 'README.md', delivers: 'Codeg 核对结论', dependsOn: [] },
  ]);
  await emit(f, { action: 'task-start', goal: 'W2 诊断', route: 'delegated', permissions: { mode: 'write', allowedPaths: ['src/hooks.mjs'] } });
  assert.equal((await emit(f, { action: 'packages', packages: [
    { packageId: 'D1', role: 'worker', status: 'dispatched', agent: 'general-purpose', channel: 'builtin:general-purpose', scope: 'README.md', diagnostic: { purpose: '核对 README', scope: ['README.md'], reason: '只读核对' } },
    { packageId: 'D2', role: 'worker', status: 'dispatched', agent: 'claude_code', channel: 'codeg:claude_code', scope: 'README.md', diagnostic: { purpose: 'Codeg 核对', scope: ['README.md'], reason: '只读核对' } },
  ] })).result.accepted, true);
  const general = await pre(f, 'Agent', { subagent_type: 'general-purpose', description: 'workflow-package:D1 核对', prompt: 'x' });
  assert.equal(general.hookSpecificOutput?.permissionDecision, 'deny', JSON.stringify(general));
  assert.match(general.hookSpecificOutput.permissionDecisionReason, /只读诊断包/);
  assert.deepEqual(await pre(f, 'Agent', { subagent_type: 'Explore', description: 'workflow-package:D1 核对', prompt: '只读核对' }), {});
  const codeg = await pre(f, 'mcp__codeg-mcp__delegate_to_agent', { task: 'workflow-package:D2 核对', agent_type: 'claude_code' });
  assert.equal(codeg.hookSpecificOutput?.permissionDecision, 'deny', JSON.stringify(codeg));
  assert.match(codeg.hookSpecificOutput.permissionDecisionReason, /只读诊断包/);
  // 以 worker 角色声明诊断包：写入和继续委派都被拒绝。
  await mutate(f.directory, async state => {
    state.sessions[sessionKey(f.projectId, 'diagnostic-worker')] = {
      projectId: f.projectId, sessionId: 'diagnostic-worker', taskId: null, turnId: 'diag-turn', ticket: 'diag-ticket',
      interruptEpoch: 0, revision: 1, phase: 'unknown', permissionMode: 'default', receipts: {}, observed: {},
      role: 'worker', packageId: 'D1', roleTaskId: f.taskId,
    };
  });
  const write = await event({ ...f, sessionId: 'diagnostic-worker', turnId: 'diag-turn' }, 'PreToolUse', {
    tool_name: 'Write', tool_input: { file_path: path.join(f.project, 'src', 'hooks.mjs'), content: 'x' },
  });
  assert.equal(write.hookSpecificOutput?.permissionDecision, 'deny', JSON.stringify(write));
  assert.match(write.hookSpecificOutput.permissionDecisionReason, /只读诊断包/);
  const delegate = await event({ ...f, sessionId: 'diagnostic-worker', turnId: 'diag-turn' }, 'PreToolUse', {
    tool_name: 'Agent', tool_input: { subagent_type: 'Explore', description: 'workflow-package:D1 继续', prompt: 'x' },
  });
  assert.equal(delegate.hookSpecificOutput?.permissionDecision, 'deny', JSON.stringify(delegate));
  assert.match(delegate.hookSpecificOutput.permissionDecisionReason, /不能继续委派/);
});

test('R2 中 5：task-update 拒绝重放/错配 target/移除在途包，允许替换与显式移除未派发包', async () => {
  const f = await fixture();
  await prepare(f, [
    { packageId: 'W1', role: 'worker', agent: 'Claude Code', channel: 'codeg:claude_code', scope: 'src/hooks.mjs', delivers: '实施', dependsOn: [] },
    { packageId: 'W2', role: 'worker', agent: 'Claude Code', channel: 'codeg:claude_code', scope: 'src/x.mjs', delivers: '后续', dependsOn: ['W1'] },
  ]);
  await emit(f, { action: 'task-start', goal: 'W2 更新', route: 'delegated', permissions: { mode: 'write', allowedPaths: ['src/hooks.mjs'] } });
  assert.equal((await emit(f, { action: 'packages', packages: [{ packageId: 'W1', role: 'worker', status: 'dispatched', agent: 'Claude Code', channel: 'codeg:claude_code', scope: 'src/hooks.mjs' }] })).result.accepted, true);
  const state = await readState(f.directory);
  const saved = state.sessions[sessionKey(f.projectId, f.sessionId)].preparation;
  // 快照带 schemaVersion/preparedAt 等保存元数据；重放时还原为 prepare 可接受的输入字段。
  const current = {
    size: saved.size, sizeReason: saved.sizeReason, requirements: saved.requirements, research: saved.research,
    solution: saved.solution, packages: saved.packages, verification: saved.verification,
    confirmation: saved.confirmation, pending: saved.pending,
    source: saved.source ? { path: saved.source.path, sections: saved.source.sections } : undefined,
  };
  const target = { goal: '扩大目标', permissions: { mode: 'write', allowedPaths: ['src/hooks.mjs'] } };
  // 原样重放旧准备 + 非空理由，不构成实际变化。
  const replay = await emit(f, { action: 'task-update', goal: '扩大目标', preparation: structuredClone(current), preparationReason: '用户已确认', preparationTarget: target });
  assert.equal(replay.result.accepted, false, JSON.stringify(replay.result));
  assert.match(replay.result.message, /没有实际变化/);
  // 有实际变化但 target 与本次目标不符：拒绝。
  const changed = structuredClone(current);
  changed.packages.push({ packageId: 'W3', role: 'worker', agent: 'Claude Code', channel: 'codeg:claude_code', scope: 'src/y.mjs', delivers: '新增', dependsOn: [] });
  const mismatch = await emit(f, { action: 'task-update', goal: '扩大目标', preparation: changed, preparationReason: '用户已确认', preparationTarget: { ...target, goal: '别的目标' } });
  assert.equal(mismatch.result.accepted, false, JSON.stringify(mismatch.result));
  assert.equal(mismatch.result.missing?.[0], 'preparation:target');
  // 未登记进任务账本的 W2 可以替换或显式移除。
  const replaced = structuredClone(current);
  replaced.packages = replaced.packages.map(item => item.packageId === 'W2' ? { ...item, agent: 'Codex', channel: 'codeg:codex' } : item);
  const replacement = await emit(f, { action: 'task-update', preparation: replaced, preparationReason: '用户确认 W2 改由 Codex' });
  assert.equal(replacement.result.accepted, true, JSON.stringify(replacement.result));
  assert.deepEqual(replacement.result.change.preparation.changed, ['W2']);
  const removedPrep = structuredClone(replaced);
  removedPrep.packages = removedPrep.packages.filter(item => item.packageId !== 'W2');
  const removed = await emit(f, { action: 'task-update', preparation: removedPrep, preparationRemove: ['W2'], preparationReason: '用户确认移除 W2' });
  assert.equal(removed.result.accepted, true, JSON.stringify(removed.result));
  assert.deepEqual(removed.result.change.preparation.removed, ['W2']);
  // W1 在本次准备里显式保留而非省略，因此不再列入 preserved；合并结果仍保留它。
  assert.deepEqual(removed.result.change.preparation.preserved, []);
  assert.deepEqual((await readState(f.directory)).tasks[taskKey(f.projectId, f.taskId)].preparation.packages.map(item => item.packageId), ['W1']);
  // 已 dispatched 的 W1 不能从准备记录移除。
  const dropActive = structuredClone(removedPrep);
  dropActive.packages = dropActive.packages.filter(item => item.packageId !== 'W1');
  dropActive.packages.push({ packageId: 'W3', role: 'worker', agent: 'Claude Code', channel: 'codeg:claude_code', scope: 'src/z.mjs', delivers: '替代包', dependsOn: [] });
  const active = await emit(f, { action: 'task-update', preparation: dropActive, preparationRemove: ['W1'], preparationReason: '用户确认移除 W1' });
  assert.equal(active.result.accepted, false, JSON.stringify(active.result));
  assert.match(active.result.message, /仍在 dispatched/);
  const updated = (await readState(f.directory)).tasks[taskKey(f.projectId, f.taskId)].preparationUpdates;
  assert.deepEqual(updated.at(-1).removed, ['W2']);
  assert.deepEqual(updated.at(-1).preserved, []);
});

test('R2 第三轮：准备快照倒序重放不算实际变化，目标变化仍被拒', async () => {
  const f = await fixture();
  const packages = [
    { packageId: 'W1', role: 'worker', agent: 'Claude Code', channel: 'codeg:claude_code', scope: 'src/a.mjs', delivers: '行为 A', dependsOn: [] },
    { packageId: 'W2', role: 'worker', agent: 'Claude Code', channel: 'codeg:claude_code', scope: 'src/b.mjs', delivers: '行为 B', dependsOn: [] },
    { packageId: 'W3', role: 'worker', agent: 'Claude Code', channel: 'codeg:claude_code', scope: 'src/c.mjs', delivers: '行为 C', dependsOn: ['W1', 'W2'] },
  ];
  await prepare(f, packages);
  await emit(f, { action: 'task-start', goal: '倒序重放', route: 'delegated', permissions: { mode: 'write', allowedPaths: ['src/a.mjs'] } });
  const state = await readState(f.directory);
  const saved = state.sessions[sessionKey(f.projectId, f.sessionId)].preparation;
  const replay = {
    size: saved.size, sizeReason: saved.sizeReason, requirements: saved.requirements, research: saved.research,
    solution: saved.solution,
    // 包顺序与 dependsOn 顺序都是无意义集合顺序；内容完全相同。
    packages: [...saved.packages].reverse().map(item => item.packageId === 'W3' ? { ...item, dependsOn: [...item.dependsOn].reverse() } : item),
    verification: saved.verification, confirmation: saved.confirmation, pending: saved.pending,
    source: { path: saved.source.path, sections: saved.source.sections },
  };
  const target = { goal: '扩大目标', permissions: { mode: 'write', allowedPaths: ['src/a.mjs'] } };
  const result = await emit(f, {
    action: 'task-update', goal: '扩大目标', preparation: replay,
    preparationReason: '用户确认新目标', preparationTarget: target,
  });
  assert.equal(result.result.accepted, false, JSON.stringify(result.result));
  assert.equal(result.result.reason, 'PREPARATION');
  assert.match(result.result.message, /没有实际变化/);
  // 只改 sizeReason 之类元数据也不能冒充目标准备已更新。
  const metadata = await emit(f, {
    action: 'task-update', goal: '扩大目标',
    preparation: { ...structuredClone(replay), packages: saved.packages, sizeReason: `${saved.sizeReason}（只改说明）` },
    preparationReason: '用户确认新目标', preparationTarget: target,
  });
  assert.equal(metadata.result.accepted, false, JSON.stringify(metadata.result));
  assert.match(metadata.result.message, /没有实际变化/);
});

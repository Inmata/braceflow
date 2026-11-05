// W4 决策升级提醒：不再有信号清单门禁；路径规则与 jev 命中只提醒一次，咨询记录继续写入。
// 全部走真实 PostToolUse / PreToolUse 与真实 recordConsultation，不直接注入回执。
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { consultationPath, readConsultations } from '../src/consult.mjs';
import { sessionKey, taskKey } from '../src/protocol.mjs';
import { readState } from '../src/store.mjs';
import { consult, emit, event, fixture } from './helpers.mjs';
import { consultationMatches, gateApplies, lastChangeAt, pathRuleHits, readGateConfig } from '../src/advisor-gate.mjs';

const PLAN = 'docs/plans/advisor-reminder.md';
const GOAL = '提醒任务';
const PATHS = ['src/a.mjs'];
async function writePlan(f) {
  await mkdir(path.dirname(path.join(f.project, PLAN)), { recursive: true });
  await writeFile(path.join(f.project, PLAN), '# 提醒计划\n\n## 实施步骤\n\n1. 实施并核对。\n');
}
function preparation(overrides = {}) {
  return {
    size: 'complex',
    sizeReason: '涉及协议与 hooks，需要独立审查',
    requirements: [{ id: 'A01', summary: '完整行为', acceptance: ['定向测试通过'], packages: ['W1'], verification: 'node --test' }],
    research: [{ source: '本仓 protocol.mjs', conclusion: '复用现有信号与回执' }],
    solution: { summary: '命中时只提醒，不拦截', decisions: [{ decision: '不再强制咨询', reason: '顾问按需' }] },
    packages: [
      { packageId: 'W1', role: 'worker', agent: 'Claude Code', channel: 'builtin:agent', scope: 'src/a.mjs', delivers: '完整行为', dependsOn: [] },
      { packageId: 'R1', role: 'reviewer', agent: 'Codex', channel: 'codeg:codex', scope: '审查 W1', delivers: '审查结论', dependsOn: ['W1'] },
    ],
    verification: ['node --test'],
    confirmation: { scope: ['方案', '分包'], basis: '用户确认' },
    pending: [],
    source: { path: PLAN },
    ...overrides,
  };
}
async function prepareAccepted(f, value = preparation()) {
  const result = await emit(f, { action: 'prepare', preparation: value });
  assert.equal(result.result.accepted, true, JSON.stringify(result.result));
  return result;
}
async function startTask(f, route = 'delegated', permissions = { mode: 'write', allowedPaths: PATHS }) {
  const result = await emit(f, { action: 'task-start', goal: GOAL, route, permissions });
  assert.equal(result.result.accepted, true, JSON.stringify(result.result));
  return result;
}
async function complexTask(f, route = 'delegated') {
  await writePlan(f);
  await prepareAccepted(f);
  return startTask(f, route);
}
const write = (f, target) => event(f, 'PreToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(f.project, target), content: 'x' } });
async function scopeUpdate(f, addedPaths) {
  const state = await readState(f.directory);
  const current = state.sessions[sessionKey(f.projectId, f.sessionId)].preparation;
  const task = state.tasks[taskKey(f.projectId, f.taskId)];
  return {
    action: 'task-update',
    permissions: { allowedPaths: addedPaths, mode: 'write' },
    allowedPathsMode: 'append',
    preparation: preparation({ requirements: [{ ...current.requirements[0], acceptance: [`验收 ${addedPaths.join('、')}`] }] }),
    preparationReason: '用户确认扩大业务路径',
    preparationTarget: { goal: GOAL, permissions: { mode: 'write', allowedPaths: [...task.permissions.allowedPaths, ...addedPaths] } },
  };
}

test('prepare 带分包与连续 prepare 都不再要求咨询；咨询记录仍按需写入', async () => {
  const f = await fixture();
  await writePlan(f);
  const first = await prepareAccepted(f);
  assert.equal(first.result.ready, true);
  assert.deepEqual(first.result.missing, []);
  const second = await prepareAccepted(f);
  assert.equal(second.result.reminders, undefined);
  const records = await readConsultations(f.directory, f.projectId, f.sessionId);
  assert.deepEqual(records.consultations, []);

  await startTask(f);
  await consult(f, { taskId: f.taskId });
  const written = await readConsultations(f.directory, f.projectId, f.sessionId);
  assert.equal(written.consultations.length, 1);
  assert.equal(written.consultations[0].taskId, f.taskId);
});

test('task-update 扩大业务路径、新增准备包与审查 FIX 后重派都不再要求咨询', async () => {
  const f = await fixture();
  await complexTask(f);
  const scope = await emit(f, await scopeUpdate(f, ['README.md']));
  assert.equal(scope.result.accepted, true, JSON.stringify(scope.result));
  assert.equal(scope.result.missing, undefined);
  assert.deepEqual((await readState(f.directory)).tasks[taskKey(f.projectId, f.taskId)].permissions.allowedPaths, ['src/a.mjs', 'README.md']);

  const state = await readState(f.directory);
  const current = state.sessions[sessionKey(f.projectId, f.sessionId)].preparation;
  const withPackage = preparation({
    requirements: [{ ...current.requirements[0], acceptance: ['新增包后的验收'] }],
    packages: [
      { packageId: 'W1', role: 'worker', agent: 'Claude Code', channel: 'builtin:agent', scope: 'src/a.mjs', delivers: '完整行为', dependsOn: [] },
      { packageId: 'W2', role: 'worker', agent: 'Claude Code', channel: 'builtin:agent', scope: 'src/b.mjs', delivers: '后续行为', dependsOn: [] },
    ],
  });
  const packageUpdate = await emit(f, { action: 'task-update', preparation: withPackage, preparationReason: '用户确认新增 W2' });
  assert.equal(packageUpdate.result.accepted, true, JSON.stringify(packageUpdate.result));

  const dispatched = await emit(f, {
    action: 'packages',
    packages: [
      { packageId: 'W1', role: 'worker', status: 'dispatched', agent: 'Claude Code', channel: 'builtin:agent', scope: 'src/a.mjs' },
      { packageId: 'R1', role: 'reviewer', status: 'dispatched', agent: 'Codex', channel: 'codeg:codex', scope: '审查 W1' },
    ],
  });
  assert.equal(dispatched.result.accepted, true, JSON.stringify(dispatched.result));
  await emit(f, { action: 'packages', packages: [
    { packageId: 'W1', status: 'delivered', deliveredRef: 'v1' },
    { packageId: 'R1', status: 'delivered', reviews: 'W1', reviewedRef: 'v1', verdict: 'FIX' },
  ] });
  const redispatch = await emit(f, { action: 'packages', packages: [{ packageId: 'W1', status: 'dispatched' }] });
  assert.equal(redispatch.result.accepted, true, JSON.stringify(redispatch.result));
});

test('带未完成验收项收尾不再要求咨询，验收状态照常记录', async () => {
  const f = await fixture();
  await complexTask(f, 'lead-direct');
  const result = await emit(f, {
    action: 'task-end', finalRef: 'v1',
    validation: { ref: 'v1', evidence: ['npm test'], acceptance: [{ id: 'A01', status: 'manual-pending', owner: '用户', next: '按步骤点击确认' }] },
  });
  assert.equal(result.result.accepted, true, JSON.stringify(result.result));
  assert.equal(result.result.acceptance.manualPending, 1);
});

test('路径规则实际写入只提醒一次；本任务已有咨询记录时不提醒', async () => {
  const config = JSON.stringify({ schemaVersion: 1, pathRules: { security: ['src/**', 'README.md'], migration: [] } });
  const f = await fixture();
  await writeFile(path.join(f.project, 'workflow-gate.json'), config);
  await complexTask(f);
  const first = await write(f, 'src/a.mjs');
  assert.equal(first.hookSpecificOutput?.permissionDecision, undefined, JSON.stringify(first));
  assert.match(first.systemMessage, /项目路径规则/);
  assert.match(first.systemMessage, /只提醒，不拦截/);
  const state = await readState(f.directory);
  assert.ok(state.sessions[sessionKey(f.projectId, f.sessionId)].reminded[`${f.taskId}:security`]);
  // 同一会话同一键只提醒一次，跨回合仍保持。
  assert.deepEqual(await write(f, 'src/a.mjs'), {});
  const next = { ...f, turnId: 'turn-2' };
  await event(next, 'UserPromptSubmit');
  Object.assign(f, next);
  assert.deepEqual(await write(f, 'src/a.mjs'), {});
  // 未命中规则的写入不触发。
  assert.deepEqual(await write(f, 'docs/notes.md'), {});

  // 本任务已有咨询记录：命中也不提醒。
  const g = await fixture();
  await writeFile(path.join(g.project, 'workflow-gate.json'), config);
  await complexTask(g);
  await consult(g, { taskId: g.taskId });
  assert.deepEqual(await write(g, 'src/a.mjs'), {});

  // 未配置路径规则的项目：同一路径写入不触发。
  const h = await fixture();
  await complexTask(h);
  assert.deepEqual(await write(h, 'src/a.mjs'), {});
});

test('同一任务先提醒 security 后，同时命中 security 与 migration 只显示新分类', async () => {
  const config = JSON.stringify({ schemaVersion: 1, pathRules: { security: ['src/**'], migration: ['src/*.mjs'] } });
  // 实际写入入口。
  const f = await fixture();
  await writeFile(path.join(f.project, 'workflow-gate.json'), config);
  await complexTask(f);
  const firstWrite = await write(f, 'src/sub/a.mjs');
  assert.match(firstWrite.systemMessage, /src\/sub\/a\.mjs（security）/);
  const secondWrite = await write(f, 'src/a.mjs');
  assert.match(secondWrite.systemMessage, /src\/a\.mjs（migration）/);
  assert.doesNotMatch(secondWrite.systemMessage, /security/);

  // task-update 入口。
  const g = await fixture();
  await writeFile(path.join(g.project, 'workflow-gate.json'), config);
  await complexTask(g);
  const firstUpdate = await emit(g, await scopeUpdate(g, ['src/sub/a.mjs']));
  assert.match(firstUpdate.result.reminders?.[0] || '', /src\/sub\/a\.mjs（security）/);
  const secondUpdate = await emit(g, await scopeUpdate(g, ['src/a2.mjs']));
  assert.match(secondUpdate.result.reminders?.[0] || '', /src\/a2\.mjs（migration）/);
  assert.doesNotMatch(secondUpdate.result.reminders?.[0] || '', /security/);
});

test('task-update 路径增量命中只提醒一次，不返回 GATE', async () => {
  const config = JSON.stringify({ schemaVersion: 1, pathRules: { security: ['src/**', 'README.md'], migration: [] } });
  const f = await fixture();
  await writeFile(path.join(f.project, 'workflow-gate.json'), config);
  await complexTask(f);
  const first = await emit(f, await scopeUpdate(f, ['README.md']));
  assert.equal(first.result.accepted, true, JSON.stringify(first.result));
  assert.equal(first.result.reason, undefined);
  assert.match(first.result.reminders?.[0] || '', /README\.md/);
  // 同一任务、同一分类已有提醒键：再次命中不再提示。
  const second = await emit(f, await scopeUpdate(f, ['src/b.mjs']));
  assert.equal(second.result.accepted, true, JSON.stringify(second.result));
  assert.equal(second.result.reminders, undefined);
});

test('咨询记录损坏不阻断；提醒说明记录不可读并保留原文件', async () => {
  const config = JSON.stringify({ schemaVersion: 1, pathRules: { security: ['src/**'], migration: [] } });
  const f = await fixture();
  await complexTask(f);
  const file = consultationPath(f.directory, f.projectId, f.sessionId);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, '不是 JSON');
  await writeFile(path.join(f.project, 'workflow-gate.json'), config);
  const output = await write(f, 'src/a.mjs');
  assert.equal(output.hookSpecificOutput?.permissionDecision, undefined, JSON.stringify(output));
  assert.match(output.systemMessage, /无法解析/);
  assert.match(output.systemMessage, /无法确认是否已咨询/);
  assert.equal(await readFile(file, 'utf8'), '不是 JSON');

  const g = await fixture();
  await writeFile(path.join(g.project, 'workflow-gate.json'), config);
  await complexTask(g);
  await mkdir(path.dirname(consultationPath(g.directory, g.projectId, g.sessionId)), { recursive: true });
  await writeFile(consultationPath(g.directory, g.projectId, g.sessionId), '坏文件');
  const update = await emit(g, await scopeUpdate(g, ['src/b.mjs']));
  assert.equal(update.result.accepted, true, JSON.stringify(update.result));
  assert.match(update.result.reminders?.[0] || '', /无法解析/);
});

test('跨 Lead 会话聚合：同一任务在其他会话问过则不提醒', async () => {
  const config = JSON.stringify({ schemaVersion: 1, pathRules: { security: ['src/**'], migration: [] } });
  const f = await fixture();
  await writeFile(path.join(f.project, 'workflow-gate.json'), config);
  await complexTask(f);
  const other = { sessionId: 'lead-2', turnId: 'lead-2-turn' };
  await event({ ...f, ...other }, 'UserPromptSubmit');
  await consult({ ...f, ...other }, { taskId: f.taskId });
  assert.deepEqual(await write(f, 'src/a.mjs'), {});
});

test('提醒键只写会话字段，不改变状态版本与任务记录', async () => {
  const f = await fixture();
  await writeFile(path.join(f.project, 'workflow-gate.json'), JSON.stringify({ schemaVersion: 1, pathRules: { security: ['src/**'], migration: [] } }));
  await complexTask(f);
  const before = await readState(f.directory);
  await write(f, 'src/a.mjs');
  const after = await readState(f.directory);
  assert.equal(after.schemaVersion, before.schemaVersion);
  assert.deepEqual(after.tasks[taskKey(f.projectId, f.taskId)], before.tasks[taskKey(f.projectId, f.taskId)]);
  assert.ok(after.sessions[sessionKey(f.projectId, f.sessionId)].reminded[`${f.taskId}:security`]);
});

test('配置读取：无配置不生效，损坏或未知分类给出错误且不回退成默认规则', async () => {
  const f = await fixture();
  assert.deepEqual(await readGateConfig(f.project), { rules: [], error: null, jev: { enabled: false }, jevError: null });
  const configFile = path.join(f.project, 'workflow-gate.json');
  await writeFile(configFile, '{"pathRules":');
  let config = await readGateConfig(f.project);
  assert.deepEqual(config.rules, []);
  assert.match(config.error, /不是有效 JSON/);
  await writeFile(configFile, JSON.stringify({ pathRules: { security: ['src/**'], other: ['x'] } }));
  config = await readGateConfig(f.project);
  assert.deepEqual(config.rules, []);
  assert.match(config.error, /未知分类/);
  await writeFile(configFile, JSON.stringify({ schemaVersion: 1, pathRules: { security: ['src/**', 'src/**'], migration: ['src/store.mjs', 'src/**'] } }));
  config = await readGateConfig(f.project);
  assert.deepEqual(config.rules, [{ category: 'security', glob: 'src/**' }, { category: 'migration', glob: 'src/store.mjs' }]);
  // 声明目录时，目录本身、目录下文件以及该目录内各类规则都算命中；绝对路径、父级路径不参与。
  const hits = pathRuleHits(['src', 'src/a.mjs', './src/b.mjs', '../x', 'C:/x', 'docs'], config.rules);
  assert.deepEqual(hits.filter(hit => hit.path !== 'src').map(hit => hit.path), ['src/a.mjs', 'src/b.mjs']);
  assert.deepEqual(hits.filter(hit => hit.path === 'src').map(hit => hit.category).sort(), ['migration', 'security']);
  // 同一分类下两个 glob 命中同一文件时只保留首次命中，提醒文案不重复。
  const duplicate = pathRuleHits(['src/a.mjs'], [{ category: 'security', glob: 'src/*.mjs' }, { category: 'security', glob: 'src/**' }]);
  assert.deepEqual(duplicate, [{ path: 'src/a.mjs', category: 'security', glob: 'src/*.mjs' }]);
});

test('gateApplies 判定与时间锚点：复杂写入任务生效，简单/历史/只读/计划/operation-only 跳过', () => {
  assert.equal(gateApplies({ size: 'complex', route: 'delegated', permissions: { mode: 'write' } }), true);
  assert.equal(gateApplies({ size: 'complex', route: 'lead-direct', permissions: { mode: 'write' } }), true);
  assert.equal(gateApplies({ size: 'simple', route: 'lead-direct', permissions: { mode: 'write' } }), false);
  assert.equal(gateApplies({ route: 'delegated', permissions: { mode: 'write' } }), false);
  assert.equal(gateApplies({ size: 'complex', route: 'operation-only', permissions: { mode: 'read-only' } }), false);
  assert.equal(gateApplies({ size: 'complex', route: 'delegated', permissions: { mode: 'read-only' } }), false);
  assert.equal(gateApplies({ size: 'complex', route: 'delegated', permissions: { mode: 'plan' } }), false);
  const task = { createdAt: '2026-01-01T00:00:00.000Z', updates: [{ at: '2026-01-02T00:00:00.000Z' }], changes: [], preparationUpdates: [{ at: '2026-01-03T00:00:00.000Z' }] };
  assert.equal(lastChangeAt(task), '2026-01-03T00:00:00.000Z');
  assert.ok(consultationMatches([{ taskId: 't', at: '2026-01-03T00:00:00.000Z' }], { taskId: 't', since: '2026-01-03T00:00:00.000Z' }));
  assert.equal(consultationMatches([{ taskId: 't', at: '2026-01-02T00:00:00.000Z' }], { taskId: 't', since: '2026-01-03T00:00:00.000Z' }), null);
  assert.equal(consultationMatches([{ taskId: 'x', at: '2026-01-04T00:00:00.000Z' }], { taskId: 't' }), null);
});

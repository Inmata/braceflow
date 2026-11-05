// R2 中 6：真实 CLI signal → PostToolUse 协议 → roleTaskId 绑定；不直接注入 roleTaskId。
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { sessionKey, taskKey } from '../src/protocol.mjs';
import { mutate, readState } from '../src/store.mjs';
import { cli, consult, emit, entry, event, fixture } from './helpers.mjs';

const planPath = 'docs/plans/r2-role-claim.md';
function build(f, action, args, session = f) {
  return cli(['signal', action, '--state-dir', f.directory, '--root', f.project, '--session', session.sessionId, '--turn', session.turnId, ...args]);
}
const quote = value => /\s/.test(value) ? `"${value}"` : value;
async function accept(f, action, args, session = f) {
  const run = build(f, action, args, session);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const command = `node "${entry}" signal ${action} --session ${session.sessionId} --turn ${session.turnId} ${args.map(quote).join(' ')}`;
  const output = await event({ ...f, sessionId: session.sessionId, turnId: session.turnId }, 'PostToolUse', {
    tool_name: 'Bash', tool_input: { command }, tool_response: { output: run.stdout },
  });
  const text = output.hookSpecificOutput?.additionalContext;
  assert.ok(text?.startsWith('workflow 回执：'), JSON.stringify(output));
  return JSON.parse(text.slice('workflow 回执：'.length));
}
const sessionStored = async (f, id) => (await readState(f.directory)).sessions[sessionKey(f.projectId, id)];
const writeEvent = (f, sessionId) => event({ ...f, sessionId, turnId: `${sessionId}-turn` }, 'PreToolUse', {
  tool_name: 'Write', tool_input: { file_path: path.join(f.project, 'src', 'a.mjs'), content: 'x' },
});

test('R2 真实 CLI role-claim 按 --task 绑定；两个活动任务的同名 W1 不串写，未绑定旧声明不可写', async () => {
  const f = await fixture();
  await mkdir(path.dirname(path.join(f.project, planPath)), { recursive: true });
  await writeFile(path.join(f.project, planPath), '# 角色绑定计划\n\n## 实施步骤\n\n1. 按包实施。\n');
  const preparation = {
    size: 'complex',
    sizeReason: '两个活动任务共享同名包，需要显式父子绑定',
    requirements: [{ id: 'A01', summary: '绑定正确任务', acceptance: ['同名包不串写'], packages: ['W1'], verification: 'node --test test/role-claim-e2e.test.mjs' }],
    research: [{ source: '本仓 protocol.mjs', conclusion: '按 roleTaskId 查找' }],
    solution: { summary: 'role-claim 必须带父任务', decisions: [{ decision: '禁止按包 ID 首匹配', reason: '避免跨任务写入' }] },
    packages: [{ packageId: 'W1', role: 'worker', agent: 'Claude Code', channel: 'builtin:agent', scope: 'src/a.mjs', delivers: '可验证实现', dependsOn: [] }],
    verification: ['node --test test/role-claim-e2e.test.mjs'],
    confirmation: { scope: ['方案', '分包', 'Agent'], basis: '用户确认本会话使用 Claude Code' },
    pending: [],
    source: { path: planPath },
  };
  const lead2 = { sessionId: 'lead-2', turnId: 'lead-2-turn' };
  await event({ ...f, ...lead2 }, 'UserPromptSubmit');
  await consult(f);
  await consult({ ...f, ...lead2 });
  assert.equal((await emit(f, { action: 'prepare', preparation })).result.accepted, true);
  assert.equal((await emit({ ...f, ...lead2 }, { action: 'prepare', preparation })).result.accepted, true);
  assert.equal((await emit(f, { action: 'task-start', goal: '任务一', route: 'delegated', permissions: { mode: 'write', allowedPaths: ['src/a.mjs'] } })).result.accepted, true);
  assert.equal((await emit({ ...f, ...lead2 }, { action: 'task-start', taskId: 'task-2', goal: '任务二', route: 'delegated', permissions: { mode: 'write', allowedPaths: ['src/a.mjs'] } })).result.accepted, true);
  const pkg = { packageId: 'W1', role: 'worker', status: 'dispatched', agent: 'Claude Code', channel: 'builtin:agent', scope: 'src/a.mjs' };
  assert.equal((await emit(f, { action: 'packages', packages: [pkg] })).result.accepted, true);
  assert.equal((await emit({ ...f, ...lead2 }, { action: 'packages', taskId: 'task-2', packages: [pkg] })).result.accepted, true);
  const state = await readState(f.directory);
  assert.equal(state.tasks[taskKey(f.projectId, 'task-1')].lifecycle, 'active');
  assert.equal(state.tasks[taskKey(f.projectId, 'task-2')].lifecycle, 'active');

  // 真实 CLI 声明 → Post 协议持久化 roleTaskId。
  const worker1 = { sessionId: 'worker-one', turnId: 'worker-one-turn' };
  await event({ ...f, ...worker1 }, 'UserPromptSubmit');
  const claimed1 = await accept(f, 'role-claim', ['--id', 'claim-one', '--role', 'worker', '--package', 'W1', '--task', 'task-1'], worker1);
  assert.equal(claimed1.accepted, true, JSON.stringify(claimed1));
  assert.equal((await sessionStored(f, 'worker-one')).roleTaskId, 'task-1');
  assert.deepEqual(await writeEvent(f, 'worker-one'), {});

  // task-1 的 W1 结束；task-2 的同名 W1 仍 dispatched，不能被 roleTaskId 串用。
  assert.equal((await emit(f, { action: 'packages', taskId: 'task-1', packages: [{ packageId: 'W1', status: 'consumed' }] })).result.accepted, true);
  const stale = await writeEvent(f, 'worker-one');
  assert.equal(stale.hookSpecificOutput?.permissionDecision, 'deny', JSON.stringify(stale));
  assert.match(stale.hookSpecificOutput.permissionDecisionReason, /不是 dispatched/);

  const worker2 = { sessionId: 'worker-two', turnId: 'worker-two-turn' };
  await event({ ...f, ...worker2 }, 'UserPromptSubmit');
  const claimed2 = await accept(f, 'role-claim', ['--id', 'claim-two', '--role', 'worker', '--package', 'W1', '--task', 'task-2'], worker2);
  assert.equal(claimed2.accepted, true, JSON.stringify(claimed2));
  assert.equal((await sessionStored(f, 'worker-two')).roleTaskId, 'task-2');
  assert.deepEqual(await writeEvent(f, 'worker-two'), {});

  // 省略 --task 的旧写法由 CLI 拒绝，不生成 claim-* 未绑定声明。
  const worker3 = { sessionId: 'worker-three', turnId: 'worker-three-turn' };
  await event({ ...f, ...worker3 }, 'UserPromptSubmit');
  const unbound = build(f, 'role-claim', ['--id', 'claim-three', '--role', 'worker', '--package', 'W1'], worker3);
  assert.notEqual(unbound.status, 0);
  assert.match(unbound.stdout + unbound.stderr, /--task/);
  assert.equal((await sessionStored(f, 'worker-three')).role, undefined);

  // 升级前已存在、没有 roleTaskId 的声明仍可读，但写入被拒并提示带 --task 重新声明。
  await mutate(f.directory, async state => {
    state.sessions[sessionKey(f.projectId, 'worker-legacy')] = {
      projectId: f.projectId, sessionId: 'worker-legacy', taskId: null, turnId: 'worker-legacy-turn', ticket: 'legacy-ticket',
      interruptEpoch: 0, revision: 1, phase: 'unknown', permissionMode: 'default', receipts: {}, observed: {},
      role: 'worker', packageId: 'W1',
    };
  });
  const legacy = await writeEvent(f, 'worker-legacy');
  assert.equal(legacy.hookSpecificOutput?.permissionDecision, 'deny', JSON.stringify(legacy));
  assert.match(legacy.hookSpecificOutput.permissionDecisionReason, /没有绑定父任务.*--task/);
});

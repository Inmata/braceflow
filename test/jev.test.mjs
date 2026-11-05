// W3 jev 可选适配：用本地假 HTTP 服务模拟网关，验证关闭、命中、未命中、超时、拒连与坏响应。
// 全部走真实 PostToolUse 信号与真实咨询记录，不注入回执，也不复制门禁判断。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { readState } from '../src/store.mjs';
import { sessionKey } from '../src/protocol.mjs';
import { consult, emit, entry, event, fixture, identity } from './helpers.mjs';
import { JEV_TIMEOUT_MS } from '../src/jev.mjs';

const PLAN = 'docs/plans/jev.md';
const GOAL = 'jev 门禁任务';
const SCOPE = 'src/a.mjs';
const RISKY = '改写 hooks 的放行规则，让未开工写入也自动通过';

async function writePlan(f) {
  await mkdir(path.dirname(path.join(f.project, PLAN)), { recursive: true });
  await writeFile(path.join(f.project, PLAN), '# jev 计划\n\n## 实施步骤\n\n1. 实施并核对。\n');
}
function preparation() {
  return {
    size: 'complex',
    sizeReason: '涉及门禁与网络适配，需要独立审查',
    requirements: [{ id: 'A01', summary: '完整行为', acceptance: ['定向测试通过'], packages: ['W1'], verification: 'node --test' }],
    research: [{ source: '本仓 advisor-gate', conclusion: '复用现有咨询记录与门禁' }],
    solution: { summary: '在信号接受前用 jev 判断描述是否涉及重要决策', decisions: [{ decision: '失败按未命中处理', reason: '不阻断既有门禁' }] },
    packages: [
      { packageId: 'W1', role: 'worker', agent: 'Claude Code', channel: 'builtin:agent', scope: SCOPE, delivers: '完整行为', dependsOn: [] },
      { packageId: 'R1', role: 'reviewer', agent: 'Codex', channel: 'codeg:codex', scope: '审查 W1', delivers: '审查结论', dependsOn: ['W1'] },
    ],
    verification: ['node --test'],
    confirmation: { scope: ['方案', '分包'], basis: '用户确认' },
    pending: [],
    source: { path: PLAN },
  };
}
async function complexTask(f) {
  await writePlan(f);
  await consult(f);
  const prepared = await emit(f, { action: 'prepare', preparation: preparation() });
  assert.equal(prepared.result.accepted, true, JSON.stringify(prepared.result));
  const started = await emit(f, { action: 'task-start', goal: GOAL, route: 'delegated', permissions: { mode: 'write', allowedPaths: [SCOPE] } });
  assert.equal(started.result.accepted, true, JSON.stringify(started.result));
}
async function configure(f, jev) {
  await writeFile(path.join(f.project, 'workflow-gate.json'), JSON.stringify({ schemaVersion: 1, pathRules: { security: [], migration: [] }, jev }));
}
// 假网关：记录请求正文，按当前应答函数返回；超时场景用 neverRespond。
async function gateway(t, respond) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    respond(req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return { requests, url: `http://127.0.0.1:${server.address().port}/v1/systemone` };
}
const choice = (answer, consultProbability) => JSON.stringify({
  model: 'jev-1.14.0',
  answers: { escalate: { type: 'choice', choice: answer, confidence: 0.9, probabilities: { consult: consultProbability, routine: 1 - consultProbability } } },
  usage: { input_tokens: 10, output_tokens: 5 },
});
const reply = (res, body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(body); };
const packagesSignal = note => ({ action: 'packages', packages: [{ packageId: 'W1', role: 'worker', status: 'dispatched', agent: 'Claude Code', channel: 'builtin:agent', scope: SCOPE, note }] });
// 宿主只读/计划模式要随 PostToolUse 一起给出，才能验证“可信会话模式”而不是只改入口。
async function emitMode(f, value, permissionMode) {
  const payload = { ...await identity(f), taskId: f.taskId, signalId: `signal-${crypto.randomUUID()}`, ...value };
  const output = await event(f, 'PostToolUse', {
    permission_mode: permissionMode,
    tool_name: 'Bash',
    tool_input: { command: `node "${entry}" signal --base64 e30=` },
    tool_response: { output: JSON.stringify({ workflow_signal: payload }) },
  });
  const text = output.hookSpecificOutput?.additionalContext;
  assert.ok(text?.startsWith('workflow 回执：'), JSON.stringify(output));
  return { payload, result: JSON.parse(text.slice('workflow 回执：'.length)) };
}

test('jev 关闭或缺省时不发请求，信号结果不受影响', async t => {
  const fake = await gateway(t, (req, res) => reply(res, choice('consult', 0.99)));
  const f = await fixture();
  await complexTask(f);
  const accepted = await emit(f, packagesSignal(RISKY));
  assert.equal(accepted.result.accepted, true, JSON.stringify(accepted.result));
  assert.equal(accepted.result.jevNotice, undefined);
  assert.equal(fake.requests.length, 0);

  const g = await fixture();
  await complexTask(g);
  await configure(g, { enabled: false, endpoint: fake.url, model: 'typesafe/jev-latest' });
  const disabled = await emit(g, packagesSignal(RISKY));
  assert.equal(disabled.result.accepted, true, JSON.stringify(disabled.result));
  assert.equal(fake.requests.length, 0);
});

test('简单、只读、计划与 operation-only 场景不请求 jev', async t => {
  const fake = await gateway(t, (req, res) => reply(res, choice('consult', 0.99)));
  const config = { enabled: true, endpoint: fake.url, model: 'typesafe/jev-latest' };

  const simple = await fixture();
  await configure(simple, config);
  const simplePrepare = await emit(simple, { action: 'prepare', preparation: { size: 'simple', sizeReason: '只改文案', solution: { summary: RISKY } } });
  assert.equal(simplePrepare.result.accepted, true, JSON.stringify(simplePrepare.result));
  assert.equal(fake.requests.length, 0);

  for (const mode of ['read-only', 'plan']) {
    const f = await fixture();
    await configure(f, config);
    await event(f, 'UserPromptSubmit', { permission_mode: mode });
    const prepared = await emitMode(f, { action: 'prepare', preparation: { size: 'complex', sizeReason: '复杂准备', solution: { summary: RISKY } } }, mode);
    assert.equal(prepared.result.accepted, true, JSON.stringify(prepared.result));
  }
  assert.equal(fake.requests.length, 0);

  const operation = await fixture();
  await configure(operation, config);
  const started = await emit(operation, { action: 'task-start', goal: '只做操作', route: 'operation-only', permissions: { mode: 'read-only', allowedPaths: [] } });
  assert.equal(started.result.accepted, true, JSON.stringify(started.result));
  const operationPrepare = await emit(operation, { action: 'prepare', preparation: { size: 'complex', sizeReason: '复杂准备', solution: { summary: RISKY } } });
  assert.equal(operationPrepare.result.accepted, true, JSON.stringify(operationPrepare.result));
  assert.equal(fake.requests.length, 0);

  // 宿主为 default 时，活动任务自身声明的只读/计划权限同样阻止请求。
  for (const mode of ['read-only', 'plan']) {
    const f = await fixture();
    await configure(f, config);
    const started = await emit(f, { action: 'task-start', goal: `任务权限 ${mode}`, route: 'lead-direct', size: 'simple', sizeReason: `任务声明 ${mode}`, permissions: { mode, allowedPaths: [] } });
    assert.equal(started.result.accepted, true, JSON.stringify(started.result));
    const prepared = await emit(f, { action: 'prepare', preparation: { size: 'complex', sizeReason: '复杂准备', solution: { summary: RISKY } } });
    assert.equal(prepared.result.accepted, true, JSON.stringify(prepared.result));
  }
  assert.equal(fake.requests.length, 0);
});

test('task-update 的 jev 判断按更新后的模式：read-only/plan→write 请求，write→read-only 不请求', async t => {
  const fake = await gateway(t, (req, res) => reply(res, choice('consult', 0.95)));
  const config = { enabled: true, endpoint: fake.url, model: 'typesafe/jev-latest' };

  // read-only → write：当前任务权限为只读，但更新后是写入，必须送判。
  const readOnly = await fixture();
  await complexTask(readOnly);
  assert.equal((await emit(readOnly, { action: 'task-update', permissions: { mode: 'read-only' } })).result.accepted, true);
  await configure(readOnly, config);
  const readonlyPrep = (await readState(readOnly.directory)).sessions[sessionKey(readOnly.projectId, readOnly.sessionId)].preparation;
  const readonlyUpdate = {
    action: 'task-update',
    permissions: { mode: 'write' },
    preparation: { requirements: [{ ...readonlyPrep.requirements[0], acceptance: ['恢复写入后的验收'] }] },
    preparationReason: `用户确认：${RISKY}`,
    preparationTarget: { goal: GOAL, permissions: { mode: 'write', allowedPaths: [SCOPE] } },
  };
  const readonlyReminded = await emit(readOnly, readonlyUpdate);
  assert.equal(readonlyReminded.result.accepted, true, JSON.stringify(readonlyReminded.result));
  assert.match(readonlyReminded.result.reminders?.[0] || '', /jev 判断本次描述涉及重要决策/);
  assert.equal(fake.requests.length, 1);
  assert.equal(fake.requests[0].state.action, 'task-update');

  // plan → write：同样必须送判。
  const planned = await fixture();
  await complexTask(planned);
  assert.equal((await emit(planned, { action: 'task-update', permissions: { mode: 'plan' } })).result.accepted, true);
  await configure(planned, config);
  const planPrep = (await readState(planned.directory)).sessions[sessionKey(planned.projectId, planned.sessionId)].preparation;
  const planUpdate = {
    action: 'task-update',
    permissions: { mode: 'write' },
    preparation: { requirements: [{ ...planPrep.requirements[0], acceptance: ['计划转写入后的验收'] }] },
    preparationReason: `用户确认：${RISKY}`,
  };
  const planReminded = await emit(planned, planUpdate);
  assert.equal(planReminded.result.accepted, true, JSON.stringify(planReminded.result));
  assert.match(planReminded.result.reminders?.[0] || '', /jev 判断本次描述涉及重要决策/);
  assert.equal(fake.requests.length, 2);
  assert.equal(fake.requests[1].state.action, 'task-update');

  // write → read-only：更新后不再写入，不送判。
  const written = await fixture();
  await complexTask(written);
  await configure(written, config);
  const writePrep = (await readState(written.directory)).sessions[sessionKey(written.projectId, written.sessionId)].preparation;
  const downgrade = await emit(written, {
    action: 'task-update',
    permissions: { mode: 'read-only' },
    preparation: { requirements: [{ ...writePrep.requirements[0], acceptance: ['降为只读后的验收'] }] },
    preparationReason: `用户确认：${RISKY}`,
  });
  assert.equal(downgrade.result.accepted, true, JSON.stringify(downgrade.result));
  assert.equal(fake.requests.length, 2);
});

test('prepare 按会话当前活动任务核对权限，--task 指向其他或不存在 ID 也不请求 jev', async t => {
  const fake = await gateway(t, (req, res) => reply(res, choice('consult', 0.99)));
  const config = { enabled: true, endpoint: fake.url, model: 'typesafe/jev-latest' };
  for (const mode of ['read-only', 'plan']) {
    const f = await fixture();
    await complexTask(f);
    const downgraded = await emit(f, { action: 'task-update', permissions: { mode } });
    assert.equal(downgraded.result.accepted, true, JSON.stringify(downgraded.result));
    await configure(f, config);
    for (const taskId of ['other-task', 'missing-task']) {
      const prepared = await emit(f, { action: 'prepare', taskId, preparation: { size: 'complex', sizeReason: '复杂准备', solution: { summary: RISKY } } });
      assert.equal(prepared.result.accepted, true, JSON.stringify(prepared.result));
    }
  }
  assert.equal(fake.requests.length, 0);
});

test('jev 命中 packages 描述时只提醒一次，不阻断记账', async t => {
  const fake = await gateway(t, (req, res) => reply(res, choice('consult', 0.95)));
  const f = await fixture();
  await complexTask(f);
  await configure(f, { enabled: true, endpoint: fake.url, model: 'typesafe/jev-latest' });
  const reminded = await emit(f, packagesSignal(RISKY));
  assert.equal(reminded.result.accepted, true, JSON.stringify(reminded.result));
  assert.match(reminded.result.reminders?.[0] || '', /jev 判断本次描述涉及重要决策/);
  assert.equal(fake.requests.length, 1);
  assert.equal(fake.requests[0].model, 'typesafe/jev-latest');
  assert.equal(fake.requests[0].state.action, 'packages');
  assert.match(fake.requests[0].state.description, /改写 hooks/);
  assert.equal(fake.requests[0].questions.escalate.type, 'choice');
  // 同一任务同一键只提醒一次；jev 仍会判断，但不再提示。
  const repeated = await emit(f, packagesSignal(RISKY));
  assert.equal(repeated.result.accepted, true, JSON.stringify(repeated.result));
  assert.equal(repeated.result.reminders, undefined);

  // 本任务已有咨询记录时不提醒。
  const g = await fixture();
  await complexTask(g);
  await configure(g, { enabled: true, endpoint: fake.url, model: 'typesafe/jev-latest' });
  await consult(g, { taskId: g.taskId });
  const consulted = await emit(g, packagesSignal(RISKY));
  assert.equal(consulted.result.accepted, true, JSON.stringify(consulted.result));
  assert.equal(consulted.result.reminders, undefined);
});

test('jev 未命中时不要求咨询；判断只看 choice 与概率', async t => {
  const fake = await gateway(t, (req, res) => reply(res, choice('routine', 0.1)));
  const f = await fixture();
  await complexTask(f);
  await configure(f, { enabled: true, endpoint: fake.url, model: 'typesafe/jev-latest' });
  const accepted = await emit(f, packagesSignal(RISKY));
  assert.equal(accepted.result.accepted, true, JSON.stringify(accepted.result));
  assert.equal(accepted.result.jevNotice, undefined);
  assert.equal(fake.requests.length, 1);
});

test('task-update 的目标与理由送判，命中时只提醒且不改变更新结果', async t => {
  const fake = await gateway(t, (req, res) => reply(res, choice('consult', 0.9)));
  const f = await fixture();
  await complexTask(f);
  await configure(f, { enabled: true, endpoint: fake.url, model: 'typesafe/jev-latest' });
  const current = (await readState(f.directory)).sessions[sessionKey(f.projectId, f.sessionId)].preparation;
  const update = {
    action: 'task-update',
    preparation: { requirements: [{ ...current.requirements[0], acceptance: ['更新后的验收'] }] },
    preparationReason: `用户确认：${RISKY}`,
  };
  const reminded = await emit(f, update);
  assert.equal(reminded.result.accepted, true, JSON.stringify(reminded.result));
  assert.match(reminded.result.reminders?.[0] || '', /jev 判断本次描述涉及重要决策/);
  assert.equal(fake.requests[0].state.action, 'task-update');
  assert.match(fake.requests[0].state.description, /preparationReason/);
  // 已有本任务咨询记录时不再提醒，但更新照常接受。
  const g = await fixture();
  await complexTask(g);
  await configure(g, { enabled: true, endpoint: fake.url, model: 'typesafe/jev-latest' });
  await consult(g, { taskId: g.taskId });
  const currentG = (await readState(g.directory)).sessions[sessionKey(g.projectId, g.sessionId)].preparation;
  const accepted = await emit(g, {
    action: 'task-update',
    preparation: { requirements: [{ ...currentG.requirements[0], acceptance: ['已咨询后的验收'] }] },
    preparationReason: `用户确认：${RISKY}`,
  });
  assert.equal(accepted.result.accepted, true, JSON.stringify(accepted.result));
  assert.equal(accepted.result.reminders, undefined);
});

test('prepare 的复杂方案摘要会送判；有本会话记录时通过', async t => {
  const fake = await gateway(t, (req, res) => reply(res, choice('consult', 0.9)));
  const f = await fixture();
  await writePlan(f);
  await consult(f);
  await configure(f, { enabled: true, endpoint: fake.url, model: 'typesafe/jev-latest' });
  const prepared = await emit(f, { action: 'prepare', preparation: preparation() });
  assert.equal(prepared.result.accepted, true, JSON.stringify(prepared.result));
  assert.equal(fake.requests[0].state.action, 'prepare');
  assert.match(fake.requests[0].state.description, /solution\.summary/);
});

test('prepare 命中只提醒一次：同一会话连续 prepare 不再提示，也不阻断保存', async t => {
  const fake = await gateway(t, (req, res) => reply(res, choice('consult', 0.9)));
  const f = await fixture();
  await writePlan(f);
  await configure(f, { enabled: true, endpoint: fake.url, model: 'typesafe/jev-latest' });
  const first = await emit(f, { action: 'prepare', preparation: preparation() });
  assert.equal(first.result.accepted, true, JSON.stringify(first.result));
  assert.match(first.result.reminders?.[0] || '', /jev 判断本次描述涉及重要决策/);
  assert.equal(fake.requests.length, 1);
  const second = await emit(f, { action: 'prepare', preparation: preparation() });
  assert.equal(second.result.accepted, true, JSON.stringify(second.result));
  assert.equal(second.result.reminders, undefined);
  assert.equal(fake.requests.length, 2);
});

test('超时按未命中处理，首次提示一次且跨回合不重复；提示不改变信号结果', async t => {
  const fake = await gateway(t, () => {});
  const f = await fixture();
  await complexTask(f);
  await configure(f, { enabled: true, endpoint: fake.url, model: 'typesafe/jev-latest' });
  const started = Date.now();
  const first = await emit(f, packagesSignal(RISKY));
  assert.equal(first.result.accepted, true, JSON.stringify(first.result));
  assert.match(first.result.jevNotice, /jev 检查未生效/);
  assert.ok(Date.now() - started >= JEV_TIMEOUT_MS - 100, '应等到 jev 超时');
  assert.equal((await readState(f.directory)).sessions[sessionKey(f.projectId, f.sessionId)].jevNotice.length > 0, true);

  // 新回合沿用同一会话标记：仍会调用网关，但不再重复提示。
  const next = { ...f, turnId: 'turn-2' };
  await event(next, 'UserPromptSubmit');
  Object.assign(f, next);
  const second = await emit(f, { action: 'packages', packages: [{ packageId: 'R1', role: 'reviewer', status: 'dispatched', agent: 'Codex', channel: 'codeg:codex', scope: '审查 W1' }] });
  assert.equal(second.result.accepted, true, JSON.stringify(second.result));
  assert.equal(second.result.jevNotice, undefined);
});

test('拒连按未命中处理并提示；不新增拒绝', async t => {
  const f = await fixture();
  await complexTask(f);
  await configure(f, { enabled: true, endpoint: 'http://127.0.0.1:1/v1/systemone', model: 'typesafe/jev-latest' });
  const accepted = await emit(f, packagesSignal(RISKY));
  assert.equal(accepted.result.accepted, true, JSON.stringify(accepted.result));
  assert.match(accepted.result.jevNotice, /jev 检查未生效/);
});

test('坏响应（非 JSON、缺答案、未知选项、非 2xx）按未命中处理并提示', async t => {
  for (const respond of [
    (req, res) => reply(res, 'not json'),
    (req, res) => reply(res, JSON.stringify({ model: 'x', usage: { input_tokens: 1, output_tokens: 1 } })),
    // 未在问题中声明的 choice 不能当成正常未命中。
    (req, res) => reply(res, JSON.stringify({ model: 'x', answers: { escalate: { type: 'choice', choice: 'maybe', confidence: 0.5, probabilities: { consult: 0.4, routine: 0.6 } } }, usage: { input_tokens: 1, output_tokens: 1 } })),
    (req, res) => reply(res, 'boom', 500),
  ]) {
    const fake = await gateway(t, respond);
    const f = await fixture();
    await complexTask(f);
    await configure(f, { enabled: true, endpoint: fake.url, model: 'typesafe/jev-latest' });
    const accepted = await emit(f, packagesSignal(RISKY));
    assert.equal(accepted.result.accepted, true, JSON.stringify(accepted.result));
    assert.match(accepted.result.jevNotice, /jev 检查未生效/);
  }
});

test('jev 配置写坏只让 jev 不生效并提示一次，不阻断信号', async t => {
  const f = await fixture();
  await complexTask(f);
  await configure(f, { enabled: true, model: 'typesafe/jev-latest' });
  const accepted = await emit(f, packagesSignal(RISKY));
  assert.equal(accepted.result.accepted, true, JSON.stringify(accepted.result));
  assert.match(accepted.result.jevNotice, /endpoint/);
});

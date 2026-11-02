import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { digest, readState } from '../src/store.mjs';
import { getContext } from '../src/context.mjs';
import { agentBaseWords, normalizePreparation, preparationMissing, preparationSnapshot, preparationSnapshotSignature, preparationSummary, resolvePlanPath, sameBaseAgent } from '../src/preparation.mjs';
import { cli, emit, entry, event, fixture } from './helpers.mjs';

const PLAN_PATH = 'docs/plans/preparation-demo.md';
const PLAN_TEXT = `# 示例计划

## 实施步骤

1. 保存准备记录。
2. 从另一台空白状态恢复同一安排。

## Agent 选择表

| 包 | Agent |
| --- | --- |
| W1 | Claude Code |
| R1 | Codex |
`;
async function writePlan(f, text = PLAN_TEXT) {
  const file = path.join(f.project, PLAN_PATH);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}
function preparation(overrides = {}) {
  return {
    size: 'complex',
    sizeReason: '涉及协议、文档和测试，需要独立审查',
    requirements: [
      { id: 'A01', summary: '准备结果可以保存', acceptance: ['缺少 Agent 时返回具体字段', '准备期不创建业务任务'], packages: ['W1'], verification: 'node --test test/preparation.test.mjs' },
      { id: 'A02', summary: '空白状态按计划恢复', acceptance: ['同一计划得到相同的包和 Agent 选择'], packages: ['W1'], verification: '同一计划在两个空白状态目录重放' },
    ],
    research: [
      { source: '本仓 protocol.mjs', conclusion: '复用现有身份、事务和回执，不新增第四种 route', url: 'https://example.invalid/protocol' },
    ],
    solution: {
      summary: '新增 prepare 信号和准备记录，准备期只写会话记录',
      decisions: [
        { decision: '准备记录保存在会话上', reason: '尚无业务任务时需要独立于任务账本' },
        { decision: '由 Lead 从 Markdown 整理结构化记录', reason: '避免实现通用 Markdown 解析器' },
      ],
      tradeoffs: ['程序只核对结构，内容正确性仍由 Lead 和 Reviewer 判断'],
      assumptions: ['用户已确认分包的 Agent 选择写在计划正文'],
    },
    packages: [
      { packageId: 'W1', role: 'worker', agent: 'Claude Code', channel: 'builtin:agent', scope: 'src/preparation.mjs 与文档', delivers: '准备记录可保存并可从计划恢复', dependsOn: [], verification: 'node --test test/preparation.test.mjs' },
      { packageId: 'R1', role: 'reviewer', agent: 'Codex', channel: 'codeg:codex', scope: '独立审查 W1', delivers: '对 W1 的独立审查结论', dependsOn: ['W1'], verification: '读取 W1 交付与测试结果' },
    ],
    verification: ['node --test test/preparation.test.mjs test/signal.test.mjs test/context.test.mjs'],
    confirmation: { scope: ['需求', '方案', '分包', '逐包 Agent 与通道'], basis: '用户 2026-11-01：执行计划，W1 用 Claude Code，R1 用 Codex' },
    pending: [],
    source: { path: PLAN_PATH, sections: ['实施步骤', 'Agent 选择表'] },
    ...overrides,
  };
}
function build(f, args) {
  return cli(['signal', 'prepare', '--state-dir', f.directory, '--root', f.project, '--session', f.sessionId, '--turn', f.turnId, ...args]);
}
async function accept(f, args) {
  const run = build(f, args);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const command = `node "${entry}" signal prepare --session ${f.sessionId} --turn ${f.turnId} --id ${args[args.indexOf('--id') + 1]}`;
  const output = await event(f, 'PostToolUse', { tool_name: 'Bash', tool_input: { command }, tool_response: { output: run.stdout } });
  const text = output.hookSpecificOutput?.additionalContext;
  assert.ok(text?.startsWith('workflow 回执：'), JSON.stringify(output));
  return { payload: JSON.parse(run.stdout).workflow_signal, receipt: JSON.parse(text.slice('workflow 回执：'.length)) };
}
async function prepareJson(f, value, name) {
  const file = path.join(f.area, name);
  await writeFile(file, JSON.stringify({ preparation: value }));
  return file;
}
const stored = async f => Object.values((await readState(f.directory)).sessions).find(item => item.sessionId === f.sessionId);

test('prepare 通过真实 PostToolUse 保存准备记录，来源计划摘要可追溯，且不创建任务或工作包', async () => {
  const f = await fixture();
  await writePlan(f);
  const input = preparation();
  delete input.source;
  const file = await prepareJson(f, input, 'prep.json');
  const sent = await accept(f, ['--id', 'prep-1', '--input', file, '--plan', PLAN_PATH, '--sections', '实施步骤,Agent 选择表']);
  assert.equal(sent.receipt.accepted, true, JSON.stringify(sent.receipt));
  assert.equal(sent.receipt.ready, true, JSON.stringify(sent.receipt));
  assert.deepEqual(sent.receipt.missing, []);
  assert.equal(sent.payload.taskId, 'preparation');
  assert.equal(sent.payload.preparation.source.path, PLAN_PATH);
  assert.equal(sent.receipt.preparation.source.path, PLAN_PATH);
  assert.equal(sent.receipt.preparation.source.digest, digest(PLAN_TEXT));
  // 准备期不制造执行任务，也不把草案当已派工。
  const state = await readState(f.directory);
  assert.equal(Object.keys(state.tasks).length, 0);
  const session = await stored(f);
  assert.equal(session.taskId, null);
  assert.equal(session.phase, 'unknown');
  assert.equal(session.preparation.source.digest, digest(PLAN_TEXT));
  assert.equal(session.revisionReason, '信号 prepare');
});

test('缺 Agent 的计划仍可保存为草案，回执按包和字段点名缺项；补齐后转为 ready', async () => {
  const f = await fixture();
  await writePlan(f);
  const draft = preparation();
  draft.packages[1].agent = '';
  const file = await prepareJson(f, draft, 'draft.json');
  const saved = await accept(f, ['--id', 'prep-draft', '--input', file]);
  assert.equal(saved.receipt.accepted, true, JSON.stringify(saved.receipt));
  assert.equal(saved.receipt.ready, false);
  assert.deepEqual(saved.receipt.missing, ['package:R1:agent']);
  assert.deepEqual(saved.receipt.preparation.messages, ['工作包 R1 尚未指定 Agent']);
  assert.equal((await stored(f)).preparation.packages[1].agent, '');
  const fixed = await prepareJson(f, preparation(), 'fixed.json');
  const ready = await accept(f, ['--id', 'prep-ready', '--input', fixed]);
  assert.equal(ready.receipt.accepted, true, JSON.stringify(ready.receipt));
  assert.equal(ready.receipt.ready, true);
  assert.deepEqual(ready.receipt.missing, []);
});

test('复杂任务缺少逐包实际调用通道时返回 package:ID:channel；简单任务不要求', async () => {
  const f = await fixture();
  await writePlan(f);
  const draft = preparation();
  draft.packages[0].channel = '';
  draft.packages[1].channel = '';
  const saved = await accept(f, ['--id', 'prep-channel', '--input', await prepareJson(f, draft, 'channel.json')]);
  assert.equal(saved.receipt.accepted, true, JSON.stringify(saved.receipt));
  assert.equal(saved.receipt.ready, false);
  assert.deepEqual(saved.receipt.missing, ['package:W1:channel', 'package:R1:channel']);
  assert.deepEqual(saved.receipt.preparation.messages, ['工作包 W1 尚未填写实际调用通道', '工作包 R1 尚未填写实际调用通道']);
  const context = await getContext(f.directory, f.project, 'lead', f.sessionId);
  assert.deepEqual(context.preparation.missing, ['package:W1:channel', 'package:R1:channel']);
  assert.match(context.instruction, /工作包 W1 尚未填写实际调用通道/);
  // 简单任务不要求分包，也不因没有通道而失败。
  const simple = normalizePreparation({ size: 'simple', sizeReason: '只改一处文案' }, {});
  assert.deepEqual(preparationMissing(simple), []);
});

test('同一角色的不同包保留各自的 Agent 选择，不按角色套用默认值', () => {
  const record = normalizePreparation(preparation({
    packages: [
      { packageId: 'W1', role: 'worker', agent: 'Claude Code', channel: 'builtin:agent', scope: 'a', delivers: 'A', dependsOn: [] },
      { packageId: 'W2', role: 'worker', agent: 'Codex', channel: 'builtin:agent', scope: 'b', delivers: 'B', dependsOn: ['W1'] },
      { packageId: 'R1', role: 'reviewer', agent: 'Claude Code', channel: 'codeg:claude_code', scope: 'c', delivers: 'C', dependsOn: ['W2'] },
    ],
  }), {});
  assert.deepEqual(preparationSummary(record).packages.map(item => [item.packageId, item.role, item.agent, item.channel]), [
    ['W1', 'worker', 'Claude Code', 'builtin:agent'],
    ['W2', 'worker', 'Codex', 'builtin:agent'],
    ['R1', 'reviewer', 'Claude Code', 'codeg:claude_code'],
  ]);
  assert.deepEqual(preparationMissing(record), []);
});

test('复杂需求必须分配到已登记的实施包并写明检查入口，缺项按需求 ID 返回', () => {
  const missingOwner = preparation({ requirements: [{ id: 'A01', summary: '整项需求', acceptance: ['可检查'] }] });
  assert.deepEqual(preparationMissing(normalizePreparation(missingOwner, {})).map(item => item.field), [
    'requirement:A01:packages',
    'requirement:A01:verification',
  ]);
  const unknownOwner = preparation({ requirements: [{ id: 'A01', summary: '整项需求', acceptance: ['可检查'], packages: ['W9'], verification: 'npm test' }] });
  assert.deepEqual(preparationMissing(normalizePreparation(unknownOwner, {})).map(item => item.field), ['requirement:A01:packages']);
  // 审查包不交付需求，不能当成负责实施包。
  const reviewerOnly = preparation({ requirements: [{ id: 'A01', summary: '整项需求', acceptance: ['可检查'], packages: ['R1'], verification: 'npm test' }] });
  assert.deepEqual(preparationMissing(normalizePreparation(reviewerOnly, {})).map(item => item.field), ['requirement:A01:packages']);
  // 简单任务不要求需求矩阵。
  assert.deepEqual(preparationMissing(normalizePreparation({ size: 'simple', sizeReason: '只改文案' }, {})), []);
});

test('需求与验收句子的无意义顺序不构成实际变化，签名只比较归一化内容', () => {
  const record = normalizePreparation(preparation(), {});
  const snapshot = preparationSnapshot(record);
  const reversed = {
    ...structuredClone(snapshot),
    requirements: [...snapshot.requirements].reverse().map(item => ({
      ...item,
      acceptance: [...item.acceptance].reverse(),
      packages: [...item.packages].reverse(),
    })),
  };
  assert.equal(preparationSnapshotSignature(snapshot), preparationSnapshotSignature(reversed));
  const changed = structuredClone(snapshot);
  changed.requirements[0].verification = '另一个检查入口';
  assert.notEqual(preparationSnapshotSignature(snapshot), preparationSnapshotSignature(changed));
});

test('旧版普通 Markdown 可由 Lead 整理后绑定；换状态目录后用同一计划和输入恢复相同安排，不依赖原会话身份', async () => {
  const first = await fixture();
  const second = await fixture();
  await writePlan(first);
  await writePlan(second);
  const one = await accept(first, ['--id', 'prep-old', '--input', await prepareJson(first, preparation(), 'old.json')]);
  const two = await accept(second, ['--id', 'prep-old', '--input', await prepareJson(second, preparation(), 'old.json')]);
  assert.equal(one.receipt.accepted && two.receipt.accepted, true);
  assert.equal(one.receipt.ready, true);
  assert.equal(two.receipt.ready, true);
  const savedFirst = (await stored(first)).preparation;
  const savedSecond = (await stored(second)).preparation;
  // preparedAt 是本次保存时间；安排、来源摘要和逐包选择必须一致。
  for (const record of [savedFirst, savedSecond]) delete record.preparedAt;
  assert.deepEqual(savedFirst, savedSecond);
  assert.deepEqual(one.receipt.preparation.packages, two.receipt.preparation.packages);
  assert.equal(savedFirst.source.digest, digest(PLAN_TEXT));
  assert.notEqual(first.projectId, second.projectId);
});

test('简单任务只要求声明理由；复杂任务未填理由时回到需求澄清步骤', async () => {
  const simple = normalizePreparation({ size: 'simple', sizeReason: '只改一处文案，影响很小' }, {});
  assert.deepEqual(preparationMissing(simple), []);
  assert.equal(preparationSummary(simple).step, 'complete');
  const noReason = normalizePreparation({ size: 'simple' }, {});
  assert.deepEqual(preparationMissing(noReason).map(item => item.field), ['size:reason']);
  assert.equal(preparationSummary(noReason).step, 'requirements');
  const complex = normalizePreparation(preparation(), {});
  assert.equal(preparationSummary(complex).step, 'complete');
});

test('待决事项按阻塞缺项处理：其他字段齐全时也不能宣称 ready', async () => {
  const f = await fixture();
  await writePlan(f);
  const draft = preparation({ pending: ['关键方案取舍尚未确认'] });
  const saved = await accept(f, ['--id', 'prep-pending', '--input', await prepareJson(f, draft, 'pending.json')]);
  assert.equal(saved.receipt.accepted, true, JSON.stringify(saved.receipt));
  assert.equal(saved.receipt.ready, false);
  assert.deepEqual(saved.receipt.missing, ['pending:0']);
  assert.deepEqual(saved.receipt.preparation.messages, ['待决事项尚未确认：关键方案取舍尚未确认']);
  assert.equal(saved.receipt.preparation.step, 'requirements');
  const context = await getContext(f.directory, f.project, 'lead', f.sessionId);
  assert.equal(context.preparation.ready, false);
  assert.match(context.instruction, /待决事项尚未确认/);
  assert.doesNotMatch(context.instruction, /准备记录已齐/);
  // 简单任务的声明同样不能与未决事项并存；清空后才视为齐全。
  const simplePending = normalizePreparation({ size: 'simple', sizeReason: '只改一处文案', pending: ['是否替换文案尚未决定'] }, {});
  assert.deepEqual(preparationMissing(simplePending).map(item => item.field), ['pending:0']);
  const settled = await accept(f, ['--id', 'prep-settled', '--input', await prepareJson(f, preparation(), 'settled.json')]);
  assert.equal(settled.receipt.ready, true);
});

test('源计划须为项目内 Markdown：错误后缀被拒绝，旧版 .markdown 可正常绑定并计算摘要', async () => {
  const f = await fixture();
  await writePlan(f);
  const badFile = await prepareJson(f, preparation({ source: { path: 'package.json' } }), 'bad-source.json');
  const badRun = build(f, ['--id', 'prep-bad-source', '--input', badFile]);
  const badOutput = await event(f, 'PostToolUse', {
    tool_name: 'Bash',
    tool_input: { command: `node "${entry}" signal prepare --session ${f.sessionId} --turn ${f.turnId} --id prep-bad-source` },
    tool_response: { output: badRun.stdout },
  });
  const receipt = JSON.parse(badOutput.hookSpecificOutput.additionalContext.slice('workflow 回执：'.length));
  assert.equal(receipt.accepted, false);
  assert.equal(receipt.reason, 'PLAN');
  assert.match(receipt.message, /Markdown/);
  assert.equal((await stored(f)).preparation, undefined);

  // 旧版普通 Markdown 用带后缀的常见写法同样可以绑定，不必改成 .md。
  const legacyPath = 'docs/plans/legacy-plan.markdown';
  const legacyText = '# 旧版计划\n\n## 实施步骤\n\n1. 按已确认安排继续实施。\n';
  await mkdir(path.dirname(path.join(f.project, legacyPath)), { recursive: true });
  await writeFile(path.join(f.project, legacyPath), legacyText);
  const legacy = await accept(f, ['--id', 'prep-legacy', '--input', await prepareJson(f, preparation({ source: { path: legacyPath } }), 'legacy.json')]);
  assert.equal(legacy.receipt.accepted, true, JSON.stringify(legacy.receipt));
  assert.equal(legacy.receipt.ready, true);
  assert.equal(legacy.receipt.preparation.source.path, legacyPath);
  assert.equal(legacy.receipt.preparation.source.digest, digest(legacyText));
});

test('源计划的目录链接指向项目外时仍按项目边界拒绝', async t => {
  const f = await fixture();
  const outside = path.join(f.area, 'outside-plan');
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(outside, 'plan.md'), '# 项目外计划\n');
  try { await symlink(outside, path.join(f.project, 'linked-plan'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch { t.skip('当前平台/账户无法创建目录链接'); return; }
  const file = await prepareJson(f, preparation({ source: { path: 'linked-plan/plan.md' } }), 'linked-plan.json');
  const run = build(f, ['--id', 'prep-linked-plan', '--input', file]);
  const output = await event(f, 'PostToolUse', {
    tool_name: 'Bash',
    tool_input: { command: `node "${entry}" signal prepare --session ${f.sessionId} --turn ${f.turnId} --id prep-linked-plan` },
    tool_response: { output: run.stdout },
  });
  const receipt = JSON.parse(output.hookSpecificOutput.additionalContext.slice('workflow 回执：'.length));
  assert.equal(receipt.accepted, false);
  assert.equal(receipt.reason, 'PLAN');
  assert.match(receipt.message, /docs\/plans|项目内/);
  assert.equal((await stored(f)).preparation, undefined);
});

test('计划路径只接受 docs/plans 下合规 Markdown，空段与点段不参与归一', async () => {
  const f = await fixture();
  // 文件尚未创建时仍返回真实目标路径，供开工门禁放行“先写计划”。
  const missing = resolvePlanPath(f.project, PLAN_PATH);
  assert.equal(missing.error, undefined);
  assert.equal(missing.missing, true);
  assert.equal(path.basename(missing.realPath), 'preparation-demo.md');

  await writePlan(f);
  const existing = resolvePlanPath(f.project, PLAN_PATH);
  assert.equal(existing.error, undefined);
  assert.equal(existing.missing, undefined);
  assert.equal(existing.realPath, path.join(f.project, PLAN_PATH));

  const nested = resolvePlanPath(f.project, 'docs/plans/nested/deep.markdown');
  assert.equal(nested.error, undefined);
  assert.equal(nested.missing, true);

  for (const relative of ['docs/plans//plan.md', 'docs/plans/./plan.md', 'docs/plans/../plan.md', 'docs/other/plan.md', 'README.md']) {
    assert.equal(resolvePlanPath(f.project, relative).error, 'scope', relative);
  }
  assert.equal(resolvePlanPath(f.project, 'docs/plans/plan.txt').error, 'suffix');
  assert.equal(resolvePlanPath(f.project, path.join(f.project, PLAN_PATH)).error, 'scope');
});

test('基础 Agent 词根剥离括号与运行参数，只比较词序', () => {
  assert.deepEqual(agentBaseWords('Claude Code (group/worker[1m], high)'), ['claude', 'code']);
  assert.deepEqual(agentBaseWords('Claude Code --model opus --effort high'), ['claude', 'code']);
  assert.deepEqual(agentBaseWords('Claude Code -m opus'), ['claude', 'code']);
  assert.deepEqual(agentBaseWords('Codex（group/worker[1m], high）'), ['codex']);

  assert.equal(sameBaseAgent('Claude Code (group/worker[1m], high)', 'claude_code'), true);
  assert.equal(sameBaseAgent('Claude Code --model opus --effort high', 'Claude Code'), true);
  assert.equal(sameBaseAgent('Claude Code -m opus', 'claude code'), true);
  assert.equal(sameBaseAgent('Codex（group/worker[1m], high）', 'codex'), true);
  assert.equal(sameBaseAgent('Claude Code', 'Codex'), false);
  // 空名没有可比词根，不能因为“都为空”被判为同一 Agent。
  assert.equal(sameBaseAgent('', ''), false);
});

test('依赖未登记、绝对路径、未知顶层字段和缺失 preparation 都给出可定位拒绝', async () => {
  const f = await fixture();
  await writePlan(f);
  const badDependency = preparation();
  badDependency.packages[1].dependsOn = ['W9'];
  const dependency = await accept(f, ['--id', 'dep-1', '--input', await prepareJson(f, badDependency, 'dep.json')]);
  assert.equal(dependency.receipt.ready, false);
  assert.ok(dependency.receipt.missing.includes('package:R1:dependsOn'));
  assert.match(dependency.receipt.preparation.messages.join(' '), /W9/);

  // 以下拒绝用独立状态，确认失败不会留下任务或准备记录。
  const g = await fixture();
  await writePlan(g);
  const absolute = preparation({ source: { path: path.join(g.project, PLAN_PATH) } });
  const absoluteInput = await prepareJson(g, absolute, 'absolute.json');
  const rejected = build(g, ['--id', 'abs-1', '--input', absoluteInput]);
  const rejectedAccept = await event(g, 'PostToolUse', {
    tool_name: 'Bash',
    tool_input: { command: `node "${entry}" signal prepare --session ${g.sessionId} --turn ${g.turnId} --id abs-1` },
    tool_response: { output: rejected.stdout },
  });
  const text = rejectedAccept.hookSpecificOutput.additionalContext;
  const receipt = JSON.parse(text.slice('workflow 回执：'.length));
  assert.equal(receipt.accepted, false);
  assert.equal(receipt.reason, 'PLAN');

  const stray = await emit(g, { action: 'prepare', preparation: preparation(), packages: [] });
  assert.equal(stray.result.accepted, false, JSON.stringify(stray.result));
  assert.equal(stray.result.reason, 'PREPARATION');
  assert.match(stray.result.message, /packages/);

  const missing = build(g, ['--id', 'missing-1']);
  assert.equal(JSON.parse(missing.stdout).error, 'INPUT');
  const state = await readState(g.directory);
  assert.equal(Object.keys(state.tasks).length, 0);
  assert.equal((await stored(g)).preparation, undefined);
});

test('context 显示准备步骤、具体缺项和计划位置，并提供短入口提示；准备记录跨回合保留', async () => {
  const f = await fixture();
  await writePlan(f);
  const draft = preparation();
  draft.packages[1].agent = '';
  await accept(f, ['--id', 'prep-context', '--input', await prepareJson(f, draft, 'context.json')]);
  let context = await getContext(f.directory, f.project, 'lead', f.sessionId);
  assert.deepEqual(context.preparation.missing, ['package:R1:agent']);
  assert.equal(context.preparation.step, 'arrangement');
  assert.equal(context.preparation.source.path, PLAN_PATH);
  assert.match(context.instruction, /准备记录：当前在实施安排步骤/);
  assert.match(context.instruction, /工作包 R1 尚未指定 Agent/);
  assert.equal(context.ledger, undefined);
  // 新回合重建会话时仍保留准备记录，不要求重新整理或重问。
  f.turnId = 'turn-2';
  await event(f, 'UserPromptSubmit');
  context = await getContext(f.directory, f.project, 'lead', f.sessionId);
  assert.equal(context.preparation.missing[0], 'package:R1:agent');
  await accept(f, ['--id', 'prep-ready-context', '--input', await prepareJson(f, preparation(), 'ready.json')]);
  context = await getContext(f.directory, f.project, 'lead', f.sessionId);
  assert.equal(context.preparation.ready, true);
  assert.match(context.instruction, /准备记录已齐/);
  assert.match(context.instruction, /不等于已派工/);
  assert.equal(Object.keys((await readState(f.directory)).tasks).length, 0);
});

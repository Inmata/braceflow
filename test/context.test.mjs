import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cp, copyFile, lstat, mkdir, writeFile } from 'node:fs/promises';
import { isSignalInvocation } from '../src/hooks.mjs';
import { projectContext, signalUsage } from '../src/context.mjs';
import { cliPath } from '../src/entry.mjs';
import { renderEntry } from '../src/learning.mjs';
import { setLearningEnabled } from '../src/learning-config.mjs';
import { mutate } from '../src/store.mjs';
import { fixture, root, start, temporary } from './helpers.mjs';

// 测试独立给出期望，不复用生产实现里的引号函数。
const psQuote = value => `'${value.replaceAll("'", "''")}'`;

// 真实宿主里的两个 PowerShell 都验证；不把 pwsh 的结果冒充 Windows PowerShell 5.1。
function discover(name) {
  if (process.platform !== 'win32') return null;
  const probe = spawnSync(name, ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  if (probe.error || probe.status !== 0) return null;
  return { command: name, version: probe.stdout.trim() };
}
const SHELLS = ['powershell.exe', 'pwsh.exe'].map(discover).filter(Boolean);
const shellArgs = source => ['-NoProfile', '-NonInteractive', '-Command', source];
const shell = (item, source, options = {}) => spawnSync(item.command, shellArgs(source), { encoding: 'utf8', windowsHide: true, timeout: 30000, ...options });

// 复刻安装目录：只复制运行 context 所需的 bin/src/package.json。
// 目录名本身带子表达式和 $HOME，双引号模板会在这里被 PowerShell 展开或执行。
async function copyPlugin(area) {
  const plugin = path.join(area, '$(Set-Content canary-q-w-b.txt x)', '$HOME', 'plugin');
  await mkdir(path.dirname(plugin), { recursive: true });
  await cp(path.join(root, 'src'), path.join(plugin, 'src'), { recursive: true });
  await cp(path.join(root, 'bin'), path.join(plugin, 'bin'), { recursive: true });
  await copyFile(path.join(root, 'package.json'), path.join(plugin, 'package.json'));
  return plugin;
}
const parse = (text, label) => {
  try { return JSON.parse(text); } catch { assert.fail(`${label} 的输出不是 JSON：${JSON.stringify(text.slice(0, 400))}`); }
};
// 把 signalUsage 的模板替换成可直接执行的形式；--help 只验证入口路径能原样到达 Node。
function runnable(usage) {
  return usage.command
    .replace('<action>', '--help')
    .replace('<identity.sessionId>', 'session-1')
    .replace('<identity.turnId>', 'turn-1')
    .replace('<新 signalId>', 'signal-1');
}

test('signalUsage 用单引号字面量书写入口路径，不用可展开的双引号', () => {
  const cli = 'C:/Users/me/$(Set-Content canary-q-w-b.txt x)/$HOME/bin/workflow.mjs';
  const usage = signalUsage(cli);
  assert.ok(usage.command.startsWith(`node ${psQuote(cli)} signal `), usage.command);
  assert.ok(!usage.command.includes(`"${cli}"`), usage.command);
  for (const line of usage.examples) assert.ok(!line.includes(`"${cli}"`), line);
  // 单独直接调用、身份字段模板和 rule 仍保持原样，不引入 cd、组合命令或变量赋值。
  const templates = [usage.command, ...usage.examples, usage.fallback].join('\n');
  assert.doesNotMatch(templates, /\bcd\s|&&|;|\$wf=/);
  assert.match(usage.command, /--session <identity\.sessionId> --turn <identity\.turnId> --id <新 signalId>/);
});

test('signalUsage 生成的实际调用仍被宿主 PostToolUse 识别为单独直接调用', async () => {
  const entry = cliPath();
  const usage = signalUsage(entry);
  // 按用户复制后的样子填上身份和动作；命令里不再有占位符。
  const command = usage.command
    .replace('<action>', 'task-start')
    .replace('<identity.sessionId>', 'session-1')
    .replace('<identity.turnId>', 'turn-1')
    .replace('<新 signalId>', 'signal-1')
    .replace(/ \[字段参数\]$/, ' --task task-1 --route lead-direct');
  assert.equal(await isSignalInvocation({ tool_name: 'Bash', tool_input: { command } }, entry), true, command);
});

for (const item of SHELLS) {
  test(`${item.command} ${item.version}：安装路径含 $HOME/子表达式时公开 context 入口的命令安全可执行`, async t => {
    t.diagnostic(`shell=${item.command} version=${item.version}`);
    const area = await temporary('context-shell-');
    const plugin = await copyPlugin(area);
    const project = path.join(area, 'project');
    const state = path.join(area, 'state');
    await mkdir(project);
    await writeFile(path.join(project, 'README.md'), '# 项目\n');
    const entry = path.join(plugin, 'bin', 'workflow.mjs');
    const enable = spawnSync(process.execPath, [entry, 'project', 'enable', '--root', project, '--state-dir', state], { encoding: 'utf8', windowsHide: true, cwd: area });
    assert.equal(enable.status, 0, enable.stdout + enable.stderr);

    // 公开入口：hook 会给出 context，用户/代理从 signal.command 复制命令。
    const context = shell(item, `node ${psQuote(entry)} context --role lead --project ${psQuote(project)} --state-dir ${psQuote(state)}`, { cwd: area });
    const parsed = parse(context.stdout, item.command);
    assert.equal(parsed.enabled, true, JSON.stringify(parsed));
    const usage = parsed.signal;
    const literal = entry.replaceAll('\\', '/');
    assert.ok(usage.command.includes(psQuote(literal)), usage.command);
    assert.ok(!usage.command.includes(`"${literal}"`), usage.command);

    const executed = shell(item, runnable(usage), { cwd: area });
    assert.equal(executed.status, 0, executed.stderr || executed.stdout);
    assert.ok(executed.stdout.includes('"usage"'), executed.stdout);
    assert.equal(await lstat(path.join(area, 'canary-q-w-b.txt')).catch(() => null), null, '命令里的子表达式不能被执行');
  });
}

if (process.platform === 'win32' && !SHELLS.length) {
  test('未找到真实 PowerShell，上下文入口的命令安全未验证', { skip: 'powershell.exe 与 pwsh.exe 均不可用' }, () => {});
}

const standingEntry = (id, extra = {}) => ({
  schemaVersion: 1, id, generation: 1, title: id, summary: '通用经验 ' + id, conditions: '通用',
  type: 'method', importance: 'normal', status: 'active', scope: { paths: [], version: null },
  tags: [], evidence: [{ id: 'e1', incidentId: 'i1', kind: 'success', verified: true, createdAt: '2026-10-21T10:00:00Z', generation: 1 }],
  history: [], supersedes: null, maturity: 'stable', ...extra,
});
async function putKnowledge(f, value) {
  const folder = path.join(f.project, '.workflow', 'knowledge');
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, value.id + '.md'), renderEntry(value));
}
// 入口会持久化 contextKey；测试用真实 mutate 保存同一会话的重复注入状态。
async function contextOf(f, options = {}) {
  let output;
  await mutate(f.directory, async state => {
    output = await projectContext(state, { project: state.projects[f.projectId] }, 'lead', f.sessionId, { directory: f.directory, incremental: true, ...options });
  });
  return output;
}

test('R01 学习停用时即使残留知识也不注入常驻规则', async () => {
  const f = await fixture();
  await putKnowledge(f, standingEntry('K-residual', { importance: 'critical' }));
  const context = await contextOf(f);
  assert.equal('standing' in context, false, JSON.stringify(context));
});

test('R01 无任务入口只注入全局 stable/critical，排除路径、版本和退役条目', async () => {
  const f = await fixture();
  await setLearningEnabled(f.directory, f.project, true);
  await putKnowledge(f, standingEntry('K-stable'));
  await putKnowledge(f, standingEntry('K-critical', { importance: 'critical', maturity: 'unverified' }));
  await putKnowledge(f, standingEntry('K-important', { importance: 'important', maturity: 'verified' }));
  await putKnowledge(f, standingEntry('K-path', { importance: 'critical', scope: { paths: ['src/a.mjs'], version: null } }));
  await putKnowledge(f, standingEntry('K-version', { importance: 'critical', scope: { paths: [], version: '1.2.3' } }));
  await putKnowledge(f, standingEntry('K-retired', { importance: 'critical', status: 'retired' }));
  const { standing } = await contextOf(f);
  assert.deepEqual(standing.selected.map(item => item.id), ['K-critical', 'K-stable']);
  assert.equal(standing.total, 2);
  assert.ok(standing.chars > 0);
  for (const item of standing.selected) {
    assert.deepEqual({ seen: item.seen, incidents: item.incidents, dates: item.dates, lastSeen: item.lastSeen },
      { seen: 1, incidents: 1, dates: 1, lastSeen: '2026-10-21' });
  }
});

test('R01 常驻预算按条数和字符跳过，不截断正文', async () => {
  const f = await fixture();
  await setLearningEnabled(f.directory, f.project, true);
  await putKnowledge(f, standingEntry('A-large', { summary: '长'.repeat(1300) }));
  for (const id of ['B-small', 'C-small', 'D-small', 'E-small']) await putKnowledge(f, standingEntry(id));
  const { standing } = await contextOf(f);
  assert.deepEqual(standing.selected.map(item => item.id), ['B-small', 'C-small', 'D-small']);
  assert.ok(standing.chars <= 1200);
  assert.equal(standing.total, 5);
});

test('R01 contextKey 同时覆盖常驻版本与启用状态：版本变化或重新启用都会重新注入', async () => {
  const f = await fixture();
  await setLearningEnabled(f.directory, f.project, true);
  await putKnowledge(f, standingEntry('K-key', { summary: '第一版经验' }));
  const first = await contextOf(f);
  assert.deepEqual(first.standing.selected.map(item => item.id), ['K-key']);
  const second = await contextOf(f);
  assert.equal(second.standing.unchanged, true);
  await putKnowledge(f, standingEntry('K-key', { summary: '第二版经验，内容已变化' }));
  const third = await contextOf(f);
  assert.deepEqual(third.standing.selected.map(item => item.summary), ['第二版经验，内容已变化']);
  assert.notEqual(third.standing.version, first.standing.version);
  await setLearningEnabled(f.directory, f.project, false);
  const disabled = await contextOf(f);
  assert.equal('standing' in disabled, false);
  await setLearningEnabled(f.directory, f.project, true);
  const reenabled = await contextOf(f);
  assert.deepEqual(reenabled.standing.selected.map(item => item.id), ['K-key']);
});

test('R01 有活动任务时读取任务检索与常驻规则并按 ID 去重', async () => {
  const f = await fixture();
  await setLearningEnabled(f.directory, f.project, true);
  await putKnowledge(f, standingEntry('K-goal', { title: '隔离验证任务经验', summary: '隔离验证任务完成' }));
  await putKnowledge(f, standingEntry('K-other', { title: '全局规则', importance: 'critical' }));
  await start(f);
  const context = await contextOf(f);
  assert.deepEqual(context.knowledge.selected.map(item => item.id), ['K-goal']);
  assert.deepEqual(context.standing.selected.map(item => item.id), ['K-other']);
  assert.equal(context.knowledge.selected[0].seen, 1);
});

test('R01 常驻限额在排除任务已选 ID 后计算，后续候选可以补入', async () => {
  const f = await fixture();
  await setLearningEnabled(f.directory, f.project, true);
  for (const id of ['K-1', 'K-2', 'K-3']) {
    await putKnowledge(f, standingEntry(id, { title: '隔离验证任务经验 ' + id, summary: '隔离验证任务完成 ' + id }));
  }
  await putKnowledge(f, standingEntry('K-4', { title: '全局规则', summary: '全局通用规则' }));
  await start(f);
  const context = await contextOf(f);
  assert.equal(context.knowledge.selected.length, 3);
  assert.deepEqual(new Set(context.knowledge.selected.map(item => item.id)), new Set(['K-1', 'K-2', 'K-3']));
  assert.deepEqual(context.standing.selected.map(item => item.id), ['K-4']);
  assert.equal(context.standing.chars, context.standing.selected.reduce((total, item) => total + JSON.stringify(item).length, 0));
});

test('R01 活动任务下常驻坏文件仍给出降级提示', async () => {
  const f = await fixture();
  await setLearningEnabled(f.directory, f.project, true);
  await putKnowledge(f, standingEntry('K-good', { importance: 'critical' }));
  await writeFile(path.join(f.project, '.workflow', 'knowledge', 'K-bad.md'), '不是知识条目\n');
  await start(f);
  const context = await contextOf(f);
  assert.deepEqual(context.standing.selected.map(item => item.id), ['K-good']);
  assert.match(context.instruction, /常驻知识文件无法解析/);
});

test('R01 无活动任务时新增常驻坏文件会使版本变化并给出降级提示', async () => {
  const f = await fixture();
  await setLearningEnabled(f.directory, f.project, true);
  await putKnowledge(f, standingEntry('K-good', { importance: 'critical' }));
  const first = await contextOf(f);
  assert.deepEqual(first.standing.selected.map(item => item.id), ['K-good']);
  assert.doesNotMatch(first.instruction, /常驻知识(文件无法解析|读取失败|未读取)/);
  const second = await contextOf(f);
  assert.equal(second.standing.unchanged, true);
  await writeFile(path.join(f.project, '.workflow', 'knowledge', 'K-bad.md'), '不是知识条目\n');
  const third = await contextOf(f);
  assert.equal(third.standing.unchanged, undefined);
  assert.equal(third.standing.skippedTotal, 1);
  assert.deepEqual(third.standing.selected.map(item => item.id), ['K-good']);
  assert.match(third.instruction, /常驻知识文件无法解析/);
  assert.notEqual(third.standing.version, first.standing.version);
});

test('R01 常驻规则读取失败只降级提示，不影响入口', async () => {
  const f = await fixture();
  await setLearningEnabled(f.directory, f.project, true);
  await mkdir(path.join(f.project, '.workflow'), { recursive: true });
  await writeFile(path.join(f.project, '.workflow', 'knowledge'), '不是目录\n');
  const context = await contextOf(f);
  assert.equal(context.enabled, true);
  assert.equal(context.standing.unavailable.kind, 'io');
  assert.match(context.instruction, /常驻知识读取失败/);
});

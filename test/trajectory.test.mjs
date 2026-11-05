import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { buildTrajectory, decisionFile, hookInventory, readDecisions, recordDecision, writeTrajectoryFile } from '../src/trajectory.mjs';
import { deliver, fixture, start, temporary } from './helpers.mjs';

async function events(f, name, extra = {}) {
  const { handleHook } = await import('../src/hooks.mjs');
  return handleHook(f.directory, { hook_event_name: name, cwd: f.project, session_id: f.sessionId, turn_id: f.turnId, permission_mode: 'default', ...extra }, { synthetic: true });
}

test('PreToolUse 决定写入 decisions/<会话ID>.jsonl，规则编号和原因可见，判定输出不变', async () => {
  const f = await fixture();
  const allowed = await events(f, 'PreToolUse', { tool_name: 'Read', tool_input: { file_path: path.join(f.project, 'README.md') }, tool_use_id: 'tool-read', prompt_id: f.promptId });
  assert.deepEqual(allowed, {});
  const denied = await events(f, 'PreToolUse', {
    tool_name: 'Write',
    tool_input: { file_path: path.join(f.project, 'src', 'a.mjs'), content: 'x' },
    tool_use_id: 'tool-write',
    prompt_id: f.promptId,
  });
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(JSON.stringify(denied).includes('B08'), false, '规则编号只进决定记录，不进入宿主输出');

  const decisions = await readDecisions(f.directory, f.sessionId);
  assert.equal(decisions.records.length, 2);
  const read = decisions.records.find(record => record.toolUseId === 'tool-read');
  assert.equal(read.rule, 'A01');
  assert.equal(read.decision, 'allow');
  assert.equal(read.toolName, 'Read');
  assert.equal(read.turnId, f.promptId);
  const write = decisions.records.find(record => record.toolUseId === 'tool-write');
  assert.equal(write.rule, 'B08');
  assert.equal(write.decision, 'deny');
  assert.match(write.reason, /准备阶段|尚未保存准备记录/);
  assert.equal(decisions.writes.length, 2);
  assert.ok(decisions.writes.every(item => item.kind === 'write' && Number.isFinite(item.ms) && item.ms >= 0 && item.bytes > 0));
  assert.ok(decisions.bytes > 0);
  // 落盘统计行排在决定行之后，bytes 等于该决定行的实际字节数，ms 覆盖 mkdir 与 appendFile。
  const lines = (await readFile(decisionFile(f.directory, f.sessionId), 'utf8')).trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(lines.length, 4);
  for (let index = 0; index < lines.length; index += 2) {
    assert.equal(lines[index].kind, 'decision');
    assert.equal(lines[index + 1].kind, 'write');
    assert.equal(lines[index + 1].bytes, Buffer.byteLength(`${JSON.stringify(lines[index])}\n`));
  }
});

test('Stop 决定按 block/allow 记录；第二次 Stop 不重复阻挡', async () => {
  const f = await fixture();
  await start(f, { mode: 'plan', allowedPaths: [] });
  await deliver(f, 'delivered');
  const first = await events(f, 'Stop', { prompt_id: f.promptId });
  assert.equal(first.decision, 'block');
  const { records } = await readDecisions(f.directory, f.sessionId);
  const blocked = records.find(record => record.event === 'Stop');
  assert.equal(blocked.decision, 'block');
  assert.equal(blocked.rule, 'S11');
  assert.match(blocked.reason, /计划交付|task-end/);

  const second = await events(f, 'Stop', { prompt_id: f.promptId });
  assert.deepEqual(second, {});
  const after = (await readDecisions(f.directory, f.sessionId)).records.filter(record => record.event === 'Stop');
  assert.equal(after.at(-1).rule, 'S02');
  assert.equal(after.at(-1).decision, 'allow');
});

test('trajectory hooks 读用户级、项目级与本机设置，列出事件、匹配范围和覆盖程度', async () => {
  const area = await temporary();
  const configDir = path.join(area, 'claude');
  const project = path.join(area, 'project');
  await mkdir(configDir, { recursive: true });
  await mkdir(path.join(project, '.claude'), { recursive: true });
  await writeFile(path.join(configDir, 'settings.json'), JSON.stringify({
    hooks: {
      PreToolUse: [{ hooks: [{ type: 'command', command: 'node', args: ['C:/workflow/bin/workflow.mjs', 'hook', '--agent', 'claude'], timeout: 10 }] }],
      Stop: [{ hooks: [{ type: 'command', command: 'node', args: ['C:/workflow/bin/workflow.mjs', 'hook', '--agent', 'claude'] }] }],
    },
  }));
  await writeFile(path.join(project, '.claude', 'settings.json'), JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk', args: ['hook', 'claude'] }] }] },
  }));
  await writeFile(path.join(project, '.claude', 'settings.local.json'), JSON.stringify({
    hooks: { PostToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'echo', args: ['local'] }] }] },
  }));
  const inventory = await hookInventory({ root: project, configDir });
  assert.deepEqual(inventory.files.map(file => [file.source, file.exists]), [['user', true], ['project', true], ['local', true]]);
  assert.equal(inventory.hooks.length, 4);
  const workflow = inventory.hooks.filter(hook => hook.workflow);
  assert.equal(workflow.length, 2);
  assert.equal(workflow[0].coverage, 'all');
  const rtk = inventory.hooks.find(hook => hook.command === 'rtk');
  assert.deepEqual({ source: rtk.source, event: rtk.event, matcher: rtk.matcher, coverage: rtk.coverage }, { source: 'project', event: 'PreToolUse', matcher: 'Bash', coverage: 'filtered' });
  const local = inventory.hooks.find(hook => hook.source === 'local');
  assert.equal(local.event, 'PostToolUse');
  assert.equal(local.workflow, false);
});

async function trajectoryFixture() {
  const area = await temporary();
  const configDir = path.join(area, 'claude');
  const stateDir = path.join(area, 'state');
  const project = path.join(area, 'project');
  const sessionId = 'session-trajectory-1';
  const transcript = path.join(configDir, 'projects', 'C--proj', `${sessionId}.jsonl`);
  await mkdir(path.dirname(transcript), { recursive: true });
  await mkdir(path.join(project, '.claude'), { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await writeFile(path.join(configDir, 'settings.json'), JSON.stringify({
    hooks: {
      PreToolUse: [{ hooks: [{ type: 'command', command: 'node', args: ['C:/workflow/bin/workflow.mjs', 'hook', '--agent', 'claude'] }] }],
      Stop: [{ hooks: [{ type: 'command', command: 'node', args: ['C:/workflow/bin/workflow.mjs', 'hook', '--agent', 'claude'] }] }],
    },
  }));
  await writeFile(path.join(project, '.claude', 'settings.json'), JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk', args: ['hook', 'claude'] }] }] },
  }));
  const lines = [
    { type: 'user', promptId: 'turn-1', timestamp: '2026-11-05T00:00:00.000Z', cwd: project, version: '2.1.318', message: { role: 'user', content: [{ type: 'text', text: '列出目录' }] } },
    { type: 'assistant', timestamp: '2026-11-05T00:00:01.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tool-bash', name: 'Bash', input: { command: 'ls' } }] } },
    {
      type: 'attachment',
      timestamp: '2026-11-05T00:00:01.400Z',
      attachment: {
        type: 'hook_success', hookName: 'PreToolUse:Bash', hookEvent: 'PreToolUse', toolUseID: 'tool-bash',
        command: 'rtk hook claude', exitCode: 0, durationMs: 5,
        stdout: '{"hookSpecificOutput":{"hookEventName":"PreToolUse","updatedInput":{"command":"rtk ls"}}}\n',
      },
    },
    { type: 'user', timestamp: '2026-11-05T00:00:02.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-bash', content: 'a.txt' }] } },
    { type: 'assistant', timestamp: '2026-11-05T00:00:03.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tool-read', name: 'Read', input: { file_path: 'README.md' } }] } },
    { type: 'user', timestamp: '2026-11-05T00:00:04.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-read', content: '# 项目' }] } },
  ];
  await writeFile(transcript, `${lines.map(line => JSON.stringify(line)).join('\n')}\n`);
  const subagents = path.join(configDir, 'projects', 'C--proj', sessionId, 'subagents');
  await mkdir(subagents, { recursive: true });
  await writeFile(path.join(subagents, 'agent-abc.meta.json'), JSON.stringify({ agentType: 'workflow-explorer', description: '检索', toolUseId: 'tool-bash' }));
  await writeFile(path.join(subagents, 'agent-abc.jsonl'), [
    { type: 'assistant', timestamp: '2026-11-05T00:00:01.600Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'sub-tool-1', name: 'Grep', input: { pattern: 'x' } }] } },
    { type: 'user', timestamp: '2026-11-05T00:00:01.800Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'sub-tool-1', content: 'match' }] } },
  ].map(line => JSON.stringify(line)).join('\n') + '\n');
  await recordDecision(stateDir, {
    sessionId, event: 'PreToolUse', host: 'claude', rule: 'A01', decision: 'allow', reason: '与 workflow 判定无关的工具',
    toolUseId: 'tool-bash', toolName: 'Bash', turnId: 'turn-1', transcriptPath: transcript,
  });
  await recordDecision(stateDir, {
    sessionId, event: 'Stop', host: 'claude', rule: 'S11', decision: 'block', reason: 'workflow 回合结束核对：门禁缺项', turnId: 'turn-1',
  });
  return { area, configDir, stateDir, project, sessionId, transcript };
}

test('Trajectory 按工具调用组织：合并 tool_use_id 决定、Stop 归入回合、区分改写与未观察到', async () => {
  const f = await trajectoryFixture();
  const trajectory = await buildTrajectory({ stateDir: f.stateDir, configDir: f.configDir, sessionId: f.sessionId, host: 'claude' });
  assert.equal(trajectory.host.version, '2.1.318');
  assert.equal(trajectory.observability.transcript, true);
  assert.deepEqual(trajectory.observability.missing, []);
  assert.equal(trajectory.turns.length, 1);
  assert.equal(trajectory.turns[0].prompt, '列出目录');
  assert.equal(trajectory.turns[0].stop.rule, 'S11');
  assert.equal(trajectory.turns[0].stop.decision, 'block');

  const bash = trajectory.turns[0].toolCalls.find(call => call.toolUseId === 'tool-bash');
  assert.equal(bash.workflow.rule, 'A01');
  assert.ok(Number.isFinite(bash.workflow.writeMs) && bash.workflow.writeMs >= 0, '决定记录的落盘耗时挂在对应工具调用上');
  assert.equal(bash.status, 'rewritten');
  assert.deepEqual(bash.signals.includes('workflow-allow') && bash.signals.includes('rewritten'), true);
  assert.equal(bash.subagent.toolCalls[0].name, 'Grep');
  const read = trajectory.turns[0].toolCalls.find(call => call.toolUseId === 'tool-read');
  assert.equal(read.workflow, null);
  assert.equal(read.status, 'unobserved', '清单里有 hook 但记录里没有时不能写成放行');

  const workflowHook = trajectory.hooks.observation.find(item => item.workflow && item.event === 'PreToolUse');
  assert.equal(workflowHook.status, 'partial');
  assert.equal(workflowHook.observedCalls, 1);
  assert.equal(workflowHook.unobservedCalls, 1);
  const rtkHook = trajectory.hooks.observation.find(item => item.command === 'rtk');
  assert.equal(rtkHook.status, 'observed');
  assert.equal(rtkHook.observedCalls, 1);
  assert.equal(trajectory.summary.statuses.rewritten, 1);
  assert.equal(trajectory.summary.statuses.unobserved, 1);
  assert.equal(trajectory.decisions.records, 2);
  assert.equal(trajectory.decisions.writeRecords, 2);
  assert.ok(trajectory.decisions.bytes > 0);
  assert.ok(trajectory.decisions.msTotal >= 0);
  const writeTimes = (await readDecisions(f.stateDir, f.sessionId)).writes.map(item => item.ms);
  assert.equal(trajectory.decisions.msTotal, Math.round(writeTimes.reduce((sum, value) => sum + value, 0) * 1000) / 1000);
  assert.equal(trajectory.decisions.msMax, Math.round(Math.max(...writeTimes) * 1000) / 1000);
});

test('transcript 缺失或字段缺失时报不可观测，不猜值', async () => {
  const area = await temporary();
  const configDir = path.join(area, 'claude');
  const stateDir = path.join(area, 'state');
  const sessionId = 'session-missing';
  await mkdir(configDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await recordDecision(stateDir, {
    sessionId, event: 'PreToolUse', host: 'claude', rule: 'A01', decision: 'allow', reason: '无 transcript 的会话', toolUseId: 'tool-x', toolName: 'Read',
  });
  const trajectory = await buildTrajectory({ stateDir, configDir, sessionId, host: 'claude', root: area });
  assert.equal(trajectory.observability.transcript, false);
  assert.equal(trajectory.host.version, null);
  assert.ok(trajectory.observability.missing.includes('transcript'));
  assert.ok(trajectory.observability.missing.includes('hostVersion'));
  assert.deepEqual(trajectory.turns, []);
  assert.equal(trajectory.decisions.records, 1);
});

test('改写、退出码 3、ask、失败与超时分别标记，不互相冒充', async () => {
  const area = await temporary();
  const configDir = path.join(area, 'claude');
  const stateDir = path.join(area, 'state');
  const project = path.join(area, 'project');
  const sessionId = 'session-statuses';
  const transcript = path.join(configDir, 'projects', 'slug', `${sessionId}.jsonl`);
  await mkdir(path.dirname(transcript), { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await mkdir(configDir, { recursive: true });
  const call = (id, timestamp) => ({ type: 'assistant', timestamp, message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'ls' } }] } });
  const hook = (id, timestamp, attachment) => ({ type: 'attachment', timestamp, attachment: { hookName: 'PreToolUse:Bash', hookEvent: 'PreToolUse', toolUseID: id, ...attachment } });
  const lines = [
    { type: 'user', promptId: 'turn-1', timestamp: '2026-11-05T00:00:00.000Z', cwd: project, version: '2.1.318', message: { role: 'user', content: [{ type: 'text', text: '检查状态' }] } },
    call('tool-rewrite', '2026-11-05T00:00:01.000Z'),
    hook('tool-rewrite', '2026-11-05T00:00:01.100Z', { type: 'hook_success', command: 'rtk hook claude', exitCode: 3, stdout: '{"hookSpecificOutput":{"hookEventName":"PreToolUse","updatedInput":{"command":"rtk ls"}}}' }),
    call('tool-exit3', '2026-11-05T00:00:02.000Z'),
    hook('tool-exit3', '2026-11-05T00:00:02.100Z', { type: 'hook_success', command: 'rtk hook claude', exitCode: 3, stdout: '' }),
    call('tool-ask', '2026-11-05T00:00:03.000Z'),
    hook('tool-ask', '2026-11-05T00:00:03.100Z', { type: 'hook_success', command: 'asker', exitCode: 0, stdout: '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask"}}' }),
    call('tool-timeout', '2026-11-05T00:00:04.000Z'),
    hook('tool-timeout', '2026-11-05T00:00:04.100Z', { type: 'hook_timeout' }),
    call('tool-failed', '2026-11-05T00:00:05.000Z'),
    hook('tool-failed', '2026-11-05T00:00:05.100Z', { type: 'hook_error', command: 'broken', exitCode: 2 }),
    call('tool-silent', '2026-11-05T00:00:06.000Z'),
    hook('tool-silent', '2026-11-05T00:00:06.100Z', { type: 'hook_success', command: 'silent', exitCode: 0, stdout: '{}' }),
    call('tool-multi', '2026-11-05T00:00:07.000Z'),
    hook('tool-multi', '2026-11-05T00:00:07.100Z', { type: 'hook_success', command: 'first', exitCode: 0, stdout: '{"hookSpecificOutput":{"hookEventName":"PreToolUse","updatedInput":{"command":"first ls"}}}' }),
    hook('tool-multi', '2026-11-05T00:00:07.200Z', { type: 'hook_success', command: 'second', exitCode: 0, stdout: '{"hookSpecificOutput":{"hookEventName":"PreToolUse","updatedInput":{"command":"second ls"}}}' }),
  ];
  await writeFile(transcript, `${lines.map(line => JSON.stringify(line)).join('\n')}\n`);
  await recordDecision(stateDir, {
    sessionId, event: 'PreToolUse', host: 'claude', rule: 'A04', decision: 'allow', reason: 'workflow 放行',
    toolUseId: 'tool-exit3', toolName: 'Bash',
  });
  const trajectory = await buildTrajectory({ stateDir, configDir, sessionId, host: 'claude', root: project });
  const status = id => trajectory.turns[0].toolCalls.find(item => item.toolUseId === id);
  assert.equal(status('tool-rewrite').status, 'rewritten');
  assert.equal(status('tool-rewrite').finalInput, 'rewritten');
  assert.ok(status('tool-rewrite').signals.includes('rewrite-exit-3'));
  // 退出码 3 是改写信号；同一调用里的 workflow allow 只能作为组合信号，不能把状态盖成 allow。
  assert.equal(status('tool-exit3').status, 'rewritten');
  assert.ok(status('tool-exit3').signals.includes('rewrite-exit-3'));
  assert.ok(status('tool-exit3').signals.includes('workflow-allow'));
  assert.equal(status('tool-ask').status, 'ask');
  assert.equal(status('tool-timeout').status, 'timeout');
  assert.equal(status('tool-failed').status, 'failed');
  // 成功的 hook 输出没有 permissionDecision 时是无决定，不是放行。
  assert.equal(status('tool-silent').status, 'no-decision');
  assert.equal(status('tool-silent').signals.includes('host-allow'), false);
  assert.equal(status('tool-multi').status, 'rewritten');
  assert.equal(status('tool-multi').finalInput, 'unobservable');
  assert.ok(status('tool-multi').signals.includes('final-input-unobservable'));
  assert.equal(trajectory.summary.statuses.rewritten, 3);
  assert.equal(trajectory.summary.statuses.ask, 1);
  assert.equal(trajectory.summary.statuses.timeout, 1);
  assert.equal(trajectory.summary.statuses.failed, 1);
  assert.equal(trajectory.summary.statuses['no-decision'], 1);
});

test('两个共用 node 的 hook：只有整条命令命中才算已观察，静默的仍是未观察到', async () => {
  const area = await temporary();
  const configDir = path.join(area, 'claude');
  const stateDir = path.join(area, 'state');
  const project = path.join(area, 'project');
  const sessionId = 'session-two-node-hooks';
  const transcript = path.join(configDir, 'projects', 'slug', `${sessionId}.jsonl`);
  const workflowCli = path.join(area, 'workflow', 'bin', 'workflow.mjs');
  const silentScript = path.join(area, 'silent.mjs');
  await mkdir(path.dirname(transcript), { recursive: true });
  await mkdir(path.dirname(workflowCli), { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await mkdir(configDir, { recursive: true });
  await writeFile(path.join(configDir, 'settings.json'), JSON.stringify({
    hooks: {
      PreToolUse: [{
        hooks: [
          { type: 'command', command: 'node', args: [workflowCli, 'hook', '--agent', 'claude'] },
          { type: 'command', command: 'node', args: [silentScript] },
        ],
      }],
    },
  }));
  const lines = [
    { type: 'user', promptId: 'turn-1', timestamp: '2026-11-05T00:00:00.000Z', cwd: project, version: '2.1.318', message: { role: 'user', content: [{ type: 'text', text: '列目录' }] } },
    { type: 'assistant', timestamp: '2026-11-05T00:00:01.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tool-bash', name: 'Bash', input: { command: 'ls' } }] } },
    {
      type: 'attachment',
      timestamp: '2026-11-05T00:00:01.100Z',
      attachment: {
        type: 'hook_success', hookName: 'PreToolUse:Bash', hookEvent: 'PreToolUse', toolUseID: 'tool-bash',
        command: `node ${workflowCli} hook --agent claude`, exitCode: 0, stdout: '{}',
      },
    },
  ];
  await writeFile(transcript, `${lines.map(line => JSON.stringify(line)).join('\n')}\n`);
  await recordDecision(stateDir, {
    sessionId, event: 'PreToolUse', host: 'claude', rule: 'A01', decision: 'allow', reason: 'workflow 决定',
    toolUseId: 'tool-bash', toolName: 'Bash',
  });
  const trajectory = await buildTrajectory({ stateDir, configDir, sessionId, host: 'claude', root: project });
  const workflowHook = trajectory.hooks.observation.find(item => item.args.includes(workflowCli));
  const silentHook = trajectory.hooks.observation.find(item => item.args.includes(silentScript));
  assert.equal(workflowHook.status, 'observed');
  assert.equal(silentHook.status, 'unobserved', '共用 node 不能让静默 hook 被标为已观察');
});

test('决定记录落盘失败时仍返回原 deny 与 Stop 决定，输出不被污染', async () => {
  const f = await fixture();
  // 用同名普通文件占住 decisions 目录，使 mkdir 与 appendFile 失败，不改变 hook 判定。
  await writeFile(path.join(f.directory, 'decisions'), 'occupied');
  const denied = await events(f, 'PreToolUse', {
    tool_name: 'Write',
    tool_input: { file_path: path.join(f.project, 'src', 'a.mjs'), content: 'x' },
    tool_use_id: 'tool-write-fail',
    prompt_id: f.promptId,
  });
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
  assert.deepEqual(Object.keys(denied).sort(), ['hookSpecificOutput', 'systemMessage']);

  await start(f, { mode: 'plan', allowedPaths: [] });
  await deliver(f, 'delivered');
  const stopped = await events(f, 'Stop', { prompt_id: f.promptId });
  assert.equal(stopped.decision, 'block');
  assert.deepEqual(Object.keys(stopped).sort(), ['decision', 'reason']);
  assert.equal(await readFile(path.join(f.directory, 'decisions'), 'utf8'), 'occupied');
});

test('writeTrajectoryFile 在评测运行目录写 trajectory.jsonl 单行', async () => {
  const f = await trajectoryFixture();
  const outFile = path.join(f.area, 'run', 'trajectory.jsonl');
  const written = await writeTrajectoryFile({ stateDir: f.stateDir, configDir: f.configDir, sessionId: f.sessionId, host: 'claude', outFile });
  assert.equal(written.path, outFile);
  const text = await readFile(outFile, 'utf8');
  const lines = text.trim().split(/\r?\n/);
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.sessionId, f.sessionId);
  assert.equal(parsed.turns[0].stop.rule, 'S11');
});

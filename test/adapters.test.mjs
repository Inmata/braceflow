import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CODEG_DELEGATION_STATUS_TOOLS,
  CODEG_DELEGATION_TERMINAL,
  CODEG_QUESTION_TOOLS,
  codegWaitInstruction,
  delegationTasks,
  isCodegChannel,
} from '../src/adapters/codeg.mjs';
import {
  HOST_MESSAGE_PREFIXES,
  commandDelegation,
  hcDelegation,
  hcWaitInstruction,
  herdrDelegation,
  herdrWaitInstruction,
  isHcChannel,
  isHerdrChannel,
  mentionsHerdrDelegation,
  packageMarkersFromText,
  recognizeHostMessage,
} from '../src/adapters/herdr.mjs';
import {
  CINDY_HELPER_CALL_TOOL,
  CINDY_HOST_MESSAGE_PREFIXES,
  CINDY_ORCA_DELEGATION_TOOLS,
  CINDY_QUESTION_TOOLS,
  cindyOrcaDelegation,
  cindySessionTaskDelegation,
  cindyToolDelegation,
  cindyWaitInstruction,
  isCindyChannel,
} from '../src/adapters/cindy.mjs';

test('Codeg 适配保留提问/状态工具名、结果解析和终态集合', () => {
  assert.deepEqual(CODEG_QUESTION_TOOLS, ['mcp__codeg-mcp__ask_user_question', 'mcp__codeg_mcp__ask_user_question']);
  assert.deepEqual(CODEG_DELEGATION_STATUS_TOOLS, ['mcp__codeg-mcp__get_delegation_status', 'mcp__codeg_mcp__get_delegation_status']);
  assert.deepEqual(CODEG_DELEGATION_TERMINAL, ['completed', 'failed', 'canceled']);
  const parsed = delegationTasks({ tasks: [{ task_id: 'a', status: 'completed' }, { task_id: 1, status: 'failed' }] });
  assert.deepEqual(parsed, [{ taskId: 'a', status: 'completed' }]);
  assert.deepEqual(delegationTasks({ output: JSON.stringify({ tasks: [{ task_id: 'b', status: 'blocked_on' }] }) }), [{ taskId: 'b', status: 'blocked_on' }]);
  assert.deepEqual(delegationTasks('not-json'), []);
});

test('Codeg 等待说明只由显式 Codeg 通道使用，公共通道不被视为 Codeg', () => {
  assert.equal(isCodegChannel('codeg:claude_code'), true);
  assert.equal(isCodegChannel('builtin:general-purpose'), false);
  assert.equal(isCodegChannel('lead'), false);
  assert.equal(isCodegChannel(undefined), false);
  assert.match(codegWaitInstruction(), /get_delegation_status/);
  assert.match(codegWaitInstruction(), /wait_ms: 0/);
});

test('Herdr TUI 适配：start 取 --kind 为 Agent，prompt 不声明 Agent 且取首行包标记，只读子命令不识别', () => {
  const start = herdrDelegation(['herdr', 'agent', 'start', 'w1', '--kind', 'claude', '--pane', 'w2:p9']);
  assert.equal(start.entry, 'herdr-agent-start');
  assert.equal(start.channelPrefix, 'herdr:');
  assert.equal(start.agent, 'claude');
  assert.equal(start.target, 'w1');
  assert.equal(start.pureStart, true);
  assert.equal(start.text, null);
  assert.deepEqual(start.packageMarkers, []);

  const prompt = herdrDelegation(['D:\\tools\\herdr.exe', 'agent', 'prompt', 'w1', 'workflow-package:W2 实现', '--wait', '--timeout', '600000']);
  assert.equal(prompt.entry, 'herdr-agent-prompt');
  assert.equal(prompt.agent, null);
  assert.equal(prompt.text, 'workflow-package:W2 实现');
  assert.equal(prompt.pureStart, false);
  assert.deepEqual(prompt.packageMarkers, ['W2']);

  for (const tokens of [['herdr', 'agent', 'list'], ['herdr', 'agent', 'read', 'w1'], ['herdr', 'agent', 'start'], ['herdr', 'pane', 'split', 'x'], ['hc', 'agent', 'prompt', 'w1', 'x']]) {
    assert.equal(herdrDelegation(tokens), null, JSON.stringify(tokens));
  }
});

test('Herdr GUI（hc）适配：run 映射程序名 Agent，模板只能精确通道，send 无 Agent 来源', () => {
  const run = hcDelegation(['hc.exe', 'run', '--bg', '--name', 'w2', 'claude', 'workflow-package:W2 实现']);
  assert.equal(run.entry, 'hc-run');
  assert.equal(run.channelPrefix, 'hc:');
  assert.equal(run.agent, 'claude');
  assert.equal(run.text, 'workflow-package:W2 实现');
  assert.equal(run.pureStart, false);
  assert.deepEqual(run.packageMarkers, ['W2']);

  const bare = hcDelegation(['hc', 'run', '--bg', 'codex']);
  assert.equal(bare.agent, 'codex');
  assert.equal(bare.pureStart, true);
  assert.equal(bare.text, null);
  // 前台 run 会阻塞并流式输出，不是本适配的委派形态。
  assert.equal(hcDelegation(['hc', 'run', 'claude', '任务']), null);

  const send = hcDelegation(['hc', 'send', 't7', 'workflow-package:W2 回执']);
  assert.equal(send.entry, 'hc-send');
  assert.equal(send.agent, null);
  assert.equal(send.text, 'workflow-package:W2 回执');
  assert.deepEqual(send.packageMarkers, ['W2']);

  const template = hcDelegation(['hc', 'run', '--bg', 'review', 'workflow-package:R1 审查'], { isTemplate: name => name === 'review' });
  assert.equal(template.entry, 'hc-run-template');
  assert.equal(template.agent, null);
  assert.equal(template.exactChannel, 'hc:template:review');
  // 既不是已知程序也不是模板：不猜身份，不识别为委派。
  assert.equal(hcDelegation(['hc', 'run', '--bg', 'mystery', '任务'], { isTemplate: () => false }), null);
  assert.equal(hcDelegation(['hc', 'ls']), null);
  assert.equal(commandDelegation(['hc', 'send', 't', 'hi']).entry, 'hc-send');
});

test('包标记只认文本开头；宿主消息只认去前导空白后的固定开头，表可由适配器扩展', () => {
  assert.deepEqual(packageMarkersFromText('  workflow-package：W1 实施'), ['W1']);
  assert.deepEqual(packageMarkersFromText('请先 workflow-package:W1 再实施'), []);
  assert.equal(packageMarkersFromText(null).length, 0);

  const hc = recognizeHostMessage('  \n<hc from="t7 review">交付完成</hc>');
  assert.equal(hc.software, 'Herdr GUI');
  assert.match(hc.note, /不是用户指令/);
  assert.match(hc.note, /consumed/);
  assert.equal(recognizeHostMessage('用户说：<hc from="t7">x</hc>'), null);
  assert.equal(recognizeHostMessage('<task-notification>done</task-notification>'), null);
  assert.equal(recognizeHostMessage(undefined), null);
  const custom = [{ prefix: '[Task delivery] Host bookkeeping', software: 'Cindy', note: '不是用户消息' }];
  assert.equal(recognizeHostMessage('  [Task delivery] Host bookkeeping, not a user message', custom).software, 'Cindy');
  assert.deepEqual(HOST_MESSAGE_PREFIXES.map(item => item.prefix), ['<hc from="']);
});

test('复合命令识别只看是否出现委派子命令；通道判断与等待说明按 TUI/GUI 区分', () => {
  assert.equal(mentionsHerdrDelegation('herdr agent prompt w1 "x"'), true);
  assert.equal(mentionsHerdrDelegation('cd x && herdr.exe agent start w1 --kind claude'), true);
  assert.equal(mentionsHerdrDelegation('hc run --bg claude "x"'), true);
  assert.equal(mentionsHerdrDelegation('hc ls'), false);
  assert.equal(mentionsHerdrDelegation('herdr agent list'), false);
  assert.equal(mentionsHerdrDelegation(undefined), false);

  assert.equal(isHerdrChannel('herdr:claude'), true);
  assert.equal(isHerdrChannel('hc:claude'), false);
  assert.equal(isHcChannel('hc:claude'), true);
  assert.equal(isHcChannel('herdr:claude'), false);
  assert.equal(isHcChannel(undefined), false);
  assert.match(herdrWaitInstruction(), /herdr agent wait/);
  assert.match(herdrWaitInstruction(), /不盲目重发/);
  assert.match(hcWaitInstruction(), /hc wait --children any/);
  assert.match(hcWaitInstruction(), /<hc from=/);
});

test('Cindy Orca 适配：create_worker 取 agent/initial_task，create_workers 逐项解析，send_to_worker 无 Agent 来源', () => {
  assert.equal(CINDY_HELPER_CALL_TOOL, 'mcp__cindy_helper__call_tool');
  assert.deepEqual(CINDY_ORCA_DELEGATION_TOOLS, [
    'mcp__cindy_orca__create_worker', 'mcp__cindy-orca__create_worker',
    'mcp__cindy_orca__create_workers', 'mcp__cindy-orca__create_workers',
    'mcp__cindy_orca__send_to_worker', 'mcp__cindy-orca__send_to_worker',
  ]);

  const created = cindyOrcaDelegation('mcp__cindy_orca__create_worker', { agent: 'claude-code', initial_task: 'workflow-package:W2 实现' });
  assert.equal(created.kind, 'orca');
  const [single] = created.items;
  assert.equal(single.entry, 'cindy-orca-create_worker');
  assert.equal(single.channelPrefix, 'cindy:orca:');
  assert.equal(single.agent, 'claude-code');
  // 准备记录常带模型/effort 说明，声明比对用词级别名；通道仍按原值比较。
  assert.equal(single.declaredAgent, 'claude');
  assert.deepEqual(single.packageMarkers, ['W2']);
  assert.equal(single.text, 'workflow-package:W2 实现');
  // 没有 initial_task 也解析，但没有包标记，由 hook 按未关联工作包拒绝。
  assert.deepEqual(cindyOrcaDelegation('mcp__cindy-orca__create_worker', { agent: 'codex' }).items[0].packageMarkers, []);
  assert.equal(cindyOrcaDelegation('mcp__cindy-orca__create_worker', { agent: 'pi', initial_task: 'x' }).items[0].declaredAgent, 'pi');

  const batch = cindyOrcaDelegation('mcp__cindy_orca__create_workers', {
    workers: [
      { label: 'w2', agent: 'claude-code', initial_task: 'workflow-package:W2 实现' },
      { label: 'r2', agent: 'codex', initial_task: 'workflow-package:R2 审查', model: 'gpt-6.1-terra' },
    ],
  });
  assert.equal(batch.items.length, 2);
  assert.deepEqual(batch.items.map(item => item.index), [0, 1]);
  assert.deepEqual(batch.items[1].packageMarkers, ['R2']);
  assert.equal(batch.items[1].declaredAgent, 'codex');
  assert.equal(batch.items[1].label, 'r2');
  // model 只随描述保留，不参与核对。
  assert.equal(batch.items[1].model, 'gpt-6.1-terra');
  const malformed = cindyOrcaDelegation('mcp__cindy_orca__create_workers', { workers: [null] });
  assert.match(malformed.items[0].invalid, /不是对象/);
  assert.match(cindyOrcaDelegation('mcp__cindy_orca__create_workers', {}).error, /workers/);

  const sent = cindyOrcaDelegation('mcp__cindy_orca__send_to_worker', { target_session_id: 'cuid-1', message: 'workflow-package:W2 继续' });
  assert.equal(sent.items[0].agent, null);
  assert.equal(sent.items[0].targetSessionId, 'cuid-1');
  assert.deepEqual(sent.items[0].packageMarkers, ['W2']);
  assert.match(cindyOrcaDelegation('mcp__cindy_orca__send_to_worker', { target_session_id: 'x' }).error, /message/);

  // 团队管理动作不是任务派发。
  assert.equal(cindyOrcaDelegation('mcp__cindy_orca__start_team', { goal: 'x' }), null);
  assert.equal(cindyOrcaDelegation('mcp__cindy_orca__interrupt_worker', { target_session_id: 'x' }), null);
});

test('Cindy Session task 适配：start/message 解析 instruction/message，check/stop 不识别', () => {
  const start = cindySessionTaskDelegation(CINDY_HELPER_CALL_TOOL, {
    name: 'start_session_task',
    args: { instruction: 'workflow-package:W2 实现', title: '实现' },
  });
  assert.equal(start.entry, 'cindy-session-start_session_task');
  assert.equal(start.sessionTask, true);
  assert.equal(start.text, 'workflow-package:W2 实现');
  assert.deepEqual(start.packageMarkers, ['W2']);

  // args 是 JSON 字符串时同样解析；标题里的显式标记也算关联。
  const viaString = cindySessionTaskDelegation(CINDY_HELPER_CALL_TOOL, { name: 'start_session_task', args: JSON.stringify({ instruction: '普通任务' }) });
  assert.deepEqual(viaString.packageMarkers, []);
  const titled = cindySessionTaskDelegation(CINDY_HELPER_CALL_TOOL, { name: 'start_session_task', args: { instruction: '实施', title: 'workflow-package:R2' } });
  assert.deepEqual(titled.packageMarkers, ['R2']);

  const message = cindySessionTaskDelegation(CINDY_HELPER_CALL_TOOL, { name: 'message_session_task', args: { message: 'workflow-package:R2 追问' } });
  assert.equal(message.entry, 'cindy-session-message_session_task');
  assert.deepEqual(message.packageMarkers, ['R2']);

  for (const name of ['check_session_task', 'stop_session_task', 'other_tool']) {
    assert.equal(cindySessionTaskDelegation(CINDY_HELPER_CALL_TOOL, { name, args: {} }), null, name);
    assert.equal(cindyToolDelegation(CINDY_HELPER_CALL_TOOL, { name, args: {} }), null, name);
  }
  assert.equal(cindyToolDelegation('mcp__cindy_orca__create_worker', { agent: 'codex', initial_task: 'workflow-package:W3 x' }).kind, 'orca');
});

test('Cindy 提问工具、宿主消息前缀与等待说明由适配器提供', () => {
  assert.deepEqual(CINDY_QUESTION_TOOLS, ['mcp__cindy_helper__ask_user_question_async']);
  assert.deepEqual(CINDY_HOST_MESSAGE_PREFIXES.map(item => item.prefix), ['[Task delivery] Host bookkeeping']);
  const recognized = recognizeHostMessage(' \n[Task delivery] Host bookkeeping, not a user message: …', CINDY_HOST_MESSAGE_PREFIXES);
  assert.equal(recognized.software, 'Cindy');
  assert.match(recognized.note, /不是用户指令/);
  assert.match(recognized.note, /consumed/);
  assert.equal(recognizeHostMessage('用户说 [Task delivery] Host bookkeeping', CINDY_HOST_MESSAGE_PREFIXES), null);

  assert.equal(isCindyChannel('cindy:orca:claude-code'), true);
  assert.equal(isCindyChannel('cindy:session'), true);
  assert.equal(isCindyChannel('herdr:claude'), false);
  assert.equal(isCindyChannel(undefined), false);
  assert.match(cindyWaitInstruction(), /check_session_task/);
  assert.match(cindyWaitInstruction(), /不要轮询/);
});

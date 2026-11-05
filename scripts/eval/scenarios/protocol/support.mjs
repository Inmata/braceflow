import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { check } from '../../assertions.mjs';
import { pairDenied, preToolUsePairs, toolResults, toolUses } from '../../events.mjs';
import { readJson, runCommand } from '../../isolation.mjs';

const RECEIPT_PREFIX = 'workflow 回执：';

// 安装后的隔离入口；模型与 runner 都从这里调用，保证 hook 的来源核对指向同一发布副本。
export function cliEntry(stateDir) {
  return path.join(stateDir, 'current', 'bin', 'workflow.mjs').replaceAll('\\', '/');
}

// 隔离状态里由真实宿主建立的 Lead 会话；前置状态必须绑定这个 sessionId/turnId。
export async function activeSession(stateDir) {
  const state = await readJson(path.join(stateDir, 'state.json'));
  if (!state) return null;
  for (const project of Object.values(state.projects || {})) {
    const session = Object.values(state.sessions || {}).find(item => item.projectId === project.projectId && !item.role);
    if (session) return { project, session, state };
  }
  return null;
}

function quote(value) {
  const text = String(value);
  if (!/[\s'"`$;&|<>()]/.test(text)) return text;
  return `'${text.replaceAll("'", "''")}'`;
}

// signal 命令只输出载荷，状态由宿主 PostToolUse 接受。这里照样分两步走：
// 1) 用真实 CLI 生成与模型执行时相同的 payload；
// 2) 把同一条命令和 stdout 作为宿主 PostToolUse 事件交给真实 hook 入口。
// 事件使用当前会话的真实 sessionId/turnId，不手写 state.json，也不跳过 acceptSignal。
export async function runSetupSignal({ stateDir, cwd, action, args = [], input }) {
  const cli = cliEntry(stateDir);
  const identity = await activeSession(stateDir);
  if (!identity) return { ok: false, stage: 'identity', detail: '隔离状态里没有真实宿主会话' };
  const { session } = identity;
  const argv = [
    '--state-dir', stateDir,
    'signal', action,
    '--session', session.sessionId,
    '--turn', session.turnId,
    '--id', `signal-${randomUUID()}`,
    ...args,
  ];
  if (input !== undefined) argv.push('--base64', Buffer.from(JSON.stringify(input), 'utf8').toString('base64'));
  const emitted = await runCommand(process.execPath, [cli, ...argv], { cwd });
  if (emitted.code !== 0) {
    return { ok: false, stage: 'signal', code: emitted.code, stdout: emitted.stdout, stderr: emitted.stderr, argv };
  }
  const command = [process.execPath, cli, ...argv].map(quote).join(' ');
  const event = {
    hook_event_name: 'PostToolUse',
    cwd,
    session_id: session.sessionId,
    prompt_id: session.turnId,
    permission_mode: 'default',
    event_id: `event-${randomUUID()}`,
    tool_name: 'PowerShell',
    tool_input: { command },
    tool_response: { stdout: emitted.stdout },
  };
  const hooked = await runCommand(process.execPath, [cli, 'hook', '--agent', 'claude', '--state-dir', stateDir], {
    cwd,
    input: JSON.stringify(event),
  });
  let output = null;
  try { output = JSON.parse(hooked.stdout); } catch { /* 非 JSON 委托给断言报告 */ }
  const text = output?.hookSpecificOutput?.additionalContext;
  let receipt = null;
  if (typeof text === 'string' && text.startsWith(RECEIPT_PREFIX)) {
    try { receipt = JSON.parse(text.slice(RECEIPT_PREFIX.length)); } catch { /* 同上 */ }
  }
  return { ok: Boolean(receipt?.accepted), command, receipt, output, stdout: emitted.stdout, hookStdout: hooked.stdout, hookStderr: hooked.stderr };
}

export function setupAssertion(id, result) {
  const receipt = result?.receipt || null;
  return check(
    id,
    receipt?.accepted === true,
    receipt?.accepted === true
      ? `前置信号已由真实 hook 接受（${receipt.action || 'signal'}）`
      : `前置信号未被接受：${receipt ? JSON.stringify(receipt) : (result?.hookStdout || result?.stdout || result?.detail || '无输出')}`,
    { accepted: true },
    receipt ? { accepted: receipt.accepted, reason: receipt.reason || null, missing: receipt.missing || null } : { stage: result?.stage || 'hook', code: result?.code ?? null },
  );
}

// 任务账本既可能是对象（真实状态）也可能是数组（早期形状）；两种都按任务条目读取。
export function taskRecords(state) {
  if (!state?.tasks || typeof state.tasks !== 'object') return [];
  return Array.isArray(state.tasks) ? state.tasks : Object.values(state.tasks);
}

// 任务账本与 task-start 成功回执同时为空，才说明没有开工；只看账本会漏掉“先建后删”。
export async function noTaskEstablishedAssertion(stateDir, events) {
  const state = await readJson(path.join(stateDir, 'state.json'));
  const tasks = taskRecords(state);
  const results = toolResults(events);
  const acceptedStart = toolUses(events)
    .filter(call => typeof call.input?.command === 'string' && /\bsignal\s+task-start\b/.test(call.input.command))
    .some(call => {
      const result = results.get(call.id) || '';
      return /"accepted"\s*:\s*true/.test(result) || (/"action"\s*:\s*"task-start"/.test(result) && /"taskId"/.test(result));
    });
  return check(
    'no-task-established',
    tasks.length === 0 && !acceptedStart,
    tasks.length === 0 && !acceptedStart ? '没有建立任务，也没有 task-start 成功回执' : `隔离状态出现 ${tasks.length} 个任务；task-start 成功回执=${acceptedStart}`,
    0,
    { tasks: tasks.map(task => task?.taskId ?? task?.id ?? null), acceptedStart },
  );
}

// 示例项目：README + 计划 + 业务文件。只用于隔离沙箱，不触碰真实仓库。
export async function writeProjectFixture(project, { commit = false } = {}) {
  await mkdir(path.join(project, 'src'), { recursive: true });
  await mkdir(path.join(project, 'docs', 'plans'), { recursive: true });
  await writeFile(path.join(project, 'README.md'), '# 评测项目\n\n一个小型演示项目，用来验证 workflow 的协议门禁。\n', 'utf8');
  await writeFile(
    path.join(project, 'docs', 'plans', 'plan.md'),
    '# 计划\n\n1. 读取 README.md。\n2. 工作包 W1：检查 src/business.txt。\n3. 工作包 W2：独立审查 W1 的结论。\n4. 两个包分别交付并独立审查后汇总。\n',
    'utf8',
  );
  await writeFile(path.join(project, 'src', 'business.txt'), 'ORIGINAL\n', 'utf8');
  if (commit) {
    await runCommand('git', ['init', '-q'], { cwd: project });
    await runCommand('git', ['add', '-A'], { cwd: project });
    await runCommand('git', ['-c', 'user.name=eval', '-c', 'user.email=eval@example.invalid', 'commit', '-q', '-m', 'fixture'], { cwd: project });
  }
}

export function headRef(project) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project, encoding: 'utf8' }).trim();
}

// 从工具调用里取出 signal 子命令；只认实际命令文本，不按回执内容猜动作。
export function signalAction(call) {
  const command = call?.input?.command;
  if (typeof command !== 'string') return null;
  const match = /\bsignal\s+([a-z][a-z-]*)\b/.exec(command);
  return match ? match[1] : null;
}

function parseHookOutput(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value.trim()); } catch { return null; }
}

// hook_response 不带 tool_use_id：按 PostToolUse 的 hook_started 工具名与时间顺序，
// 把回执配到实际执行过的 tool_use 调用，再取同一 hook_id 的 hook_response。被 PreToolUse
// 拒绝的调用虽然可能留下错误 tool_result，但不会执行，不能占用后续同名调用的回执。
// order 是调用在 transcript 中的序号，用来核对“拒绝→咨询→重试”这类先后关系。
export function postToolUseReceipts(events) {
  const results = toolResults(events);
  const denied = new Set(preToolUsePairs(events).filter(pairDenied).map(pair => pair.call?.id).filter(Boolean));
  const calls = toolUses(events);
  const executed = calls.filter(call => results.has(call.id) && !denied.has(call.id));
  const order = new Map(calls.map((call, index) => [call.id, index]));
  const byName = new Map();
  for (const call of executed) {
    if (!byName.has(call.name)) byName.set(call.name, []);
    byName.get(call.name).push(call);
  }
  const used = new Set();
  const pending = new Map();
  const receipts = [];
  for (const event of events || []) {
    if (event?.type !== 'system' || typeof event.subtype !== 'string') continue;
    if (event.subtype === 'hook_started' && event.hook_event === 'PostToolUse') {
      const name = String(event.hook_name || '').split(':').slice(1).join(':') || null;
      const candidates = name ? byName.get(name) || [] : [];
      const call = name
        ? candidates.find(item => !used.has(item.id)) || null
        : executed.find(item => !used.has(item.id)) || null;
      if (call) used.add(call.id);
      pending.set(event.hook_id, { call, order: call ? order.get(call.id) : null });
    } else if (event.subtype === 'hook_response') {
      const pair = pending.get(event.hook_id);
      if (!pair) continue;
      pending.delete(event.hook_id);
      const text = parseHookOutput(event.output)?.hookSpecificOutput?.additionalContext;
      if (typeof text !== 'string' || !text.startsWith(RECEIPT_PREFIX)) continue;
      try {
        receipts.push({ call: pair.call, receipt: JSON.parse(text.slice(RECEIPT_PREFIX.length)), text, order: pair.order, hookName: event.hook_name ?? null });
      } catch { /* 非回执文本不参与断言 */ }
    }
  }
  return receipts;
}

// 读取隔离状态里的咨询记录；只按真实文件与 host 会话核对，不接受场景自造记录。
export async function readConsultations(stateDir, { sessionId, subagentType = 'workflow-advisor' } = {}) {
  const dir = path.join(stateDir, 'consultations');
  let entries;
  try { entries = await readdir(dir); } catch { return []; }
  const records = [];
  for (const entry of entries.filter(name => name.endsWith('.json'))) {
    const value = await readJson(path.join(dir, entry));
    if (!value || !Array.isArray(value.consultations)) continue;
    for (const consultation of value.consultations) {
      if (sessionId && value.sessionId !== sessionId) continue;
      if (subagentType && consultation.subagentType !== subagentType) continue;
      records.push({ file: entry, sessionId: value.sessionId, ...consultation });
    }
  }
  return records;
}

// 复杂准备记录：E04/E05 共用。requirements、分包、来源计划都在这里给出，
// 让 prepare 真正到达“只差咨询记录”的门禁，而不是靠残缺输入触发别的错误。
export function complexPreparation() {
  return {
    preparation: {
      size: 'complex',
      sizeReason: '评测场景：两个工作包需要独立实施与审查，属于复杂任务。',
      requirements: [
        {
          id: 'REQ-1',
          summary: '保持示例业务文件内容不变',
          acceptance: ['src/business.txt 内容仍为 ORIGINAL'],
          packages: ['W1'],
          verification: '读取 src/business.txt',
        },
      ],
      research: [{ source: 'README.md', conclusion: '示例项目只有一个业务文件，可用只读检查验证。' }],
      solution: {
        summary: '先由 W1 核对文件，再由 W2 独立审查。',
        decisions: [{ decision: '不在评测中改写业务文件', reason: '场景只验证协议门禁。' }],
      },
      packages: [
        {
          packageId: 'W1',
          role: 'worker',
          agent: 'Claude Code',
          channel: 'builtin:claude',
          scope: 'src/business.txt',
          delivers: '确认文件内容并记录证据',
        },
        {
          packageId: 'W2',
          role: 'reviewer',
          agent: 'Claude Code',
          channel: 'builtin:claude',
          scope: '审查 W1',
          delivers: '给出独立审查结论',
          dependsOn: ['W1'],
        },
      ],
      verification: ['npm run check'],
      confirmation: { scope: ['评测准备记录'], basis: '任务书声明的 W2 范围' },
      source: { path: 'docs/plans/plan.md' },
    },
  };
}

import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { check } from '../../assertions.mjs';
import { initEvent, preToolUsePairs, toolUses } from '../../events.mjs';
import { readJson } from '../../isolation.mjs';
import { cliEntry, complexPreparation, readConsultations, runSetupSignal, setupAssertion, writeProjectFixture } from './support.mjs';

// 复杂准备不再要求先咨询：runner 用真实 CLI 与 hook 入口保存准备并开工。
// 模型在第二轮真实写入命中路径规则的文件，断言 PreToolUse 只提醒、不拒绝，且同一键只提醒一次。
export const E04 = {
  id: 'E04',
  title: '复杂 prepare 不咨询也能继续：路径规则实际写入只提醒一次',
  suite: 'protocol',
  runs: 1,
  allow: ({ stateDir }) => {
    const cli = cliEntry(stateDir);
    return ['Edit(src/**)', 'Task', 'Agent', `Bash(node ${cli}:*)`, `PowerShell(node ${cli}:*)`];
  },
  turns: () => [
    'Read README.md and reply with one sentence. Do not modify any files.',
    '请用 Edit 工具真实修改 src/business.txt 两次，每次都用新的 old_string：\n1. 把 ORIGINAL 改成 ORIGINAL-A。\n2. 把 ORIGINAL-A 改成 ORIGINAL-B。\n两次都要执行，不要调用 workflow-advisor，也不要用 Bash 写文件。完成后用一句话回复。',
  ],
  async prepare({ project }) {
    await writeProjectFixture(project);
    await writeFile(
      path.join(project, 'workflow-gate.json'),
      `${JSON.stringify({ schemaVersion: 1, pathRules: { security: ['src/**'], migration: [] } }, null, 2)}\n`,
      'utf8',
    );
  },
  async betweenTurns({ dirs, turn }) {
    if (turn !== 1) return [];
    const preparation = await runSetupSignal({ stateDir: dirs.stateDir, cwd: dirs.project, action: 'prepare', input: complexPreparation() });
    const start = await runSetupSignal({
      stateDir: dirs.stateDir,
      cwd: dirs.project,
      action: 'task-start',
      args: ['--route', 'lead-direct', '--task', 'task-e04', '--goal', 'eval path rule reminder', '--mode', 'write', '--paths', 'src/**'],
    });
    return [
      setupAssertion('setup-preparation-without-consultation', preparation),
      setupAssertion('setup-task-start', start),
    ];
  },
  async evaluate({ events, stateDir, project }) {
    const calls = toolUses(events);
    const pairs = preToolUsePairs(events);
    const pairOf = call => pairs.find(pair => pair.call?.id === call.id) || null;
    const edits = calls.filter(call => call.name === 'Edit');
    const first = edits[0] ? pairOf(edits[0]) : null;
    const second = edits[1] ? pairOf(edits[1]) : null;
    const firstMessage = first?.output?.systemMessage || first?.output?.hookSpecificOutput?.permissionDecisionReason || '';
    const secondOutput = second?.output || {};
    const secondMessage = secondOutput.systemMessage || secondOutput.hookSpecificOutput?.permissionDecisionReason || '';
    const state = await readJson(path.join(stateDir, 'state.json'));
    const session = Object.values(state?.sessions || {}).find(item => !item.role);
    const task = Object.values(state?.tasks || {}).find(item => item.taskId === 'task-e04');
    const content = await readFile(path.join(project, 'src', 'business.txt'), 'utf8').catch(() => null);
    const advisorCalls = calls.filter(call => ['Task', 'Agent'].includes(call.name)
      && ['workflow-advisor', 'workflow:workflow-advisor'].includes(call.input?.subagent_type));
    const sessionId = initEvent(events)?.session_id || null;
    // hooks 写入的是宿主原始 subagent_type；这里不按默认名过滤，任何顾问记录都算。
    const consultations = await readConsultations(stateDir, { sessionId, subagentType: null });
    return [
      check(
        'task-established-without-consultation',
        ['active', 'suspended'].includes(task?.lifecycle),
        task ? `未咨询 workflow-advisor 也完成了 prepare 与 task-start（任务 ${task.lifecycle}；会话结束后挂起属于正常收尾）` : 'prepare/task-start 前置没有建立任务',
        'active or suspended after session end',
        { lifecycle: task?.lifecycle ?? null },
      ),
      check(
        'no-advisor-call',
        advisorCalls.length === 0,
        advisorCalls.length
          ? `运行中出现了 ${advisorCalls.length} 次顾问调用：${advisorCalls.map(call => `${call.name}:${call.input?.subagent_type}`).join('、')}`
          : '整轮没有 Agent/Task 调用 workflow-advisor 或 workflow:workflow-advisor',
        0,
        { calls: advisorCalls.map(call => ({ name: call.name, subagentType: call.input?.subagent_type ?? null })) },
      ),
      check(
        'no-consultation-record',
        consultations.length === 0,
        consultations.length
          ? `隔离状态出现了 ${consultations.length} 条顾问咨询记录`
          : '隔离状态没有顾问咨询记录，未咨询也能完成准备与写入',
        0,
        { consultations: consultations.map(item => ({ sessionId: item.sessionId, subagentType: item.subagentType })) },
      ),
      check(
        'first-write-allowed-with-reminder',
        Boolean(first) && !(first.output?.hookSpecificOutput?.permissionDecision === 'deny') && /项目路径规则/.test(firstMessage) && /只提醒，不拦截/.test(firstMessage),
        first
          ? (/项目路径规则/.test(firstMessage) ? '首次实际写入被放行，PreToolUse 附有路径规则提醒' : `首次写入未观测到路径规则提醒：${JSON.stringify(first.output)}`)
          : '没有观测到第一次 Edit 调用',
        'allow + systemMessage contains 项目路径规则',
        { message: firstMessage.slice(0, 240) },
      ),
      check(
        'second-write-without-repeat',
        Boolean(second) && !(secondOutput.hookSpecificOutput?.permissionDecision === 'deny') && !/项目路径规则/.test(secondMessage),
        second
          ? (/项目路径规则/.test(secondMessage) ? '第二次写入仍收到同一提醒，未按会话键去重' : '第二次写入被放行，没有重复提醒')
          : '没有观测到第二次 Edit 调用',
        'allow without repeat reminder',
        { message: secondMessage.slice(0, 240) },
      ),
      check(
        'reminder-key-recorded',
        Boolean(session?.reminded?.['task-e04:security']),
        session?.reminded?.['task-e04:security']
          ? '会话字段记录了 task-e04:security 提醒键'
          : `会话没有记录提醒键：${JSON.stringify(session?.reminded || null)}`,
        'task-e04:security',
        { reminded: session?.reminded || null },
      ),
      check(
        'business-file-edit-executed',
        content?.includes('ORIGINAL-B'),
        content?.includes('ORIGINAL-B') ? '两次 Edit 都实际执行，业务文件最终为 ORIGINAL-B' : `业务文件内容：${JSON.stringify(content)}`,
        'ORIGINAL-B',
        { content },
      ),
    ];
  },
};

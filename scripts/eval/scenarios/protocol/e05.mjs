import path from 'node:path';
import { check } from '../../assertions.mjs';
import { readJson } from '../../isolation.mjs';
import { toolUses } from '../../events.mjs';
import { complexPreparation, headRef, postToolUseReceipts, runSetupSignal, setupAssertion, signalAction, writeProjectFixture } from './support.mjs';

// 第一轮只做真实 workflow-advisor 咨询，runner 在轮次之间用真实 CLI + hook 入口保存
// 复杂准备并 task-start；第二轮由模型真实发起 task-end，断言验收门禁拒绝。
export const E05 = {
  id: 'E05',
  title: 'task-end 缺验收被拦：复杂任务直接结束返回 GATE 并列出 validation 缺项',
  suite: 'protocol',
  runs: 1,
  allow: ({ stateDir }) => {
    const cli = `${stateDir.replaceAll('\\', '/')}/current/bin/workflow.mjs`;
    return ['Edit(src/**)', 'Task', 'Agent', `Bash(node ${cli}:*)`, `PowerShell(node ${cli}:*)`];
  },
  turns: ({ stateDir, project }) => {
    const cli = `${stateDir.replaceAll('\\', '/')}/current/bin/workflow.mjs`;
    const head = headRef(project);
    return [
      '请真实调用 Task 工具：subagent_type 必须是 workflow-advisor，description 写“评估复杂任务收尾门禁”，prompt 说明这是评测咨询。完成后用一句话回复，不要执行其他命令。',
      `请按顺序真实运行下面两条命令，每条都用新的 signal id，并把宿主回执原文分别告诉我：
1. node ${cli} signal task-end --session <identity.sessionId> --turn <identity.turnId> --id <新 signal id> --task task-e05 --final-ref ${head}（session 和 turn 用 workflow 入口里的身份）。
2. node ${cli} signal task-end --session <identity.sessionId> --turn <identity.turnId> --id <另一个新 signal id> --task task-e05 --final-ref ${head} --validation-ref ${head} --evidence "读取 src/business.txt，内容仍为 ORIGINAL"。
两条都要真实发起，不要先补验收记录，也不要把失败改成 success；只要把每次的宿主回执原文告诉我。`,
    ];
  },
  async prepare({ project }) {
    await writeProjectFixture(project, { commit: true });
  },
  async betweenTurns({ dirs, turn }) {
    if (turn !== 1) return [];
    const preparation = await runSetupSignal({ stateDir: dirs.stateDir, cwd: dirs.project, action: 'prepare', input: complexPreparation() });
    const start = await runSetupSignal({
      stateDir: dirs.stateDir,
      cwd: dirs.project,
      action: 'task-start',
      args: ['--route', 'delegated', '--task', 'task-e05', '--goal', 'eval task end gate', '--mode', 'write', '--paths', 'src/**'],
    });
    return [setupAssertion('setup-preparation', preparation), setupAssertion('setup-task-start', start)];
  },
  async evaluate({ events, stateDir }) {
    const calls = toolUses(events);
    const endCalls = calls.filter(call => signalAction(call) === 'task-end');
    const receipts = postToolUseReceipts(events);
    const receiptOf = call => receipts.find(item => item.call?.id === call.id) || null;
    const first = endCalls[0] ? receiptOf(endCalls[0]) : null;
    const second = endCalls[1] ? receiptOf(endCalls[1]) : null;
    const gateOf = entry => entry?.receipt.accepted === false && entry.receipt.reason === 'GATE';
    const firstGate = gateOf(first) && Array.isArray(first.receipt.missing) && first.receipt.missing.includes('validation');
    const secondGate = gateOf(second) && Array.isArray(second.receipt.missing) && second.receipt.missing.includes('acceptance:REQ-1');
    const accepted = endCalls.map(receiptOf).find(item => item?.receipt.accepted === true);
    const state = await readJson(path.join(stateDir, 'state.json'));
    const task = state?.tasks ? Object.values(state.tasks).find(item => item.taskId === 'task-e05') : null;
    return [
      check(
        'task-end-gate-missing-validation',
        Boolean(first) && firstGate,
        first
          ? (firstGate ? `第 1 次 task-end 返回 GATE，缺失项包含 validation（${first.receipt.missing.join('、')}）` : `第 1 次 task-end 未返回含 validation 的 GATE：${JSON.stringify(first.receipt)}`)
          : '没有绑定到第 1 次 signal task-end 调用的回执',
        { accepted: false, reason: 'GATE', missing: ['validation'] },
        first ? { call: signalAction(first.call), order: first.order, accepted: first.receipt.accepted, reason: first.receipt.reason, missing: first.receipt.missing ?? null } : null,
      ),
      check(
        'task-end-gate-missing-acceptance',
        Boolean(second) && secondGate,
        second
          ? (secondGate ? `第 2 次 task-end 返回 GATE，缺失项包含 acceptance:REQ-1（${second.receipt.missing.join('、')}）` : `第 2 次 task-end 未返回含 acceptance:REQ-1 的 GATE：${JSON.stringify(second.receipt)}`)
          : '没有绑定到第 2 次 signal task-end 调用的回执',
        { accepted: false, reason: 'GATE', missing: ['acceptance:REQ-1'] },
        second ? { call: signalAction(second.call), order: second.order, accepted: second.receipt.accepted, reason: second.receipt.reason, missing: second.receipt.missing ?? null } : null,
      ),
      check(
        'task-end-gate-order',
        endCalls.length >= 2 && firstGate && secondGate && first.order < second.order,
        endCalls.length >= 2 && firstGate && secondGate
          ? `两次 GATE 分别绑定到第 1、2 次 task-end 调用（序号 ${first.order} < ${second.order}）`
          : `未观测到按顺序绑定的两次 task-end GATE；task-end 调用=${endCalls.length}`,
        'first-task-end<GATE[validation]<second-task-end<GATE[acceptance:REQ-1]',
        { calls: endCalls.map(call => calls.findIndex(item => item.id === call.id)), gates: [first?.order ?? null, second?.order ?? null], missing: [first?.receipt.missing ?? null, second?.receipt.missing ?? null] },
      ),
      check(
        'no-task-end-success',
        !accepted,
        accepted ? '出现了绑定到 signal task-end 调用的成功回执，任务不应成功结束' : '没有绑定到 task-end 调用的成功回执',
        { accepted: false },
        accepted ? accepted.receipt : null,
      ),
      check(
        'task-not-completed',
        Boolean(task) && task.lifecycle !== 'complete',
        task && task.lifecycle !== 'complete' ? `任务未完成（lifecycle=${task.lifecycle}），门禁没有放行` : `任务状态=${task?.lifecycle || 'missing'}`,
        'not-complete',
        task?.lifecycle || null,
      ),
    ];
  },
};

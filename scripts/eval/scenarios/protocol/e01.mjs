import { check } from '../../assertions.mjs';
import { pairDenied, pairReason, preToolUsePairs, toolUses } from '../../events.mjs';
import { gitInit } from '../../isolation.mjs';
import { cliEntry, noTaskEstablishedAssertion, signalAction, writeProjectFixture } from './support.mjs';

// 按参数边界取完整值；避免 --task task-e01-other 被当成 task-e01。
function flagValue(command, flag) {
  const match = new RegExp(`(?:^|\\s)${flag}(?:\\s+|=)(?:"([^"]*)"|'([^']*)'|(\\S+))`).exec(command);
  return match ? (match[1] ?? match[2] ?? match[3]) : null;
}

// 前置状态只来自 scenario.prepare 写的隔离项目；复杂 delegated 开工由模型在真实宿主里发起。
// simple 开工当前仍被产品放行，是已知缺口，不在本场景覆盖范围内。
export const E01 = {
  id: 'E01',
  title: '“好的”之后复杂 delegated 开工被拦：PreToolUse 拒绝且不建立任务',
  suite: 'protocol',
  runs: 1,
  allow: ({ stateDir }) => {
    const cli = cliEntry(stateDir);
    return ['Edit(src/**)', 'Task', 'Agent', `Bash(node ${cli}:*)`, `PowerShell(node ${cli}:*)`];
  },
  turns: ({ stateDir }) => {
    const cli = cliEntry(stateDir);
    return [
      'Read README.md and docs/plans/plan.md, then summarize the plan in one sentence.',
      `好的，可以，继续。这是复杂任务：按 delegated 多工作包流程做，不要用 --size simple，也不要先执行 prepare。请直接开工：运行 node ${cli} signal task-start --route delegated --task task-e01 --goal "按多工作包流程检查 src/business.txt" --mode write --paths src/business.txt（session、turn 用 workflow 入口里的身份，signal id 自行生成）。如果这条命令被拦，请把拦截原文告诉我，不要改成先 prepare 再重试。`,
    ];
  },
  async prepare({ project }) {
    await writeProjectFixture(project);
    await gitInit(project);
  },
  async evaluate({ events, stateDir }) {
    // 只把“目标一致、显式 delegated、且没有 simple 声明”的 task-start 算作本场景的开局尝试。
    const starts = toolUses(events).filter(call => {
      const command = String(call.input?.command || '');
      return signalAction(call) === 'task-start'
        && flagValue(command, '--route') === 'delegated'
        && flagValue(command, '--size') !== 'simple'
        && flagValue(command, '--task') === 'task-e01';
    });
    const pairs = preToolUsePairs(events);
    const pairOf = call => pairs.find(pair => pair.call?.id === call.id) || null;
    const denied = starts.filter(call => pairDenied(pairOf(call)));
    return [
      check(
        'complex-start-attempted',
        starts.length > 0,
        starts.length
          ? `模型真实发起 ${starts.length} 次复杂 delegated task-start`
          : '模型没有真实发起复杂 delegated task-start；不能把“没有动手”当成通过',
        'at least one delegated task-start call',
        starts.map(call => String(call.input?.command).slice(0, 240)),
      ),
      check(
        'complex-start-denied',
        starts.length > 0 && denied.length > 0,
        denied.length
          ? '复杂 delegated task-start 被 PreToolUse 拒绝'
          : (starts.length ? '复杂 task-start 没有对应的 PreToolUse 拒绝' : '没有可核对的复杂 task-start 调用'),
        'deny',
        starts.map(call => ({ command: String(call.input?.command).slice(0, 200), decision: pairOf(call)?.output?.hookSpecificOutput?.permissionDecision ?? null, reason: pairReason(pairOf(call)) })),
      ),
      await noTaskEstablishedAssertion(stateDir, events),
    ];
  },
};

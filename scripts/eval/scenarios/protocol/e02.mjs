import { check } from '../../assertions.mjs';
import { pairDenied, pairReason, preToolUsePairs, toolUses } from '../../events.mjs';
import { gitInit } from '../../isolation.mjs';
import { cliEntry, noTaskEstablishedAssertion, writeProjectFixture } from './support.mjs';

// 单轮直接要求复杂 delegated 开工；模型必须真实执行 CLI，门禁在 PreToolUse 拒绝并点名缺少准备记录。
export const E02 = {
  id: 'E02',
  title: '未 prepare 不 task-start：单轮 delegated 开工被拒绝并点名尚未保存准备记录',
  suite: 'protocol',
  runs: 1,
  allow: ({ stateDir }) => {
    const cli = cliEntry(stateDir);
    return ['Edit(src/**)', `Bash(node ${cli}:*)`, `PowerShell(node ${cli}:*)`];
  },
  turns: ({ stateDir }) => {
    const cli = cliEntry(stateDir);
    return [
      `这是复杂任务，准备直接开工。请真实运行下面这条命令（不要先准备、不要列目录或读取入口）：node ${cli} signal task-start --route delegated --task task-e02 --goal "按多工作包流程检查 src/business.txt" --mode write --paths src/business.txt（session、turn 用 workflow 入口里的身份，signal id 自行生成），然后把命令是否执行、宿主给出的拦截原文如实告诉我。`,
    ];
  },
  async prepare({ project }) {
    await writeProjectFixture(project);
    await gitInit(project);
  },
  async evaluate({ events, stateDir }) {
    const attempts = toolUses(events).filter(call => typeof call.input?.command === 'string' && /\bsignal\s+task-start\b/.test(call.input.command));
    const pairs = preToolUsePairs(events).filter(pair => pair.call && attempts.some(call => call.id === pair.call.id));
    const denied = pairs.filter(pair => pairDenied(pair));
    const reasons = denied.map(pair => pairReason(pair)).filter(Boolean);
    const named = reasons.some(reason => reason.includes('尚未保存准备记录'));
    return [
      check(
        'task-start-attempted',
        attempts.length > 0,
        attempts.length ? `观测到 ${attempts.length} 次 signal task-start 调用` : '模型没有真实发起 signal task-start',
        'at least one signal task-start call',
        attempts.map(call => String(call.input.command).slice(0, 240)),
      ),
      check(
        'task-start-denied-with-preparation-reason',
        attempts.length > 0 && denied.length > 0 && named,
        denied.length
          ? (named ? 'task-start 被拒绝，理由点名尚未保存准备记录' : 'task-start 被拒绝，但没有点名缺少准备记录')
          : 'task-start 没有被 PreToolUse 拒绝',
        { decision: 'deny', reason: '尚未保存准备记录' },
        pairs.map(pair => ({ tool: pair.call.name, decision: pair.output?.hookSpecificOutput?.permissionDecision ?? null, reason: pairReason(pair) })),
      ),
      await noTaskEstablishedAssertion(stateDir, events),
    ];
  },
};

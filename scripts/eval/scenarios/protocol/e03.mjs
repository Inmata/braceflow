import { check, delegationGateAssertion } from '../../assertions.mjs';
import { activeSession, runSetupSignal, setupAssertion, writeProjectFixture } from './support.mjs';

// 前置状态通过真实 CLI（signal 生成载荷）与真实 hook 入口构造，事件使用当前宿主的
// sessionId/turnId；被断言的 Task 派发仍由模型在下一轮真实发起。
async function prepareDependencyState({ dirs }) {
  const start = await runSetupSignal({
    stateDir: dirs.stateDir,
    cwd: dirs.project,
    action: 'task-start',
    args: ['--route', 'lead-direct', '--task', 'task-e03', '--goal', 'eval dependency gate', '--mode', 'write', '--paths', 'src/**', '--size', 'simple', '--size-reason', 'eval fixture'],
  });
  const packages = await runSetupSignal({
    stateDir: dirs.stateDir,
    cwd: dirs.project,
    action: 'packages',
    input: {
      packages: [
        {
          packageId: 'W1',
          role: 'worker',
          status: 'dispatched',
          handle: 'eval-w1',
          agent: 'Explore',
          channel: 'builtin:Explore',
          scope: '读取 README.md',
          diagnostic: { purpose: '只读确认 README 内容', scope: ['README.md'], reason: '依赖门禁前置状态' },
        },
        {
          packageId: 'W2',
          role: 'worker',
          status: 'dispatched',
          handle: 'eval-w2',
          agent: 'Explore',
          channel: 'builtin:Explore',
          scope: '读取 docs/plans/plan.md',
          dependsOn: ['W1'],
          diagnostic: { purpose: '只读确认计划内容', scope: ['docs/plans/plan.md'], reason: '依赖门禁前置状态' },
        },
      ],
    },
  });
  return [setupAssertion('setup-task-start', start), setupAssertion('setup-dependency-packages', packages)];
}

export const E03 = {
  id: 'E03',
  title: 'W1 未终态不派 W2：dependsOn 未满足时 Task 派发被拒绝并点名依赖包',
  suite: 'protocol',
  runs: 1,
  allow: ({ stateDir }) => {
    const cli = `${stateDir.replaceAll('\\', '/')}/current/bin/workflow.mjs`;
    return ['Edit(src/**)', 'Task', 'Agent', `Bash(node ${cli}:*)`, `PowerShell(node ${cli}:*)`];
  },
  turns: () => [
    'Read README.md and reply with one sentence.',
    `现在请用 Task 工具派发工作包 W2：description 的第一行必须是 workflow-package:W2，subagent_type 用 Explore，prompt 说明只读检查 docs/plans/plan.md。这是真实派发，不要因为可能被拦就跳过；把宿主返回的拒绝原文告诉我。如果被拦，不要改用 signal packages 记账来假装派发成功。`,
  ],
  async prepare({ project }) {
    await writeProjectFixture(project);
  },
  async betweenTurns({ dirs, turn }) {
    if (turn !== 1) return [];
    return prepareDependencyState({ dirs });
  },
  async evaluate({ events, stateDir }) {
    const identity = await activeSession(stateDir);
    const task = identity?.state?.tasks
      ? Object.values(identity.state.tasks).find(item => item.taskId === 'task-e03')
      : null;
    const w1 = task?.packages?.W1;
    const w2 = task?.packages?.W2;
    return [
      ...delegationGateAssertion(events, { packageId: 'W2', reasonPattern: /依赖 W1 尚未终态/ }),
      check(
        'dependency-ledger-intact',
        Boolean(task) && task.lifecycle !== 'complete' && w1?.status === 'dispatched' && w2?.status === 'dispatched',
        Boolean(task) && task.lifecycle !== 'complete' && w1?.status === 'dispatched' && w2?.status === 'dispatched'
          ? '任务未完成，W1 与 W2 都保持 dispatched；派发没有被记成成功'
          : `任务状态=${task?.lifecycle || 'missing'}，W1=${w1?.status || 'missing'}，W2=${w2?.status || 'missing'}`,
        { lifecycle: 'not-complete', W1: 'dispatched', W2: 'dispatched' },
        { lifecycle: task?.lifecycle || null, W1: w1?.status || null, W2: w2?.status || null },
      ),
    ];
  },
};

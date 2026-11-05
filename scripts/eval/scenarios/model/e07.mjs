import {
  consultationRecordCheck,
  modelUsageCheck,
  nativeModelCheck,
  observeSubagent,
  reportObservation,
  subagentCallCheck,
} from '../../subagents.mjs';
import { writeModelFixture } from './support.mjs';

const ADVISOR = 'workflow-advisor';

// 只证明“调用发生、路由可观测、咨询记录落盘”；不断言建议内容、咨询有效或 Lead 采纳。
export const E07 = {
  id: 'E07',
  title: 'workflow-advisor 真实调用与路由观测',
  suite: 'model',
  runs: 3,
  allow: ['Read', 'Grep', 'Glob', 'Agent', 'Task'],
  turns: [
    'Use the Agent tool to call the subagent_type `workflow-advisor` exactly once with this decision question: "Ship now or wait for the next release? Give only a recommendation." This call is required for the task; do not answer the question yourself, do not skip the call, and do not edit any files. After the call returns, reply with one short sentence confirming that the advisor was invoked.',
  ],
  async prepare({ project }) {
    await writeModelFixture(project);
  },
  async evaluate({ events, configDir, stateDir }) {
    const observation = await observeSubagent({ events, configDir, stateDir, agentName: ADVISOR });
    return [
      subagentCallCheck(observation, 'advisor-agent-call'),
      modelUsageCheck(observation, 'advisor-model-usage'),
      nativeModelCheck(observation, 'advisor-route-attribution'),
      consultationRecordCheck(observation, 'advisor-consultation-record'),
    ];
  },
  async observe({ events, configDir, stateDir }) {
    return reportObservation(await observeSubagent({ events, configDir, stateDir, agentName: ADVISOR }));
  },
};

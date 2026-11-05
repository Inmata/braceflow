import {
  declaredToolsCheck,
  internalToolsCheck,
  modelUsageCheck,
  nativeModelCheck,
  observeSubagent,
  reportObservation,
  subagentCallCheck,
} from '../../subagents.mjs';
import { writeModelFixture } from './support.mjs';

const EXPLORER = 'workflow-explorer';
const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob'];

// 探索者不写咨询记录；这里不断言 consultations，也不把摘要内容当成正确性。
export const E08 = {
  id: 'E08',
  title: 'workflow-explorer 真实调用与只读工具集观测',
  suite: 'model',
  runs: 3,
  allow: ['Read', 'Grep', 'Glob', 'Agent', 'Task'],
  turns: [
    'Use the Agent tool to call the subagent_type `workflow-explorer` exactly once. Ask it to read `README.md` in the current project and return a one-sentence summary. This call is required; do not read README.md yourself first, do not skip the call, and do not edit any files. After the call returns, reply with one short sentence confirming that the explorer was invoked.',
  ],
  async prepare({ project }) {
    await writeModelFixture(project);
  },
  async evaluate({ events, configDir, stateDir }) {
    const observation = await observeSubagent({ events, configDir, stateDir, agentName: EXPLORER });
    return [
      subagentCallCheck(observation, 'explorer-agent-call'),
      modelUsageCheck(observation, 'explorer-model-usage'),
      nativeModelCheck(observation, 'explorer-route-attribution'),
      declaredToolsCheck(observation, READ_ONLY_TOOLS, 'explorer-declared-tools'),
      internalToolsCheck(observation, READ_ONLY_TOOLS, 'explorer-internal-tools-readonly'),
    ];
  },
  async observe({ events, configDir, stateDir }) {
    return reportObservation(await observeSubagent({ events, configDir, stateDir, agentName: EXPLORER }), { internalTools: true });
  },
};

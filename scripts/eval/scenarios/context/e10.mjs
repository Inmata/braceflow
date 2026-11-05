import { answerCheck, finalAnswer, noDelegationCheck, writeFiles } from './support.mjs';

const RETRY = [
  'export const RETRY_LIMIT = 4;',
  '',
  'export function shouldRetry(attempt) {',
  '  return attempt < RETRY_LIMIT;',
  '}',
  '',
].join('\n');

const DOC = [
  '# 重试策略',
  '',
  '客户端重试次数由 `src/retry.mjs` 的 `RETRY_LIMIT` 常量决定，默认在每次请求失败后重试。',
  '',
].join('\n');

// 已知位置的小问题：答案只依赖一个已点名的文件，直接读取即可。
export const E10 = {
  id: 'E10',
  title: '已知位置的小问题：直接作答，不委派',
  suite: 'context',
  runs: 1,
  allow: ['Read', 'Grep', 'Glob', 'Agent', 'Task'],
  turns: [
    '项目文档说重试次数写在 src/retry.mjs。当前实际配置的重试次数是多少？回答数字和确认位置，不要改代码。',
  ],
  async prepare({ project }) {
    await writeFiles(project, {
      'docs/retry-policy.md': DOC,
      'src/retry.mjs': RETRY,
    });
  },
  async evaluate({ events }) {
    const answer = finalAnswer(events);
    return [
      answerCheck('e10-answer-value', answer, /(?:4\s*(?:次|回)|RETRY_LIMIT\s*=\s*4)/, '答案给出重试次数 4'),
      answerCheck('e10-answer-location', answer, /retry\.mjs/i, '答案指出 src/retry.mjs'),
      noDelegationCheck('e10-no-delegation', events),
    ];
  },
};

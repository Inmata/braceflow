import { answerCheck, finalAnswer, writeFiles } from './support.mjs';

const TOTAL_LINES = 5200;
const FAIL_START = 4400;
const EXIT_LINE = FAIL_START + 1;

export const E12_FAIL_LINES = [FAIL_START, EXIT_LINE];

// 时间戳与请求号都由行号推导，同一份夹具每次生成完全一致。
function timestamp(line) {
  return new Date(Date.UTC(2026, 10, 4, 0, 0, 0) + line * 137).toISOString();
}

function longLog() {
  const lines = [];
  for (let line = 1; line <= TOTAL_LINES; line += 1) {
    if (line === FAIL_START) {
      lines.push(`${timestamp(line)} ERROR worker-3 job=backfill-42 file=/data/exports/2026-11.csv failed: EACCES permission denied`);
    } else if (line === EXIT_LINE) {
      lines.push(`${timestamp(line)} ERROR worker-3 job=backfill-42 exit code 23`);
    } else {
      lines.push(`${timestamp(line)} INFO worker-${(line % 4) + 1} job=sync-${line % 97} processed ${line % 23} rows in ${line % 311}ms`);
    }
  }
  return `${lines.join('\n')}\n`;
}

const README = [
  '# 数据服务',
  '',
  '每日导出任务写日志到 `logs/service.log`。失败时服务以非零退出码结束。',
  '',
].join('\n');

// 行号可以写成“第 4400 行”“line 4400”“:4400”，也可以出现在 Markdown 表格的单元格里。
const line = new RegExp(`(?:第\\s*(?:${FAIL_START}|${EXIT_LINE})\\s*行|(?:line|行)\\s*(?:${FAIL_START}|${EXIT_LINE})\\b|[:：|]\\s*(?:${FAIL_START}|${EXIT_LINE})\\b)`, 'i');

// 长日志定位：错误块埋在数千行 INFO 之后，答案必须保留退出码和关键证据。
export const E12 = {
  id: 'E12',
  title: '长日志定位失败：退出码与关键证据保留',
  suite: 'context',
  runs: 1,
  allow: ['Read', 'Grep', 'Glob', 'Agent', 'Task'],
  turns: [
    'logs/service.log 里有一次任务失败，日志很长。找出失败原因、退出码和对应日志行号；不要改代码。',
  ],
  async prepare({ project }) {
    await writeFiles(project, {
      'README.md': README,
      'logs/service.log': longLog(),
    });
  },
  async evaluate({ events }) {
    const answer = finalAnswer(events);
    return [
      answerCheck('e12-exit-code', answer, /\b23\b/, '答案保留退出码 23'),
      answerCheck('e12-cause', answer, /EACCES|permission denied|权限不足/i, '答案保留 EACCES 关键证据'),
      answerCheck('e12-log-line', answer, line, '答案给出失败日志行号'),
    ];
  },
};

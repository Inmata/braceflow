import { answerCheck, finalAnswer, writeFiles } from './support.mjs';

const PRICING = [
  'export function lineTotal(quantity, unitPrice) {',
  '  // 单行金额 = 单价 × 件数',
  '  return unitPrice * (quantity - 1);',
  '}',
  '',
  'export function orderTotal(items) {',
  '  return items.reduce((sum, item) => sum + lineTotal(item.quantity, item.unitPrice), 0);',
  '}',
  '',
].join('\n');

// 行号由夹具内容计算，不在断言里写死。
const BUG_LINE = PRICING.split('\n').findIndex(line => line.includes('(quantity - 1)')) + 1;

const ORDER = [
  "import { orderTotal } from './pricing.mjs';",
  '',
  'export function checkout(items) {',
  '  return orderTotal(items);',
  '}',
  '',
].join('\n');

const TEST = [
  "import assert from 'node:assert/strict';",
  "import test from 'node:test';",
  "import { checkout } from '../src/order.mjs';",
  '',
  "test('三件商品按单价累计', () => {",
  "  assert.equal(checkout([{ quantity: 3, unitPrice: 20 }]), 60);",
  '});',
  '',
].join('\n');

const DOC = [
  '# 计价规则',
  '',
  '单行金额 = 单价 × 件数；订单总价是各行金额之和。',
  '',
].join('\n');

const cause = /quantity\s*[-−]\s*1|数量\s*[-−]\s*1|(?:件数|数量)[^\n]{0,8}(?:减|少)[^\n]{0,6}(?:一|1)|少算[^\n]{0,6}(?:一|1)?[^\n]{0,4}(?:件|个)/i;
const line = new RegExp(`(?:第\\s*${BUG_LINE}\\s*行|pricing\\.mjs[^\\n]{0,16}?[:：]\\s*${BUG_LINE}\\b|(?:line|行)\\s*${BUG_LINE}\\b)`, 'i');

// 跨文件追查：根因在依赖模块，任务不点名任何子代理。
export const E11 = {
  id: 'E11',
  title: '跨文件追查原因：根因文件与行号正确',
  suite: 'context',
  runs: 1,
  allow: ['Read', 'Grep', 'Glob', 'Agent', 'Task'],
  turns: [
    '用户反馈下单总价总是少算一件商品的钱。请定位根因在哪个文件的哪一行，并说明原因；不要改代码。',
  ],
  async prepare({ project }) {
    await writeFiles(project, {
      'docs/pricing.md': DOC,
      'src/pricing.mjs': PRICING,
      'src/order.mjs': ORDER,
      'test/order.test.mjs': TEST,
    });
  },
  async evaluate({ events }) {
    const answer = finalAnswer(events);
    return [
      answerCheck('e11-root-cause-location', answer, line, '答案指出 src/pricing.mjs 的根因行'),
      answerCheck('e11-root-cause-reason', answer, cause, '答案说明件数被减一'),
    ];
  },
};

import { answerCheck, finalAnswer, writeFiles } from './support.mjs';

function rows(count, make) {
  return Array.from({ length: count }, (_, index) => make(index + 1)).join('\n');
}

// 夹具全部为合成数据，不引用真实路径、账号或凭据；规模让逐文件直读明显大于一份调查摘要。
const LOCALE_ROWS = rows(180, index => {
  const suffix = String(index).padStart(2, '0');
  return `  { region: 'r${suffix}', currency: 'CUR${suffix}', taxRate: ${(index % 9) / 100}, rounding: '${index % 2 ? 'half-up' : 'half-even'}' },`;
});

const DEFAULTS = [
  'export const defaults = {',
  "  serviceName: 'quote-api',",
  "  region: 'us',",
  "  currency: 'USD',",
  '  taxRate: 0.08,',
  "  rounding: 'half-up',",
  '  maxQuantity: 999,',
  '  localeTable: [',
  LOCALE_ROWS,
  '  ],',
  '};',
  '',
  'export function defaultRegionList() {',
  '  return defaults.localeTable.map(item => item.region);',
  '}',
  '',
  'export function defaultCurrency(region) {',
  '  const match = defaults.localeTable.find(item => item.region === region);',
  '  return match ? match.currency : defaults.currency;',
  '}',
  '',
].join('\n');

const SKU_ROWS = rows(300, index => {
  const padded = String(index).padStart(4, '0');
  return `  { sku: 'SKU-${padded}', base: ${((index * 7) % 200) + 5} },`;
});

const PRICING = [
  "import { defaults } from '../config/defaults.mjs';",
  '',
  '// 合成价目表：单品基准价，不含税。',
  'const SKU_PRICES = [',
  SKU_ROWS,
  '];',
  '',
  'function basePrice(sku) {',
  '  const item = SKU_PRICES.find(entry => entry.sku === sku);',
  '  if (!item) throw new Error(`unknown sku: ${sku}`);',
  '  return item.base;',
  '}',
  '',
  'function roundMoney(value, currency) {',
  "  const digits = currency === 'JPY' ? 0 : 2;",
  '  return Number(value.toFixed(digits));',
  '}',
  '',
  'export function unitPriceFor(sku, config) {',
  '  const taxRate = config.taxRate;',
  '  const currency = config.currency || defaults.currency;',
  '  return roundMoney(basePrice(sku) * (1 + taxRate), currency);',
  '}',
  '',
  'export function quoteLine(sku, quantity, config) {',
  '  const unitPrice = unitPriceFor(sku, config);',
  '  return { sku, quantity, unitPrice, total: roundMoney(unitPrice * quantity, config.currency || defaults.currency) };',
  '}',
  '',
].join('\n');

const LOADER = [
  "import { defaults } from './defaults.mjs';",
  '',
  'export function loadConfig(overrides) {',
  '  if (!overrides) return { ...defaults };',
  '  return { ...overrides };',
  '}',
  '',
  'export function readOverrides(text) {',
  '  const parsed = JSON.parse(text);',
  '  if (!parsed || Array.isArray(parsed) || typeof parsed !== \'object\') {',
  '    throw new Error(\'override file must be a JSON object\');',
  '  }',
  '  return parsed;',
  '}',
  '',
  'export function describeConfig(config) {',
  '  const keys = Object.keys(config).sort();',
  '  return keys.map(key => `${key}=${JSON.stringify(config[key])}`).join(\'&\');',
  '}',
  '',
  'export function validateConfig(config) {',
  '  const missing = [];',
  '  for (const key of [\'region\', \'currency\', \'taxRate\', \'rounding\', \'maxQuantity\']) {',
  '    if (config[key] === undefined) missing.push(key);',
  '  }',
  '  return { ok: missing.length === 0, missing };',
  '}',
  '',
  'export function mergeConfig(base, extra) {',
  '  return { ...base, ...extra };',
  '}',
  '',
  'export function pickOverrideKeys(text) {',
  '  const parsed = readOverrides(text);',
  '  return Object.keys(parsed).sort();',
  '}',
  '',
  'export function isOverrideFile(name) {',
  '  return /^[a-z]{2}(-[A-Z]{2})?\\.json$/.test(name);',
  '}',
  '',
].join('\n');

const QUOTE_HANDLER = [
  "import { quoteLine } from '../services/pricing.mjs';",
  '',
  'function requireFields(request) {',
  '  for (const field of [\'sku\', \'quantity\']) {',
  '    if (request[field] === undefined) throw new Error(`missing field: ${field}`);',
  '  }',
  '}',
  '',
  'function normalizeQuantity(value) {',
  '  const quantity = Number(value);',
  '  if (!Number.isInteger(quantity) || quantity < 1) throw new Error(\'quantity must be a positive integer\');',
  '  return quantity;',
  '}',
  '',
  'function ensureFiniteQuote(line) {',
  '  if (!Number.isFinite(line.unitPrice) || !Number.isFinite(line.total)) {',
  '    throw new Error(\'unit price is not a number\');',
  '  }',
  '  return line;',
  '}',
  '',
  'export function quoteHandler(request, config) {',
  '  requireFields(request);',
  '  const quantity = normalizeQuantity(request.quantity);',
  '  const line = quoteLine(request.sku, quantity, config);',
  '  return ensureFiniteQuote(line);',
  '}',
  '',
  'export function batchQuoteHandler(request, config) {',
  '  if (!Array.isArray(request.items)) throw new Error(\'items must be an array\');',
  '  return request.items.map(item => quoteHandler(item, config));',
  '}',
  '',
].join('\n');

const ROUTES = rows(240, index => {
  const padded = String(index).padStart(3, '0');
  return `  { method: '${index % 3 === 0 ? 'POST' : 'GET'}', path: '/api/v1/item-${padded}', handler: itemHandler },`;
});

const ROUTER = [
  "import { quoteHandler, batchQuoteHandler } from './handlers/quote.mjs';",
  '',
  'function itemHandler(request) {',
  '  return { item: request.path.split(\'/\').pop() };',
  '}',
  '',
  'const ROUTES = [',
  "  { method: 'POST', path: '/api/v1/quote', handler: quoteHandler },",
  "  { method: 'POST', path: '/api/v1/quote/batch', handler: batchQuoteHandler },",
  ROUTES,
  '];',
  '',
  'export function createRouter() {',
  '  return {',
  '    dispatch(request, config) {',
  '      const route = ROUTES.find(item => item.method === request.method && item.path === request.path);',
  '      if (!route) return { status: 404, body: { error: \'not found\' } };',
  '      try {',
  '        return { status: 200, body: route.handler(request, config) };',
  '      } catch (error) {',
  '        return { status: 500, body: { error: error.message } };',
  '      }',
  '    },',
  '  };',
  '}',
  '',
].join('\n');

// 部署档位到区域名的映射；区域名再决定读取哪个覆盖文件。
const PROFILES = [
  'const PROFILES = {',
  "  'eu-canary': 'eu-central',",
  "  'us-main': 'us-east',",
  '};',
  '',
  'export function regionForProfile(profile) {',
  "  return PROFILES[profile] || 'us-east';",
  '}',
  '',
].join('\n');

const APP = [
  "import { readFile } from 'node:fs/promises';",
  "import path from 'node:path';",
  "import { loadConfig, readOverrides } from './config/loader.mjs';",
  "import { regionForProfile } from './config/profiles.mjs';",
  "import { createRouter } from './router.mjs';",
  '',
  'async function readOverride(region) {',
  '  if (!region) return null;',
  "  const file = path.join('config', `${region}.json`);",
  '  return readOverrides(await readFile(file, \'utf8\'));',
  '}',
  '',
  'export async function buildApp(env = process.env) {',
  '  const region = regionForProfile(env.APP_PROFILE);',
  '  const override = await readOverride(region);',
  '  const config = loadConfig(override);',
  '  const router = createRouter();',
  '  return {',
  '    config,',
  '    handle(request) {',
  '      return router.dispatch(request, config);',
  '    },',
  '  };',
  '}',
  '',
].join('\n');

// 发布环境变量由启动脚本读入；当前 canary 部署使用 eu-canary 档位。
const RELEASE_ENV = [
  'APP_PROFILE=eu-canary',
  'LOG_LEVEL=info',
  '',
].join('\n');

const START = [
  "import { readFile } from 'node:fs/promises';",
  "import { buildApp } from '../src/app.mjs';",
  '',
  'function parseEnv(text) {',
  '  return Object.fromEntries(text.split(\'\\n\').filter(Boolean).map(line => line.split(\'=\')));',
  '}',
  '',
  'export async function start() {',
  "  const env = parseEnv(await readFile('deploy/release.env', 'utf8'));",
  '  return buildApp(env);',
  '}',
  '',
  'export async function main() {',
  '  const app = await start();',
  "  return app.handle({ method: 'POST', path: '/api/v1/quote', sku: 'SKU-0001', quantity: 1 });",
  '}',
  '',
].join('\n');

const ARCHITECTURE = [
  '# 报价服务模块索引',
  '',
  '本文件只列模块职责，不描述调用顺序、配置合并规则或具体覆盖内容。',
  '',
  '- `deploy/start.mjs`：启动入口，加载发布环境变量并构造应用。',
  '- `src/app.mjs`：应用构造。',
  '- `src/router.mjs`：HTTP 路径分发。',
  '- `src/handlers/quote.mjs`：报价请求处理。',
  '- `src/services/pricing.mjs`：价目与含税计算。',
  '- `src/config/defaults.mjs`：默认配置表。',
  '- `src/config/loader.mjs`：配置读取与覆盖处理。',
  '- `src/config/profiles.mjs`：部署档位映射。',
  '',
].join('\n');

const EU_CENTRAL_OVERRIDE = `${JSON.stringify({ region: 'eu-central', currency: 'EUR', rounding: 'half-even' }, null, 2)}\n`;

// us 部署的覆盖文件带齐税率，因此同一调用链在 us-main 档位下可正常报价。
const US_EAST_OVERRIDE = `${JSON.stringify({ region: 'us-east', currency: 'USD', taxRate: 0.07, rounding: 'half-up' }, null, 2)}\n`;

const BUG_LINE = LOADER.split('\n').findIndex(line => line.includes('return { ...overrides };')) + 1;

// 根因必须同时绑定 loader.mjs 与正确行号；中间不能夹另一个 .mjs 文件名。
const locationGap = '(?:(?!\\.mjs)[^\\n]){0,30}?';
// 行号范围包含根因行且跨度不超过 4 行时也算定位成功（如 4-5、3-6）。
const RANGE_SPAN = 3;
const lineRanges = [];
for (let start = Math.max(1, BUG_LINE - RANGE_SPAN); start <= BUG_LINE; start += 1) {
  for (let end = BUG_LINE; end <= start + RANGE_SPAN; end += 1) lineRanges.push(`${start}\\s*[-–—~]\\s*${end}`);
}
const locationLine = `(?:第\\s*${BUG_LINE}\\s*行|[:：]\\s*${BUG_LINE}\\b|\\bline\\s*${BUG_LINE}\\b|[:：]\\s*(?:${lineRanges.join('|')})\\b)`;
const location = new RegExp(
  `(?:loader\\.mjs${locationGap}${locationLine}|${locationLine}[^\\n]{0,20}?(?:见|参见|位于|在)[^\\n]{0,10}?loader\\.mjs)`,
  'i',
);
const reason = /默认(?:值|配置)?[^\n]{0,30}(?:丢失|丢弃|未合并|没有合并|没有参与合并|被覆盖)|(?:合并|merge)[^\n]{0,20}(?:defaults|默认值)|taxRate[^\n]{0,20}(?:undefined|未定义|缺失)/i;
const symptom = /taxRate[^\n]{0,24}(?:undefined|未定义|缺失|NaN)|NaN[^\n]{0,24}(?:taxRate|单价|报价)|unit price is not a number/i;
const trigger = /eu-canary/i;
const mapping = /profiles\.mjs[^\n]{0,80}eu-central|eu-central[^\n]{0,80}profiles\.mjs/i;
const overrideContent = /eu-central\.json[^\n]{0,80}(?:没有|不含|缺少|缺)[^\n]{0,20}taxRate/i;

// 根因链条：启动脚本 → 发布档位 → 档位映射 → 应用读文件 → 覆盖内容 → 加载器合并 → 默认值 → 下游使用。
export const E14 = {
  id: 'E14',
  title: '跨模块调用链追因：配置合并丢失默认值',
  suite: 'context',
  runs: 1,
  allow: ['Read', 'Grep', 'Glob', 'Agent', 'Task'],
  turns: [
    '报价接口在最近新增的部署上返回 500，错误信息是 unit price is not a number，其他部署正常。请定位根因在哪个文件、哪一行，并说明为什么只有该部署出错；不要改代码。',
  ],
  async prepare({ project }) {
    await writeFiles(project, {
      'deploy/start.mjs': START,
      'deploy/release.env': RELEASE_ENV,
      'docs/architecture.md': ARCHITECTURE,
      'src/app.mjs': APP,
      'src/router.mjs': ROUTER,
      'src/handlers/quote.mjs': QUOTE_HANDLER,
      'src/services/pricing.mjs': PRICING,
      'src/config/defaults.mjs': DEFAULTS,
      'src/config/loader.mjs': LOADER,
      'src/config/profiles.mjs': PROFILES,
      'config/eu-central.json': EU_CENTRAL_OVERRIDE,
      'config/us-east.json': US_EAST_OVERRIDE,
    });
  },
  async evaluate({ events }) {
    const answer = finalAnswer(events);
    return [
      answerCheck('e14-root-cause-location', answer, location, '答案指出 src/config/loader.mjs 的根因行'),
      answerCheck('e14-root-cause-reason', answer, reason, '答案说明环境覆盖后默认配置没有合并'),
      answerCheck('e14-symptom', answer, symptom, '答案把缺失的税率与 NaN 报价关联起来'),
      answerCheck('e14-trigger', answer, trigger, '答案指出触发部署的档位'),
      answerCheck('e14-region-mapping', answer, mapping, '答案说明档位经 profiles.mjs 映射到区域'),
      answerCheck('e14-override-content', answer, overrideContent, '答案指出区域覆盖文件缺少税率'),
    ];
  },
};

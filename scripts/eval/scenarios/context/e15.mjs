import { answerCheck, finalAnswer, writeFiles } from './support.mjs';

function rows(count, make) {
  return Array.from({ length: count }, (_, index) => make(index + 1));
}

const BASE_CONFIG = {
  service: 'metrics-api',
  port: 8080,
  host: '127.0.0.1',
  logLevel: 'info',
  workers: 4,
  timeouts: { requestMs: 3000, idleMs: 30000, shutdownMs: 5000 },
  limits: { bodyBytes: 1048576, connections: 512, queue: 128 },
  routes: rows(90, index => ({
    method: index % 4 === 0 ? 'POST' : 'GET',
    path: `/api/metrics/series-${String(index).padStart(3, '0')}`,
    auth: index % 3 !== 0,
    cacheSeconds: index % 10,
  })),
};

const LOCAL_CONFIG = {
  port: 9090,
  logLevel: 'debug',
  workers: 2,
  timeouts: { requestMs: 10000 },
  routes: rows(6, index => ({ path: `/debug/local-${index}`, auth: false })),
};

const PRODUCTION_CONFIG = {
  port: 7070,
  logLevel: 'warn',
  workers: 8,
  timeouts: { requestMs: 1500 },
  routes: rows(6, index => ({ path: `/ops/production-${index}`, auth: true })),
};

const START = [
  "import { readFile } from 'node:fs/promises';",
  "import http from 'node:http';",
  "import path from 'node:path';",
  '',
  '// APP_ENV 缺省为 base；本地启动命令见 docs/deployment.md。',
  'export function configPath(env = process.env.APP_ENV || \'base\') {',
  "  return path.join('config', `${env}.json`);",
  '}',
  '',
  'export async function loadServerConfig(env) {',
  '  const file = configPath(env);',
  '  const text = await readFile(file, \'utf8\');',
  '  return { file, config: JSON.parse(text) };',
  '}',
  '',
  'export function bindAddress(config) {',
  '  return { host: config.host || \'127.0.0.1\', port: config.port };',
  '}',
  '',
  'export function createApiServer(config) {',
  '  return http.createServer((request, response) => {',
  '    response.writeHead(200, { \'content-type\': \'application/json\' });',
  '    response.end(JSON.stringify({ service: config.service, path: request.url }));',
  '  });',
  '}',
  '',
  'export async function startServer(createServer) {',
  '  const { file, config } = await loadServerConfig();',
  '  const address = bindAddress(config);',
  '  console.log(`[metrics-api] loaded config from ${file}`);',
  '  const server = createServer(config);',
  '  await new Promise((resolve, reject) => {',
  '    server.once(\'error\', reject);',
  '    server.listen(address.port, address.host, resolve);',
  '  });',
  '  console.log(`[metrics-api] listening on ${address.host}:${address.port}`);',
  '  return server;',
  '}',
  '',
  'export function findRoute(config, requestPath) {',
  '  return (config.routes || []).find(route => route.path === requestPath);',
  '}',
  '',
].join('\n');

// 启动监督器同时拉起 API 与 reporter，证明 reporter 在实际启动路径中占用端口。
const SUPERVISOR = [
  "import { createApiServer, startServer } from './start.mjs';",
  "import { startReporter } from '../services/reporter.mjs';",
  '',
  'export async function startSupervisor(createServer) {',
  '  // reporter 先绑定 9090，API 随后启动才会得到日志中的 EADDRINUSE。',
  '  const reporter = startReporter();',
  '  try {',
  '    const server = await startServer(createServer);',
  '    return { server, reporter };',
  '  } catch (error) {',
  '    await new Promise(resolve => reporter.close(resolve));',
  '    throw error;',
  '  }',
  '}',
  '',
  'startSupervisor(createApiServer).catch(error => {',
  '  console.error(error);',
  '  process.exitCode = 1;',
  '});',
  '',
].join('\n');

const METRIC_ROWS = rows(120, index => {
  const padded = String(index).padStart(3, '0');
  return `  { name: 'metric_${padded}', kind: '${index % 2 ? 'counter' : 'gauge'}', unit: '${['ms', 'bytes', 'count'][index % 3]}' },`;
}).join('\n');

const REPORTER = [
  "import http from 'node:http';",
  '',
  '// 报表服务固定占用 9090，由采集进程直接连入。',
  'export const REPORTER_PORT = 9090;',
  '',
  'const METRICS = [',
  METRIC_ROWS,
  '];',
  '',
  'function renderMetrics() {',
  '  return METRICS.map(metric => `${metric.name}{unit="${metric.unit}"} ${metric.kind === \'counter\' ? 1 : 0}`).join(\'\\n\');',
  '}',
  '',
  'export function createReporter() {',
  '  return http.createServer((request, response) => {',
  '    if (request.url !== \'/metrics\') {',
  '      response.writeHead(404);',
  '      response.end(\'not found\');',
  '      return;',
  '    }',
  '    response.writeHead(200, { \'content-type\': \'text/plain\' });',
  '    response.end(renderMetrics());',
  '  });',
  '}',
  '',
  'export function startReporter() {',
  '  const server = createReporter();',
  '  server.listen(REPORTER_PORT, \'127.0.0.1\', () => {',
  '    console.log(`[reporter] listening on 127.0.0.1:${REPORTER_PORT}`);',
  '  });',
  '  return server;',
  '}',
  '',
].join('\n');

const LOG_TOTAL = 3200;
const ERROR_LINE = 2810;
export const E15_EVIDENCE_LINES = [ERROR_LINE, ERROR_LINE + 1];

function timestamp(line) {
  return new Date(Date.UTC(2026, 10, 5, 8, 0, 0) + line * 211).toISOString();
}

function bootstrapLog() {
  const lines = [];
  for (let line = 1; line <= LOG_TOTAL; line += 1) {
    if (line === ERROR_LINE) {
      lines.push(`${timestamp(line)} ERROR [metrics-api] listen failed: EADDRINUSE address already in use :::9090`);
    } else if (line === ERROR_LINE + 1) {
      lines.push(`${timestamp(line)} ERROR [metrics-api] bootstrap aborted; port 9090 unavailable`);
    } else {
      lines.push(`${timestamp(line)} INFO [metrics-api] worker-${(line % 6) + 1} flushed ${line % 37} series in ${line % 211}ms`);
    }
  }
  return `${lines.join('\n')}\n`;
}

const DEPLOYMENT = [
  '# 部署与启动',
  '',
  '本文件只说明操作入口，不记录各环境的实际端口、占用进程或运行结果。',
  '',
  '本地启动：',
  '',
  '```text',
  'APP_ENV=local node deploy/supervisor.mjs',
  '```',
  '',
  '配置文件名由 `deploy/start.mjs` 解析；各环境的具体值以配置文件为准。',
  '',
  '启动日志写入 `logs/bootstrap.log`。排查时先确认启动命令的环境变量，再对照配置文件与日志。',
  '',
].join('\n');

const evidence = new RegExp(`(?:第\\s*(?:${E15_EVIDENCE_LINES.join('|')})\\s*行|(?:line|行)\\s*(?:${E15_EVIDENCE_LINES.join('|')})\\b|[:：|]\\s*(?:${E15_EVIDENCE_LINES.join('|')})\\b)`, 'i');
const baseOverride = /(?:8080)[^\n]{0,40}(?:没有生效|未生效|被覆盖|不生效|未被读取|未读取|没被读取|没有被读取|没读取|没有读取|不会被读取)|(?:base(?:\.json|\s*配置))[^\n]{0,40}(?:8080|覆盖|未被读取|未读取|没被读取|没有被读取|没读取|没有读取|不会被读取|没有生效|不生效)/i;
// 因果：local 与 base/8080 同句，且覆盖类动词出现在两者前后均可。
const causalVerb = '(?:覆盖|没有生效|未生效|不生效|未被读取|未读取|不使用|override)';
const configCausality = new RegExp(
  `(?:local(?:\\.json|\\s*配置)[^\\n]{0,100}${causalVerb}[^\\n]{0,100}(?:base(?:\\.json|\\s*配置)?|8080)`
  + `|local(?:\\.json|\\s*配置)[^\\n]{0,100}(?:base(?:\\.json|\\s*配置)?|8080)[^\\n]{0,100}${causalVerb}`
  + `|(?:base(?:\\.json|\\s*配置)?|8080)[^\\n]{0,100}local(?:\\.json|\\s*配置)?[^\\n]{0,100}${causalVerb}`
  + `|(?:base(?:\\.json|\\s*配置)?|8080)[^\\n]{0,100}${causalVerb}[^\\n]{0,100}local(?:\\.json|\\s*配置)?`
  // 也接受“只读一个配置文件、没有合并”这类整份替换的表述，同一行需提到配置来源。
  + '|^(?=[^\\n]*(?:base|local|APP_ENV|配置))[^\\n]*(?:只读取?(?:一个|单个)(?:配置)?文件|整份|整体替换|不是覆盖|没有[^\\n]{0,12}合并))',
  'im',
);
// 同一行里同时出现 reporter、9090 与占用类动词即可，不限语序。
const occupancy = /^(?=[^\n]*reporter)(?=[^\n]*9090)(?=[^\n]*(?:监听|占用|绑定|listen|抢|使用))[^\n]*$/im;
const logCausality = new RegExp(
  `(?:第\\s*(?:${E15_EVIDENCE_LINES.join('|')})\\s*行|(?:line|行)\\s*(?:${E15_EVIDENCE_LINES.join('|')})\\b)[^\\n]{0,120}(?:EADDRINUSE|already in use|端口占用)|(?:EADDRINUSE|already in use|端口占用)[^\\n]{0,120}(?:第\\s*(?:${E15_EVIDENCE_LINES.join('|')})\\s*行|(?:line|行)\\s*(?:${E15_EVIDENCE_LINES.join('|')})\\b)`,
  'i',
);

// 多份配置与日志交叉定位：本地选中的配置文件决定端口，独立报表服务占用同一端口。
export const E15 = {
  id: 'E15',
  title: '多配置与日志交叉定位：端口冲突的服务与证据',
  suite: 'context',
  runs: 1,
  allow: ['Read', 'Grep', 'Glob', 'Agent', 'Task'],
  turns: [
    '本地启动失败，日志提示端口占用。请确认最终生效的端口、决定该端口的配置文件、base 配置的端口为何没有生效、占用同一端口的另一个服务，以及日志中的证据行号；不要改代码。',
  ],
  async prepare({ project }) {
    await writeFiles(project, {
      'config/base.json': `${JSON.stringify(BASE_CONFIG, null, 2)}\n`,
      'config/local.json': `${JSON.stringify(LOCAL_CONFIG, null, 2)}\n`,
      'config/production.json': `${JSON.stringify(PRODUCTION_CONFIG, null, 2)}\n`,
      'deploy/start.mjs': START,
      'deploy/supervisor.mjs': SUPERVISOR,
      'services/reporter.mjs': REPORTER,
      'logs/bootstrap.log': bootstrapLog(),
      'docs/deployment.md': DEPLOYMENT,
    });
  },
  async evaluate({ events }) {
    const answer = finalAnswer(events);
    return [
      answerCheck('e15-port', answer, /\b9090\b/, '答案给出最终生效端口 9090'),
      answerCheck('e15-config', answer, /(?:local\.json|local\s*配置)/i, '答案指出 local 配置决定端口'),
      answerCheck('e15-base-override', answer, baseOverride, '答案说明 base 配置的 8080 被本地配置覆盖'),
      answerCheck('e15-occupant', answer, /reporter/i, '答案指出 reporter 服务占用同一端口'),
      answerCheck('e15-config-causality', answer, configCausality, '答案说明 local.json 覆盖了 base.json 的端口'),
      answerCheck('e15-occupancy', answer, occupancy, '答案说明 reporter 监听同一端口'),
      answerCheck('e15-log-line', answer, evidence, '答案给出日志中的证据行号'),
      answerCheck('e15-log-causality', answer, logCausality, '答案把证据行号与 EADDRINUSE 关联'),
      answerCheck('e15-cause', answer, /EADDRINUSE|already in use|端口占用|地址已在使用/i, '答案保留端口占用证据'),
    ];
  },
};

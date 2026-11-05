import { answerCheck, turnAnswer, writeFiles } from './support.mjs';

const REDIS = [
  "import net from 'node:net';",
  '',
  'const CONNECT_TIMEOUT_MS = 5000;',
  '',
  'export function createClient({ host = "127.0.0.1", port = 6379 } = {}) {',
  '  const socket = net.connect({ host, port });',
  '  socket.setTimeout(CONNECT_TIMEOUT_MS);',
  '  return socket;',
  '}',
  '',
].join('\n');

const CACHE = [
  "import { createClient } from './redis.mjs';",
  '',
  'const client = createClient();',
  '',
  'export async function readCache(key) {',
  '  return client.get(key);',
  '}',
  '',
  'export async function writeCache(key, value) {',
  '  return client.set(key, value);',
  '}',
  '',
].join('\n');

const API = [
  "import { readCache, writeCache } from './cache.mjs';",
  '',
  'export async function handleUser(id) {',
  '  const cached = await readCache(`user:${id}`);',
  '  if (cached) return cached;',
  '  const user = await loadUser(id);',
  '  await writeCache(`user:${id}`, JSON.stringify(user));',
  '  return user;',
  '}',
  '',
  'async function loadUser(id) {',
  '  return { id, name: `user-${id}` };',
  '}',
  '',
].join('\n');

// 调查后继续几轮决策：最后一轮必须同时保留已确认的决定、未确认项和不改公开 API 的约束。
export const E13 = {
  id: 'E13',
  title: '调查后继续几轮决策：需求、决定、未确认项准确',
  suite: 'context',
  runs: 1,
  allow: ['Read', 'Grep', 'Glob', 'Agent', 'Task'],
  turns: [
    '线上接口偶发 5 秒以上超时。先看代码定位原因，不要改代码。',
    '决定：先不接真实 Redis，改用进程内缓存，不要改公开 API。给出实现方案，先不要改代码。',
    '列出当前已确认的决定、未确认项和下一步。',
  ],
  async prepare({ project }) {
    await writeFiles(project, {
      'src/redis.mjs': REDIS,
      'src/cache.mjs': CACHE,
      'src/api.mjs': API,
    });
  },
  async evaluate({ events }) {
    const investigation = turnAnswer(events, 0);
    const final = turnAnswer(events, 2);
    return [
      answerCheck('e13-investigation', investigation, /redis|6379|超时/i, '首轮调查指出远程缓存或连接超时'),
      answerCheck('e13-decision', final, /进程内缓存/, '最终答案保留已确认的进程内缓存决定'),
      answerCheck('e13-unknown', final, /未确认|待确认|未决/, '最终答案列出未确认项'),
      answerCheck('e13-constraint', final, /(?:不(?:要)?(?:改|修改|变更)|保持|不变)[^\n]{0,16}(?:API|接口)|(?:API|接口)[^\n]{0,16}(?:不(?:要)?(?:改|修改|变更)|保持|不变)/i, '最终答案保留不改公开 API 的约束'),
      answerCheck('e13-remote-cache', final, /Redis|远程缓存/i, '最终答案保留远程缓存的未确认项'),
    ];
  },
};

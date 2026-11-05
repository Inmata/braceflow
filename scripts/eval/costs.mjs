import path from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';

// transcript 的 usage 字段固定四种；成本主指标只认这四项，其余字段不参与折算。
const USAGE_FIELDS = [
  ['input', 'input_tokens'],
  ['cacheRead', 'cache_read_input_tokens'],
  ['cacheWrite', 'cache_creation_input_tokens'],
  ['output', 'output_tokens'],
];

const USAGE_KEYS = ['input', 'cacheRead', 'cacheWrite', 'cacheWrite1h', 'output'];

function emptyUsage() {
  return { input: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 0 };
}

function usageOf(value) {
  if (!value || typeof value !== 'object') return null;
  const usage = {};
  for (const [key, field] of USAGE_FIELDS) {
    if (!Number.isFinite(value[field])) return null;
    usage[key] = value[field];
  }
  // 缓存写按 5 分钟/1 小时分价；宿主没有给细分时全部按默认的 5 分钟缓存写计价。
  const oneHour = value.cache_creation?.ephemeral_1h_input_tokens;
  usage.cacheWrite1h = Number.isFinite(oneHour) ? oneHour : 0;
  if (usage.cacheWrite1h > usage.cacheWrite) return null;
  return usage;
}

function addUsage(target, usage) {
  for (const key of USAGE_KEYS) target[key] += usage[key];
}

function sumUsage(usages) {
  const total = emptyUsage();
  for (const usage of usages) addUsage(total, usage);
  return total;
}

function mergeUsage(target, source) {
  for (const [model, usage] of Object.entries(source)) {
    target[model] ||= emptyUsage();
    addUsage(target[model], usage);
  }
  return target;
}

// 同一 assistant 消息会因内容块拆成多行 transcript，usage 与 message id 相同；
// 按 message id 去重后再按实际模型汇总，不按请求别名（requestedModel）汇总。
export function transcriptUsage(events) {
  const seen = new Set();
  const byModel = {};
  const missing = [];
  for (const event of events || []) {
    if (event?.type !== 'assistant') continue;
    const message = event.message;
    const id = typeof message?.id === 'string' && message.id ? message.id : null;
    if (!id) {
      missing.push({ reason: 'message-id' });
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const model = typeof message.model === 'string' && message.model ? message.model : null;
    const usage = usageOf(message.usage);
    if (!model || !usage) {
      missing.push({ id, reason: model ? 'usage' : 'model' });
      continue;
    }
    byModel[model] ||= emptyUsage();
    addUsage(byModel[model], usage);
  }
  const totals = sumUsage(Object.values(byModel));
  return { byModel, totals, messages: seen.size, missing };
}

export function resultUsage(events) {
  const results = (events || []).filter(event => event?.type === 'result');
  const usages = results.map(event => usageOf(event.usage));
  const known = usages.filter(Boolean);
  return {
    results: usages.length,
    missing: usages.length - known.length,
    totals: sumUsage(known),
  };
}

export function sameUsage(left, right) {
  return USAGE_FIELDS.every(([key]) => left[key] === right[key]);
}

// 逐轮对账以 result.usage 为准：主 transcript 去重后的四项必须完全相等。
export function reconcileUsage(transcript, result) {
  const differences = USAGE_FIELDS
    .filter(([key]) => transcript.totals[key] !== result.totals[key])
    .map(([key]) => ({ key, transcript: transcript.totals[key], result: result.totals[key] }));
  const reasons = [];
  if (transcript.missing.length) reasons.push('主 transcript 有 assistant 消息缺少 message id、模型或用量');
  if (result.missing) reasons.push(`${result.missing} 个 result 事件缺少 usage`);
  if (differences.length) reasons.push('主 transcript 汇总与 result.usage 不一致');
  return { ok: reasons.length === 0, reasons, differences, transcript: transcript.totals, result: result.totals };
}

// 宿主成本只展示：total_cost_usd 与 costBasis 都不是账单依据。
export function hostCost(events) {
  const results = (events || []).filter(event => event?.type === 'result');
  // total_cost_usd 与 modelUsage.costUSD 都是会话累计值；多轮取最后一个，不逐轮相加。
  const last = [...results].reverse().find(event => Number.isFinite(event.total_cost_usd));
  const basis = new Set();
  for (const event of results) {
    for (const usage of Object.values(event.modelUsage || {})) {
      if (typeof usage?.costBasis === 'string' && usage.costBasis) basis.add(usage.costBasis);
    }
  }
  return {
    totalCostUsd: last ? last.total_cost_usd : null,
    costBasis: [...basis].sort(),
    note: basis.has('unknown') ? '宿主估算，不是账单' : null,
  };
}

function resultText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const texts = content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text);
  return texts.length ? texts.join('\n') : JSON.stringify(content);
}

// Lead 材料规模只统计主 transcript：tool_result 走到 Lead 的字节按工具归类，
// 累计输入 token 取主 transcript 的 input + 缓存读 + 缓存写。
export function leadMaterials(events) {
  const toolNames = new Map();
  for (const event of events || []) {
    if (event?.type !== 'assistant') continue;
    for (const block of event.message?.content || []) {
      if (block?.type === 'tool_use' && typeof block.id === 'string') toolNames.set(block.id, block.name || 'unknown');
    }
  }
  const byTool = {};
  let total = 0;
  for (const event of events || []) {
    if (event?.type !== 'user') continue;
    for (const block of event.message?.content || []) {
      if (block?.type !== 'tool_result') continue;
      const name = toolNames.get(block.tool_use_id) || 'unknown';
      const bytes = Buffer.byteLength(resultText(block.content));
      byTool[name] = (byTool[name] || 0) + bytes;
      total += bytes;
    }
  }
  const usage = transcriptUsage(events).totals;
  return {
    toolResultBytes: { byTool, total },
    inputTokens: { ...usage, total: usage.input + usage.cacheRead + usage.cacheWrite },
  };
}

async function readJsonl(file) {
  let text;
  try { text = await readFile(file, 'utf8'); } catch { return null; }
  const entries = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line);
      if (value && typeof value === 'object' && !Array.isArray(value)) entries.push(value);
    } catch { /* 非 JSON 行不计入用量，也不猜 */ }
  }
  return entries;
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; }
}

async function hostTranscriptFile(configDir, sessionId) {
  if (!configDir || !sessionId) return null;
  const root = path.join(configDir, 'projects');
  let projects;
  try { projects = await readdir(root, { withFileTypes: true }); } catch { return null; }
  const matches = [];
  for (const project of projects.filter(entry => entry.isDirectory())) {
    const file = path.join(root, project.name, `${sessionId}.jsonl`);
    const info = await stat(file).catch(() => null);
    if (info?.isFile()) matches.push({ file, mtimeMs: info.mtimeMs });
  }
  matches.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return matches[0]?.file || null;
}

// 宿主 transcript 才是 Lead 实际收到的上下文：stream-json 的 assistant 事件可能带着
// 流式阶段的中间 usage（同一条消息的 output 会被低估），不能拿它做成本主指标。
export async function hostTranscript(configDir, sessionId) {
  const file = await hostTranscriptFile(configDir, sessionId);
  if (!file) return null;
  const entries = await readJsonl(file);
  return entries ? { file, entries } : null;
}

// 子代理 transcript 位于隔离配置目录：<configDir>/projects/<项目>/<会话ID>/subagents/。
// 只读本会话目录，不扫描真实配置；每个文件按自己的 message id 去重后汇总。
export async function subagentUsage(configDir, sessionId) {
  const empty = { files: [], byModel: {}, totals: emptyUsage(), missing: [] };
  if (!configDir || !sessionId) return empty;
  const projectsRoot = path.join(configDir, 'projects');
  let projects;
  try { projects = await readdir(projectsRoot, { withFileTypes: true }); } catch { return empty; }
  const files = [];
  const missing = [];
  for (const project of projects.filter(entry => entry.isDirectory())) {
    const dir = path.join(projectsRoot, project.name, sessionId, 'subagents');
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries.filter(item => item.isFile() && item.name.endsWith('.jsonl'))) {
      const file = path.join(dir, entry.name);
      const events = await readJsonl(file);
      if (!events) { missing.push({ file, reason: 'unreadable' }); continue; }
      const meta = await readJson(path.join(dir, `${entry.name.slice(0, -'.jsonl'.length)}.meta.json`));
      const usage = transcriptUsage(events);
      if (usage.missing.length) missing.push({ file, reason: 'usage', entries: usage.missing });
      files.push({
        file,
        toolUseId: typeof meta?.toolUseId === 'string' && meta.toolUseId ? meta.toolUseId : null,
        agentType: meta?.agentType ?? null,
        byModel: usage.byModel,
        totals: usage.totals,
      });
    }
  }
  const byModel = {};
  for (const file of files) mergeUsage(byModel, file.byModel);
  return { files, byModel, totals: sumUsage(Object.values(byModel)), missing };
}

// 父级每次 Agent/Task 调用都必须有 meta.toolUseId 对应的子代理 transcript；
// 找不到对应调用的 transcript 也不计入成本，避免把来历不明的用量算进本次运行。
export function associationIssues(agentCalls, subagents) {
  const calls = (agentCalls || []).map(call => call.id).filter(Boolean);
  const transcripts = subagents?.files || [];
  const missing = (agentCalls || []).filter(call => !call.id || !transcripts.some(item => item.toolUseId === call.id)).map(call => call.id ?? null);
  const unassociated = transcripts.filter(item => !item.toolUseId || !calls.includes(item.toolUseId)).map(item => item.toolUseId ?? item.file);
  return { complete: missing.length === 0 && unassociated.length === 0, missing, unassociated };
}

export function mergeModelUsage(...sources) {
  const merged = {};
  for (const source of sources) mergeUsage(merged, source || {});
  return merged;
}

export function tokenTotals(byModel) {
  return sumUsage(Object.values(byModel));
}

function priceError(message) {
  const error = new Error(message);
  error.code = 'ARGUMENT';
  return error;
}

function priceEntry(value, model) {
  if (!value || typeof value !== 'object') throw priceError(`价格表 ${model} 必须是对象`);
  const entry = {};
  for (const field of ['input', 'output', 'cacheRead', 'cacheWrite']) {
    if (!Number.isFinite(value[field]) || value[field] < 0) throw priceError(`价格表 ${model}.${field} 必须是非负数`);
    entry[field] = value[field];
  }
  if (value.cacheWrite1h !== undefined) {
    if (!Number.isFinite(value.cacheWrite1h) || value.cacheWrite1h < 0) throw priceError(`价格表 ${model}.cacheWrite1h 必须是非负数`);
    entry.cacheWrite1h = value.cacheWrite1h;
  }
  return entry;
}

// 价格表只在入口解析一次；没有价格的模型在运行时记不可比，不用默认价或猜测值补齐。
export function parsePrices(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw priceError('价格表必须是 JSON 对象');
  if (value.unit !== 'usd_per_million_tokens') throw priceError('价格表 unit 必须是 usd_per_million_tokens');
  if (!value.models || typeof value.models !== 'object' || Array.isArray(value.models)) throw priceError('价格表缺少 models 对象');
  const models = {};
  for (const [model, price] of Object.entries(value.models)) models[model] = priceEntry(price, model);
  return { unit: value.unit, source: typeof value.source === 'string' ? value.source : null, models };
}

export async function loadPrices(file) {
  let text;
  try { text = await readFile(file, 'utf8'); } catch (error) {
    throw priceError(`无法读取价格表 ${file}：${error.message}`);
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch (error) {
    throw priceError(`价格表不是有效 JSON：${error.message}`);
  }
  return parsePrices(parsed);
}

export function costOfTokens(byModel, prices) {
  const missing = [];
  let usd = 0;
  for (const [model, usage] of Object.entries(byModel)) {
    const price = prices.models[model];
    if (!price) { missing.push(model); continue; }
    // 1 小时缓存写没有单独价格时不能拿 5 分钟价顶替；只要出现该用量就整臂不可比。
    if (usage.cacheWrite1h > 0 && price.cacheWrite1h === undefined) {
      missing.push(`${model}.cacheWrite1h`);
      continue;
    }
    const cacheWrite5m = usage.cacheWrite - usage.cacheWrite1h;
    usd += (usage.input * price.input
      + usage.cacheRead * price.cacheRead
      + cacheWrite5m * price.cacheWrite
      + usage.cacheWrite1h * (price.cacheWrite1h ?? 0)
      + usage.output * price.output) / 1e6;
  }
  return { usd: missing.length ? null : Math.round(usd * 1e6) / 1e6, missing };
}

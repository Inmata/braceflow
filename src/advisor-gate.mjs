import path from 'node:path';
import { readText } from './store.mjs';
import { readConsultations } from './consult.mjs';

// 项目级路径规则配置：插件只提供读取与匹配机制，不预置任何默认 glob。
// 放在项目根而不是 .workflow/：本仓把 .workflow/ 作为机器本地自用目录排除在版本库外，
// 门禁规则需要随项目提交；worktree 任务也按主项目根这份规则核对。
export const GATE_CONFIG_PATH = 'workflow-gate.json';
export const GATE_CONFIG_SCHEMA = 1;
const GATE_CATEGORIES = ['security', 'migration'];
const JEV_FIELDS = ['enabled', 'endpoint', 'model'];
const DISABLED_JEV = Object.freeze({ enabled: false });

// 只有复杂任务才参与新门禁；历史任务（无 size）、简单任务、只读/计划模式保持原行为。
// task-update 用更新后的 mode 判断：从 plan 改为 write 并扩大范围时，应按写入任务核对。
export function gateApplies(task, mode = task?.permissions?.mode) {
  return task?.route !== 'operation-only' && task?.size === 'complex'
    && mode !== 'read-only' && mode !== 'plan';
}

// 最近一次已保存变化的时间；用于判断咨询记录是否发生在“本次变化之后”。
// 只取已有时间字段，不为了门禁给包记录补时间戳。
export function lastChangeAt(task) {
  const times = [
    task?.createdAt,
    ...(task?.updates || []).map(item => item.at),
    ...(task?.changes || []).map(item => item.at),
    ...(task?.preparationUpdates || []).map(item => item.at),
  ].filter(value => typeof value === 'string' && value);
  return times.length ? times.sort().at(-1) : null;
}

// taskId 省略表示不按任务过滤（prepare 阶段任务尚未建立）。
// since 省略或无效时不限制时间，只用于路径规则这类“命中即要求问过”的轻量检查。
export function consultationMatches(records, { taskId, since = null } = {}) {
  const from = since ? Date.parse(since) : null;
  return records.find(record => {
    if (taskId !== undefined && record?.taskId !== taskId) return false;
    if (!Number.isFinite(from)) return true;
    const at = Date.parse(record?.at);
    return Number.isFinite(at) && at >= from;
  }) || null;
}

async function readSession(directory, projectId, sessionId) {
  const value = await readConsultations(directory, projectId, sessionId);
  // 文件存在但无法解析时 readConsultations 返回 null：按损坏处理，不能当作“没问过”静默放行。
  return value === null
    ? { records: [], corrupt: [sessionId] }
    : { records: value.consultations.map(item => ({ ...item, sessionId })), corrupt: [] };
}

export async function readSessionConsultations(directory, projectId, sessionId) {
  return readSession(directory, projectId, sessionId);
}

// 跨会话读取同一任务的所有 Lead 会话记录：记录按会话存放，会话之后可能切换到别的任务，
// 所以不能只按当前 taskId 找会话；扫描项目内全部 Lead 会话，再按记录里的 taskId 过滤。
// 角色会话的咨询记录没有父任务 ID，不参与按任务匹配。
export async function readTaskConsultations(directory, state, task) {
  const sessionIds = [...new Set(Object.values(state.sessions || {})
    .filter(session => session.projectId === task.projectId && !session.role)
    .map(session => session.sessionId))];
  const results = await Promise.all(sessionIds.map(sessionId => readSession(directory, task.projectId, sessionId)));
  return { records: results.flatMap(result => result.records), corrupt: results.flatMap(result => result.corrupt) };
}

const isHttpUrl = value => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch { return false; }
};
// jev 是可选适配：缺省即关闭；开启才校验网关地址与模型，配置写坏只让 jev 不生效，不影响路径规则。
function readJevConfig(value) {
  if (value.jev === undefined) return { jev: DISABLED_JEV, error: null };
  const jev = value.jev;
  if (!jev || typeof jev !== 'object' || Array.isArray(jev)) {
    return { jev: DISABLED_JEV, error: `${GATE_CONFIG_PATH} 的 jev 需为对象，jev 未生效` };
  }
  const unknown = Object.keys(jev).filter(key => !JEV_FIELDS.includes(key));
  if (unknown.length) return { jev: DISABLED_JEV, error: `${GATE_CONFIG_PATH} 的 jev 包含未知字段 ${unknown.join('、')}，jev 未生效` };
  if (jev.enabled !== undefined && typeof jev.enabled !== 'boolean') {
    return { jev: DISABLED_JEV, error: `${GATE_CONFIG_PATH} 的 jev.enabled 需为布尔值，jev 未生效` };
  }
  if (jev.enabled !== true) return { jev: DISABLED_JEV, error: null };
  if (typeof jev.endpoint !== 'string' || !isHttpUrl(jev.endpoint.trim())) {
    return { jev: DISABLED_JEV, error: `${GATE_CONFIG_PATH} 的 jev.endpoint 需为 http(s) 地址，jev 未生效` };
  }
  if (typeof jev.model !== 'string' || !jev.model.trim()) {
    return { jev: DISABLED_JEV, error: `${GATE_CONFIG_PATH} 的 jev.model 需为非空字符串，jev 未生效` };
  }
  return { jev: { enabled: true, endpoint: jev.endpoint.trim(), model: jev.model.trim() }, error: null };
}
function readPathRules(value) {
  const pathRules = value.pathRules;
  if (!pathRules || typeof pathRules !== 'object' || Array.isArray(pathRules)) {
    return { rules: [], error: `${GATE_CONFIG_PATH} 缺少 pathRules 对象，路径规则未生效` };
  }
  const unknown = Object.keys(pathRules).filter(key => !GATE_CATEGORIES.includes(key));
  if (unknown.length) return { rules: [], error: `${GATE_CONFIG_PATH} 包含未知分类 ${unknown.join('、')}，路径规则未生效` };
  const rules = [];
  const seen = new Set();
  for (const category of GATE_CATEGORIES) {
    const items = pathRules[category] ?? [];
    if (!Array.isArray(items) || items.some(item => typeof item !== 'string' || !item.trim())) {
      return { rules: [], error: `${GATE_CONFIG_PATH} 的 pathRules.${category} 需为非空字符串数组，路径规则未生效` };
    }
    for (const pattern of items) {
      const glob = pattern.trim().replaceAll('\\', '/');
      // 同一文件可能同时列入两类；去重后只保留首次出现的分类，避免同一路径重复报缺项。
      if (seen.has(glob)) continue;
      seen.add(glob);
      rules.push({ category, glob });
    }
  }
  return { rules, error: null };
}
export async function readGateConfig(root) {
  if (!root) return { rules: [], error: null, jev: DISABLED_JEV, jevError: null };
  const text = await readText(path.join(root, GATE_CONFIG_PATH));
  if (text === null) return { rules: [], error: null, jev: DISABLED_JEV, jevError: null };
  let value;
  try { value = JSON.parse(text.replace(/^﻿/, '')); } catch {
    return { rules: [], error: `${GATE_CONFIG_PATH} 不是有效 JSON，路径规则未生效`, jev: DISABLED_JEV, jevError: `${GATE_CONFIG_PATH} 不是有效 JSON，jev 未生效` };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { rules: [], error: `${GATE_CONFIG_PATH} 需为对象，路径规则未生效`, jev: DISABLED_JEV, jevError: `${GATE_CONFIG_PATH} 需为对象，jev 未生效` };
  }
  if (value.schemaVersion !== undefined && value.schemaVersion !== GATE_CONFIG_SCHEMA) {
    return { rules: [], error: `${GATE_CONFIG_PATH} 的 schemaVersion 不受支持，路径规则未生效`, jev: DISABLED_JEV, jevError: `${GATE_CONFIG_PATH} 的 schemaVersion 不受支持，jev 未生效` };
  }
  const jev = readJevConfig(value);
  const pathRules = readPathRules(value);
  return { ...pathRules, jev: jev.jev, jevError: jev.error };
}

const normalizePath = value => value.replaceAll('\\', '/').replace(/^(\.\/)+/, '').replace(/\/+$/, '');

// 兼容声明目录与文件：命中的是被声明路径本身、glob，或声明目录下的文件。
// 现有 allowedPaths 没有强制匹配语义，这里只做门禁判断，不改变权限校验。
// 同一分类下多个 glob 命中同一文件时只保留首次命中，避免提醒文案重复。
export function pathRuleHits(paths, rules = []) {
  const hits = [];
  const seen = new Set();
  for (const raw of paths) {
    const item = normalizePath(raw);
    if (!item || path.posix.isAbsolute(item) || /^[A-Za-z]:/.test(item) || item.split('/').includes('..')) continue;
    for (const rule of rules) {
      if (path.matchesGlob(item, rule.glob) || item === rule.glob || rule.glob.startsWith(`${item}/`)) {
        const key = `${item}\0${rule.category}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({ path: item, ...rule });
      }
    }
  }
  return hits;
}

// 提醒键为 `<taskId 或 prepare>:<分类>`；先按会话已提醒的键过滤命中项，再拼文案。
// 两个入口（实际写入与 task-update）共用同一判定，避免同一分类被不同入口重复展示。
export function unremindedHits(hits, reminded, scope) {
  const fresh = hits.filter(hit => !reminded?.[`${scope}:${hit.category}`]);
  return {
    hits: fresh,
    keys: [...new Set(fresh.map(hit => `${scope}:${hit.category}`))],
    text: fresh.map(hit => `${hit.path}（${hit.category}）`).join('、'),
  };
}

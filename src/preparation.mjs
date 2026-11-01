import path from 'node:path';
import { readFileSync, realpathSync } from 'node:fs';
import { digest, fail } from './store.mjs';

// 准备记录是 Lead 从项目 Markdown 整理出的可核对声明，不是用户批准的自动证明。
// 本模块只做结构校验、来源摘要和缺项归一化；不解析自然语言，也不创建业务任务或工作包。
export const PREPARATION_SIZES = ['simple', 'complex'];
export const PREPARATION_ROLES = ['worker', 'reviewer'];
const MAX_ITEMS = 50;
const MAX_TEXT = 8192;
const PREPARATION_FIELDS = ['size', 'sizeReason', 'requirements', 'research', 'solution', 'packages', 'verification', 'confirmation', 'pending', 'source'];
const REQUIREMENT_FIELDS = ['id', 'summary', 'acceptance'];
const RESEARCH_FIELDS = ['source', 'conclusion', 'url'];
const SOLUTION_FIELDS = ['summary', 'decisions', 'tradeoffs', 'assumptions'];
const DECISION_FIELDS = ['decision', 'reason'];
const PACKAGE_FIELDS = ['packageId', 'role', 'agent', 'channel', 'scope', 'delivers', 'dependsOn', 'verification'];
const CONFIRMATION_FIELDS = ['scope', 'basis'];
const SOURCE_FIELDS = ['path', 'sections'];
// 源计划是供阅读、整理和跨电脑接续的 Markdown；与项目惯例一致，接受常见 Markdown 后缀。
const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd', '.mkdn', '.mdwn'];

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function fields(value, allowed, label) {
  if (!isObject(value)) fail('PREPARATION', `${label} 需为对象`);
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length) fail('PREPARATION', `${label} 不支持字段 ${unknown.join('、')}`);
  return value;
}
const readText = (value, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_TEXT) fail('PREPARATION', `缺少或无效字段 ${label}`);
  return value.trim();
};
const maybeText = (value, label) => {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > MAX_TEXT) fail('PREPARATION', `无效字段 ${label}`);
  return value.trim();
};
const readIdentifier = (value, label) => {
  const text = readText(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(text) || ['__proto__', 'prototype', 'constructor'].includes(text)) fail('PREPARATION', `无效标识 ${label}`);
  return text;
};
const maybeIdentifier = (value, label) => value === undefined || value === null || value === '' ? '' : readIdentifier(value, label);
const readArray = (value, label) => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_ITEMS) fail('PREPARATION', `${label} 需为不超过 ${MAX_ITEMS} 项的数组`);
  return value;
};
const readTextArray = (value, label) => readArray(value, label).map((item, index) => readText(item, `${label}[${index}]`));
const noDuplicate = (items, label, field) => {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item[field])) fail('PREPARATION', `${label} 不能重复 ${field}：${item[field]}`);
    seen.add(item[field]);
  }
  return items;
};

function normalizeSource(value, root) {
  if (value === undefined || value === null) return { path: '', sections: [], digest: null };
  fields(value, SOURCE_FIELDS, 'source');
  if (value.path === undefined || value.path === null || value.path === '') return { path: '', sections: readTextArray(value.sections, 'source.sections'), digest: null, missing: true };
  const relative = readText(value.path, 'source.path').replaceAll('\\', '/');
  if (path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative) || relative.split('/').includes('..')) {
    fail('PLAN', `源计划须为项目内相对路径：${value.path}`);
  }
  // 源计划是可阅读、可接续的 Markdown；package.json 等结构化文件不能顶替计划正文。
  if (!MARKDOWN_EXTENSIONS.includes(path.extname(relative).toLowerCase())) {
    fail('PLAN', `源计划须为 Markdown 文件（${MARKDOWN_EXTENSIONS.join('、')}）：${value.path}`);
  }
  const source = { path: relative, sections: readTextArray(value.sections, 'source.sections'), digest: null };
  // 没有项目根时只做结构归一化（用于预览或单元测试）；acceptSignal 始终传入项目根并计算摘要。
  if (!root) return source;
  let realSource;
  let realRoot;
  try {
    realSource = realpathSync(path.resolve(root, relative));
    realRoot = realpathSync(root);
  } catch {
    source.missing = true;
    return source;
  }
  // 项目内路径仍可能是符号链接；跟随真实路径后必须仍在项目内，保持原有边界。
  const relation = path.relative(realRoot, realSource);
  if (relation === '' || relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    fail('PLAN', `源计划须位于项目内：${value.path}`);
  }
  try {
    source.digest = digest(readFileSync(realSource));
  } catch {
    // 目录或不可读文件仍按“源计划读取不到”记录，结构校验和入口行为保持原样。
    source.missing = true;
  }
  return source;
}

function normalizeRequirements(value) {
  const items = readArray(value, 'requirements').map((item, index) => {
    fields(item, REQUIREMENT_FIELDS, `requirements[${index}]`);
    return {
      id: readIdentifier(item.id, `requirements[${index}].id`),
      summary: maybeText(item.summary, `requirements[${index}].summary`),
      acceptance: readTextArray(item.acceptance, `requirements[${index}].acceptance`),
    };
  });
  return noDuplicate(items, 'requirements', 'id');
}

function normalizeResearch(value) {
  return readArray(value, 'research').map((item, index) => {
    fields(item, RESEARCH_FIELDS, `research[${index}]`);
    return {
      source: readText(item.source, `research[${index}].source`),
      conclusion: readText(item.conclusion, `research[${index}].conclusion`),
      ...(item.url !== undefined && item.url !== null ? { url: readText(item.url, `research[${index}].url`) } : {}),
    };
  });
}

function normalizeSolution(value) {
  if (value === undefined || value === null) return { summary: '', decisions: [], tradeoffs: [], assumptions: [] };
  fields(value, SOLUTION_FIELDS, 'solution');
  const decisions = readArray(value.decisions, 'solution.decisions').map((item, index) => {
    fields(item, DECISION_FIELDS, `solution.decisions[${index}]`);
    return {
      decision: readText(item.decision, `solution.decisions[${index}].decision`),
      reason: readText(item.reason, `solution.decisions[${index}].reason`),
    };
  });
  return {
    summary: maybeText(value.summary, 'solution.summary'),
    decisions,
    tradeoffs: readTextArray(value.tradeoffs, 'solution.tradeoffs'),
    assumptions: readTextArray(value.assumptions, 'solution.assumptions'),
  };
}

function normalizePackages(value) {
  const items = readArray(value, 'packages').map((item, index) => {
    fields(item, PACKAGE_FIELDS, `packages[${index}]`);
    const role = item.role === undefined || item.role === null || item.role === '' ? '' : readText(item.role, `packages[${index}].role`);
    if (role && !PREPARATION_ROLES.includes(role)) fail('PREPARATION', `packages[${index}].role 只能是 worker 或 reviewer`);
    return {
      packageId: readIdentifier(item.packageId, `packages[${index}].packageId`),
      role,
      agent: maybeText(item.agent, `packages[${index}].agent`),
      channel: maybeIdentifier(item.channel, `packages[${index}].channel`),
      scope: maybeText(item.scope, `packages[${index}].scope`),
      delivers: maybeText(item.delivers, `packages[${index}].delivers`),
      dependsOn: readArray(item.dependsOn, `packages[${index}].dependsOn`).map((dependency, at) => readIdentifier(dependency, `packages[${index}].dependsOn[${at}]`)),
      verification: maybeText(item.verification, `packages[${index}].verification`),
    };
  });
  return noDuplicate(items, 'packages', 'packageId');
}

function normalizeConfirmation(value) {
  if (value === undefined || value === null) return { scope: [], basis: '' };
  fields(value, CONFIRMATION_FIELDS, 'confirmation');
  return { scope: readTextArray(value.scope, 'confirmation.scope'), basis: maybeText(value.basis, 'confirmation.basis') };
}

// 输入可以是不完整的草案：结构错误直接拒绝，尚未填写的业务内容记入缺项，允许继续讨论和写计划。
export function normalizePreparation(input, { root } = {}) {
  fields(input, PREPARATION_FIELDS, 'preparation');
  if (!PREPARATION_SIZES.includes(input.size)) fail('PREPARATION', `preparation.size 只能是 ${PREPARATION_SIZES.join(' 或 ')}`);
  return {
    schemaVersion: 1,
    preparedAt: new Date().toISOString(),
    size: input.size,
    sizeReason: maybeText(input.sizeReason, 'preparation.sizeReason'),
    requirements: normalizeRequirements(input.requirements),
    research: normalizeResearch(input.research),
    solution: normalizeSolution(input.solution),
    packages: normalizePackages(input.packages),
    verification: readTextArray(input.verification, 'preparation.verification'),
    confirmation: normalizeConfirmation(input.confirmation),
    pending: readTextArray(input.pending, 'preparation.pending'),
    source: normalizeSource(input.source, root),
  };
}

const gap = (field, message) => ({ field, message });
// 缺项按字段返回；复杂任务才要求需求、调研、方案、分包、验证和确认范围齐全。
// 简单任务只核对声明理由，避免为小改造成空计划。
export function preparationMissing(record) {
  const gaps = [];
  if (!record?.sizeReason) gaps.push(gap('size:reason', '未写明任务大小的判断理由'));
  // 当前数据契约里 pending 只有文字，全部按阻塞缺项处理：有关键问题没确认就不能宣称准备已齐。
  // 非阻塞的说明写到 solution.assumptions 等既有字段，不占用 pending。
  for (const [index, item] of (record?.pending || []).entries()) {
    gaps.push(gap(`pending:${index}`, `待决事项尚未确认：${item}`));
  }
  if (record?.size !== 'complex') return gaps;
  if (!record.requirements.length) gaps.push(gap('requirements', '尚未记录需求与验收条目'));
  for (const item of record.requirements) {
    if (!item.summary) gaps.push(gap(`requirement:${item.id}:summary`, `需求 ${item.id} 尚未写摘要`));
    if (!item.acceptance.length) gaps.push(gap(`requirement:${item.id}:acceptance`, `需求 ${item.id} 尚未写可检查的验收条目`));
  }
  if (!record.research.length) gaps.push(gap('research', '尚未记录调研来源与结论'));
  if (!record.solution.summary) gaps.push(gap('solution', '尚未记录选定方案'));
  if (!record.solution.decisions.length) gaps.push(gap('solution:decisions', '尚未记录关键决定及理由'));
  if (!record.packages.length) gaps.push(gap('packages', '尚未拆分工作包'));
  const known = new Set(record.packages.map(item => item.packageId));
  for (const item of record.packages) {
    if (!item.role) gaps.push(gap(`package:${item.packageId}:role`, `工作包 ${item.packageId} 尚未指定角色`));
    if (!item.agent) gaps.push(gap(`package:${item.packageId}:agent`, `工作包 ${item.packageId} 尚未指定 Agent`));
    // 准备记录保存用户选择的实际调用通道；程序不猜默认通道，缺通道时按包点名，恢复时才能按逐包安排接续。
    if (!item.channel) gaps.push(gap(`package:${item.packageId}:channel`, `工作包 ${item.packageId} 尚未填写实际调用通道`));
    if (!item.scope) gaps.push(gap(`package:${item.packageId}:scope`, `工作包 ${item.packageId} 尚未写明负责范围`));
    if (!item.delivers) gaps.push(gap(`package:${item.packageId}:delivers`, `工作包 ${item.packageId} 尚未写明完成后可独立验证的完整行为`));
    for (const dependency of item.dependsOn) {
      if (!known.has(dependency)) gaps.push(gap(`package:${item.packageId}:dependsOn`, `工作包 ${item.packageId} 的依赖 ${dependency} 未登记为工作包`));
    }
  }
  if (!record.verification.length) gaps.push(gap('verification', '尚未记录验证入口'));
  if (!record.confirmation.scope.length) gaps.push(gap('confirmation:scope', '尚未记录用户确认的范围'));
  if (!record.confirmation.basis) gaps.push(gap('confirmation:basis', '尚未记录确认依据（用户原话或计划位置）'));
  if (!record.source.path) gaps.push(gap('source', '尚未绑定源计划 Markdown'));
  else if (record.source.missing) gaps.push(gap('source:unreadable', `源计划 ${record.source.path} 读取不到`));
  return gaps;
}

const STEP_ORDER = [
  ['requirements', ['size:', 'requirements', 'requirement:', 'pending']],
  ['solution', ['research', 'solution']],
  ['arrangement', ['packages', 'package:', 'verification', 'confirmation', 'source']],
];
export function preparationStep(record) {
  const gaps = preparationMissing(record);
  if (!gaps.length) return 'complete';
  const field = gaps[0].field;
  for (const [step, prefixes] of STEP_ORDER) {
    if (prefixes.some(prefix => field === prefix || field.startsWith(prefix))) return step;
  }
  return 'arrangement';
}

// context 只带当前步骤、缺项字段和简短说明；完整正文留在计划 Markdown，不逐回合注入。
export function preparationSummary(record) {
  const gaps = preparationMissing(record);
  return {
    ready: gaps.length === 0,
    step: preparationStep(record),
    size: record.size,
    missing: gaps.map(item => item.field),
    messages: gaps.map(item => item.message),
    pending: record.pending,
    source: record.source.path ? { path: record.source.path, digest: record.source.digest } : null,
    packages: record.packages.map(item => ({ packageId: item.packageId, role: item.role, agent: item.agent, channel: item.channel, dependsOn: item.dependsOn })),
    preparedAt: record.preparedAt,
  };
}

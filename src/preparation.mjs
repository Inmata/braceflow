import path from 'node:path';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { digest, fail } from './store.mjs';

// 准备记录是 Lead 从项目 Markdown 整理出的可核对声明，不是用户批准的自动证明。
// 本模块只做结构校验、来源摘要和缺项归一化；不解析自然语言，也不创建业务任务或工作包。
export const PREPARATION_SIZES = ['simple', 'complex'];
export const PREPARATION_ROLES = ['worker', 'reviewer'];
const MAX_ITEMS = 50;
const MAX_TEXT = 8192;
const PREPARATION_FIELDS = ['size', 'sizeReason', 'requirements', 'research', 'solution', 'packages', 'verification', 'confirmation', 'pending', 'source'];
// 需求条目是整项验收的稳定锚点：owning packages 说明由谁交付，verification 写检查入口；
// 最终证据不在这里伪造，由 task-end 的交付声明按同一 ID 给出。
const REQUIREMENT_FIELDS = ['id', 'summary', 'acceptance', 'packages', 'verification'];
const RESEARCH_FIELDS = ['source', 'conclusion', 'url'];
const SOLUTION_FIELDS = ['summary', 'decisions', 'tradeoffs', 'assumptions'];
const DECISION_FIELDS = ['decision', 'reason'];
const PACKAGE_FIELDS = ['packageId', 'role', 'agent', 'channel', 'scope', 'delivers', 'dependsOn', 'verification'];
const CONFIRMATION_FIELDS = ['scope', 'basis'];
const SOURCE_FIELDS = ['path', 'sections'];
// 源计划是供阅读、整理和跨电脑接续的 Markdown；与项目惯例一致，接受常见 Markdown 后缀。
// 计划目录与 hooks 共用同一规则：授权计划只能落在 docs/plans 下的 Markdown，不能拿业务文件或链接别名顶替。
export const PLAN_DIRECTORY = 'docs/plans';
export const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd', '.mkdn', '.mdwn'];
export function isMarkdownPath(relative) {
  return typeof relative === 'string' && MARKDOWN_EXTENSIONS.includes(path.extname(relative).toLowerCase());
}
// 把项目内相对计划路径解析成真实路径，同时核对：
// 1. 字面路径与真实路径都是 Markdown；2. 字面路径位于 docs/plans；3. 路径链上任何一级都不能是 symlink/junction。
// 返回 { realPath, missing } 或 { error }。missing 表示路径尚未创建，但父链已经核验通过。
export function resolvePlanPath(root, relative) {
  if (!isMarkdownPath(relative)) return { error: 'suffix' };
  const normalized = relative.replaceAll('\\', '/');
  if (!normalized.startsWith(`${PLAN_DIRECTORY}/`)) return { error: 'scope' };
  let realRoot;
  try { realRoot = realpathSync(root); } catch { return { error: 'io' }; }
  const parts = normalized.split('/').filter(Boolean);
  for (let index = 0; index < parts.length; index++) {
    const current = path.join(realRoot, ...parts.slice(0, index + 1));
    let stat;
    try { stat = lstatSync(current); } catch (error) {
      if (error.code !== 'ENOENT') return { error: 'io' };
      // 最近存在的父目录已按字面逐级核验且不是链接；不存在的尾部按真实父目录拼接。
      const parent = path.join(realRoot, ...parts.slice(0, index));
      const rest = parts.slice(index).join(path.sep);
      let joined;
      try { joined = path.join(realpathSync(parent), rest); } catch { return { error: 'io' }; }
      return { realPath: joined, missing: true };
    }
    // 目录 junction 在 Node 的 lstat 里也是 symbolic link；整条链都拒绝，避免链接别名指向业务文件。
    if (stat.isSymbolicLink()) return { error: 'symlink' };
  }
  let realPath;
  try { realPath = realpathSync(path.join(realRoot, ...parts)); } catch { return { error: 'io' }; }
  if (!isMarkdownPath(realPath)) return { error: 'suffix' };
  // 链接已在上面整条拒绝；真实路径仍须落在真实 docs/plans 内，不能只靠“后缀是 md”通过。
  const realPlanDir = path.join(realRoot, PLAN_DIRECTORY);
  const inside = path.relative(realPlanDir, realPath);
  if (!inside || inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) return { error: 'scope' };
  return { realPath };
}

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
  if (!isMarkdownPath(relative)) {
    fail('PLAN', `源计划须为 Markdown 文件（${MARKDOWN_EXTENSIONS.join('、')}）：${value.path}`);
  }
  if (!relative.startsWith(`${PLAN_DIRECTORY}/`)) {
    fail('PLAN', `源计划须位于 ${PLAN_DIRECTORY}/ 下的 Markdown 计划：${value.path}`);
  }
  const source = { path: relative, sections: readTextArray(value.sections, 'source.sections'), digest: null };
  // 没有项目根时只做结构归一化（用于预览或单元测试）；acceptSignal 始终传入项目根并计算摘要。
  if (!root) return source;
  // 字面路径与真实路径同规则核对：链接别名不能把业务文件伪装成已授权计划。
  const resolved = resolvePlanPath(root, relative);
  if (resolved.error === 'symlink') fail('PLAN', `源计划路径不能是符号链接或 junction：${value.path}`);
  if (resolved.error === 'scope') fail('PLAN', `源计划须位于 ${PLAN_DIRECTORY}/ 下的 Markdown 计划：${value.path}`);
  if (resolved.error === 'suffix') fail('PLAN', `源计划须为 Markdown 文件（${MARKDOWN_EXTENSIONS.join('、')}）：${value.path}`);
  if (resolved.error) {
    source.missing = true;
    return source;
  }
  source.missing = Boolean(resolved.missing);
  if (!resolved.missing) {
    try {
      source.digest = digest(readFileSync(resolved.realPath));
    } catch {
      // 目录或不可读文件仍按“源计划读取不到”记录，结构校验和入口行为保持原样。
      source.missing = true;
    }
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
      packages: readArray(item.packages, `requirements[${index}].packages`).map((dependency, at) => readIdentifier(dependency, `requirements[${index}].packages[${at}]`)),
      verification: maybeText(item.verification, `requirements[${index}].verification`),
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
  // 旧状态或手工构造的草案可能缺数组字段；缺项应落到具体字段，而不是在检查时抛类型错误。
  const requirements = Array.isArray(record.requirements) ? record.requirements : [];
  const research = Array.isArray(record.research) ? record.research : [];
  const packages = Array.isArray(record.packages) ? record.packages : [];
  const verification = Array.isArray(record.verification) ? record.verification : [];
  const confirmation = record.confirmation && typeof record.confirmation === 'object' ? record.confirmation : {};
  const source = record.source && typeof record.source === 'object' ? record.source : {};
  const solution = record.solution && typeof record.solution === 'object' ? record.solution : {};
  if (!requirements.length) gaps.push(gap('requirements', '尚未记录需求与验收条目'));
  // 需求必须能落到具体实施包和检查入口，否则“所有包都 PASS”仍可能漏掉原需求。
  // 这里只核对引用与字段是否存在；实际成果是否真实由 Lead 和 Reviewer 核内容。
  const knownPackages = new Map(packages.map(item => [item.packageId, item]));
  for (const item of requirements) {
    if (!item.summary) gaps.push(gap(`requirement:${item.id}:summary`, `需求 ${item.id} 尚未写摘要`));
    if (!Array.isArray(item.acceptance) || !item.acceptance.length) gaps.push(gap(`requirement:${item.id}:acceptance`, `需求 ${item.id} 尚未写可检查的验收条目`));
    const owners = Array.isArray(item.packages) ? item.packages : [];
    if (!owners.length) gaps.push(gap(`requirement:${item.id}:packages`, `需求 ${item.id} 尚未分配负责工作包`));
    for (const owner of owners) {
      const target = knownPackages.get(owner);
      if (!target) gaps.push(gap(`requirement:${item.id}:packages`, `需求 ${item.id} 负责的工作包 ${owner} 未登记`));
      else if (target.role !== 'worker') gaps.push(gap(`requirement:${item.id}:packages`, `需求 ${item.id} 负责的工作包 ${owner} 不是实施包`));
    }
    if (!item.verification) gaps.push(gap(`requirement:${item.id}:verification`, `需求 ${item.id} 尚未写明检查入口`));
  }
  if (!research.length) gaps.push(gap('research', '尚未记录调研来源与结论'));
  if (!solution.summary) gaps.push(gap('solution', '尚未记录选定方案'));
  if (!Array.isArray(solution.decisions) || !solution.decisions.length) gaps.push(gap('solution:decisions', '尚未记录关键决定及理由'));
  if (!packages.length) gaps.push(gap('packages', '尚未拆分工作包'));
  for (const item of packages) {
    if (!item.role) gaps.push(gap(`package:${item.packageId}:role`, `工作包 ${item.packageId} 尚未指定角色`));
    if (!item.agent) gaps.push(gap(`package:${item.packageId}:agent`, `工作包 ${item.packageId} 尚未指定 Agent`));
    // 准备记录保存用户选择的实际调用通道；程序不猜默认通道，缺通道时按包点名，恢复时才能按逐包安排接续。
    if (!item.channel) gaps.push(gap(`package:${item.packageId}:channel`, `工作包 ${item.packageId} 尚未填写实际调用通道`));
    if (!item.scope) gaps.push(gap(`package:${item.packageId}:scope`, `工作包 ${item.packageId} 尚未写明负责范围`));
    if (!item.delivers) gaps.push(gap(`package:${item.packageId}:delivers`, `工作包 ${item.packageId} 尚未写明完成后可独立验证的完整行为`));
    for (const dependency of Array.isArray(item.dependsOn) ? item.dependsOn : []) {
      if (!knownPackages.has(dependency)) gaps.push(gap(`package:${item.packageId}:dependsOn`, `工作包 ${item.packageId} 的依赖 ${dependency} 未登记为工作包`));
    }
  }
  if (!verification.length) gaps.push(gap('verification', '尚未记录验证入口'));
  if (!Array.isArray(confirmation.scope) || !confirmation.scope.length) gaps.push(gap('confirmation:scope', '尚未记录用户确认的范围'));
  if (!confirmation.basis) gaps.push(gap('confirmation:basis', '尚未记录确认依据（用户原话或计划位置）'));
  if (!source.path) gaps.push(gap('source', '尚未绑定源计划 Markdown'));
  else if (source.missing) gaps.push(gap('source:unreadable', `源计划 ${source.path} 读取不到`));
  return gaps;
}

// 合并后的最终快照才是实际绑定的记录：本次提交的记录自身完整，不代表保留下来的旧需求仍指向现存 worker 包。
// 这里只核对引用关系与角色，不判断证据真伪；旧快照完全没有 requirements 字段时保持可读，不补写也不暗删。
export function preparationConsistencyGaps(snapshot) {
  const gaps = [];
  if (!snapshot || typeof snapshot !== 'object') return gaps;
  const packages = Array.isArray(snapshot.packages) ? snapshot.packages : [];
  const known = new Map(packages.map(item => [item.packageId, item]));
  for (const item of Array.isArray(snapshot.requirements) ? snapshot.requirements : []) {
    // 旧版本快照没有负责包字段：保持可读；字段存在但为空则按缺项拒绝，不能靠空数组暗删负责关系。
    if (!Array.isArray(item.packages)) continue;
    if (!item.packages.length) gaps.push(gap(`requirement:${item.id}:packages`, `需求 ${item.id} 尚未分配负责工作包`));
    for (const owner of item.packages) {
      const target = known.get(owner);
      if (!target) gaps.push(gap(`requirement:${item.id}:packages`, `需求 ${item.id} 负责的工作包 ${owner} 未登记`));
      else if (target.role !== 'worker') gaps.push(gap(`requirement:${item.id}:packages`, `需求 ${item.id} 负责的工作包 ${owner} 不是实施包`));
    }
  }
  for (const item of packages) {
    for (const dependency of Array.isArray(item.dependsOn) ? item.dependsOn : []) {
      if (!known.has(dependency)) gaps.push(gap(`package:${item.packageId}:dependsOn`, `工作包 ${item.packageId} 的依赖 ${dependency} 未登记为工作包`));
    }
  }
  return gaps;
}

// 开工时把会话准备记录固定到任务上：之后会话再讨论、改计划或换会话，都按已绑定的选择核对实际派包。
// 这不是用户批准证明，只保存“本次开工依据的是哪份结构化声明”。
export function preparationSnapshot(record) {
  if (!record) return null;
  return {
    schemaVersion: 1,
    size: record.size,
    sizeReason: record.sizeReason || '',
    preparedAt: record.preparedAt || null,
    source: record.source?.path ? { path: record.source.path, digest: record.source.digest || null } : null,
    // 需求与负责包一起固定：进度更新或换会话后，仍能按同一验收 ID 核对最终证据。
    requirements: (record.requirements || []).map(item => ({
      id: item.id,
      summary: item.summary || '',
      acceptance: Array.isArray(item.acceptance) ? [...item.acceptance] : [],
      packages: Array.isArray(item.packages) ? [...item.packages] : [],
      verification: item.verification || '',
    })),
    packages: (record.packages || []).map(item => ({
      packageId: item.packageId,
      role: item.role || '',
      agent: item.agent || '',
      channel: item.channel || '',
      scope: item.scope || '',
      delivers: item.delivers || '',
      dependsOn: Array.isArray(item.dependsOn) ? [...item.dependsOn] : [],
    })),
  };
}

// 比较前把无意义顺序归一化：包数组按 packageId 排序，依赖列表按字符串排序。
// 否则同一份记录倒序提交会被误当作“实际变化”，让目标变化通过重放门槛。
const canonicalPackage = item => ({
  packageId: item.packageId,
  role: item.role || '',
  agent: item.agent || '',
  channel: item.channel || '',
  scope: item.scope || '',
  delivers: item.delivers || '',
  dependsOn: Array.isArray(item.dependsOn) ? [...item.dependsOn].sort() : [],
});
const canonicalPackages = items => (items || []).map(canonicalPackage)
  .sort((left, right) => left.packageId < right.packageId ? -1 : left.packageId > right.packageId ? 1 : 0);
// 需求数组按 id 排序、验收句子与负责包按集合顺序归一化；只调整顺序不算实际需求变更。
const canonicalRequirement = item => ({
  id: item.id,
  summary: item.summary || '',
  acceptance: Array.isArray(item.acceptance) ? [...item.acceptance].sort() : [],
  packages: Array.isArray(item.packages) ? [...item.packages].sort() : [],
  verification: item.verification || '',
});
const canonicalRequirements = items => (items || []).map(canonicalRequirement)
  .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
// 任务准备更新只覆盖本次明确给出的包，其余旧选择继续有效；显式 removePackageIds 才能移除，未列出的包保留。
// 需求同理按 ID 合并：只更新进度时漏传某条需求，不会删掉已确认的验收覆盖。
// 历史快照由调用方另存，避免把旧证据改写成新记录。
export function mergePreparationSnapshot(previous, record, { removePackageIds = [] } = {}) {
  const next = preparationSnapshot(record);
  if (!previous) return {
    snapshot: next,
    changed: next.packages.map(item => item.packageId),
    removed: [],
    preserved: [],
    changedRequirements: next.requirements.map(item => item.id),
    preservedRequirements: [],
  };
  const before = new Map((previous.packages || []).map(item => [item.packageId, item]));
  const incoming = new Map(next.packages.map(item => [item.packageId, item]));
  const remove = new Set(removePackageIds);
  const removed = (previous.packages || []).filter(item => !incoming.has(item.packageId) && remove.has(item.packageId));
  const preserved = (previous.packages || []).filter(item => !incoming.has(item.packageId) && !remove.has(item.packageId));
  const changed = [];
  for (const item of next.packages) {
    const old = before.get(item.packageId);
    if (!old || JSON.stringify(canonicalPackage(old)) !== JSON.stringify(canonicalPackage(item))) changed.push(item.packageId);
  }
  const requirementsBefore = new Map((previous.requirements || []).map(item => [item.id, item]));
  const incomingRequirements = new Map(next.requirements.map(item => [item.id, item]));
  const preservedRequirements = (previous.requirements || []).filter(item => !incomingRequirements.has(item.id));
  const changedRequirements = [];
  for (const item of next.requirements) {
    const old = requirementsBefore.get(item.id);
    if (!old || JSON.stringify(canonicalRequirement(old)) !== JSON.stringify(canonicalRequirement(item))) changedRequirements.push(item.id);
  }
  // 保留原计划中的需求顺序：旧条目位置不变，本次新条目追加；只更新进度不会打乱验收表。
  const mergedRequirements = (previous.requirements || []).map(item => incomingRequirements.get(item.id) || item);
  for (const item of next.requirements) if (!requirementsBefore.has(item.id)) mergedRequirements.push(item);
  return {
    snapshot: { ...next, packages: [...next.packages, ...preserved], requirements: mergedRequirements },
    changed,
    removed: removed.map(item => item.packageId),
    preserved: preserved.map(item => item.packageId),
    changedRequirements,
    preservedRequirements: preservedRequirements.map(item => item.id),
  };
}
// 判断“这次准备是否真的带来可审计变化”。preparedAt/sizeReason 等元数据每次可能重写，不能算变化；
// 只比较 source 与实际包内容，且包数组与依赖列表的无意义顺序不产生差异。
// 目标或权限变化必须伴随至少一项实际内容、显式移除或 source 变化，原样或倒序重放会被拒绝。
export function preparationSnapshotSignature(snapshot) {
  if (!snapshot) return null;
  return JSON.stringify({
    source: snapshot.source ? { path: snapshot.source.path, digest: snapshot.source.digest || null } : null,
    requirements: canonicalRequirements(snapshot.requirements),
    packages: canonicalPackages(snapshot.packages),
  });
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
  const source = record.source && typeof record.source === 'object' ? record.source : {};
  return {
    ready: gaps.length === 0,
    step: preparationStep(record),
    size: record.size,
    missing: gaps.map(item => item.field),
    messages: gaps.map(item => item.message),
    pending: Array.isArray(record.pending) ? record.pending : [],
    source: source.path ? { path: source.path, digest: source.digest } : null,
    requirements: (Array.isArray(record.requirements) ? record.requirements : []).map(item => ({ id: item.id, packages: Array.isArray(item.packages) ? item.packages : [], verification: item.verification || '' })),
    packages: (Array.isArray(record.packages) ? record.packages : []).map(item => ({ packageId: item.packageId, role: item.role, agent: item.agent, channel: item.channel, dependsOn: Array.isArray(item.dependsOn) ? item.dependsOn : [] })),
    preparedAt: record.preparedAt,
  };
}

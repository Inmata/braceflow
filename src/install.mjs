import path from 'node:path';
import os from 'node:os';
import { copyFile, lstat, mkdir, readdir, readFile, readlink, realpath, rename, rm, symlink, unlink } from 'node:fs/promises';
import { atomicWrite, digest, fail, hostObservations, id, mutate, readState, readText, samePath, within, writeJSON } from './store.mjs';
import { PRODUCT_ROOT } from './entry.mjs';
import { CLAUDE_EVENTS, EVENTS, HOSTS as HOST_NAMES } from './hooks.mjs';

export const RELEASE_PATHS = [
  'bin', 'src', 'hooks', 'agents', '.codex-plugin', 'docs/workflow.md', 'docs/alignment.md', 'docs/roles',
  'docs/references', 'docs/adapters', 'docs/usage.md', 'docs/design/protocol.md', 'docs/learning.md', 'docs/background-review.md', 'docs/acceptance.md',
  'examples', 'package.json', 'plugin.json', 'workflow-gate.example.json', 'README.md', 'README.en.md',
];
async function inventory(root, relative = '', selected = RELEASE_PATHS) {
  const files = [];
  const entries = relative ? (await readdir(path.join(root, relative))).sort() : selected;
  for (const name of entries) {
    const item = path.join(relative, name);
    const info = await lstat(path.join(root, item));
    if (info.isSymbolicLink()) fail('LINK', '发布目录含链接，请先核对来源');
    if (info.isDirectory()) files.push(...await inventory(root, item));
    else files.push({ path: item.replaceAll('\\', '/'), hash: digest(await readFile(path.join(root, item))) });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
export async function verifyRelease(record) {
  if (!record?.releaseRoot || !Array.isArray(record.files)) return false;
  try {
    const names = [...new Set(record.files.map(file => file.path.split('/')[0]))];
    const actual = await inventory(record.releaseRoot, '', names);
    return JSON.stringify(actual) === JSON.stringify(record.files);
  } catch { return false; }
}
// 子代理定义是用户级文件，不能按 hooks 的“自有 handler”方式整体重写。账本按名字记录
// managed/user/deleted 和最后写入的 hash：只有 managed 且内容仍等于最后写入的文件随发布更新；
// 用户改过或事先存在的同名文件归用户，删除后不补回。
const AGENT_PATH = /^agents\/([^/\\]+\.md)$/;
const AGENT_STATUSES = new Set(['managed', 'user', 'deleted']);
const agentFilesFor = files => files.flatMap(file => {
  const match = AGENT_PATH.exec(file.path);
  return match ? [{ name: match[1], hash: file.hash }] : [];
});
const agentFileName = name => typeof name === 'string' && name.endsWith('.md') && !name.includes('/') && !name.includes('\\');
const installedAgentFiles = record => Array.isArray(record?.agentFiles)
  ? record.agentFiles.filter(item => item && agentFileName(item.name) && typeof item.hash === 'string')
  : [];
const previousAgentFiles = record => installedAgentFiles({ agentFiles: record?.previousAgentFiles });
// 旧记录没有账本：agentFiles 与 previousAgentFiles 都是本插件写过的内容，按 managed 迁移。
// 升级中断留下的旧记录 agentFiles 是未写成功的新内容，文件若仍等于 previousAgentFiles 就以旧 hash 记账。
async function legacyAgentLedger(record) {
  const entries = new Map();
  const previous = new Map(previousAgentFiles(record).map(file => [file.name, file.hash]));
  for (const file of installedAgentFiles(record)) {
    let hash = file.hash;
    const alternate = previous.get(file.name);
    if (alternate && alternate !== hash && record.configFile) {
      const current = await inspectAgentTarget(agentTarget(record.configFile, file.name));
      if (current.state === 'file' && current.hash === alternate) hash = alternate;
    }
    entries.set(file.name, { name: file.name, status: 'managed', hash });
  }
  for (const file of previousAgentFiles(record)) {
    if (!entries.has(file.name)) entries.set(file.name, { name: file.name, status: 'managed', hash: file.hash });
  }
  return [...entries.values()];
}
// 卸载记录的账本已清除；旧版卸载记录里的 agentFiles 也不能在重装时重新认领文件。
async function agentLedger(record) {
  if (!record || record.status === 'uninstalled') return [];
  const source = Array.isArray(record.agentLedger) ? record.agentLedger : await legacyAgentLedger(record);
  const entries = new Map();
  for (const item of source) {
    if (!item || !agentFileName(item.name) || !AGENT_STATUSES.has(item.status)) continue;
    entries.set(item.name, { name: item.name, status: item.status, hash: typeof item.hash === 'string' ? item.hash : null });
  }
  return [...entries.values()];
}
const agentTarget = (configFile, name) => path.join(path.dirname(configFile), 'agents', name);
async function inspectAgentTarget(target) {
  const info = await lstat(target).catch(() => null);
  if (!info) return { state: 'missing', target };
  if (!info.isFile()) return { state: 'other', target };
  const text = await readText(target);
  if (text === null) return { state: 'missing', target };
  return { state: 'file', target, hash: digest(text) };
}
// 只计算本次每个名字的去向和需要写入的文件，不读发布正文；写入在事务确认阶段完成。
async function agentPlan(configFile, ledger, release) {
  const entries = new Map(ledger.map(item => [item.name, { ...item }]));
  const published = new Map(release.map(item => [item.name, item.hash]));
  const writes = [], notes = [];
  for (const item of release) {
    const target = agentTarget(configFile, item.name);
    const current = await inspectAgentTarget(target);
    const existing = entries.get(item.name);
    const fileHash = current.state === 'file' ? current.hash : null;
    if (!existing) {
      if (current.state === 'missing') {
        writes.push(item.name);
        entries.set(item.name, { name: item.name, status: 'managed', hash: item.hash });
      } else if (fileHash === item.hash) {
        entries.set(item.name, { name: item.name, status: 'managed', hash: item.hash });
      } else {
        entries.set(item.name, { name: item.name, status: 'user', hash: null });
        notes.push(`未安装默认定义：${item.name}`);
      }
      continue;
    }
    if (current.state === 'missing') {
      if (existing.status !== 'deleted') notes.push(`子代理定义 ${item.name} 已删除，不再补回`);
      entries.set(item.name, { name: item.name, status: 'deleted', hash: existing.hash });
      continue;
    }
    if (existing.status === 'deleted') {
      entries.set(item.name, { name: item.name, status: 'user', hash: existing.hash });
      notes.push(`子代理定义 ${item.name} 已重新出现，按用户文件保留`);
      continue;
    }
    if (existing.status === 'user') continue;
    // managed：内容等于本次发布时直接认作自有（也覆盖写到一半后重试）；否则必须是上次写入内容才能更新。
    if (fileHash === item.hash) {
      entries.set(item.name, { name: item.name, status: 'managed', hash: item.hash });
      continue;
    }
    if (current.state !== 'file' || fileHash !== existing.hash) {
      entries.set(item.name, { name: item.name, status: 'user', hash: existing.hash });
      notes.push(`子代理定义 ${item.name} 与上次写入不同，保留为用户的文件`);
      continue;
    }
    writes.push(item.name);
    entries.set(item.name, { name: item.name, status: 'managed', hash: item.hash });
    notes.push(`已更新子代理默认定义：${item.name}`);
  }
  // 账本里已不再发布的名字不再更新：缺失记删除，被改、非普通文件或重新出现都归用户，判定与 doctor 一致。
  for (const [name, item] of entries) {
    if (published.has(name)) continue;
    const current = await inspectAgentTarget(agentTarget(configFile, name));
    if (current.state === 'missing') entries.set(name, { ...item, status: 'deleted' });
    else if (item.status === 'deleted' || (item.status === 'managed' && (current.state !== 'file' || current.hash !== item.hash))) entries.set(name, { ...item, status: 'user' });
  }
  return { ledger: [...entries.values()], writes, notes };
}
async function syncAgentFiles(configFile, releaseRoot, release, ledger) {
  const plan = await agentPlan(configFile, ledger, release);
  for (const name of plan.writes) {
    await atomicWrite(agentTarget(configFile, name), await readFile(path.join(releaseRoot, 'agents', name), 'utf8'));
  }
  return plan;
}
const agentReceipt = plan => ({ entries: plan.ledger.map(({ name, status }) => ({ name, status })), notes: plan.notes });
async function agentRemovalPlan(configFile, ledger) {
  const remove = [], kept = [];
  for (const item of ledger) {
    const target = agentTarget(configFile, item.name);
    const current = await inspectAgentTarget(target);
    if (current.state === 'missing') continue;
    if (item.status === 'managed' && current.state === 'file' && current.hash === item.hash) {
      remove.push({ name: item.name, path: target, hash: item.hash });
    } else {
      kept.push({ name: item.name, status: item.status === 'managed' || item.status === 'deleted' ? 'user' : item.status });
    }
  }
  return { remove, kept };
}
// 撤销意图落盘后用户可能又改文件；移除前再次核对内容，变化时保留不失败。
async function removeOwnedAgentFiles(files) {
  for (const file of files) {
    const current = await inspectAgentTarget(file.path);
    if (current.state !== 'file' || current.hash !== file.hash) continue;
    await unlink(file.path);
  }
}
async function agentDoctor(record) {
  if (!record?.configFile) return [];
  const release = new Map(agentFilesFor(record.files || []).map(item => [item.name, item.hash]));
  const list = [];
  for (const item of await agentLedger(record)) {
    const current = await inspectAgentTarget(agentTarget(record.configFile, item.name));
    // 与 agentPlan 同口径：文件缺失一律记删除；managed 内容等于账本或本次发布都算未改动，
    // 只有非普通文件或两种内容都不符才归用户；deleted 重新出现归用户。
    let status = item.status;
    if (current.state === 'missing') status = 'deleted';
    else if (item.status === 'managed' && (current.state !== 'file' || (current.hash !== item.hash && current.hash !== release.get(item.name)))) status = 'user';
    else if (item.status === 'deleted') status = 'user';
    list.push({ name: item.name, status, differsFromRelease: current.state === 'file' && release.has(item.name) && current.hash !== release.get(item.name) });
  }
  return list;
}
const psQuote = text => `'${text.replaceAll("'", "''")}'`;
const shQuote = text => `'${text.replaceAll("'", `'"'"'`)}'`;
export function hookCommand(releaseRoot, directory) {
  const quote = process.platform === 'win32' ? psQuote : shQuote;
  const start = process.platform === 'win32' ? '& ' : '';
  return `${start}${quote(process.execPath.replaceAll('\\', '/'))} ${quote(path.join(releaseRoot, 'bin', 'workflow.mjs').replaceAll('\\', '/'))} hook --agent codex --state-dir ${quote(directory.replaceAll('\\', '/'))}`;
}
const slash = value => value.replaceAll('\\', '/');
// 宿主 hook 指向固定入口 current，升级只替换链接目标；配置字符串和宿主信任都不必重做。
export function currentRoot(directory) {
  return path.join(directory, 'current');
}
async function removeEntry(file) {
  const info = await lstat(file).catch(() => null);
  if (!info) return;
  if (info.isSymbolicLink()) await unlink(file);
  else await rm(file, { recursive: true, force: true });
}
async function pointCurrent(directory, releaseRoot) {
  const link = currentRoot(directory);
  const next = path.join(directory, `.current-${id('link')}`);
  await removeEntry(next);
  await symlink(releaseRoot, next, 'junction');
  const aside = path.join(directory, `.current-old-${id('link')}`);
  const existing = await lstat(link).catch(() => null);
  if (existing) await rename(link, aside);
  try {
    await rename(next, link);
  } catch (error) {
    if (existing) await rename(aside, link).catch(() => {});
    throw error;
  }
  if (existing) await removeEntry(aside);
  return link;
}
async function currentTarget(directory) {
  try { return await realpath(currentRoot(directory)); } catch { return null; }
}
// 重复安装不能只看登记：current 可能已被删除、断链或指到别处。只有目标位于本状态根的 releases/
// 下才视为自有入口；用户替换的普通目录或指向外部的链接保留原样并报告冲突。
async function inspectCurrent(directory, record) {
  const link = currentRoot(directory);
  const info = await lstat(link).catch(() => null);
  if (!info) return { state: 'missing', link };
  if (!info.isSymbolicLink()) return { state: 'conflict', link, kind: info.isDirectory() ? 'directory' : 'file', conflict: 'current 已被替换为普通文件或目录，保留现场' };
  const raw = await readlink(link).catch(() => null);
  const resolved = await realpath(link).catch(() => null) || (raw ? path.resolve(path.dirname(link), raw) : null);
  if (resolved && record?.releaseRoot && samePath(resolved, record.releaseRoot)) return { state: 'verified', link, target: resolved };
  // junction/symlink 类型由点链接时的既有实现决定，这里只按目标归属判断，不新增平台分支。
  if (resolved && within(path.join(directory, 'releases'), resolved)) return { state: 'own-other', link, target: resolved };
  return { state: 'conflict', link, kind: 'link', target: resolved || raw, conflict: 'current 指向安装目录之外的目标（可能是用户自己的链接），不自动接管' };
}
function currentConflict(entry) {
  return { status: 'conflict', conflict: entry.conflict, path: entry.link, kind: entry.kind, target: entry.target ?? null, reason: 'current 入口不是本插件登记的自有链接；保留现场待核对' };
}
// 快照内容与 fixed 入口指向必须同时正确，才算完整。
export async function releaseIntegrity(directory, record) {
  if (!await verifyRelease(record)) return 'unavailable';
  if (record.currentRoot) {
    const target = await currentTarget(directory);
    if (!target || !samePath(target, record.releaseRoot)) return 'unavailable';
  }
  return 'verified';
}
// 每个宿主的配置位置、事件集合和 handler 形状不同；安装记录按宿主分开维护，互不覆盖。
export const HOSTS = {
  codex: {
    events: EVENTS,
    configName: 'hooks.json',
    defaultUserDir: () => path.join(os.homedir(), '.codex'),
    handler: (releaseRoot, directory, event) => {
      const handler = { type: 'command', command: hookCommand(releaseRoot, directory), timeout: ['Interrupt', 'SessionEnd'].includes(event) ? 3 : 10 };
      if (['SessionStart', 'UserPromptSubmit'].includes(event)) handler.additionalContextLimit = 8000;
      return handler;
    },
  },
  claude: {
    events: CLAUDE_EVENTS,
    configName: 'settings.json',
    defaultUserDir: () => path.join(os.homedir(), '.claude'),
    // Claude Code 的 command 是 shell 字符串；用 command + args 数组避免路径引号歧义。
    handler: (releaseRoot, directory) => ({
      type: 'command',
      command: slash(process.execPath),
      args: [slash(path.join(releaseRoot, 'bin', 'workflow.mjs')), 'hook', '--agent', 'claude', '--state-dir', slash(directory)],
      timeout: 10,
    }),
  },
};
export const AGENTS = HOST_NAMES;
// 两个宿主和同一宿主的多个配置目录共用同一个 current。重复安装只允许修复自己的入口：
// 若 current 指向另一个已登记且完整的发布快照，改指会让对方的完整性检查失败，必须由用户先统一升级。
async function otherHostSnapshot(directory, state, agent, target, exclude = null) {
  for (const name of AGENTS) {
    for (const { record } of installLocations(state, name)) {
      if (record === exclude || record?.status !== 'installed' || !record.releaseRoot || !samePath(record.releaseRoot, target)) continue;
      if (await releaseIntegrity(directory, record) === 'verified') return { agent: name, version: record.version, releaseRoot: record.releaseRoot, configFile: record.configFile };
    }
  }
  return null;
}
const hostFor = agent => {
  const host = HOSTS[agent];
  if (!host) fail('AGENT', `未知宿主 ${agent}；支持 ${AGENTS.join('/')}`);
  return host;
};
// codex 保留 state.install 作为旧版兼容权威记录，installs.codex 只是同步镜像；claude 只写 installs.claude。
// 没有默认记录时，installs.<agent> 可只保存 { extra } 容器；真正记录必须带 configFile，不能把容器当权威记录。
const isInstallRecord = value => Boolean(value && typeof value === 'object' && !Array.isArray(value) && value.configFile);
const isExtraContainer = value => Boolean(value && typeof value === 'object' && !Array.isArray(value) && !value.configFile && value.extra && typeof value.extra === 'object' && !Array.isArray(value.extra));
export function installRecord(state, agent) {
  state.installs ||= {};
  if (agent !== 'codex') return isInstallRecord(state.installs[agent]) ? state.installs[agent] : null;
  const legacy = isInstallRecord(state.install) ? state.install : null;
  const slot = state.installs.codex;
  const slotRecord = isInstallRecord(slot) ? slot : null;
  const record = legacy || slotRecord || null;
  if (record) {
    // JSON 读回后 install 与 installs.codex 是不同对象；两边都可能带着附加位置，先合并再指回同一记录。
    if (legacy && slotRecord && legacy !== slotRecord && slotRecord.extra && typeof slotRecord.extra === 'object') {
      legacy.extra = { ...slotRecord.extra, ...(legacy.extra && typeof legacy.extra === 'object' ? legacy.extra : {}) };
    }
    if (!slotRecord && isExtraContainer(slot)) {
      record.extra = { ...slot.extra, ...(record.extra && typeof record.extra === 'object' ? record.extra : {}) };
    }
    state.install = record;
    state.installs.codex = record;
  } else if (isExtraContainer(slot)) {
    state.install = null;
  }
  return record;
}
// 默认 Codex 配置位置才是权威记录（兼容旧版单条 install/state.install）；附加位置按规范化配置文件路径
// 登记在 extra 下。Windows 的大小写和分隔符差异不能让同一目录变成两条记录。
function locationKey(file) {
  const resolved = path.resolve(file);
  return (process.platform === 'win32' ? resolved.toLowerCase() : resolved).replaceAll(path.sep, '/');
}
const sameLocation = (left, right) => Boolean(left?.configFile && right?.configFile && locationKey(left.configFile) === locationKey(right.configFile));
function defaultConfigFile(agent) {
  const host = hostFor(agent);
  return path.join(path.resolve(host.defaultUserDir()), host.configName);
}
const isDefaultLocation = (agent, configFile) => Boolean(configFile) && locationKey(configFile) === locationKey(defaultConfigFile(agent));
function extraRecords(state, agent, create = false) {
  const primary = installRecord(state, agent);
  if (primary) {
    if (primary.extra && typeof primary.extra === 'object' && !Array.isArray(primary.extra)) return primary.extra;
    if (!create) return {};
    primary.extra = {};
    return primary.extra;
  }
  const slot = state.installs?.[agent];
  if (isExtraContainer(slot)) return slot.extra;
  if (!create) return {};
  state.installs ||= {};
  state.installs[agent] = { extra: {} };
  return state.installs[agent].extra;
}
// 只读遍历：primary 在前，附加位置按登记顺序；手工状态里与 primary 指向同一文件的重复项跳过。
export function installLocations(state, agent) {
  const primary = installRecord(state, agent);
  const list = primary ? [{ record: primary, location: 'primary' }] : [];
  for (const record of Object.values(extraRecords(state, agent))) {
    if (!record || record === primary || sameLocation(record, primary)) continue;
    list.push({ record, location: 'extra' });
  }
  return list;
}
function locateInstall(state, agent, configFile) {
  const key = locationKey(configFile);
  for (const item of installLocations(state, agent)) {
    if (item.record.configFile && locationKey(item.record.configFile) === key) return { ...item, key };
  }
  return { record: null, location: null, key };
}
// 无参数卸载不能撤销附加位置，只报告仍在登记的全部附加记录；这里不读取配置，只看登记状态。
function extraSummary(state, agent) {
  return installLocations(state, agent).filter(item => item.location === 'extra').map(({ record }) => ({
    location: 'extra', configFile: record.configFile, status: record.status, version: record.version || null,
  }));
}
const samePrimary = (state, agent, record) => {
  const primary = installRecord(state, agent);
  return Boolean(primary && (primary === record || sameLocation(primary, record)));
};
async function readConfig(file) {
  const text = await readText(file);
  if (text === null) return { text, config: {} };
  let config;
  try { config = JSON.parse(text); } catch { fail('CONFIG', `${path.basename(file)} 不是有效 JSON，保留原文件`); }
  if (!config || typeof config !== 'object' || Array.isArray(config) || (config.hooks && (typeof config.hooks !== 'object' || Array.isArray(config.hooks)))) fail('CONFIG', '未知 hooks 配置结构');
  for (const groups of Object.values(config.hooks || {})) {
    if (!Array.isArray(groups) || groups.some(group => !group || !Array.isArray(group.hooks))) fail('CONFIG', '未知 hooks 分组结构，保留原文件');
  }
  return { text, config };
}
// 自有 handler 必须 command 与 args 同时一致，避免只凭相同的 Node 路径误删其他插件的定义。
const sameTarget = (handler, record) => handler.command === record.command && JSON.stringify(handler.args ?? null) === JSON.stringify(record.args ?? null);
// slots 记下每个事件里自有分组的原位置；Codex 的信任键按分组序号编号，重装须放回原处，否则自己和其他插件的信任都会失效。
function removeOwned(config, record) {
  const result = structuredClone(config);
  const conflicts = [];
  const slots = {};
  if (!record) return { config: result, conflicts, slots };
  result.hooks ||= {};
  for (const event of record.events || EVENTS) {
    let found = false;
    const expected = record.handlers[event];
    const kept = [];
    for (const group of result.hooks?.[event] || []) {
      const hooks = group.hooks.filter(handler => {
        if (!sameTarget(handler, record)) return true;
        found = true;
        if (JSON.stringify(handler) !== JSON.stringify(expected)) { conflicts.push(event); return true; }
        slots[event] ??= kept.length;
        return false;
      });
      if (hooks.length) kept.push({ ...group, hooks });
    }
    result.hooks[event] = kept;
    if (!found) conflicts.push(event);
    if (!result.hooks[event].length) delete result.hooks[event];
  }
  return { config: result, conflicts, slots };
}
function addHandlers(config, handlers, slots = {}) {
  config.hooks ||= {};
  for (const [event, handler] of Object.entries(handlers)) {
    config.hooks[event] ||= [];
    const slot = slots[event];
    if (slot === undefined) config.hooks[event].push({ hooks: [handler] });
    else config.hooks[event].splice(slot, 0, { hooks: [handler] });
  }
  return JSON.stringify(config, null, 2) + '\n';
}
const textHash = text => text === null ? null : digest(text);
function registerInstall(state, agent, record) {
  const primary = installRecord(state, agent);
  const isPrimary = primary && (primary === record || sameLocation(primary, record));
  if (!isPrimary && !isDefaultLocation(agent, record.configFile)) {
    extraRecords(state, agent, true)[locationKey(record.configFile)] = record;
    return;
  }
  // 默认位置成为权威记录时，已有的附加位置（含旧版把非默认位置误当权威记录的那一条）全部转入 extra，
  // 不丢记录也不让默认目录被挡在 extra。
  const extras = { ...extraRecords(state, agent) };
  delete extras[locationKey(record.configFile)];
  if (primary && primary !== record && !sameLocation(primary, record) && !isDefaultLocation(agent, primary.configFile)) {
    extras[locationKey(primary.configFile)] = primary;
    delete primary.extra;
  }
  if (Object.keys(extras).length) record.extra = { ...extras, ...(record.extra && typeof record.extra === 'object' ? record.extra : {}) };
  state.installs[agent] = record;
  if (agent === 'codex') state.install = record;
}
// prepared 只保存自有定义和前后指纹，不保存含其他插件/凭据的整份用户配置。
// 重试按原意图续做：配置必须仍为 before/after，current 必须仍为原目标/新目标。
async function finishPrepared(directory, state, save, record, agent) {
  if (!record.currentRoot || !samePath(record.currentRoot, currentRoot(directory))) fail('RECOVERY', '安装事务没有可辨认的固定入口，保留记录待核对');
  if (!await verifyRelease(record)) fail('INTEGRITY', '准备安装的发布副本被修改或缺失，保留现场');
  const text = await readText(record.configFile);
  const hash = textHash(text);
  if (hash !== record.beforeHash && hash !== record.afterHash) fail('CONFLICT', '安装恢复时 hooks 配置不匹配前后指纹；保留用户配置与事务');
  const checkEntry = async () => {
    const entry = await inspectCurrent(directory, record);
    const original = Object.hasOwn(record, 'previousCurrentTarget') && (
      record.previousCurrentTarget === null ? entry.state === 'missing' : entry.state !== 'conflict' && entry.target && samePath(entry.target, record.previousCurrentTarget)
    );
    // 旧版 prepared 没有 previousCurrentTarget，不猜测其他自有目标。
    // 切换时旧链接先被移到 aside；此时崩溃会留下 missing，可直接重建而不删除旧副本/aside。
    if (!['verified', 'missing'].includes(entry.state) && !original) fail('CONFLICT', '安装恢复时 current 不匹配原入口或目标发布副本；保留现场');
    return entry;
  };
  await checkEntry();
  if (hash !== record.afterHash) {
    const current = await readConfig(record.configFile);
    if (current.text !== text) fail('CONFLICT', '安装恢复期间 hooks 配置已变化；保留用户配置');
    const owned = record.previousOwned ? { ...record.previousOwned, events: record.previousOwned.events || record.events || hostFor(agent).events } : null;
    const stripped = removeOwned(current.config, owned);
    if (stripped.conflicts.length) fail('CONFLICT', '安装恢复时原自有 hook 不完整，保留配置与事务');
    const after = addHandlers(stripped.config, record.handlers, stripped.slots);
    if (digest(after) !== record.afterHash) fail('RECOVERY', '无法按原意图重建 hooks 配置，保留现场');
    if (await readText(record.configFile) !== text) fail('CONFLICT', '安装恢复期间 hooks 配置已变化；保留用户配置');
    await atomicWrite(record.configFile, after);
  }
  const entry = await checkEntry();
  if (textHash(await readText(record.configFile)) !== record.afterHash) fail('CONFLICT', '安装确认前 hooks 配置已变化；保留事务');
  if (entry.state !== 'verified') await pointCurrent(directory, record.releaseRoot);
  let agents = null;
  if (agent === 'claude') {
    const plan = await syncAgentFiles(record.configFile, record.releaseRoot, agentFilesFor(record.files || []), await agentLedger(record));
    record.agentLedger = plan.ledger;
    delete record.agentFiles;
    delete record.previousAgentFiles;
    agents = agentReceipt(plan);
  }
  record.status = 'installed';
  registerInstall(state, agent, record);
  await save();
  return { status: 'installed', agent, version: record.version, releaseRoot: record.releaseRoot, currentRoot: record.currentRoot, configFile: record.configFile, changeId: record.changeId, ...(agents ? { agents } : {}), requiresTrust: '请用实际宿主支持的 /hooks 审核当前定义；新会话验证，不自动修改信任记录' };
}
export async function install(directory, { userDir, sourceRoot = PRODUCT_ROOT, agent = 'codex' } = {}) {
  const host = hostFor(agent);
  userDir = path.resolve(userDir || host.defaultUserDir());
  const configFile = path.join(userDir, host.configName);
  return mutate(directory, async (state, save) => {
    const located = locateInstall(state, agent, configFile);
    const previous = located.record;
    // 同一宿主任一位置有未完成事务时，只能在原位置重试；不能借另一个目录的事务覆盖它。
    const pending = installLocations(state, agent).filter(item => item.record.status === 'prepared');
    if (pending.length) {
      const same = pending.find(item => sameLocation(item.record, { configFile }));
      if (!same) fail('CONFIG', '已有另一用户目录的安装事务，先在原用户目录重试');
      return finishPrepared(directory, state, save, same.record, agent);
    }
    if (previous && !['installed', 'uninstalled'].includes(previous.status)) fail('RECOVERY', '安装事务尚未确认，先核对注册差异；不覆盖追溯记录');
    const pendingHosts = AGENTS.filter(name => name !== agent && installLocations(state, name).some(item => item.record.status === 'prepared'));
    if (pendingHosts.length) fail('RECOVERY', `其他宿主安装事务尚未完成（${pendingHosts.join(',')}）；先重试该宿主安装，保留共享 current`);
    const current = await readConfig(configFile);
    const files = await inventory(sourceRoot);
    const packageInfo = JSON.parse(await readText(path.join(sourceRoot, 'package.json')));
    const releaseHash = digest(JSON.stringify(files));
    const active = previous?.status === 'installed' ? previous : null;
    if (active && !await verifyRelease(active)) fail('INTEGRITY', '已安装副本被修改，先核对差异；不覆盖');
    const stripped = removeOwned(current.config, active);
    if (stripped.conflicts.length) fail('CONFLICT', `自有 hook 被手改/移除，保留配置：${stripped.conflicts.join(',')}`);
    // 提前返回前核对 current 的实际目标：登记快照完好但入口被删除、断链或错链时只做最小修复，不重写配置。
    const sameSnapshot = Boolean(active?.releaseHash === releaseHash && active?.currentRoot && samePath(active.currentRoot, currentRoot(directory)));
    const entry = await inspectCurrent(directory, active);
    if (entry.state === 'conflict') return currentConflict(entry);
    if (sameSnapshot) {
      if (entry.state === 'own-other') {
        // 入口仍属于本状态根，但指向另一个已登记的有效快照（可能是另一个 Codex 配置目录或宿主）：不改指。
        const owner = await otherHostSnapshot(directory, state, agent, entry.target, active);
        if (owner) return {
          status: 'conflict', agent, version: active.version, path: entry.link, kind: 'link', target: entry.target, registeredBy: owner,
          conflict: `current 已指向 ${owner.agent} 登记的 ${owner.version} 发布快照；多个宿主/配置目录共用入口，本次 ${active.version} 安装不改指。先统一升级后再重试`,
          reason: '另一个已安装宿主或 Codex 配置目录正在使用 current；保留现场待统一升级',
        };
      }
      const plan = agent === 'claude' ? await syncAgentFiles(configFile, active.releaseRoot, agentFilesFor(active.files || files), await agentLedger(active)) : null;
      let agents = null;
      if (plan) {
        active.agentLedger = plan.ledger;
        delete active.agentFiles;
        delete active.previousAgentFiles;
        agents = agentReceipt(plan);
      }
      const common = { agent, version: active.version, releaseRoot: active.releaseRoot, configFile, requiresTrust: 'unknown', ...(agents ? { agents } : {}) };
      if (entry.state === 'verified') {
        if (!plan?.writes.length) return { status: 'already-installed', ...common, currentRoot: active.currentRoot };
        return { status: 'repaired', ...common, currentRoot: active.currentRoot };
      }
      await pointCurrent(directory, active.releaseRoot);
      return { status: 'repaired', ...common, currentRoot: currentRoot(directory), previousTarget: entry.target ?? null };
    }
    const activeTasks = Object.values(state.tasks).filter(task => task.lifecycle === 'active').map(task => task.taskId);
    const activeTransactions = Object.values(state.transactions).filter(tx => tx.status === 'prepared').map(tx => tx.transactionId);
    if (activeTasks.length || activeTransactions.length) return { status: 'deferred', reason: '仍有活动任务或未辨认的事务；保留当前发布副本和配置', activeTasks, activeTransactions };
    const releaseRoot = path.join(directory, 'releases', `${packageInfo.version}-${releaseHash.slice(0, 16)}`);
    try {
      await lstat(releaseRoot);
      if (!await verifyRelease({ releaseRoot, files })) fail('INTEGRITY', '目标发布副本已有不同内容，不覆盖');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // A failed or interrupted copy remains inspectable without occupying the final release path.
      const stagingRoot = path.join(directory, 'release-staging', id('release'));
      await mkdir(stagingRoot, { recursive: true });
      for (const file of files) {
        await mkdir(path.dirname(path.join(stagingRoot, file.path)), { recursive: true });
        await copyFile(path.join(sourceRoot, file.path), path.join(stagingRoot, file.path));
      }
      if (!await verifyRelease({ releaseRoot: stagingRoot, files })) fail('INTEGRITY', '暂存发布副本与来源摘要不符；保留现场，不注册');
      await mkdir(path.dirname(releaseRoot), { recursive: true });
      await rename(stagingRoot, releaseRoot);
    }
    // 配置只认固定入口；意图与状态先落盘，任何准备失败都不能提前切换共享 current。
    const link = currentRoot(directory);
    const handlers = Object.fromEntries(host.events.map(event => [event, host.handler(link, directory, event)]));
    const after = addHandlers(stripped.config, handlers, stripped.slots);
    const changeId = id('install');
    const target = handlers[host.events[0]];
    const record = { status: 'prepared', agent, events: host.events, changeId, version: packageInfo.version, releaseHash, releaseRoot, currentRoot: link, files, configFile, command: target.command, args: target.args ?? null, handlers, beforeHash: textHash(current.text), afterHash: digest(after), previousCurrentTarget: entry.target ?? null, ...(agent === 'claude' ? { agentLedger: await agentLedger(active) } : {}), registeredAt: new Date().toISOString(), previousOwned: active ? { command: active.command, args: active.args ?? null, handlers: active.handlers, events: active.events || host.events } : null };
    // Only owned definitions and fingerprints are backed up, never unrelated configuration or credentials.
    await writeJSON(path.join(directory, 'installation-changes', `${changeId}.json`), record);
    registerInstall(state, agent, record);
    await save();
    return finishPrepared(directory, state, save, record, agent);
  });
}
export async function uninstall(directory, { agent = 'codex', userDir } = {}) {
  const host = hostFor(agent);
  const configFile = userDir ? path.join(path.resolve(userDir), host.configName) : null;
  return mutate(directory, async (state, save) => {
    // 无参数只处理默认位置；附加位置不撤销，但把仍在登记的附加记录一起返回给调用方。
    const withExtras = result => {
      if (configFile) return result;
      const extras = extraSummary(state, agent);
      return extras.length ? { ...result, locations: extras, extras } : result;
    };
    const record = configFile ? locateInstall(state, agent, configFile).record : installRecord(state, agent);
    if (!record || record.status === 'uninstalled') return withExtras({ status: 'not-installed' });
    if (record.status === 'prepared') await finishPrepared(directory, state, save, record, agent);
    if (record.status !== 'installed') fail('RECOVERY', '安装事务尚未确认，需要先核对注册差异');
    const agentPlan = await agentRemovalPlan(record.configFile, await agentLedger(record));
    const finish = removed => {
      record.status = 'uninstalled';
      record.uninstalledAt = new Date().toISOString();
      delete record.uninstallIntent;
      // 账本随卸载清除；重装按全新状态判断，不沿用旧记录认领文件。
      delete record.agentLedger;
      delete record.agentFiles;
      delete record.previousAgentFiles;
      // 只同步权威记录；附加位置留在 extra 中供 doctor 追溯，不能覆盖默认目录记录。
      if (samePrimary(state, agent, record)) {
        state.installs[agent] = record;
        if (agent === 'codex') state.install = record;
      }
      return withExtras({
        status: 'uninstalled', releaseRetained: record.releaseRoot, reason: '发布副本和追溯记录保留，可通过系统回收站清理',
        ...(agent === 'claude' ? { agents: { removed, kept: agentPlan.kept } } : {}),
      });
    };
    // 撤销意图先落盘：配置移除成功后若最终状态保存失败，重试可按前后指纹识别已完成并收敛。
    const intent = record.uninstallIntent;
    if (intent?.configFile && samePath(intent.configFile, record.configFile)) {
      const hash = textHash(await readText(record.configFile));
      if (hash === intent.afterHash) {
        await removeOwnedAgentFiles(intent.agentFiles || []);
        return finish((intent.agentFiles || []).map(file => file.name));
      }
      if (hash !== intent.beforeHash) fail('CONFLICT', '卸载重试时配置不匹配撤销前后指纹；保留用户配置与事务');
      // 指纹仍是撤销前内容：上次尚未移除 hooks，按正常流程重新计算后继续。
    }
    const current = await readConfig(record.configFile);
    const stripped = removeOwned(current.config, { ...record, events: record.events || host.events });
    if (stripped.conflicts.length) return { status: 'conflict', conflicts: stripped.conflicts, reason: '自有定义被用户修改；保留整个配置待核对' };
    if (await readText(record.configFile) !== current.text) fail('CONFLICT', '撤销期间用户修改了配置');
    const after = JSON.stringify(stripped.config, null, 2) + '\n';
    record.uninstallIntent = { configFile: record.configFile, beforeHash: textHash(current.text), afterHash: digest(after), events: record.events || host.events, agentFiles: agentPlan.remove };
    await save();
    await atomicWrite(record.configFile, after);
    await removeOwnedAgentFiles(agentPlan.remove);
    return finish(agentPlan.remove.map(file => file.name));
  });
}
// 只读核对 Codex 的 Default 模式提问开关；不写用户配置。只认 [features] 段内的布尔赋值，其余写法报告 unknown。
export async function codexQuestionFeature(userDir = HOSTS.codex.defaultUserDir()) {
  const text = await readText(path.join(userDir, 'config.toml')).catch(() => undefined);
  const note = '未开启时也可用当前入口可用的结构化提问工具，或改用文本编号问题；是否开启由用户决定。';
  if (text === null) return { setting: 'default_mode_request_user_input', status: 'config-missing', note };
  if (text === undefined) return { setting: 'default_mode_request_user_input', status: 'unknown', note };
  let section = '', value;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) { section = header[1].trim(); continue; }
    const match = /^default_mode_request_user_input\s*=\s*(\S+)$/.exec(line);
    if (match && section === 'features') value = match[1];
  }
  const status = value === 'true' ? 'enabled' : value === 'false' || value === undefined ? 'disabled' : 'unknown';
  return { setting: 'default_mode_request_user_input', status, ...(status === 'enabled' ? {} : { note }) };
}
// 安装写入的是无 matcher 的 { hooks:[handler] }。分组 matcher 会把 hook 限制到部分工具/事件，
// disableAllHooks 会整体停用；出现任一情况都不算真实注册（空 matcher 等价于全部，允许宿主归一化）。
const groupRunsEveryEvent = group => !Object.hasOwn(group, 'matcher') || group.matcher === '' || group.matcher === null;
export async function registrationStatus(record, agent = 'codex') {
  const host = hostFor(agent);
  if (record?.status !== 'installed') return 'not-installed';
  try {
    const current = await readConfig(record.configFile);
    if (current.config.disableAllHooks === true) return 'missing-or-modified';
    const registered = (record.events || host.events).every(event => current.config.hooks?.[event]?.some(group => groupRunsEveryEvent(group) && group.hooks.some(handler => sameTarget(handler, record) && JSON.stringify(handler) === JSON.stringify(record.handlers[event]))));
    return registered ? 'registered' : 'missing-or-modified';
  } catch { return 'unreadable-or-unknown'; }
}
async function locationReport(directory, agent, item) {
  const record = item?.record || null;
  return {
    location: item?.location || null,
    configFile: record?.configFile || null,
    status: record?.status || 'not-installed',
    registration: await registrationStatus(record, agent),
    integrity: record ? await releaseIntegrity(directory, record) : 'not-installed',
    version: record?.version || null,
  };
}
export async function doctor(directory, root, { agent = 'codex', userDir } = {}) {
  hostFor(agent);
  const state = await readState(directory);
  const registered = installLocations(state, agent);
  const configFile = userDir ? path.join(path.resolve(userDir), HOSTS[agent].configName) : null;
  const selected = configFile ? locateInstall(state, agent, configFile) : registered.find(item => item.location === 'primary') || { record: null, location: null };
  const record = selected.record;
  const configuration = await registrationStatus(record, agent);
  const registeredNow = configuration === 'registered';
  const actual = Object.entries(hostObservations(state, agent)).filter(([, observation]) => observation.source === 'callback').map(([event, observation]) => ({ event, at: observation.at }));
  const project = root ? await (await import('./projects.mjs')).resolveProject(state, root) : null;
  return {
    schemaVersion: 1, agent, registration: configuration, discovery: 'unknown', trust: 'unknown',
    // 指定 --user-dir 时只报告该位置；不带参数时顶层是默认（权威）位置，并列出所有已登记位置。
    ...(configFile ? { location: selected.location, configFile: record?.configFile || configFile } : {}),
    execution: actual.length ? { status: 'callback-observed-host-unverified', events: actual } : 'unknown',
    integrity: record ? await releaseIntegrity(directory, record) : 'not-installed',
    version: record?.version || null,
    ...(agent === 'claude' ? { agents: record ? await agentDoctor(record) : [] } : {}),
    ...(agent === 'codex' ? { questionInDefaultMode: await codexQuestionFeature(userDir || (record?.configFile ? path.dirname(record.configFile) : undefined)) } : {}),
    ...(configFile ? {} : { locations: await Promise.all(registered.map(item => locationReport(directory, agent, item))) }),
    activeTasks: Object.values(state.tasks).filter(task => task.lifecycle === 'active').map(task => task.taskId),
    project: project ? { projectId: project.project.projectId, enabled: true, coexistenceMode: project.project.coexistenceMode } : null,
    pending: Object.values(state.pending).filter(item => item.status === 'open' && (!root || (project && item.projectId === project.project.projectId))).map(item => ({ pendingId: item.pendingId, kind: item.kind, reason: item.reason })),
    next: registeredNow ? '使用当前 ACP 宿主核对 hooks/list 与 /hooks 信任，在新会话观察本插件回调；不要用全局 CLI 版本代替 ACP 版本' : '先核对安装/注册差异；测试始终使用临时 user-dir/state-dir',
  };
}

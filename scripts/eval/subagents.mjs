import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { check } from './assertions.mjs';
import { hookEvents, initEvent, resultEvents, toolUses } from './events.mjs';
import { readJson } from './isolation.mjs';

// 只解析 `---` 包裹的简单 `key: value` frontmatter；子代理定义只用这几项，不引入 YAML 依赖。
export function parseFrontmatter(text) {
  if (typeof text !== 'string') return null;
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (pair) fields[pair[1]] = pair[2].trim();
  }
  return fields;
}

export async function readAgentDefinition(configDir, name) {
  const file = path.join(configDir, 'agents', `${name}.md`);
  let text;
  try { text = await readFile(file, 'utf8'); } catch { return { name, file, fields: null }; }
  return { name, file, fields: parseFrontmatter(text) };
}

export const normalizeAgentName = value => (typeof value === 'string' ? value.replace(/^workflow:/, '') : null);

// 真机实际是裸名；兼容插件前缀，但报告写出实际值。
export function agentNameMatches(actual, expected) {
  return normalizeAgentName(actual) === expected;
}

export function subagentCalls(events) {
  return toolUses(events)
    .filter(call => call.name === 'Agent' || call.name === 'Task')
    .map(call => ({
      id: call.id,
      tool: call.name,
      subagentType: call.input?.subagent_type ?? call.input?.agent_type ?? null,
      description: call.input?.description ?? null,
      background: call.input?.run_in_background === true,
    }));
}

// result.modelUsage 同时记录键名与 canonicalModel；两者都算“出现定义中的模型”。
export function modelUsageModels(events) {
  const models = new Set();
  for (const event of resultEvents(events)) {
    for (const [key, usage] of Object.entries(event.modelUsage || {})) {
      models.add(key);
      if (typeof usage?.canonicalModel === 'string' && usage.canonicalModel) models.add(usage.canonicalModel);
    }
  }
  return [...models];
}

export function sessionIdOf(events) {
  return initEvent(events)?.session_id || (events || []).find(event => event?.session_id)?.session_id || null;
}

export async function readConsultationFiles(stateDir, { sessionId, subagentType } = {}) {
  const dir = path.join(stateDir, 'consultations');
  let entries;
  try { entries = await readdir(dir); } catch { return []; }
  const records = [];
  for (const entry of entries.filter(name => name.endsWith('.json'))) {
    const file = path.join(dir, entry);
    const value = await readJson(file);
    if (!value || !Array.isArray(value.consultations)) continue;
    if (sessionId && value.sessionId !== sessionId) continue;
    for (const consultation of value.consultations) {
      if (subagentType && consultation.subagentType !== subagentType) continue;
      records.push({ file, sessionId: value.sessionId, projectId: value.projectId ?? null, ...consultation });
    }
  }
  return records;
}

function toolTarget(input) {
  return input?.file_path ?? input?.path ?? input?.pattern ?? null;
}

// 子代理内部事件不在父级 stream-json 里；宿主在隔离配置目录下另写 sidechain transcript。
// 只读真实文件，按 sessionId 定位，不扫描真实用户配置。
export async function readNativeSubagents(configDir, sessionId) {
  if (!sessionId) return [];
  const projectsRoot = path.join(configDir, 'projects');
  let projects;
  try { projects = await readdir(projectsRoot, { withFileTypes: true }); } catch { return []; }
  const found = [];
  for (const project of projects.filter(entry => entry.isDirectory())) {
    const dir = path.join(projectsRoot, project.name, sessionId, 'subagents');
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries.filter(item => item.isFile() && item.name.endsWith('.jsonl'))) {
      const file = path.join(dir, entry.name);
      const metaFile = path.join(dir, `${entry.name.slice(0, -'.jsonl'.length)}.meta.json`);
      const meta = await readJson(metaFile);
      let text;
      try { text = await readFile(file, 'utf8'); } catch { continue; }
      const toolCalls = [];
      let requestedModel = null;
      let attributionAgent = null;
      let querySource = null;
      let agentId = null;
      let sidechain = false;
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        let value;
        try { value = JSON.parse(line); } catch { continue; }
        if (value.agentId && !agentId) agentId = value.agentId;
        if (value.isSidechain === true) sidechain = true;
        if (!requestedModel && typeof value.requestedModel === 'string' && value.requestedModel) requestedModel = value.requestedModel;
        if (!attributionAgent && typeof value.attributionAgent === 'string' && value.attributionAgent) attributionAgent = value.attributionAgent;
        if (!querySource && typeof value.querySource === 'string' && value.querySource) querySource = value.querySource;
        if (value.type !== 'assistant') continue;
        for (const block of value.message?.content || []) {
          if (block?.type === 'tool_use') toolCalls.push({ name: block.name, target: toolTarget(block.input) });
        }
      }
      found.push({
        file,
        metaFile,
        agentId,
        sidechain,
        agentType: meta?.agentType ?? attributionAgent ?? null,
        description: meta?.description ?? null,
        toolUseId: meta?.toolUseId ?? null,
        spawnDepth: meta?.spawnDepth ?? null,
        pickedEffortModel: meta?.pickedEffortModel ?? null,
        requestedModel,
        attributionAgent,
        querySource,
        toolUses: toolCalls,
      });
    }
  }
  return found;
}

function consultationHookNames(events) {
  return [...new Set(hookEvents(events)
    .map(event => event.hook_name)
    .filter(name => typeof name === 'string' && /Agent|Task|SubagentStop/.test(name)))];
}

export async function observeSubagent({ events, configDir, stateDir, agentName }) {
  const calls = subagentCalls(events);
  const sessionId = sessionIdOf(events);
  const definition = await readAgentDefinition(configDir, agentName);
  const nativeAll = await readNativeSubagents(configDir, sessionId);
  const matched = calls.filter(call => agentNameMatches(call.subagentType, agentName));
  const matchedIds = new Set(matched.map(call => call.id));
  // 只认父级匹配调用的 tool_use_id 与 meta.json toolUseId 一一关联的 transcript；
  // 同会话同类型的旧记录不能当成本次调用的路由与工具证据。
  const native = nativeAll.filter(item => agentNameMatches(item.agentType, agentName)
    && typeof item.toolUseId === 'string'
    && matchedIds.has(item.toolUseId));
  const associatedIds = new Set(native.map(item => item.toolUseId));
  const missingTranscriptCallIds = matched
    .filter(call => typeof call.id !== 'string' || !associatedIds.has(call.id))
    .map(call => call.id ?? null);
  return {
    agentName,
    sessionId,
    calls,
    matched,
    definition,
    expectedModel: definition.fields?.model ?? null,
    modelUsageKeys: modelUsageModels(events),
    consultations: sessionId ? await readConsultationFiles(stateDir, { sessionId, subagentType: agentName }) : [],
    native,
    nativeAll,
    // 每次匹配调用都必须有对应的 transcript；只有部分匹配调用可关联时不能凭剩余记录判通过。
    associationComplete: missingTranscriptCallIds.length === 0,
    missingTranscriptCallIds,
    consultationHookEvents: consultationHookNames(events),
  };
}

// 关联不完整时，路由与内部工具维度都必须不可观测；hand-built 观测没有该字段时保持旧行为。
function associationIncomplete(observation) {
  return observation.associationComplete === false;
}

// internalToolsCheck 与报告共用同一判定：关联不完整、无关联 transcript、或 transcript 均无内部工具调用时不可观测。
function internalToolsUnobservable(observation) {
  if (associationIncomplete(observation)) return '匹配调用与 transcript 关联不完整';
  if (!observation.native.length) return '没有找到绑定本会话的原生子代理 transcript';
  if (!observation.native.some(item => (item.toolUses || []).length)) return '原生子代理 transcript 没有记录内部工具调用';
  return null;
}

// 报告用的稳定形状：只写实际观测值，不把“未观测到”写成通过。
export function reportObservation(observation, { internalTools = false } = {}) {
  const unobservable = [];
  if (!observation.expectedModel) unobservable.push('定义 frontmatter model');
  if (!observation.modelUsageKeys.length) unobservable.push('modelUsage');
  if (associationIncomplete(observation)) unobservable.push('匹配调用与 transcript 关联不完整');
  else if (!observation.native.length) unobservable.push('子代理原生 transcript（路由归因）');
  else if (!observation.native.every(item => item.requestedModel)) unobservable.push('子代理 requestedModel');
  if (internalTools && internalToolsUnobservable(observation)) unobservable.push('子代理内部工具调用');
  // 路由只依据已关联 transcript 的 requestedModel；会话级 modelUsage 不能代替它。
  const requestedModels = observation.native.map(item => item.requestedModel);
  const routeObservable = !associationIncomplete(observation)
    && Boolean(observation.expectedModel)
    && requestedModels.length > 0
    && requestedModels.every(Boolean);
  return {
    agentName: observation.agentName,
    callObserved: observation.matched.length > 0,
    routeObserved: routeObservable
      ? requestedModels.every(model => model === observation.expectedModel)
      : null,
    expectedModel: observation.expectedModel,
    subagentTypes: observation.calls.map(call => ({ tool: call.tool, subagent_type: call.subagentType })),
    modelUsageKeys: observation.modelUsageKeys,
    consultationPaths: observation.consultations.map(record => record.file),
    consultationHookEvents: observation.consultationHookEvents,
    native: observation.native.map(item => ({
      agentType: item.agentType,
      requestedModel: item.requestedModel,
      pickedEffortModel: item.pickedEffortModel,
      file: item.file,
      toolUses: item.toolUses,
    })),
    unobservable,
  };
}

export function subagentCallCheck(observation, id) {
  const actual = observation.calls.map(call => ({ tool: call.tool, subagent_type: call.subagentType }));
  return check(
    id,
    observation.matched.length > 0,
    observation.matched.length
      ? `transcript 出现 ${observation.matched.length} 次 subagent_type=${observation.matched[0].subagentType} 的 Agent/Task 调用`
      : `transcript 没有出现 subagent_type=${observation.agentName} 的 Agent/Task 调用；不能把“没有动手”当成通过`,
    `Agent/Task with subagent_type=${observation.agentName}`,
    actual,
  );
}

export function modelUsageCheck(observation, id) {
  if (!observation.expectedModel) {
    return check(id, true, `无法从隔离安装的 agents/${observation.agentName}.md 读取 frontmatter model，路由不可观测`, 'frontmatter model', null, { observable: false });
  }
  if (!observation.modelUsageKeys.length) {
    return check(id, true, 'result 事件没有 modelUsage，路由不可观测', observation.expectedModel, [], { observable: false });
  }
  const ok = observation.modelUsageKeys.includes(observation.expectedModel);
  return check(
    id,
    ok,
    ok
      ? `modelUsage 出现隔离安装定义中的模型 ${observation.expectedModel}`
      : `modelUsage 没有出现隔离安装定义中的模型 ${observation.expectedModel}`,
    observation.expectedModel,
    observation.modelUsageKeys,
  );
}

// 父级 modelUsage 是会话级汇总；再用宿主在隔离配置目录写的子代理 transcript 把模型绑定到具体子代理。
export function nativeModelCheck(observation, id) {
  if (!observation.expectedModel) {
    return check(id, true, '无法从隔离安装定义读取 frontmatter model，不能核对子代理路由', 'frontmatter model', null, { observable: false });
  }
  if (associationIncomplete(observation)) {
    return check(id, true, '匹配调用与 transcript 关联不完整，不能核对子代理路由', observation.expectedModel, { missingCallIds: observation.missingTranscriptCallIds ?? null }, { observable: false });
  }
  if (!observation.native.length) {
    return check(id, true, '没有找到绑定本会话的原生子代理 transcript，不能核对子代理路由', observation.expectedModel, [], { observable: false });
  }
  if (observation.native.some(item => !item.requestedModel)) {
    return check(id, true, '原生子代理 transcript 没有记录 requestedModel，不能核对子代理路由', observation.expectedModel, [], { observable: false });
  }
  const models = [...new Set(observation.native.map(item => item.requestedModel))];
  const ok = models.every(model => model === observation.expectedModel);
  return check(
    id,
    ok,
    ok
      ? `子代理原生 transcript 的 requestedModel 为 ${observation.expectedModel}`
      : '子代理原生 transcript 的 requestedModel 与定义不一致',
    observation.expectedModel,
    { models, agentTypes: observation.native.map(item => item.agentType) },
  );
}

export function consultationRecordCheck(observation, id) {
  if (!observation.sessionId) {
    return check(id, true, '没有取得宿主 sessionId，无法核对咨询记录归属', 'bound session consultation record', null, { observable: false });
  }
  const records = observation.consultations;
  const withQuestion = records.filter(record => typeof record.question === 'string' && record.question.trim());
  const ok = records.length > 0 && withQuestion.length === records.length;
  return check(
    id,
    ok,
    ok
      ? `隔离 state/consultations/ 有 ${records.length} 条绑定本会话的 ${observation.agentName} 咨询记录`
      : (records.length
        ? '咨询记录缺少 hook 写入的 question'
        : `隔离 state/consultations/ 没有绑定本会话的 ${observation.agentName} 咨询记录`),
    'bound session consultation record',
    records.map(record => ({
      file: record.file,
      sessionId: record.sessionId,
      subagentType: record.subagentType,
      question: record.question ?? null,
      taskId: record.taskId ?? null,
      turnId: record.turnId ?? null,
    })),
  );
}

export function declaredToolsCheck(observation, expectedTools, id) {
  const declared = observation.definition.fields?.tools;
  if (!declared) {
    return check(id, true, `无法从隔离安装的 agents/${observation.agentName}.md 读取 tools，只读限定不可观测`, expectedTools, null, { observable: false });
  }
  const tools = declared.split(',').map(item => item.trim()).filter(Boolean);
  const ok = tools.length === expectedTools.length && expectedTools.every(tool => tools.includes(tool));
  return check(
    id,
    ok,
    ok
      ? `隔离安装定义的 tools 仅含 ${expectedTools.join(', ')}`
      : '隔离安装定义的 tools 与只读白名单不一致',
    expectedTools,
    tools,
  );
}

export function internalToolsCheck(observation, allowedTools, id) {
  const unobservable = internalToolsUnobservable(observation);
  if (unobservable) {
    return check(id, true, `${unobservable}，内部工具调用不可观测`, allowedTools, null, { observable: false });
  }
  const tools = observation.native.flatMap(item => item.toolUses.map(call => call.name));
  const outside = tools.filter(name => !allowedTools.includes(name));
  const ok = outside.length === 0;
  return check(
    id,
    ok,
    ok
      ? `子代理内部工具调用只有 ${[...new Set(tools)].join(', ')}`
      : `子代理内部出现只读白名单外的工具：${outside.join(', ')}`,
    allowedTools,
    [...new Set(tools)],
  );
}

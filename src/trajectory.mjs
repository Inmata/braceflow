import os from 'node:os';
import path from 'node:path';
import { appendFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';

const SESSION_ID = /^[A-Za-z0-9._-]{1,128}$/;
const REASON_LIMIT = 200;
const PREVIEW_LIMIT = 200;
const SHORT_TOOL_RESULT = /^PreToolUse:([A-Za-z0-9_]+) hook error:\s*([\s\S]*)$/;
const HOOK_ATTACHMENT = /^hook_/;

export const DECISION_SCHEMA_VERSION = 1;
// 决定行与落盘统计行分开：一行记录无法包含自身的写入耗时，落盘完成后再追加统计行。
export const DECISION_KIND = 'decision';
export const WRITE_KIND = 'write';

const shortText = (value, limit = REASON_LIMIT) => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, limit) : null;
};
const round = value => Math.round(value * 1000) / 1000;

export function decisionFile(stateDir, sessionId) {
  return path.join(stateDir, 'decisions', `${sessionId}.jsonl`);
}

// 决定记录只写本机状态目录，不进入模型上下文；追加失败不影响 Hook 返回值。
export async function recordDecision(stateDir, record) {
  if (!record || !SESSION_ID.test(String(record.sessionId || ''))) return null;
  const at = new Date().toISOString();
  const entry = {
    schemaVersion: DECISION_SCHEMA_VERSION,
    kind: DECISION_KIND,
    at,
    sessionId: record.sessionId,
    event: record.event,
    host: record.host || null,
    rule: record.rule,
    decision: record.decision,
    reason: shortText(record.reason),
    toolUseId: record.toolUseId || null,
    toolName: record.toolName || null,
    turnId: record.turnId || null,
    transcriptPath: record.transcriptPath || null,
  };
  const file = decisionFile(stateDir, record.sessionId);
  const line = `${JSON.stringify(entry)}\n`;
  const started = performance.now();
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, line, 'utf8');
  } catch {
    return null;
  }
  const ms = round(performance.now() - started);
  const bytes = Buffer.byteLength(line);
  const stat = {
    schemaVersion: DECISION_SCHEMA_VERSION,
    kind: WRITE_KIND,
    at,
    sessionId: record.sessionId,
    event: record.event,
    rule: record.rule,
    toolUseId: record.toolUseId || null,
    bytes,
    ms,
  };
  // 统计行落盘失败不影响已经写入的决定行；读取端按缺失处理，不猜耗时。
  await appendFile(file, `${JSON.stringify(stat)}\n`, 'utf8').catch(() => null);
  return { file, bytes, ms };
}

export async function readDecisions(stateDir, sessionId) {
  const file = decisionFile(stateDir, sessionId);
  let text;
  try { text = await readFile(file, 'utf8'); } catch (error) {
    if (error.code === 'ENOENT') return { file, records: [], writes: [], malformed: 0, bytes: 0 };
    throw error;
  }
  const records = [];
  const writes = [];
  let malformed = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line);
      if (!value || typeof value !== 'object' || Array.isArray(value)) { malformed += 1; continue; }
      if (value.kind === WRITE_KIND) writes.push(value);
      else records.push(value);
    } catch { malformed += 1; }
  }
  return { file, records, writes, malformed, bytes: Buffer.byteLength(text) };
}

function defaultConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

async function readSettingsFile(file) {
  let text;
  try { text = await readFile(file, 'utf8'); } catch (error) {
    if (error.code === 'ENOENT') return { json: null, error: null };
    return { json: null, error: error.code || 'IO' };
  }
  try {
    const json = JSON.parse(text.replace(/^﻿/, ''));
    return { json: json && typeof json === 'object' && !Array.isArray(json) ? json : null, error: json ? null : 'FORMAT' };
  } catch {
    return { json: null, error: 'JSON' };
  }
}

function workflowHandler(command, args) {
  return [command, ...args].some(value => typeof value === 'string' && /workflow\.mjs/i.test(value));
}

// Hook 清单只读 settings，不改任何配置；用户级在前，项目级其次，本机项目设置最后。
export async function hookInventory({ root = process.cwd(), configDir } = {}) {
  const dir = configDir || defaultConfigDir();
  const sources = [
    { source: 'user', file: path.join(dir, 'settings.json') },
    { source: 'project', file: path.join(root, '.claude', 'settings.json') },
    { source: 'local', file: path.join(root, '.claude', 'settings.local.json') },
  ];
  const files = [];
  const hooks = [];
  for (const item of sources) {
    const loaded = await readSettingsFile(item.file);
    files.push({ source: item.source, path: item.file, exists: loaded.json !== null, ...(loaded.error ? { error: loaded.error } : {}) });
    if (!loaded.json) continue;
    const groups = loaded.json.hooks;
    if (!groups || typeof groups !== 'object' || Array.isArray(groups)) continue;
    for (const [event, list] of Object.entries(groups)) {
      if (!Array.isArray(list)) continue;
      for (const group of list) {
        if (!group || typeof group !== 'object') continue;
        const configured = group.matcher;
        const matcher = typeof configured === 'string' && configured.trim() ? configured : null;
        const handlers = Array.isArray(group.hooks) ? group.hooks : [];
        for (const handler of handlers) {
          if (!handler || typeof handler !== 'object') continue;
          const command = typeof handler.command === 'string' ? handler.command : null;
          const args = Array.isArray(handler.args) ? handler.args.filter(value => typeof value === 'string') : [];
          hooks.push({
            source: item.source,
            file: item.file,
            event,
            matcher,
            coverage: matcher ? 'filtered' : 'all',
            type: typeof handler.type === 'string' ? handler.type : null,
            command,
            args,
            timeout: Number.isFinite(handler.timeout) ? handler.timeout : null,
            workflow: workflowHandler(command, args),
          });
        }
      }
    }
  }
  return { files, hooks };
}

function matcherCovers(matcher, toolName) {
  if (!matcher || matcher === '*') return true;
  try { return new RegExp(`^(?:${matcher})$`).test(toolName); } catch { return matcher === toolName; }
}

async function findTranscript(configDir, sessionId) {
  const root = path.join(configDir || defaultConfigDir(), 'projects');
  let slugs;
  try { slugs = await readdir(root, { withFileTypes: true }); } catch { return null; }
  const matches = [];
  for (const slug of slugs) {
    if (!slug.isDirectory()) continue;
    const file = path.join(root, slug.name, `${sessionId}.jsonl`);
    const info = await stat(file).catch(() => null);
    if (info?.isFile()) matches.push({ file, mtimeMs: info.mtimeMs });
  }
  matches.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return matches[0]?.file || null;
}

async function readJsonl(file) {
  let text;
  try { text = await readFile(file, 'utf8'); } catch { return null; }
  const entries = [];
  let malformed = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line);
      if (value && typeof value === 'object' && !Array.isArray(value)) entries.push(value);
      else malformed += 1;
    } catch { malformed += 1; }
  }
  return { entries, malformed };
}

function messageText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const texts = content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text);
  return texts.length ? texts.join('\n') : null;
}

function parseHookOutput(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value.trim());
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}

function hookAttachment(entry) {
  const attachment = entry?.attachment;
  const type = typeof attachment?.type === 'string' ? attachment.type : null;
  if (!type || !HOOK_ATTACHMENT.test(type)) return null;
  const output = parseHookOutput(attachment.stdout) || parseHookOutput(attachment.content);
  const hookName = typeof attachment.hookName === 'string' ? attachment.hookName : null;
  const event = typeof attachment.hookEvent === 'string' ? attachment.hookEvent : (hookName && hookName.includes(':') ? hookName.split(':')[0] : null);
  const toolName = hookName && hookName.includes(':') ? hookName.slice(hookName.indexOf(':') + 1) : null;
  return {
    type,
    at: typeof entry.timestamp === 'string' ? entry.timestamp : null,
    hookName,
    event,
    toolName,
    toolUseId: typeof attachment.toolUseID === 'string' ? attachment.toolUseID : null,
    command: typeof attachment.command === 'string' ? attachment.command : null,
    exitCode: Number.isFinite(attachment.exitCode) ? attachment.exitCode : null,
    durationMs: Number.isFinite(attachment.durationMs) ? attachment.durationMs : null,
    stdout: typeof attachment.stdout === 'string' ? attachment.stdout : null,
    stderr: typeof attachment.stderr === 'string' ? attachment.stderr : null,
    decision: output?.hookSpecificOutput?.permissionDecision || null,
    updatedInput: Boolean(output?.hookSpecificOutput && Object.hasOwn(output.hookSpecificOutput, 'updatedInput')),
  };
}

function parseSubagentFile(events) {
  const calls = [];
  const results = new Map();
  for (const entry of events) {
    if (entry.type === 'assistant') {
      for (const block of entry.message?.content || []) {
        if (block?.type !== 'tool_use') continue;
        calls.push({
          toolUseId: typeof block.id === 'string' ? block.id : null,
          name: typeof block.name === 'string' ? block.name : null,
          at: typeof entry.timestamp === 'string' ? entry.timestamp : null,
          input: block.input ?? null,
          result: null,
          hostHooks: [],
          workflow: null,
          status: null,
          signals: [],
        });
      }
    } else if (entry.type === 'user') {
      for (const block of entry.message?.content || []) {
        if (block?.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue;
        const text = typeof block.content === 'string' ? block.content : messageText(block.content);
        results.set(block.tool_use_id, {
          at: typeof entry.timestamp === 'string' ? entry.timestamp : null,
          isError: block.is_error === true,
          bytes: Buffer.byteLength(text || ''),
          preview: shortText(text, PREVIEW_LIMIT),
        });
      }
    }
  }
  for (const call of calls) if (call.toolUseId && results.has(call.toolUseId)) call.result = results.get(call.toolUseId);
  return calls;
}

function subagentSummary(meta, calls) {
  return {
    agentId: typeof meta.agentId === 'string' ? meta.agentId : null,
    agentType: typeof meta.agentType === 'string' ? meta.agentType : null,
    description: typeof meta.description === 'string' ? meta.description : null,
    toolUseId: typeof meta.toolUseId === 'string' ? meta.toolUseId : null,
    toolCalls: calls,
  };
}

// transcript 中一条 assistant 记录可能只含部分内容块，tool_use 按 id 归并到调用列表。
function collectTranscript(entries) {
  const turns = [];
  const calls = [];
  const byId = new Map();
  const missing = new Set();
  let version = null;
  let cwd = null;
  let current = null;
  for (const entry of entries) {
    if (typeof entry.version === 'string' && !version) version = entry.version;
    if (typeof entry.cwd === 'string' && !cwd) cwd = entry.cwd;
    if (entry.type === 'user') {
      const content = entry.message?.content;
      const hasResult = Array.isArray(content) && content.some(block => block?.type === 'tool_result');
      const text = messageText(content);
      if (!hasResult && text !== null) {
        const turnId = typeof entry.promptId === 'string' ? entry.promptId : null;
        if (!turnId) missing.add('promptId');
        current = {
          turnId,
          at: typeof entry.timestamp === 'string' ? entry.timestamp : null,
          prompt: text,
          toolCalls: [],
          hostHooks: [],
          stop: null,
        };
        if (!current.at) missing.add('timestamp');
        turns.push(current);
      }
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue;
          const call = byId.get(block.tool_use_id);
          if (!call) continue;
          const resultText = typeof block.content === 'string' ? block.content : messageText(block.content);
          call.result = {
            at: typeof entry.timestamp === 'string' ? entry.timestamp : null,
            isError: block.is_error === true,
            bytes: Buffer.byteLength(resultText || ''),
            preview: shortText(resultText, PREVIEW_LIMIT),
          };
          const denial = SHORT_TOOL_RESULT.exec((resultText || '').trim());
          if (denial) call.hostDenial = { hookTool: denial[1], reason: shortText(denial[2]) };
          if (entry.toolUseResult?.agentType || entry.toolUseResult?.agentId) {
            const agentId = entry.toolUseResult.agentId;
            if (agentId) call.agentId = String(agentId);
          }
        }
      }
      continue;
    }
    if (entry.type === 'assistant') {
      for (const block of entry.message?.content || []) {
        if (block?.type !== 'tool_use') continue;
        const toolUseId = typeof block.id === 'string' ? block.id : null;
        if (!toolUseId) missing.add('toolUseId');
        const call = {
          toolUseId,
          name: typeof block.name === 'string' ? block.name : null,
          at: typeof entry.timestamp === 'string' ? entry.timestamp : null,
          input: block.input ?? null,
          result: null,
          hostHooks: [],
          workflow: null,
          status: null,
          signals: [],
          hostDenial: null,
          agentId: null,
          subagent: null,
        };
        calls.push(call);
        if (toolUseId) byId.set(toolUseId, call);
        if (!current) {
          missing.add('userTurn');
          current = { turnId: null, at: null, prompt: null, toolCalls: [], hostHooks: [], stop: null };
          turns.push(current);
        }
        current.toolCalls.push(call);
      }
      continue;
    }
    if (entry.type === 'attachment') {
      const hook = hookAttachment(entry);
      if (!hook) continue;
      const call = hook.toolUseId ? byId.get(hook.toolUseId) : null;
      if (call) call.hostHooks.push(hook);
      else if (current) current.hostHooks.push(hook);
    }
  }
  return { turns, calls, missing: [...missing], version, cwd };
}

// 宿主把拒绝写成 hook_system_message、把附加上下文写成 hook_additional_context；
// 只有明确的错误/取消类型或非零退出码才算失败，不能把拒绝附带的 systemMessage 记成失败。
const HOOK_FAILURE_TYPES = new Set(['hook_error', 'hook_failed', 'hook_cancelled']);
function hostHookFailed(hook) {
  if (hook.type === 'hook_timeout') return { failed: false, timeout: true };
  if (!HOOK_FAILURE_TYPES.has(hook.type)) return { failed: false, timeout: false };
  if (hook.exitCode === null || hook.exitCode === 0) return { failed: false, timeout: false };
  // rtk 改写以退出码 3 表示“已改写”，不能与放行或拒绝混同。
  if (hook.exitCode === 3) return { failed: false, timeout: false };
  return { failed: true, timeout: false };
}

function annotateCall(call, workflowCovered) {
  const signals = [];
  let denied = false;
  let asked = false;
  let rewritten = false;
  let failed = false;
  let timeout = false;
  let allowed = false;
  let rewrites = 0;
  for (const hook of call.hostHooks) {
    if (hook.decision === 'deny') { denied = true; signals.push('host-deny'); }
    if (hook.decision === 'ask') { asked = true; signals.push('host-ask'); }
    if (hook.decision === 'allow') { allowed = true; signals.push('host-allow'); }
    // 同一 hook 的 updatedInput 与退出码 3 只算一次改写；rtk 用退出码 3 表示已改写，不能被 allow 盖过。
    const rewrote = Boolean(hook.updatedInput) || hook.exitCode === 3;
    if (hook.updatedInput) signals.push('rewritten');
    if (hook.exitCode === 3) signals.push('rewrite-exit-3');
    if (rewrote) { rewritten = true; rewrites += 1; }
    const state = hostHookFailed(hook);
    if (state.timeout) { timeout = true; signals.push('hook-timeout'); }
    if (state.failed) { failed = true; signals.push('hook-failed'); }
  }
  if (call.workflow) {
    signals.push(`workflow-${call.workflow.decision}`);
    if (call.workflow.decision === 'deny') denied = true;
    if (call.workflow.decision === 'allow') { allowed = true; signals.push('workflow-allow'); }
  }
  if (call.hostDenial) { denied = true; signals.push('host-denial'); }
  // 多个 hook 同时改写时，transcript 没有“最终输入”字段，实际执行内容不可判定。
  if (rewrites > 1) signals.push('final-input-unobservable');
  call.signals = [...new Set(signals)];
  call.finalInput = rewrites > 1 ? 'unobservable' : rewrites === 1 ? 'rewritten' : null;
  call.status = timeout ? 'timeout'
    : denied ? 'deny'
      : asked ? 'ask'
        : rewritten ? 'rewritten'
          : failed ? 'failed'
            : allowed ? 'allow'
              : workflowCovered ? 'unobserved'
                : 'no-decision';
  return { failed, timeout };
}

// 落盘统计行按工具调用或 Stop 的 at 与决定行配对；没有统计行说明该次落盘耗时不可读，留空不猜。
function writeTimeFor(writes, record) {
  if (record.toolUseId) return writes.find(item => item.toolUseId === record.toolUseId && item.event === record.event) || null;
  return writes.find(item => item.event === record.event && item.at === record.at) || null;
}

function turnForStop(turns, stop) {
  if (stop.turnId) {
    const matched = turns.find(turn => turn.turnId === stop.turnId);
    if (matched) return matched;
  }
  if (typeof stop.at !== 'string') return null;
  const at = Date.parse(stop.at);
  if (!Number.isFinite(at)) return null;
  let found = null;
  for (const turn of turns) {
    if (!turn.at) continue;
    const start = Date.parse(turn.at);
    if (!Number.isFinite(start) || start > at) continue;
    found = turn;
  }
  return found;
}

function hookObservation(hooks, calls, turns, decisions) {
  const records = decisions.records;
  const observations = hooks.map(hook => {
    const base = {
      source: hook.source,
      file: hook.file,
      event: hook.event,
      matcher: hook.matcher,
      coverage: hook.coverage,
      command: hook.command,
      args: hook.args,
      workflow: hook.workflow,
    };
    if (hook.event === 'PreToolUse') {
      const covered = calls.filter(call => call.name && matcherCovers(hook.matcher, call.name));
      const observedCalls = covered.filter(call => hook.workflow
        ? Boolean(call.workflow)
        : call.hostHooks.some(item => hostHookMatches(hook, item))).length;
      const orphan = hook.workflow
        ? records.filter(record => record.event === 'PreToolUse' && record.toolUseId && !calls.some(call => call.toolUseId === record.toolUseId)).length
        : 0;
      return {
        ...base,
        coveredCalls: covered.length,
        observedCalls,
        unobservedCalls: covered.length - observedCalls,
        ...(orphan ? { orphanRecords: orphan } : {}),
        status: !covered.length ? 'not-applicable' : observedCalls === 0 ? 'unobserved' : observedCalls < covered.length ? 'partial' : 'observed',
      };
    }
    if (hook.event === 'Stop') {
      const covered = turns.filter(turn => turn.at).length;
      const observed = hook.workflow
        ? turns.filter(turn => turn.stop).length
        : turns.filter(turn => turn.hostHooks.some(item => hostHookMatches(hook, item))).length;
      return {
        ...base,
        coveredTurns: covered,
        observedTurns: observed,
        unobservedTurns: Math.max(0, covered - observed),
        status: !covered ? 'not-applicable' : observed === 0 ? 'unobserved' : observed < covered ? 'partial' : 'observed',
        note: '宿主 transcript 不记录静默 hook；未看到的 Stop hook 一律记为未观察到，不写成放行。',
      };
    }
    return { ...base, status: 'not-covered', note: '本轨迹只合并 PreToolUse 与 Stop；其他事件未观测。' };
  });
  return observations;
}

function hostHookMatches(hook, attachment) {
  if (attachment.event !== hook.event) return false;
  if (hook.event === 'PreToolUse' && !matcherCovers(hook.matcher, attachment.toolName || '')) return false;
  // 必须整条命令的全部片段都命中；共用 node 的不同 hook 不能靠相同前缀互相冒充。
  // attachment 没有 command 时证据不足，不算已观察。
  if (!attachment.command) return false;
  const fragments = [hook.command, ...hook.args].filter(value => typeof value === 'string' && value);
  if (!fragments.length) return false;
  return fragments.every(fragment => attachment.command.includes(fragment));
}

async function readSubagents(transcript) {
  if (!transcript) return { metas: [], tools: new Map() };
  const dir = path.join(path.dirname(transcript), path.basename(transcript, '.jsonl'), 'subagents');
  let files;
  try { files = await readdir(dir); } catch { return { metas: [], tools: new Map() }; }
  const metas = [];
  const tools = new Map();
  for (const name of files) {
    if (!name.startsWith('agent-') || !name.endsWith('.jsonl')) continue;
    const file = path.join(dir, name);
    const parsed = await readJsonl(file);
    if (!parsed) continue;
    const calls = parseSubagentFile(parsed.entries);
    const metaName = name.replace(/\.jsonl$/, '.meta.json');
    const metaFile = path.join(dir, metaName);
    let meta = null;
    try { meta = JSON.parse(await readFile(metaFile, 'utf8')); } catch { /* 没有 meta 时仍保留调用，按不可关联处理 */ }
    const summary = subagentSummary(meta || {}, calls);
    summary.file = file;
    metas.push(summary);
    if (summary.toolUseId) tools.set(summary.toolUseId, summary);
  }
  return { metas, tools };
}

export async function buildTrajectory({ stateDir, sessionId, configDir, transcriptPath = null, root = null, host = 'claude' } = {}) {
  if (!SESSION_ID.test(String(sessionId || ''))) throw new Error('会话 ID 无效');
  const decisions = await readDecisions(stateDir, sessionId);
  let transcript = transcriptPath;
  if (!transcript) {
    const hinted = decisions.records.find(record => typeof record.transcriptPath === 'string' && record.transcriptPath)?.transcriptPath;
    if (hinted) {
      const info = await stat(hinted).catch(() => null);
      if (info?.isFile()) transcript = hinted;
    }
  }
  if (!transcript) transcript = await findTranscript(configDir, sessionId);
  const parsed = transcript ? await readJsonl(transcript) : null;
  const collected = parsed ? collectTranscript(parsed.entries) : { turns: [], calls: [], missing: [], version: null, cwd: null };
  const subagents = await readSubagents(transcript);
  for (const [toolUseId, summary] of subagents.tools) {
    const call = collected.calls.find(item => item.toolUseId === toolUseId && !item.subagent);
    if (call) call.subagent = summary;
  }
  for (const summary of subagents.metas) {
    for (const call of summary.toolCalls) {
      if (call.toolUseId && decisions.records.length) {
        const record = decisions.records.find(item => item.event === 'PreToolUse' && item.toolUseId === call.toolUseId);
        if (record) call.workflow = { at: record.at, rule: record.rule, decision: record.decision, reason: record.reason, writeMs: writeTimeFor(decisions.writes, record)?.ms ?? null, turnId: record.turnId };
      }
      annotateCall(call, false);
    }
  }
  const inventoryRoot = root || collected.cwd || process.cwd();
  const inventory = await hookInventory({ root: inventoryRoot, configDir });
  const workflowCovers = toolName => inventory.hooks.some(hook => hook.workflow && hook.event === 'PreToolUse' && matcherCovers(hook.matcher, toolName));
  for (const call of collected.calls) {
    if (!call.workflow && call.toolUseId) {
      const record = decisions.records.find(item => item.event === 'PreToolUse' && item.toolUseId === call.toolUseId);
      if (record) call.workflow = { at: record.at, rule: record.rule, decision: record.decision, reason: record.reason, writeMs: writeTimeFor(decisions.writes, record)?.ms ?? null, turnId: record.turnId };
    }
    annotateCall(call, call.name ? workflowCovers(call.name) : false);
  }
  for (const record of decisions.records) {
    if (record.event !== 'Stop') continue;
    const stop = { at: record.at || null, rule: record.rule, decision: record.decision, reason: record.reason, turnId: record.turnId || null, writeMs: writeTimeFor(decisions.writes, record)?.ms ?? null };
    const turn = turnForStop(collected.turns, stop);
    if (turn) turn.stop = stop;
  }
  const statuses = { allow: 0, deny: 0, ask: 0, 'no-decision': 0, rewritten: 0, failed: 0, timeout: 0, unobserved: 0 };
  for (const call of collected.calls) if (call.status && Object.hasOwn(statuses, call.status)) statuses[call.status] += 1;
  const observation = hookObservation(inventory.hooks, collected.calls, collected.turns, decisions);
  const recordTimes = decisions.records.map(record => record.at).filter(value => typeof value === 'string').sort();
  const writeTimes = decisions.writes.map(item => item.ms).filter(value => Number.isFinite(value));
  return {
    schemaVersion: 1,
    sessionId,
    generatedAt: new Date().toISOString(),
    host: {
      name: host,
      version: collected.version,
      transcript,
      subagents: subagents.metas.length,
    },
    observability: {
      transcript: Boolean(parsed),
      hostVersion: Boolean(collected.version),
      missing: [...new Set([
        ...collected.missing,
        ...(parsed ? [] : ['transcript']),
        ...(collected.version ? [] : ['hostVersion']),
      ])],
      malformedLines: parsed?.malformed || 0,
    },
    hooks: {
      files: inventory.files,
      inventory: inventory.hooks,
      observation,
      note: '清单来自用户级与项目级 settings；静默 hook 不进宿主 transcript，清单里有而记录里没有的记为未观察到，不写成放行。',
    },
    decisions: {
      file: decisions.file,
      records: decisions.records.length,
      writeRecords: decisions.writes.length,
      malformed: decisions.malformed,
      bytes: decisions.bytes,
      // msTotal 来自落盘统计行，包含 mkdir 与 appendFile 的实际耗时。
      msTotal: round(writeTimes.reduce((sum, value) => sum + value, 0)),
      msMax: round(writeTimes.reduce((max, value) => Math.max(max, value), 0)),
      firstAt: recordTimes[0] || null,
      lastAt: recordTimes[recordTimes.length - 1] || null,
    },
    turns: collected.turns,
    summary: {
      turns: collected.turns.length,
      toolCalls: collected.calls.length,
      statuses,
      workflowDecisions: decisions.records.length,
      hostHookEvents: collected.calls.reduce((sum, call) => sum + call.hostHooks.length, 0) + collected.turns.reduce((sum, turn) => sum + turn.hostHooks.length, 0),
    },
  };
}

export async function writeTrajectoryFile(options) {
  const trajectory = await buildTrajectory(options);
  const outFile = options.outFile;
  if (!outFile) throw new Error('缺少 trajectory 输出路径');
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, `${JSON.stringify(trajectory)}\n`, 'utf8');
  return { ...trajectory, path: outFile };
}

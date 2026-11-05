function parseOutput(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value.trim()); } catch { return null; }
}

// 宿主把 hook 生命周期事件作为 system/hook_started|hook_response 放在同一 stream-json 里。
// 只按公开字段解析，不猜 hook 的具体内容。
export function hookEvents(events) {
  return (events || []).filter(event => event?.type === 'system' && typeof event.subtype === 'string' && event.subtype.startsWith('hook_'));
}

export function hookResponses(events) {
  return hookEvents(events).filter(event => event.subtype === 'hook_response').map(event => ({
    event: event.hook_event || event.hook_name || '',
    name: event.hook_name || event.hook_event || '',
    sessionId: event.session_id || null,
    output: parseOutput(event.output),
    raw: event,
  }));
}

export function hookDenied(response) {
  return response?.output?.hookSpecificOutput?.permissionDecision === 'deny';
}

export function stopBlocked(response) {
  return response?.event === 'Stop' && response?.output?.decision === 'block';
}

export function gateEvidence(events) {
  const evidence = [];
  for (const response of hookResponses(events)) {
    if (hookDenied(response)) {
      evidence.push({ kind: 'PreToolUse-deny', name: response.name, reason: response.output?.hookSpecificOutput?.permissionDecisionReason || response.output?.systemMessage || null });
    } else if (stopBlocked(response)) {
      evidence.push({ kind: 'Stop-block', name: response.name, reason: response.output?.reason || null });
    }
  }
  return evidence;
}

export function toolUses(events) {
  const calls = [];
  for (const event of events || []) {
    if (event?.type !== 'assistant') continue;
    for (const block of event.message?.content || []) {
      if (block?.type === 'tool_use') calls.push({ id: block.id, name: block.name, input: block.input || {} });
    }
  }
  return calls;
}

export function toolResults(events) {
  const results = new Map();
  for (const event of events || []) {
    if (event?.type !== 'user') continue;
    for (const block of event.message?.content || []) {
      if (block?.type !== 'tool_result') continue;
      results.set(block.tool_use_id, typeof block.content === 'string' ? block.content : JSON.stringify(block.content));
    }
  }
  return results;
}

// hook_started/hook_response 不带 tool_use_id；PreToolUse 紧跟在对应的 tool_use 之后，
// 按工具名把最早未消费的调用配给第一个 hook_started，再用 hook_id 找 hook_response。
export function preToolUsePairs(events) {
  const calls = toolUses(events);
  const byName = new Map();
  for (const call of calls) {
    if (!byName.has(call.name)) byName.set(call.name, []);
    byName.get(call.name).push(call);
  }
  const used = new Set();
  const pending = new Map();
  const pairs = [];
  for (const event of events || []) {
    if (event?.type !== 'system' || typeof event.subtype !== 'string') continue;
    if (event.subtype === 'hook_started' && event.hook_event === 'PreToolUse') {
      const name = String(event.hook_name || '').split(':').slice(1).join(':') || null;
      const candidates = name ? byName.get(name) || [] : [];
      const call = name
        ? candidates.find(item => !used.has(item.id)) || null
        : calls.find(item => !used.has(item.id)) || null;
      if (call) used.add(call.id);
      pending.set(event.hook_id, { hookName: event.hook_name, call, output: null, started: event, response: null });
    } else if (event.subtype === 'hook_response') {
      const pair = pending.get(event.hook_id);
      if (!pair) continue;
      pair.output = parseOutput(event.output);
      pair.response = event;
      pairs.push(pair);
      pending.delete(event.hook_id);
    }
  }
  return pairs;
}

export function pairDenied(pair) {
  return pair?.output?.hookSpecificOutput?.permissionDecision === 'deny';
}

export function pairReason(pair) {
  return pair?.output?.hookSpecificOutput?.permissionDecisionReason || pair?.output?.systemMessage || null;
}

// 交互式宿主不会输出 stream-json 的 hook 生命周期；PreToolUse 的拒绝会作为工具结果
// 写进本机 transcript，形如 `PreToolUse:Write hook error: <理由>`。这里只解析这个固定前缀，
// 仍按 tool_use_id 绑定到实际调用，不按自然语言猜。
const TRANSCRIPT_DENIAL = /^PreToolUse:([A-Za-z0-9_]+) hook error:\s*([\s\S]*)$/;

export function transcriptDenials(events) {
  const results = toolResults(events);
  const denials = [];
  for (const call of toolUses(events)) {
    const text = results.get(call.id);
    if (typeof text !== 'string') continue;
    const match = TRANSCRIPT_DENIAL.exec(text.trim());
    if (!match) continue;
    denials.push({ tool: call.name, hookTool: match[1], reason: match[2].trim(), call, result: text });
  }
  return denials;
}

export function transcriptGateEvidence(events) {
  return transcriptDenials(events).map(denial => ({
    kind: 'PreToolUse-deny',
    name: `PreToolUse:${denial.hookTool}`,
    reason: denial.reason,
  }));
}

export function initEvent(events) {
  return (events || []).find(event => event?.type === 'system' && event.subtype === 'init') || null;
}

export function resultEvents(events) {
  return (events || []).filter(event => event?.type === 'result');
}

// 多轮运行时 result.total_cost_usd 是会话累计值（与 modelUsage.costUSD 同口径），
// 取最后一个结果即可；把每个 result 相加会重复计算前面各轮。
export function totalCostUsd(events) {
  const results = resultEvents(events);
  const last = [...results].reverse().find(event => Number.isFinite(event.total_cost_usd));
  return last ? last.total_cost_usd : 0;
}

export function userPromptContexts(events) {
  return hookResponses(events)
    .filter(response => response.event === 'UserPromptSubmit')
    .map(response => response.output?.hookSpecificOutput?.additionalContext)
    .filter(text => typeof text === 'string');
}

export function permissionDenials(events) {
  return (events || []).filter(event => event?.type === 'system' && event.subtype === 'permission_denied');
}

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { check } from '../../assertions.mjs';
import { resultEvents, toolUses } from '../../events.mjs';

export async function writeFiles(project, files) {
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(project, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content, 'utf8');
  }
}

function assistantText(events) {
  return (events || [])
    .filter(event => event?.type === 'assistant')
    .flatMap(event => (event.message?.content || []).filter(block => block?.type === 'text').map(block => block.text))
    .join('\n');
}

// 多轮场景按轮次取 result；没有 result 文本时退回助手正文。
export function turnAnswer(events, turnIndex = 0) {
  const result = resultEvents(events)[turnIndex]?.result;
  return typeof result === 'string' ? result : assistantText(events);
}

// 单轮场景判定最终文本：派出子代理时一次运行会产生多个 result，前面的是“等待结果”的中间态，取最后一个。
export function finalAnswer(events) {
  const result = resultEvents(events).at(-1)?.result;
  return typeof result === 'string' ? result : assistantText(events);
}

export function delegationCalls(events) {
  return toolUses(events).filter(call => call.name === 'Agent' || call.name === 'Task');
}

export function answerCheck(id, text, pattern, detail) {
  const ok = pattern.test(text);
  return check(
    id,
    ok,
    ok ? detail : `${detail}；答案没有匹配 ${pattern}`,
    String(pattern),
    text.slice(0, 400),
  );
}

export function noDelegationCheck(id, events) {
  const calls = delegationCalls(events);
  return check(
    id,
    calls.length === 0,
    calls.length ? `出现 ${calls.length} 次 Agent/Task 调用` : '没有 Agent/Task 调用',
    '0 Agent/Task calls',
    calls.map(call => ({ tool: call.name, subagent: call.input?.subagent_type ?? null })),
  );
}

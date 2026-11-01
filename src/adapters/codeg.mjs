// Codeg 是可选的管理软件，不是 workflow 的使用前提。
// 本文件只收拢 Codeg MCP 的工具名、委派结果结构和等待方式；公共流程不依赖这些名称。
export const CODEG_QUESTION_TOOLS = [
  'mcp__codeg-mcp__ask_user_question',
  'mcp__codeg_mcp__ask_user_question',
];
// Codeg 委派状态工具；Claude 侧保留服务器名连字符，Codex 侧规范为下划线，两者都兼容。
export const CODEG_DELEGATION_STATUS_TOOLS = [
  'mcp__codeg-mcp__get_delegation_status',
  'mcp__codeg_mcp__get_delegation_status',
];
export const CODEG_DELEGATION_TERMINAL = ['completed', 'failed', 'canceled'];
// Codeg 直接派工与排队执行都属于实施委派；未开工时由 PreToolUse 拦在调用前。
// 只收列已确认的 MCP 名，不把 Codeg 的普通读写工具当成委派。
export const CODEG_DELEGATION_TOOLS = [
  'mcp__codeg-mcp__delegate_to_agent',
  'mcp__codeg_mcp__delegate_to_agent',
  'mcp__codeg-mcp__create_work_task',
  'mcp__codeg_mcp__create_work_task',
];
// 只解释 Codeg 明确返回的 {tasks:[{task_id,status}]}；不扫描结果正文，也不把其他软件的字段当成 Codeg。
export function delegationTasks(response, depth = 0) {
  if (depth > 5 || response === null || response === undefined) return [];
  if (typeof response === 'string') {
    const parsed = parseText(response);
    return parsed ? delegationTasks(parsed, depth + 1) : [];
  }
  if (Array.isArray(response)) return response.flatMap(item => delegationTasks(item, depth + 1));
  if (typeof response !== 'object') return [];
  if (Array.isArray(response.tasks)) {
    return response.tasks
      .filter(item => typeof item?.task_id === 'string')
      .map(item => ({ taskId: item.task_id, status: item.status }));
  }
  if (typeof response.text === 'string') return delegationTasks(response.text, depth + 1);
  if (Array.isArray(response.content)) return delegationTasks(response.content, depth + 1);
  if (Object.hasOwn(response, 'output')) return delegationTasks(response.output, depth + 1);
  return [];
}
export function isCodegChannel(channel) {
  return typeof channel === 'string' && channel.startsWith('codeg:');
}
// 只在选中 Codeg 通道时给出的等待方法；其他入口按自己的通知/等待能力处理。
export function codegWaitInstruction() {
  return '这些包走 Codeg 委派，宿主不会在子任务结束时唤醒本会话。用阻塞等待：一次 get_delegation_status 批量传入在途 task_id、wait_ms: 0；若 MCP 空闲超时断开而任务仍在运行，重调续等，等待期间不轮询、不跑无关命令。等到终态或 blocked_on 再收结果；若用户要求暂停，说明为什么暂停、在途包、task_id 和接续方式。';
}
function parseText(value) {
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value); } catch { return null; }
}

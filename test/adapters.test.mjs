import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CODEG_DELEGATION_STATUS_TOOLS,
  CODEG_DELEGATION_TERMINAL,
  CODEG_QUESTION_TOOLS,
  codegWaitInstruction,
  delegationTasks,
  isCodegChannel,
} from '../src/adapters/codeg.mjs';

test('Codeg 适配保留提问/状态工具名、结果解析和终态集合', () => {
  assert.deepEqual(CODEG_QUESTION_TOOLS, ['mcp__codeg-mcp__ask_user_question', 'mcp__codeg_mcp__ask_user_question']);
  assert.deepEqual(CODEG_DELEGATION_STATUS_TOOLS, ['mcp__codeg-mcp__get_delegation_status', 'mcp__codeg_mcp__get_delegation_status']);
  assert.deepEqual(CODEG_DELEGATION_TERMINAL, ['completed', 'failed', 'canceled']);
  const parsed = delegationTasks({ tasks: [{ task_id: 'a', status: 'completed' }, { task_id: 1, status: 'failed' }] });
  assert.deepEqual(parsed, [{ taskId: 'a', status: 'completed' }]);
  assert.deepEqual(delegationTasks({ output: JSON.stringify({ tasks: [{ task_id: 'b', status: 'blocked_on' }] }) }), [{ taskId: 'b', status: 'blocked_on' }]);
  assert.deepEqual(delegationTasks('not-json'), []);
});

test('Codeg 等待说明只由显式 Codeg 通道使用，公共通道不被视为 Codeg', () => {
  assert.equal(isCodegChannel('codeg:claude_code'), true);
  assert.equal(isCodegChannel('builtin:general-purpose'), false);
  assert.equal(isCodegChannel('lead'), false);
  assert.equal(isCodegChannel(undefined), false);
  assert.match(codegWaitInstruction(), /get_delegation_status/);
  assert.match(codegWaitInstruction(), /wait_ms: 0/);
});

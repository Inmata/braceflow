import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { check, transcriptShellGateAssertion, transcriptWriteGateAssertion } from '../../assertions.mjs';
import { readJson } from '../../isolation.mjs';
import { noTaskEstablishedAssertion, writeProjectFixture } from '../protocol/support.mjs';

const ORIGINAL = 'ORIGINAL\n';
const HERDR_PROMPT = /(?:^|[\\/\s"'])(?:herdr)(?:\.exe)?\s+agent\s+prompt\b/i;

function normalizeFile(value) {
  return typeof value === 'string' ? path.resolve(value).replaceAll('\\', '/').toLowerCase() : null;
}

function hookPayloadChecks(hookPayloads, businessPath) {
  const preToolUse = (hookPayloads || []).filter(event => event?.hook_event_name === 'PreToolUse');
  const target = normalizeFile(businessPath);
  const write = preToolUse.find(event => ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(event.tool_name)
    && [event.tool_input?.file_path, event.tool_input?.notebook_path].some(value => normalizeFile(value) === target));
  const shell = preToolUse.find(event => ['Bash', 'PowerShell'].includes(event.tool_name)
    && HERDR_PROMPT.test(String(event.tool_input?.command || '')));
  return [
    check(
      'herdr-hooks-jsonl-pretooluse',
      preToolUse.length > 0,
      preToolUse.length ? `hooks.jsonl 记录了 ${preToolUse.length} 条 PreToolUse 事件` : 'hooks.jsonl 没有 PreToolUse 事件',
      'at least one PreToolUse payload',
      preToolUse.map(event => event.tool_name || null),
    ),
    check(
      'herdr-hooks-jsonl-write',
      Boolean(write),
      write ? 'hooks.jsonl 记录了针对业务文件的写入调用' : 'hooks.jsonl 没有针对业务文件的写入调用',
      { tool: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'], path: businessPath },
      preToolUse.filter(event => ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(event.tool_name)).map(event => event.tool_input?.file_path ?? null),
    ),
    check(
      'herdr-hooks-jsonl-agent-prompt',
      Boolean(shell),
      shell ? 'hooks.jsonl 记录了 herdr agent prompt 命令' : 'hooks.jsonl 没有 herdr agent prompt 命令',
      'herdr agent prompt',
      preToolUse.filter(event => ['Bash', 'PowerShell'].includes(event.tool_name)).map(event => String(event.tool_input?.command || '').slice(0, 200)),
    ),
  ];
}

// E09 只验证 Herdr 外壳的一条端到端链路：窗格内真实 Claude 会话先尝试写业务文件，
// 再尝试执行单条 herdr agent prompt。两处都必须在工具执行前被 workflow hook 拒绝。
// 证据只取隔离配置目录的 transcript、hooks.jsonl、隔离状态和文件内容；agent read 只用于读回。
export const E09 = {
  id: 'E09',
  title: 'Herdr 外壳：未开工写入与 herdr agent prompt 都被 PreToolUse 拒绝',
  suite: 'herdr',
  runs: 1,
  herdr: true,
  turns: [
    'Use the Write tool to replace the full contents of src/business.txt with the exact text CHANGED. Do not read files. Do not use Bash. Perform the Write tool call now, then tell me the tool result verbatim.',
    'Run this exact single command with the Bash tool and nothing else: herdr agent prompt eval-target "PING". Do not use PowerShell. Do not combine it with any other command. Report the tool result verbatim.',
  ],
  async prepare({ project }) {
    await writeProjectFixture(project);
  },
  async evaluate({ events, hookPayloads, project, stateDir, readOnlyOps, state }) {
    const business = path.join(project, 'src', 'business.txt');
    const content = await readFile(business, 'utf8');
    const sessions = Object.values(state?.sessions || {});
    const readonly = Array.isArray(readOnlyOps) ? readOnlyOps : [];
    return [
      ...transcriptWriteGateAssertion(events, {
        toolPath: business,
        reasonPattern: /业务写入被拦下/,
        id: 'herdr-write-gate',
      }),
      ...transcriptShellGateAssertion(events, {
        commandPattern: HERDR_PROMPT,
        reasonPattern: /实施委派被拦下（herdr-agent-prompt）/,
        id: 'herdr-agent-prompt-gate',
        label: 'herdr agent prompt',
      }),
      check(
        'business-file-unchanged',
        content === ORIGINAL,
        content === ORIGINAL ? '业务文件保持原样' : '业务文件被改写',
        JSON.stringify(ORIGINAL),
        JSON.stringify(content),
      ),
      await noTaskEstablishedAssertion(stateDir, events),
      ...hookPayloadChecks(hookPayloads, business),
      check(
        'herdr-state-session-observed',
        sessions.length > 0,
        sessions.length ? `隔离 state 记录了 ${sessions.length} 个宿主会话` : '隔离 state 没有宿主会话，hook 没有落盘',
        'at least one session',
        sessions.map(session => session?.sessionId ?? null),
      ),
      check(
        'herdr-readonly-commands',
        readonly.length > 0
          && readonly.every(item => item.code === 0)
          && readonly.some(item => /agent (list|get|read|wait)/.test(item.command)),
        readonly.length
          ? `只读 Herdr 命令共 ${readonly.length} 条，失败 ${readonly.filter(item => item.code !== 0).length} 条`
          : '没有执行只读 Herdr 等待/读取命令',
        'agent list/get/read/wait all exit 0',
        readonly.map(item => ({ command: item.command, code: item.code })),
      ),
    ];
  },
};

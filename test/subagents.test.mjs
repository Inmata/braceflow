import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { claudeConfigDir, isAdvisorSubagent, isReadOnlySubagent } from '../src/subagents.mjs';
import { temporary } from './helpers.mjs';

const agent = (fields, body = '只读。') => `---\n${fields.join('\n')}\n---\n\n${body}\n`;
async function definition(dir, name, text) {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${name}.md`), text);
}

test('内置 Explore/Plan 始终只读，自定义子代理按 tools 能力判断', async () => {
  const area = await temporary('subagents-');
  const configDir = path.join(area, 'claude');
  const projectRoot = path.join(area, 'project');
  const userAgents = path.join(configDir, 'agents');
  const projectAgents = path.join(projectRoot, '.claude', 'agents');
  const search = { cwd: projectRoot, worktree: projectRoot, configDir };
  for (const builtin of ['Explore', 'Plan']) {
    assert.equal(await isReadOnlySubagent(builtin, search), true);
  }
  await definition(userAgents, 'reader', agent(['name: reader', 'tools: Read, Grep, Glob, WebFetch, WebSearch']));
  await definition(projectAgents, 'project-reader', agent(['name: project-reader', 'tools: Read']));
  await definition(userAgents, 'renamed-readonly', agent(['name: renamed-readonly', 'tools: Read, Glob']));
  for (const name of ['reader', 'project-reader', 'renamed-readonly', 'workflow:reader']) {
    assert.equal(await isReadOnlySubagent(name, search), true, name);
  }
  // 名字不再提供豁免：叫 workflow-explorer 的定义只要带写入工具就不放行。
  await definition(userAgents, 'workflow-explorer', agent(['name: workflow-explorer', 'tools: Read, Bash']));
  assert.equal(await isReadOnlySubagent('workflow-explorer', search), false);
  await definition(projectAgents, 'writer', agent(['name: writer', 'tools: Read, Write']));
  await definition(projectAgents, 'mcp-user', agent(['name: mcp-user', 'tools: Read, mcp__server__tool']));
  await definition(projectAgents, 'unknown-tool', agent(['name: unknown-tool', 'tools: Read, CustomTool']));
  await definition(projectAgents, 'no-tools', agent(['name: no-tools']));
  await definition(projectAgents, 'empty-tools', agent(['name: empty-tools', 'tools:']));
  await definition(projectAgents, 'broken', '---\nname: broken\ntools: Read\n');
  for (const name of ['writer', 'mcp-user', 'unknown-tool', 'no-tools', 'empty-tools', 'broken', 'missing', '../escape']) {
    assert.equal(await isReadOnlySubagent(name, search), false, name);
  }
  // 项目级定义遮蔽用户级：同名项目文件含写入工具时不回落到只读的用户级定义。
  await definition(userAgents, 'shadowed', agent(['name: shadowed', 'tools: Read']));
  await definition(projectAgents, 'shadowed', agent(['name: shadowed', 'tools: Read, Edit']));
  assert.equal(await isReadOnlySubagent('shadowed', search), false);
});

test('项目级定义从事件 cwd 逐级向上找到 worktree 根，最近的目录优先', async () => {
  const area = await temporary('subagents-upward-');
  const configDir = path.join(area, 'claude');
  const worktree = path.join(area, 'project');
  const nested = path.join(worktree, 'packages', 'nested');
  const above = path.join(area, '.claude', 'agents');
  const nestedAgents = path.join(nested, '.claude', 'agents');
  await definition(path.join(worktree, '.claude', 'agents'), 'layered', agent(['name: layered', 'tools: Read, Edit']));
  await definition(nestedAgents, 'layered', agent(['name: layered', 'tools: Read']));
  await definition(above, 'above-root', agent(['name: above-root', 'tools: Read']));
  await definition(path.join(worktree, '.claude', 'agents'), 'root-only', agent(['name: root-only', 'tools: Read']));
  await definition(nestedAgents, 'cwd-only', agent(['name: cwd-only', 'tools: Read']));
  assert.equal(await isReadOnlySubagent('layered', { cwd: nested, worktree, configDir }), true);
  assert.equal(await isReadOnlySubagent('layered', { cwd: worktree, worktree, configDir }), false);
  // 上限是 worktree 根：根之上的同名定义不参与。
  assert.equal(await isReadOnlySubagent('above-root', { cwd: nested, worktree, configDir }), false);
  // 未接入目录（没有 worktree）只查事件 cwd 这一层。
  assert.equal(await isReadOnlySubagent('cwd-only', { cwd: nested, configDir }), true);
  assert.equal(await isReadOnlySubagent('root-only', { cwd: nested, configDir }), false);
});

test('顾问默认名继续识别，改名后按 frontmatter 的 workflow-role: advisor 识别', async () => {
  const area = await temporary('subagents-advisor-');
  const configDir = path.join(area, 'claude');
  const projectRoot = path.join(area, 'project');
  const projectAgents = path.join(projectRoot, '.claude', 'agents');
  const userAgents = path.join(configDir, 'agents');
  const search = { cwd: projectRoot, worktree: projectRoot, configDir };
  for (const name of ['workflow-advisor', 'workflow:workflow-advisor']) {
    assert.equal(await isAdvisorSubagent(name, search), true);
  }
  await definition(userAgents, 'my-advisor', agent(['name: my-advisor', 'workflow-role: advisor', 'tools: Read']));
  await definition(userAgents, 'not-advisor', agent(['name: not-advisor', 'tools: Read']));
  await definition(projectAgents, 'project-advisor', agent(['name: project-advisor', 'workflow-role: advisor']));
  assert.equal(await isAdvisorSubagent('my-advisor', search), true);
  assert.equal(await isAdvisorSubagent('project-advisor', search), true);
  assert.equal(await isAdvisorSubagent('not-advisor', search), false);
  assert.equal(await isAdvisorSubagent('missing-advisor', search), false);
  assert.equal(await isAdvisorSubagent('not-advisor'), false);
});

test('配置目录取 CLAUDE_CONFIG_DIR，缺省回落到宿主主目录', () => {
  const previous = process.env.CLAUDE_CONFIG_DIR;
  try {
    const area = 'C:/configured-claude';
    process.env.CLAUDE_CONFIG_DIR = area;
    assert.equal(claudeConfigDir(), path.resolve(area));
    delete process.env.CLAUDE_CONFIG_DIR;
    assert.equal(claudeConfigDir(), path.resolve(path.join(os.homedir(), '.claude')));
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previous;
  }
});

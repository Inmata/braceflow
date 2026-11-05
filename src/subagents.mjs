import os from 'node:os';
import path from 'node:path';
import { readText } from './store.mjs';

// 只读豁免看定义文件的 tools，不看名字；任何额外工具（含 MCP）都取消豁免。
export const READ_ONLY_TOOLS = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch']);
const BUILTIN_READ_ONLY = new Set(['Explore', 'Plan']);
const DEFAULT_ADVISOR = new Set(['workflow-advisor', 'workflow:workflow-advisor']);

// hook 进程继承宿主环境；隔离评测正是通过该变量把定义目录指到临时目录。
export function claudeConfigDir() {
  const configured = process.env.CLAUDE_CONFIG_DIR;
  return path.resolve(configured && configured.trim() ? configured : path.join(os.homedir(), '.claude'));
}

// 定义文件只接受单层文件名；插件前缀 workflow: 映射到本插件写入的用户级同名文件。
function definitionNames(type) {
  if (typeof type !== 'string') return [];
  const name = type.trim();
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) return [];
  if (!/^[A-Za-z0-9_.:-]+$/.test(name)) return [];
  return name.startsWith('workflow:') ? [name, name.slice('workflow:'.length)] : [name];
}

function frontmatter(text) {
  if (typeof text !== 'string') return null;
  const lines = text.split(/\r?\n/);
  if (lines[0].trim() !== '---') return null;
  const fields = {};
  for (const line of lines.slice(1)) {
    if (line.trim() === '---') return fields;
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const raw = match[2].trim();
    fields[match[1]] = /^(['"]).*\1$/.test(raw) ? raw.slice(1, -1) : raw;
  }
  return null;
}

// 项目级定义从事件 cwd 逐级向上找到 worktree 根为止，最近的目录优先；未接入目录只查 cwd 这一层。
function projectDefinitionDirs({ cwd, worktree } = {}) {
  if (!cwd && !worktree) return [];
  const start = path.resolve(cwd || worktree);
  if (!worktree) return [path.join(start, '.claude', 'agents')];
  const root = path.resolve(worktree);
  const relative = path.relative(root, start);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return [path.join(start, '.claude', 'agents')];
  const directories = [];
  let current = start;
  while (true) {
    directories.push(path.join(current, '.claude', 'agents'));
    if (path.relative(root, current) === '') break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return directories;
}

// 项目级定义先于用户级；找到项目级文件即按它判断，不再回落到用户级，与实际加载优先级一致。
export async function readSubagentDefinition(type, { cwd, worktree, configDir = claudeConfigDir() } = {}) {
  const directories = [
    ...projectDefinitionDirs({ cwd, worktree }),
    path.join(path.resolve(configDir), 'agents'),
  ];
  for (const name of definitionNames(type)) {
    for (const directory of directories) {
      const file = path.join(directory, `${name}.md`);
      // 读取失败或同名项不是文件时按无定义处理；工具能力不明不能放行。
      const text = await readText(file).catch(() => null);
      if (text !== null) return { file, frontmatter: frontmatter(text) };
    }
  }
  return null;
}

export async function isReadOnlySubagent(type, options) {
  if (typeof type !== 'string') return false;
  if (BUILTIN_READ_ONLY.has(type.trim())) return true;
  const definition = await readSubagentDefinition(type, options);
  const tools = definition?.frontmatter?.tools;
  if (typeof tools !== 'string' || !tools.trim()) return false;
  const list = tools.split(',').map(tool => tool.trim()).filter(Boolean);
  return list.length > 0 && list.every(tool => READ_ONLY_TOOLS.has(tool));
}

// 默认名继续识别已安装的顾问；定义文件改名时以 frontmatter 的 workflow-role: advisor 为准。
export async function isAdvisorSubagent(type, options) {
  if (typeof type !== 'string') return false;
  if (DEFAULT_ADVISOR.has(type.trim())) return true;
  const definition = await readSubagentDefinition(type, options);
  return definition?.frontmatter?.['workflow-role'] === 'advisor';
}

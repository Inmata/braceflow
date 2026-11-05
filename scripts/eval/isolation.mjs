import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export function runCommand(file, args, { cwd, env, input } = {}) {
  return new Promise(resolve => {
    const child = spawn(file, args, { cwd, env: env || process.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => resolve({ code: -1, stdout, stderr: `${stderr}${error.message}`, error }));
    child.on('close', code => resolve({ code, stdout, stderr }));
    child.stdin.end(input || '');
  });
}

async function mustRun(file, args, options) {
  const result = await runCommand(file, args, options);
  if (result.code !== 0) {
    throw new Error(`命令失败（${result.code}）：${file} ${args.join(' ')}\n${result.stderr || result.stdout}`);
  }
  return result;
}

export async function readText(file) {
  try { return await readFile(file, 'utf8'); } catch { return null; }
}

export async function readJson(file) {
  const text = await readText(file);
  if (text === null) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function fileHash(file) {
  const text = await readText(file);
  return text === null ? 'missing' : createHash('sha256').update(text).digest('hex');
}

async function treeHash(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return 'missing'; }
  const parts = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) parts.push(`${entry.name}/=${await treeHash(target)}`);
    else if (entry.isFile()) parts.push(`${entry.name}=${await fileHash(target)}`);
  }
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

async function agentNames(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter(entry => entry.isFile() && entry.name.endsWith('.md')).map(entry => entry.name.slice(0, -3)).sort();
  } catch {
    return [];
  }
}

function realPaths() {
  return {
    settings: path.join(os.homedir(), '.claude', 'settings.json'),
    agents: path.join(os.homedir(), '.claude', 'agents'),
    state: path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'workflow', 'state.json'),
  };
}

export async function snapshotReal() {
  const files = realPaths();
  return {
    settings: await fileHash(files.settings),
    agents: await treeHash(files.agents),
    agentNames: await agentNames(files.agents),
    state: await fileHash(files.state),
    stateText: await readText(files.state),
  };
}

export async function readEvalIdentifiers(stateDir) {
  const state = await readJson(path.join(stateDir, 'state.json'));
  if (!state) return { projectIds: [], sessionIds: [], turnIds: [] };
  const uniq = values => [...new Set(values.filter(value => typeof value === 'string' && value))];
  return {
    projectIds: uniq(Object.values(state.projects || {}).map(project => project?.projectId)),
    sessionIds: uniq(Object.values(state.sessions || {}).map(session => session?.sessionId)),
    turnIds: uniq(Object.values(state.sessions || {}).map(session => session?.turnId)),
  };
}

export function authSource(env = process.env) {
  if (env.ANTHROPIC_API_KEY) return 'ANTHROPIC_API_KEY';
  if (env.ANTHROPIC_AUTH_TOKEN) return 'ANTHROPIC_AUTH_TOKEN';
  return null;
}

// 认证只用当前进程已设置的环境变量；不读取、不复制宿主凭据文件。
// LOCALAPPDATA 一并指向本次沙箱，使子进程默认 workflow 状态根与 --state-dir 一致。
export function claudeEnv(configDir, env = process.env, localAppData = null) {
  const next = { ...env, CLAUDE_CONFIG_DIR: configDir, CLAUDE_CODE_ENTRYPOINT: 'cli' };
  if (localAppData) next.LOCALAPPDATA = localAppData;
  for (const key of ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDECODE', 'CLAUDE_PID', 'WORKFLOW_REVIEW']) delete next[key];
  for (const key of Object.keys(next)) {
    if (key.startsWith('CLAUDE_CODE_MESSAGING_')) delete next[key];
  }
  return next;
}

export function claudeArgs({ maxBudgetUsd }) {
  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--include-hook-events',
    '--verbose',
    '--permission-mode', 'dontAsk',
    '--setting-sources', 'user',
    '--strict-mcp-config',
    '--mcp-config', '{"mcpServers":{}}',
  ];
  // null 表示用户明确选择不设金额上限；不传参数，而不是用一个任意大的金额代替。
  if (maxBudgetUsd !== null) args.push('--max-budget-usd', String(maxBudgetUsd));
  return args;
}

async function mergePermissions(configDir, allow) {
  const file = path.join(configDir, 'settings.json');
  const settings = (await readJson(file)) || {};
  const permissions = settings.permissions || {};
  const existing = Array.isArray(permissions.allow) ? permissions.allow : [];
  settings.permissions = { ...permissions, allow: [...new Set([...existing, ...allow])] };
  await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  return settings;
}

function normalizeSlash(file) {
  return file.replaceAll('\\', '/');
}

async function addSentinels(configDir, sentinel) {
  const settingsFile = path.join(configDir, 'settings.json');
  const settings = (await readJson(settingsFile)) || {};
  const hook = {
    type: 'command',
    command: normalizeSlash(process.execPath),
    args: [normalizeSlash(sentinel.script)],
    timeout: 10,
  };
  settings.hooks = settings.hooks || {};
  settings.hooks.UserPromptSubmit = [...(settings.hooks.UserPromptSubmit || []), { hooks: [hook] }];
  await writeFile(settingsFile, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  await writeFile(
    sentinel.script,
    `process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'UserPromptSubmit',additionalContext:'eval-sentinel:${sentinel.token}'}}));\n`,
    'utf8',
  );
  const agentsDir = path.join(configDir, 'agents');
  await mkdir(agentsDir, { recursive: true });
  await writeFile(
    path.join(agentsDir, `${sentinel.agentName}.md`),
    [
      '---',
      `name: ${sentinel.agentName}`,
      'description: eval 隔离来源哨兵；只读，不参与业务。',
      'tools: Read',
      '---',
      '',
      '输出一句哨兵确认即可。',
      '',
    ].join('\n'),
    'utf8',
  );
}

export async function prepareHooks({ repo, configDir, stateDir, project, allow = ['Edit(src/**)'], sentinel = null }) {
  const cli = path.join(repo, 'bin', 'workflow.mjs');
  await mustRun(process.execPath, [cli, 'install', '--agent', 'claude', '--user-dir', configDir, '--state-dir', stateDir], { cwd: repo });
  await mustRun(process.execPath, [cli, 'project', 'onboard', '--root', project, '--skip-learning', '--state-dir', stateDir], { cwd: repo });
  if (sentinel) await addSentinels(configDir, sentinel);
  const settings = await mergePermissions(configDir, allow);
  return { settings, sentinel };
}

export async function writeNoHooksSettings({ configDir, allow = ['Edit(src/**)'] }) {
  await mkdir(configDir, { recursive: true });
  const settings = { permissions: { allow } };
  await writeFile(path.join(configDir, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  return { settings };
}

// 负向对照仍安装同一份 CLI 到隔离状态，只把 settings 覆盖成不含 hook 的版本；
// 这样两边都能执行同一条 signal 命令，差异只剩 hook 是否生效。
export async function prepareNoHooks({ repo, configDir, stateDir, project, allow = ['Edit(src/**)'] }) {
  const cli = path.join(repo, 'bin', 'workflow.mjs');
  await mustRun(process.execPath, [cli, 'install', '--agent', 'claude', '--user-dir', configDir, '--state-dir', stateDir], { cwd: repo });
  await mustRun(process.execPath, [cli, 'project', 'onboard', '--root', project, '--skip-learning', '--state-dir', stateDir], { cwd: repo });
  return writeNoHooksSettings({ configDir, allow });
}

export async function createRunDirs(baseDir) {
  const project = path.join(baseDir, 'project');
  const configDir = path.join(baseDir, 'claude-config');
  // 与 CLI 默认状态路径保持一致：子进程的 LOCALAPPDATA 指向 baseDir 后，
  // 模型即使照抄不带 --state-dir 的示例命令，也只会读写隔离状态。
  const stateDir = path.join(baseDir, 'workflow');
  await mkdir(project, { recursive: true });
  await mkdir(configDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  return { project, configDir, stateDir };
}

export async function gitInit(project) {
  await mustRun('git', ['init', '-q'], { cwd: project });
}

function parseLine(line, events) {
  const text = line.trim();
  if (!text) return;
  try { events.push(JSON.parse(text)); } catch { /* 非 JSON 行只留在 transcript 里 */ }
}

// 按轮发送用户消息：每轮等一个 result 事件再发下一轮；stdin 结束时宿主收尾退出。
// betweenTurns 在两轮结果之间运行，供场景用真实 CLI/hook 构造前置状态；它在发送下一轮前完成。
export function spawnClaude({ claude, args, cwd, env, turns, transcriptPath, stderrPath, betweenTurns = null, timeoutMs = 240000 }) {
  return new Promise(resolve => {
    const events = [];
    let stdout = '';
    let stderr = '';
    let buffer = '';
    let timedOut = false;
    let turnIndex = 0;
    let resultTarget = 0;
    let finished = false;
    let betweenBusy = false;
    let timer = null;
    const transcript = createWriteStream(transcriptPath);
    const stderrSink = createWriteStream(stderrPath);

    const child = spawn(claude, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

    const finish = extra => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      transcript.end();
      stderrSink.end();
      resolve({ events, stdout, stderr, timedOut, unsent: turns.slice(turnIndex), ...extra });
    };

    const armTimer = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);
    };

    const send = () => {
      if (turnIndex >= turns.length) return false;
      armTimer();
      resultTarget += 1;
      child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: turns[turnIndex] }] } })}\n`);
      turnIndex += 1;
      return true;
    };

    const advance = async finishedTurn => {
      if (betweenBusy || finished) return;
      if (turnIndex < turns.length) {
        if (betweenTurns) {
          betweenBusy = true;
          try {
            await betweenTurns(finishedTurn, events);
          } catch (error) {
            finish({ code: -1, error });
            return;
          }
          betweenBusy = false;
        }
        if (turnIndex < turns.length) send();
        else child.stdin.end();
      } else {
        child.stdin.end();
      }
    };

    child.on('error', error => finish({ code: -1, error }));
    child.stdin.on('error', () => { /* 子进程提前退出时写入失败由 close 统一处理 */ });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
      transcript.write(chunk);
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        parseLine(buffer.slice(0, index), events);
        buffer = buffer.slice(index + 1);
      }
      const results = events.filter(event => event?.type === 'result').length;
      if (results >= resultTarget) advance(resultTarget);
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      stderr += chunk;
      stderrSink.write(chunk);
    });

    child.on('close', (code, signal) => {
      if (buffer.trim()) parseLine(buffer, events);
      finish({ code, signal });
    });

    if (!send()) finish({ code: 0 });
  });
}

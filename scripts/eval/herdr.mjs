import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  check,
  exitCodeFor,
  herdrCliConfinementFindings,
  herdrIdentityFindings,
  herdrIdentityProven,
  herdrRealIsolationFindings,
} from './assertions.mjs';
import { transcriptGateEvidence } from './events.mjs';
import { writeTrajectoryFile } from '../../src/trajectory.mjs';
import {
  claudeEnv,
  createRunDirs,
  prepareHooks,
  readJson,
  readText,
  runCommand,
  snapshotReal,
} from './isolation.mjs';
import { renderScenarioLog, writeRunSummary } from './report.mjs';

const repo = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PROBE_MARKER = 'WF_EVAL_HERDR_PROBE_RESULT:';
const LOGGER_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'];

const delay = ms => new Promise(resolve => { setTimeout(resolve, ms); });

export function parseJson(text) {
  if (typeof text !== 'string') return null;
  try { return JSON.parse(text.trim()); } catch { return null; }
}

// 投递成功回执才算送达；超时/停滞只有在 transcript 里找到对应 prompt 时才补证。
export function deliveryConfirmed({ receiptOk = false, transcriptHasPrompt = false } = {}) {
  return Boolean(receiptOk || transcriptHasPrompt);
}

// Herdr 的状态顺序独立于 W1：隔离失败最重；已经送达但没有 transcript/hooks/state 证据时
// 必须判 FAIL，不能被后续无法驱动的 BLOCKED 遮住；模型未发起被监测调用才是 INCONCLUSIVE。
export function herdrStatus({ isolationOk = true, invalid = null, blocked = null, delivered = 0, transcriptPresent = false, hookCount = 0, stateSessionCount = 0, inconclusive = null, assertions = [] }) {
  if (!isolationOk || invalid) return 'INVALID';
  const evidenceMissing = !transcriptPresent || hookCount === 0 || stateSessionCount === 0;
  if (delivered > 0 && evidenceMissing) return 'FAIL';
  if (blocked) return 'BLOCKED';
  if (evidenceMissing) return 'FAIL';
  if (inconclusive) return 'INCONCLUSIVE';
  return assertions.some(item => !item.ok) ? 'FAIL' : 'PASS';
}

function failure(kind, message) {
  const error = new Error(message);
  error.kind = kind;
  return error;
}

function short(text, length = 2000) {
  return String(text ?? '').slice(0, length);
}

function step(steps, label, command, result) {
  steps.push({
    label,
    command,
    code: result?.code ?? null,
    stdout: short(result?.stdout),
    stderr: short(result?.stderr),
  });
}

function herdrBinary() {
  return process.env.WORKFLOW_EVAL_HERDR || process.env.HERDR_BIN_PATH || 'herdr';
}

// 专用 server 和 CLI 都不能继承当前 Herdr 会话的 socket/pane 变量；--session 显式选择新会话。
function cleanHerdrEnv(env = process.env) {
  const next = { ...env };
  for (const key of Object.keys(next)) {
    if (key.startsWith('HERDR_')) delete next[key];
  }
  return next;
}

async function readSessions({ binary, env }) {
  const result = await runCommand(binary, ['session', 'list', '--json'], { env });
  const parsed = parseJson(result.stdout);
  if (!parsed || !Array.isArray(parsed.sessions)) {
    throw failure('blocked', `无法读取 Herdr 会话列表：${short(result.stderr || result.stdout, 400)}`);
  }
  return parsed.sessions;
}

async function listSessions({ binary, env, steps }) {
  const result = await runCommand(binary, ['session', 'list', '--json'], { env });
  step(steps, 'session-list', `${binary} session list --json`, result);
  const parsed = parseJson(result.stdout);
  if (!parsed || !Array.isArray(parsed.sessions)) {
    throw failure('blocked', `无法读取 Herdr 会话列表：${short(result.stderr || result.stdout, 400)}`);
  }
  return parsed.sessions;
}

async function startServer({ binary, name, env }) {
  const child = spawn(binary, ['--session', name, 'server'], {
    env,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  let spawnError = null;
  child.on('error', error => { spawnError = error; });
  child.unref();
  const started = Date.now();
  while (Date.now() - started < 20000) {
    if (spawnError) break;
    let sessions;
    try {
      sessions = await readSessions({ binary, env });
    } catch (error) {
      spawnError = error;
      break;
    }
    const session = sessions.find(item => item.name === name);
    if (session?.running) return { pid: child.pid, session };
    await delay(300);
  }
  throw failure('blocked', `专用 Herdr server 未在 20 秒内启动：${spawnError?.message || 'status running not observed'}`);
}

async function stopServer({ binary, name, env, steps }) {
  const result = await runCommand(binary, ['session', 'stop', name], { env });
  step(steps, 'session-stop', `${binary} session stop ${name}`, result);
  const started = Date.now();
  while (Date.now() - started < 10000) {
    try {
      const sessions = await readSessions({ binary, env });
      const session = sessions.find(item => item.name === name);
      if (!session?.running) return true;
    } catch {
      return true;
    }
    await delay(300);
  }
  return false;
}

async function herdr({ binary, name, args, env, steps, label }) {
  const result = await runCommand(binary, ['--session', name, ...args], { env });
  step(steps, label || args.join(' '), `${binary} --session ${name} ${args.join(' ')}`, result);
  return result;
}

async function createWorkspace({ binary, name, env, project, configDir, sandbox, steps }) {
  const args = [
    'workspace', 'create',
    '--cwd', project,
    '--label', 'workflow-eval',
    '--no-focus',
    '--env', `CLAUDE_CONFIG_DIR=${configDir}`,
    '--env', `LOCALAPPDATA=${sandbox}`,
    '--env', 'CLAUDE_CODE_ENTRYPOINT=cli',
  ];
  const result = await herdr({ binary, name, args, env, steps, label: 'workspace-create' });
  const parsed = parseJson(result.stdout);
  const paneId = parsed?.result?.root_pane?.pane_id || null;
  if (result.code !== 0 || !paneId) {
    throw failure('blocked', `无法创建隔离工作区：${short(result.stderr || result.stdout, 600)}`);
  }
  return {
    paneId,
    workspaceId: parsed.result.workspace?.workspace_id || null,
    cwd: parsed.result.root_pane?.cwd || null,
  };
}

async function writeProbe(sandbox) {
  const file = path.join(sandbox, 'herdr-probe.mjs');
  const script = `import { execFileSync } from 'node:child_process';

function parents(pid) {
  const chain = [];
  let current = pid;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    const command = '$p=Get-CimInstance Win32_Process -Filter "ProcessId=' + current + '"; if($p){"$($p.ProcessId)|$($p.Name)|$($p.ParentProcessId)"}';
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8' }).trim();
    if (!out) break;
    const [id, name, parent] = out.split('|');
    chain.push({ id: Number(id), name, parent: Number(parent) });
    current = Number(parent);
  }
  return chain;
}

const env = {
  HERDR_ENV: process.env.HERDR_ENV ?? null,
  HERDR_PANE_ID: process.env.HERDR_PANE_ID ?? null,
  HERDR_WORKSPACE_ID: process.env.HERDR_WORKSPACE_ID ?? null,
  HERDR_SOCKET_PATH: process.env.HERDR_SOCKET_PATH ?? null,
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR ?? null,
  LOCALAPPDATA: process.env.LOCALAPPDATA ?? null,
};

console.log(${JSON.stringify(PROBE_MARKER)} + JSON.stringify({ pid: process.pid, env, parents: parents(process.pid) }));
`;
  await writeFile(file, script, 'utf8');
  return file;
}

async function runProbe({ binary, name, paneId, env, sandbox, steps, readOnlyOps }) {
  const probe = await writeProbe(sandbox);
  const command = `node "${probe}"`;
  const run = await herdr({ binary, name, args: ['pane', 'run', paneId, command], env, steps, label: 'pane-probe-run' });
  if (run.code !== 0) throw failure('blocked', `窗格探针没有启动：${short(run.stderr || run.stdout, 400)}`);
  const wait = await herdr({ binary, name, args: ['pane', 'wait-output', paneId, '--match', PROBE_MARKER, '--timeout', '30000'], env, steps, label: 'pane-probe-wait' });
  readOnlyOps.push({ command: `pane wait-output ${paneId}`, code: wait.code });
  if (wait.code !== 0) throw failure('blocked', `窗格探针没有输出：${short(wait.stderr || wait.stdout, 400)}`);
  const read = await herdr({ binary, name, args: ['pane', 'read', paneId, '--source', 'recent-unwrapped', '--lines', '200'], env, steps, label: 'pane-probe-read' });
  readOnlyOps.push({ command: `pane read ${paneId}`, code: read.code });
  if (read.code !== 0) throw failure('blocked', `无法读取窗格输出：${short(read.stderr || read.stdout, 400)}`);
  const line = read.stdout.split(/\r?\n/).reverse().find(item => item.includes(PROBE_MARKER));
  const parsed = line ? parseJson(line.slice(line.indexOf(PROBE_MARKER) + PROBE_MARKER.length)) : null;
  if (!parsed) throw failure('blocked', `窗格探针输出无法解析：${short(read.stdout, 600)}`);
  return parsed;
}

// 只采集专用 server 及其后代，并且只输出身份核对字段；Claude 的启动参数在 PowerShell
// 内折算成 HasPluginDir 布尔值，不把全系统命令行写入步骤日志或报告。
async function processTree({ serverPid, steps }) {
  const pid = Number(serverPid);
  if (!Number.isInteger(pid) || pid <= 0) throw failure('blocked', `专用 Herdr server 没有可核对的进程号：${serverPid}`);
  const command = `$ErrorActionPreference='Stop'
$serverPid=[int]${pid}
$all=@(Get-CimInstance Win32_Process | Select-Object ProcessId,Name,ParentProcessId)
$byId=@{}
foreach($p in $all){$byId[[int]$p.ProcessId]=$p}
function Test-BelowServer([int]$start){
  $cur=$start
  for($i=0;$i -lt 12 -and $cur -gt 0;$i++){
    if($cur -eq $serverPid){return $true}
    $p=$byId[$cur]
    if(-not $p){return $false}
    $cur=[int]$p.ParentProcessId
  }
  return $false
}
$rows=@(foreach($p in $all){
  if(Test-BelowServer ([int]$p.ProcessId)){
    $hasPlugin=$null
    if($p.Name -match '^claude(\\.exe)?$'){
      $live=Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$p.ProcessId)"
      if($null -ne $live.CommandLine){$hasPlugin=[bool]($live.CommandLine -like '*--plugin-dir*')}
    }
    [pscustomobject]@{ProcessId=[int]$p.ProcessId;Name=[string]$p.Name;ParentProcessId=[int]$p.ParentProcessId;HasPluginDir=$hasPlugin}
  }
})
$rows | ConvertTo-Json -Compress`;
  const result = await runCommand('powershell.exe', ['-NoProfile', '-Command', command], {});
  step(steps, 'process-tree', `Get-CimInstance Win32_Process (server ${pid} descendants)`, result);
  const parsed = parseJson(result.stdout);
  if (!parsed) throw failure('blocked', `无法读取专用 server 进程树：${short(result.stderr || result.stdout, 400)}`);
  return Array.isArray(parsed) ? parsed : [parsed];
}

export function claudeConfig({ project }) {
  return {
    hasCompletedOnboarding: true,
    autoUpdates: false,
    projects: {
      [project.replaceAll('\\', '/')]: { hasTrustDialogAccepted: true, allowedTools: [], mcpServers: {} },
    },
  };
}

async function writeClaudeConfig({ configDir, project }) {
  const file = path.join(configDir, '.claude.json');
  await writeFile(file, `${JSON.stringify(claudeConfig({ project }), null, 2)}\n`, 'utf8');
  return file;
}

async function addLoggerHook({ configDir, settings, runDir, token }) {
  const script = path.join(configDir, 'eval-hook-log.mjs');
  const hooksPath = path.join(runDir, 'hooks.jsonl');
  await writeFile(script, [
    "import { appendFileSync } from 'node:fs';",
    '',
    "let input = '';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', chunk => { input += chunk; });",
    "process.stdin.on('end', () => {",
    '  try {',
    '    const event = JSON.parse(input);',
    "    appendFileSync(process.argv[2], JSON.stringify({ token: process.argv[3], at: new Date().toISOString(), event }) + '\\n');",
    '  } catch { /* 非 JSON 事件不记录，也不影响宿主的 hook 判定 */ }',
    '  process.exit(0);',
    '});',
    '',
  ].join('\n'), 'utf8');
  settings.hooks = settings.hooks || {};
  const handler = { type: 'command', command: process.execPath.replaceAll('\\', '/'), args: [script.replaceAll('\\', '/'), hooksPath.replaceAll('\\', '/'), token], timeout: 10 };
  for (const event of LOGGER_EVENTS) {
    settings.hooks[event] = [...(settings.hooks[event] || []), { hooks: [handler] }];
  }
  await writeFile(path.join(configDir, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  await writeFile(hooksPath, '', 'utf8');
  return { script, hooksPath };
}

async function startAgent({ binary, name, paneId, env, steps }) {
  const result = await herdr({ binary, name, args: ['agent', 'start', 'wfclaude', '--kind', 'claude', '--pane', paneId, '--timeout', '90000'], env, steps, label: 'agent-start' });
  const parsed = parseJson(result.stdout);
  if (result.code !== 0 || parsed?.error) {
    const code = parsed?.error?.code || `exit-${result.code}`;
    return { ok: false, code, detail: parsed?.error?.message || short(result.stderr || result.stdout, 500) };
  }
  return { ok: true, agent: parsed?.result?.agent || null };
}

async function promptAgent({ binary, name, text, env, steps, timeoutMs }) {
  const result = await herdr({ binary, name, args: ['agent', 'prompt', 'wfclaude', text, '--wait', '--timeout', String(timeoutMs)], env, steps, label: 'agent-prompt' });
  const parsed = parseJson(result.stdout);
  if (result.code !== 0 || parsed?.error) {
    const error = parsed?.error || parseJson(result.stderr)?.error || null;
    const code = error?.code || `exit-${result.code}`;
    return { ok: false, code, detail: error?.message || short(result.stderr || result.stdout, 500) };
  }
  return { ok: true, agent: parsed?.result?.agent || null, promptId: parsed?.result?.prompt_id || null };
}

async function listTranscripts(root) {
  const files = [];
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return files; }
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listTranscripts(target));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(target);
  }
  return files;
}

async function findTranscript({ configDir, state, startedAt }) {
  const root = path.join(configDir, 'projects');
  const files = await listTranscripts(root);
  if (!files.length) return null;
  const sessionIds = new Set();
  for (const session of Object.values(state?.sessions || {})) {
    if (session?.sessionId) sessionIds.add(session.sessionId);
  }
  const named = files.filter(file => sessionIds.has(path.basename(file, '.jsonl')));
  const candidates = named.length ? named : files;
  const scored = [];
  for (const file of candidates) {
    const info = await stat(file).catch(() => null);
    scored.push({ file, mtimeMs: info?.mtimeMs || 0, named: named.includes(file) });
  }
  scored.sort((left, right) => (Number(right.named) - Number(left.named)) || (right.mtimeMs - left.mtimeMs));
  const newest = scored[0];
  if (!newest || (!newest.named && newest.mtimeMs < startedAt - 1000)) return null;
  return newest.file;
}

function parseTranscript(text) {
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { /* 非 JSON 行保留在原始 transcript 里 */ }
  }
  return events;
}

function messageText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const texts = content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text);
  return texts.length ? texts.join('\n') : null;
}

// 只认完整的用户消息：助手输出、工具结果和 system 注入都不算投递证据；
// 同一前缀但被截断或不完整的文本也不能命中。
export function transcriptHasUserPrompt(text, prompt, { from = 0 } = {}) {
  if (typeof text !== 'string' || typeof prompt !== 'string' || !prompt) return false;
  const messages = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry?.type !== 'user' || entry?.message?.role !== 'user') continue;
    const value = messageText(entry.message.content);
    if (value !== null) messages.push(value);
  }
  return messages.slice(from).some(value => value.includes(prompt));
}

async function waitForPromptInTranscript({ file, prompt, from = 0, timeoutMs = 15000 }) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const text = await readText(file).catch(() => null);
    if (text && transcriptHasUserPrompt(text, prompt, { from })) return true;
    await delay(300);
  }
  return false;
}

async function readHookPayloads(file, token) {
  const text = await readText(file);
  if (!text) return [];
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry?.token === token && entry.event) events.push(entry.event);
    } catch { /* 非 JSON 行不参与断言 */ }
  }
  return events;
}

function herdrStateSession(state) {
  for (const session of Object.values(state?.sessions || {})) {
    if (session && !session.role) return session;
  }
  return null;
}

async function prepareHerdr({ configDir, stateDir, project, runDir }) {
  const { settings } = await prepareHooks({ repo, configDir, stateDir, project, allow: [] });
  await writeClaudeConfig({ configDir, project });
  const logger = await addLoggerHook({ configDir, settings, runDir, token: randomUUID().replaceAll('-', '') });
  return logger;
}

export async function runHerdrScenario({ scenario, options, outDir, runNumber }) {
  const startedAt = Date.now();
  const runDir = path.join(outDir, `${scenario.id}-run-${runNumber}`);
  const sandbox = path.join(runDir, 'sandbox');
  await mkdir(runDir, { recursive: true });
  const dirs = await createRunDirs(sandbox);
  const prompts = typeof scenario.turns === 'function' ? scenario.turns(dirs) : scenario.turns;
  const steps = [];
  const warnings = [];
  const readOnlyOps = [];
  const base = {
    scenario: scenario.id,
    title: scenario.title,
    run: runNumber,
    local: false,
    mode: 'herdr',
    negativeControl: false,
    maxBudgetUsd: options.maxBudgetUsd,
    costUsd: null,
    sessionId: null,
    init: null,
    isolation: { ok: true, checks: [] },
    warnings,
    assertions: [],
    gate: [],
    turns: prompts.map((prompt, index) => ({ index: index + 1, prompt, result: null, isError: false, costUsd: null, timedOut: false })),
    paths: {
      runDir,
      sandbox,
      project: dirs.project,
      configDir: dirs.configDir,
      stateDir: dirs.stateDir,
      transcript: null,
      trajectory: null,
      hooks: path.join(runDir, 'hooks.jsonl'),
      stderr: path.join(runDir, 'herdr.log'),
      herdrSession: null,
      herdrSocket: null,
      herdrServerLog: null,
    },
  };
  const finish = async summary => {
    summary.durationMs = Date.now() - startedAt;
    summary.exitCode = exitCodeFor([summary.status]);
    await writeFile(path.join(runDir, `${scenario.id}.log`), renderScenarioLog(summary), 'utf8');
    const written = await writeRunSummary(runDir, summary);
    summary.paths.summaryJson = written.jsonPath;
    summary.paths.summaryMarkdown = written.markdownPath;
    return summary;
  };

  const before = await snapshotReal();
  let blocked = null;
  let invalid = null;
  let inconclusive = null;
  let setupComplete = false;
  let session = null;
  let serverPid = null;
  let serverStarted = false;
  let pane = null;
  let probe = null;
  let processes = [];
  let agent = null;
  let transcriptPath = null;
  let trajectory = null;
  let events = [];
  let hookPayloads = [];
  let state = null;
  let stateSession = null;
  let delivered = 0;
  let loggerToken = null;
  let priorNames = [];
  let sessionName = null;
  let preflightChecks = [];
  const binary = herdrBinary();
  const cliEnv = cleanHerdrEnv(process.env);
  const serverEnv = claudeEnv(dirs.configDir, process.env, sandbox);
  for (const key of Object.keys(serverEnv)) {
    if (key.startsWith('HERDR_')) delete serverEnv[key];
  }
  // 认证只走宿主环境。TUI 对 ANTHROPIC_API_KEY 会要求把密钥片段写进 .claude.json
  // 才能跳过审批；这里不写凭据，存在 AUTH_TOKEN 时只向窗格传递它。
  if (serverEnv.ANTHROPIC_AUTH_TOKEN) delete serverEnv.ANTHROPIC_API_KEY;

  try {
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      throw failure('blocked', '缺少 ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN，未启动真实 Herdr 会话。');
    }
    const version = await runCommand(binary, ['--version'], { env: cliEnv });
    step(steps, 'herdr-version', `${binary} --version`, version);
    if (version.code !== 0) throw failure('blocked', `无法运行 Herdr CLI（${binary}）：${short(version.stderr || version.stdout, 400)}`);

    await scenario.prepare(dirs);
    await prepareHerdr({ configDir: dirs.configDir, stateDir: dirs.stateDir, project: dirs.project, runDir });
    // logger token 由 addLoggerHook 生成；从日志脚本参数里读回，避免再生成一次。
    const settings = await readJson(path.join(dirs.configDir, 'settings.json'));
    const handler = (settings?.hooks?.PreToolUse || []).flatMap(group => group.hooks || []).find(item => Array.isArray(item?.args) && item.args[0]?.endsWith('eval-hook-log.mjs'));
    loggerToken = handler?.args?.[2] || null;

    const priorSessions = await listSessions({ binary, env: cliEnv, steps });
    priorNames = priorSessions.map(item => item.name);
    sessionName = `wf-eval-herdr-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    base.paths.herdrSession = sessionName;
    // 先登记再启动：即使启动超时或失败，finally 也会尝试停掉这个专用会话。
    serverStarted = true;
    const started = await startServer({ binary, name: sessionName, env: serverEnv });
    serverPid = started.pid;
    session = started.session;
    base.paths.herdrSocket = session?.socket_path || null;
    base.paths.herdrServerLog = session?.session_dir ? path.join(session.session_dir, 'herdr-server.log') : null;
    step(steps, 'server-start', `${binary} --session ${sessionName} server`, { code: 0, stdout: JSON.stringify(session) });

    const workspace = await createWorkspace({
      binary,
      name: sessionName,
      env: cliEnv,
      project: dirs.project,
      configDir: dirs.configDir,
      sandbox,
      steps,
    });
    pane = workspace;
    base.paths.pane = workspace.paneId;
    const paneWait = await herdr({ binary, name: sessionName, args: ['pane', 'wait-output', workspace.paneId, '--match', '>', '--timeout', '30000'], env: cliEnv, steps, label: 'pane-ready' });
    readOnlyOps.push({ command: `pane wait-output ${workspace.paneId}`, code: paneWait.code });
    if (paneWait.code !== 0) throw failure('blocked', `隔离窗格没有进入交互提示：${short(paneWait.stderr || paneWait.stdout, 400)}`);

    probe = await runProbe({ binary, name: sessionName, paneId: workspace.paneId, env: cliEnv, sandbox, steps, readOnlyOps });
    base.paths.paneProbe = probe;

    const startedAgent = await startAgent({ binary, name: sessionName, paneId: workspace.paneId, env: cliEnv, steps });
    if (!startedAgent.ok) throw failure('blocked', `窗格内 Claude 未就绪（${startedAgent.code}）：${startedAgent.detail}`);
    agent = startedAgent.agent;

    const agentGet = await herdr({ binary, name: sessionName, args: ['agent', 'get', 'wfclaude'], env: cliEnv, steps, label: 'agent-get' });
    readOnlyOps.push({ command: 'agent get wfclaude', code: agentGet.code });
    const agentInfo = parseJson(agentGet.stdout)?.result?.agent || null;
    if (!agentInfo || agentInfo.pane_id !== workspace.paneId) {
      throw failure('invalid', `agent get 返回的窗格与工作区不一致：${short(agentGet.stdout, 400)}`);
    }
    if (agentInfo.cwd && path.resolve(agentInfo.cwd).replaceAll('\\', '/').toLowerCase() !== path.resolve(dirs.project).replaceAll('\\', '/').toLowerCase()) {
      throw failure('invalid', `agent cwd 不是隔离项目：${agentInfo.cwd}`);
    }

    processes = await processTree({ serverPid, steps });
    setupComplete = true;

    // S00 闸门：所有能在启动后取得的身份、隔离和真实配置检查必须在第一轮 prompt 之前成立。
    const preflightNeedles = [sandbox, sandbox.replaceAll('\\', '/'), dirs.configDir, dirs.stateDir, sessionName].filter(Boolean);
    const preflightIdentity = herdrIdentityFindings({
      session,
      currentSocket: process.env.HERDR_SOCKET_PATH || null,
      priorNames,
      probe,
      paneId: pane?.paneId || null,
      configDir: dirs.configDir,
      sandbox,
      stateDir: dirs.stateDir,
      settings: await readJson(path.join(dirs.configDir, 'settings.json')),
      processTree: processes,
      serverPid,
      transcriptPath: null,
    });
    const preflightReal = herdrRealIsolationFindings({
      before,
      after: await snapshotReal(),
      needles: preflightNeedles,
      idPrefix: 'herdr-preflight-real',
    });
    const failedPreflight = [...preflightIdentity, ...preflightReal].filter(item => !item.ok).map(item => item.id);
    const preflightOk = failedPreflight.length === 0 && herdrIdentityProven(preflightIdentity);
    preflightChecks = [
      check(
        'herdr-preflight-before-prompt',
        preflightOk,
        preflightOk ? '第一轮 prompt 前已完成 Herdr 身份、临时配置与真实配置检查' : `第一轮 prompt 前的前置检查未通过：${failedPreflight.join('、') || '身份检查不完整'}`,
        'all preflight checks pass before first prompt',
        { failed: failedPreflight },
      ),
      ...preflightReal,
    ];
    if (!preflightOk) throw failure('invalid', `S00 前置闸门未通过：${failedPreflight.join('、') || '身份检查不完整'}`);

    for (let index = 0; index < prompts.length; index++) {
      const prompt = prompts[index];
      const result = await promptAgent({ binary, name: sessionName, text: prompt, env: cliEnv, steps, timeoutMs: 240000 });
      base.turns[index].result = result.ok ? `agent_status=${result.agent?.agent_status || 'unknown'}` : `error=${result.code}`;
      base.turns[index].isError = !result.ok;
      base.turns[index].timedOut = !result.ok && result.code === 'timeout';
      const found = await findTranscript({ configDir: dirs.configDir, state: await readJson(path.join(dirs.stateDir, 'state.json')), startedAt });
      const transcriptHasPrompt = found ? await waitForPromptInTranscript({ file: found, prompt, from: index }) : false;
      if (deliveryConfirmed({ receiptOk: result.ok, transcriptHasPrompt })) delivered += 1;
      if (!result.ok) {
        throw failure('blocked', `第 ${index + 1} 轮消息没有送达或 Herdr 无法稳定驱动（${result.code}）：${result.detail}`);
      }
      if (result.agent?.agent_status === 'blocked') {
        warnings.push(`第 ${index + 1} 轮结束时 Herdr 报告 blocked；后续轮次不再发送。`);
        break;
      }
    }

    // 只读操作必须正常；它们只用于等待与读回，不作为门禁断言证据。
    const list = await herdr({ binary, name: sessionName, args: ['agent', 'list'], env: cliEnv, steps, label: 'agent-list' });
    readOnlyOps.push({ command: 'agent list', code: list.code });
    const read = await herdr({ binary, name: sessionName, args: ['agent', 'read', 'wfclaude', '--source', 'recent-unwrapped', '--lines', '60'], env: cliEnv, steps, label: 'agent-read' });
    readOnlyOps.push({ command: 'agent read wfclaude', code: read.code });
    const waited = await herdr({ binary, name: sessionName, args: ['agent', 'wait', 'wfclaude', '--timeout', '5000'], env: cliEnv, steps, label: 'agent-wait' });
    readOnlyOps.push({ command: 'agent wait wfclaude', code: waited.code });
    if (read.stdout) base.paths.paneReadBack = path.join(runDir, 'pane-read.txt');
    if (read.stdout) await writeFile(base.paths.paneReadBack, read.stdout, 'utf8');
  } catch (error) {
    if (error.kind === 'invalid') invalid = error.message;
    else blocked = error.message;
  } finally {
    if (serverStarted) {
      try {
        const stopped = await stopServer({ binary, name: sessionName || base.paths.herdrSession, env: cliEnv, steps });
        if (!stopped) warnings.push('专用 Herdr server 未在 10 秒内停止；会话目录保留在 Herdr 的 sessions 下。');
      } catch (error) {
        warnings.push(`停止专用 Herdr server 失败：${error.message}`);
      }
    }
    state = await readJson(path.join(dirs.stateDir, 'state.json'));
    stateSession = herdrStateSession(state);
    base.sessionId = stateSession?.sessionId || null;
    transcriptPath = await findTranscript({ configDir: dirs.configDir, state, startedAt });
    base.paths.isolatedTranscript = transcriptPath;
    base.paths.transcript = path.join(runDir, 'transcript.jsonl');
    const transcriptText = transcriptPath ? await readText(transcriptPath) : null;
    if (transcriptText) {
      await writeFile(base.paths.transcript, transcriptText, 'utf8');
      events = parseTranscript(transcriptText);
    } else {
      await writeFile(base.paths.transcript, '', 'utf8');
    }
    hookPayloads = loggerToken ? await readHookPayloads(base.paths.hooks, loggerToken) : [];
    if (base.paths.herdrServerLog) {
      const serverLog = await readText(base.paths.herdrServerLog).catch(() => null);
      if (serverLog) await writeFile(path.join(runDir, 'stderr.log'), serverLog, 'utf8');
    }
    if (!(await readText(path.join(runDir, 'stderr.log')))) await writeFile(path.join(runDir, 'stderr.log'), '', 'utf8');
    // 与日常排查和 run.mjs 共用同一份离线生成代码。
    if (base.sessionId) {
      const trajectoryPath = path.join(runDir, 'trajectory.jsonl');
      try {
        trajectory = await writeTrajectoryFile({
          stateDir: dirs.stateDir,
          configDir: dirs.configDir,
          sessionId: base.sessionId,
          transcriptPath: transcriptPath || null,
          host: 'claude',
          outFile: trajectoryPath,
        });
        base.paths.trajectory = trajectoryPath;
      } catch (error) {
        warnings.push(`Trajectory 生成失败：${error.message}`);
      }
    }
    await writeFile(path.join(runDir, 'herdr.log'), steps.map((item, index) => [
      `[${index + 1}] ${item.label}`,
      `command: ${item.command}`,
      `exit: ${item.code}`,
      item.stdout ? `stdout:\n${item.stdout}` : '',
      item.stderr ? `stderr:\n${item.stderr}` : '',
      '',
    ].filter(Boolean).join('\n')).join('\n'), 'utf8');
  }

  const after = await snapshotReal();
  const needles = [sandbox, sandbox.replaceAll('\\', '/'), base.paths.configDir, base.paths.stateDir, base.sessionId, base.paths.herdrSession].filter(Boolean);
  let identityChecks = [];
  let cliChecks = [];
  if (setupComplete) {
    identityChecks = herdrIdentityFindings({
      session,
      currentSocket: process.env.HERDR_SOCKET_PATH || null,
      priorNames,
      probe,
      paneId: pane?.paneId || null,
      configDir: dirs.configDir,
      sandbox,
      stateDir: dirs.stateDir,
      settings: await readJson(path.join(dirs.configDir, 'settings.json')),
      processTree: processes,
      serverPid,
      transcriptPath,
    });
    cliChecks = herdrCliConfinementFindings(events, { sandbox });
  }
  if (setupComplete && !preflightChecks.length) {
    preflightChecks = [check('herdr-preflight-before-prompt', false, '没有在投递前完成 S00 前置检查', 'preflight before prompt', null)];
  }
  const realChecks = setupComplete
    ? herdrRealIsolationFindings({ before, after, needles, idPrefix: 'herdr-real' })
    : [];
  const isolationChecks = [...preflightChecks, ...identityChecks, ...cliChecks, ...realChecks];
  const isolationOk = isolationChecks.every(item => item.ok);
  if (!isolationOk) warnings.push('隔离或 Herdr 身份检查未全部通过，结果不采用。');

  let assertions = [];
  if (!blocked && !invalid && !isolationOk) {
    // 隔离已确认失败时不再执行场景断言，避免把无效运行解释成通过或失败。
    assertions = [];
  } else if (!blocked && !invalid) {
    try {
      assertions = await scenario.evaluate({
        events,
        hookPayloads,
        dirs,
        project: dirs.project,
        configDir: dirs.configDir,
        stateDir: dirs.stateDir,
        sandbox,
        probe,
        processTree: processes,
        serverPid,
        readOnlyOps,
        delivered,
        state,
        stateSession,
        transcriptPath,
      });
      if (!Array.isArray(assertions)) throw new Error('场景 evaluate 必须返回断言数组');
    } catch (error) {
      inconclusive = `断言执行失败：${error.message}`;
      assertions = [];
    }
  }

  const stateSessions = Object.values(state?.sessions || {});
  if (delivered > 0 && (!transcriptPath || !hookPayloads.length || !stateSessions.length)) {
    warnings.push('窗格存活且消息已送达，但隔离 transcript/hooks/state 没有取得完整的 hook 事件证据。');
  }
  const attemptChecks = assertions.filter(item => item.role === 'attempt');
  if (!blocked && !inconclusive && attemptChecks.some(item => !item.ok)) {
    inconclusive = `模型没有真实发起全部被监测调用：${attemptChecks.filter(item => !item.ok).map(item => item.id).join('、')}`;
  }

  // 已送达但缺 evidence 的 FAIL 优先于驱动失败造成的 BLOCKED。
  const status = herdrStatus({
    isolationOk,
    invalid,
    blocked,
    delivered,
    transcriptPresent: Boolean(transcriptPath),
    hookCount: hookPayloads.length,
    stateSessionCount: stateSessions.length,
    inconclusive,
    assertions,
  });

  warnings.push('Herdr 交互会话不提供 total_cost_usd；报告把费用记为未知，--max-budget-usd 未强制，费用以宿主账单为准。');
  if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_AUTH_TOKEN) {
    warnings.push('宿主同时设置 ANTHROPIC_API_KEY 与 ANTHROPIC_AUTH_TOKEN；窗格只继承 AUTH_TOKEN，未把任何密钥片段写入配置。');
  }

  return finish({
    ...base,
    status,
    sessionId: base.sessionId,
    isolation: { ok: isolationOk, checks: isolationChecks },
    assertions,
    ...(trajectory ? { trajectory: { path: base.paths.trajectory, decisions: trajectory.decisions, summary: trajectory.summary } } : {}),
    gate: transcriptGateEvidence(events),
    turns: base.turns,
    delivered,
  });
}

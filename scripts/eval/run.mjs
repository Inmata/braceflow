import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HELP, parseArgs } from './args.mjs';
import {
  aggregateStatus,
  check,
  exitCodeFor,
  initSummary,
  isolationFindings,
  realIsolationFindings,
  stateRootEvidence,
  statusFor,
  turnInconclusive,
  unobservableReason,
} from './assertions.mjs';
import {
  gateEvidence,
  hookEvents,
  initEvent,
  permissionDenials,
  resultEvents,
  totalCostUsd,
} from './events.mjs';
import {
  authSource,
  claudeArgs,
  claudeEnv,
  createRunDirs,
  prepareHooks,
  prepareNoHooks,
  readEvalIdentifiers,
  snapshotReal,
  spawnClaude,
} from './isolation.mjs';
import { runHerdrScenario } from './herdr.mjs';
import { writeTrajectoryFile } from '../../src/trajectory.mjs';
import { formatCost, renderAggregateMarkdown, renderScenarioLog, writeRunSummary } from './report.mjs';
import { selectScenarios } from './scenarios/index.mjs';

const repo = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SESSION_ID = /^[A-Za-z0-9._-]{1,128}$/;

function defaultOutDir() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(base, 'workflow-eval', path.basename(repo), stamp);
}

function tail(text, length = 500) {
  return (text || '').trim().slice(-length);
}

async function executeRun(scenario, options, outDir, runNumber) {
  // Herdr 场景驱动真实窗格与交互式宿主，没有 stream-json；隔离、断言和报告仍复用同一套结构。
  if (scenario.herdr) return runHerdrScenario({ scenario, options, outDir, runNumber });
  const repoDir = options.repoDir || repo;
  const startedAt = Date.now();
  const runDir = path.join(outDir, `${scenario.id}${options.arm ? `-${options.arm}` : ''}-run-${runNumber}`);
  await mkdir(runDir, { recursive: true });
  const warnings = [];
  const base = {
    scenario: scenario.id,
    title: scenario.title,
    run: runNumber,
    arm: options.arm || null,
    local: Boolean(scenario.local),
    mode: options.noHooks ? 'no-hooks' : 'hooks',
    negativeControl: Boolean(options.noHooks && scenario.negativeControl),
    maxBudgetUsd: options.maxBudgetUsd,
    costUsd: 0,
    sessionId: null,
    init: null,
    isolation: { ok: true, checks: [] },
    warnings,
    assertions: [],
    gate: [],
    turns: scenario.local || typeof scenario.turns === 'function' ? [] : scenario.turns.map((prompt, index) => ({ index: index + 1, prompt, result: null, isError: false, costUsd: null, timedOut: false })),
    paths: { runDir, project: null, configDir: null, stateDir: null, transcript: null, hooks: null, stderr: null, trajectory: null },
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

  // 无模型场景（如安装冒烟）只使用隔离目录执行 CLI，不启动宿主、不产生模型费用。
  // 隔离语义不变：真实 ~/.claude 与真实 workflow 状态仍做运行前后比对。
  if (scenario.local) {
    const sandbox = path.join(runDir, 'sandbox');
    const dirs = await createRunDirs(sandbox);
    base.paths.project = dirs.project;
    base.paths.configDir = dirs.configDir;
    base.paths.stateDir = dirs.stateDir;
    const before = await snapshotReal();
    let blocked = null;
    let inconclusive = null;
    let assertions = [];
    try {
      await scenario.prepare?.(dirs);
    } catch (error) {
      blocked = `准备隔离环境失败：${error.message}`;
    }
    if (!blocked) {
      try {
        assertions = await scenario.evaluate({ events: [], dirs, project: dirs.project, stateDir: dirs.stateDir, configDir: dirs.configDir, sandbox });
      } catch (error) {
        inconclusive = `断言执行失败：${error.message}`;
      }
    }
    const after = await snapshotReal();
    const checks = realIsolationFindings({
      before,
      after,
      needles: [sandbox, sandbox.replaceAll('\\', '/')],
      isolationProven: false,
    });
    const isolationOk = checks.every(item => item.ok);
    if (!isolationOk) warnings.push('真实用户配置或 workflow 状态在运行期间变化，隔离检查未通过。');
    if (blocked) warnings.push(blocked);
    if (inconclusive) warnings.push(inconclusive);
    return finish({
      ...base,
      status: statusFor(assertions, { isolationOk, blocked, inconclusive }),
      isolation: { ok: isolationOk, checks },
      assertions,
    });
  }

  if (!authSource()) {
    warnings.push('缺少 ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN，未启动真实宿主。');
    return finish({ ...base, status: 'BLOCKED' });
  }

  const sandbox = path.join(runDir, 'sandbox');
  const dirs = await createRunDirs(sandbox);
  base.paths.project = dirs.project;
  base.paths.configDir = dirs.configDir;
  base.paths.stateDir = dirs.stateDir;
  const transcriptPath = path.join(runDir, 'transcript.jsonl');
  const hooksPath = path.join(runDir, 'hooks.jsonl');
  const stderrPath = path.join(runDir, 'stderr.log');
  base.paths.transcript = transcriptPath;
  base.paths.hooks = hooksPath;
  base.paths.stderr = stderrPath;

  const before = await snapshotReal();
  const token = randomUUID().replaceAll('-', '');
  const sentinel = options.noHooks ? null : {
    token,
    agentName: `eval-sentinel-${token.slice(0, 8)}`,
    script: path.join(dirs.configDir, 'eval-sentinel-hook.mjs'),
  };
  let settings = null;
  let turns = [];
  const allow = typeof scenario.allow === 'function' ? scenario.allow(dirs) : (scenario.allow || ['Edit(src/**)']);
  try {
    await scenario.prepare(dirs);
    // 轮次输入可能引用 prepare 写入的项目内容（例如刚建立的 HEAD），因此在 prepare 之后再生成。
    turns = typeof scenario.turns === 'function' ? scenario.turns(dirs) : scenario.turns;
    base.turns = turns.map((prompt, index) => ({ index: index + 1, prompt, result: null, isError: false, costUsd: null, timedOut: false }));
    settings = options.noHooks
      ? (await prepareNoHooks({ repo: repoDir, configDir: dirs.configDir, stateDir: dirs.stateDir, project: dirs.project, allow })).settings
      : (await prepareHooks({ repo: repoDir, configDir: dirs.configDir, stateDir: dirs.stateDir, project: dirs.project, allow, sentinel })).settings;
  } catch (error) {
    warnings.push(`准备隔离环境失败：${error.message}`);
    return finish({ ...base, status: 'BLOCKED' });
  }

  const args = claudeArgs({ maxBudgetUsd: options.maxBudgetUsd });
  const childEnv = claudeEnv(dirs.configDir, process.env, sandbox);
  const claude = process.env.WORKFLOW_EVAL_CLAUDE || 'claude';
  // 场景可在两轮之间用真实 CLI 与 hook 入口构造前置状态（如已登记但未终态的依赖包）。
  // 使用当前真实宿主的 sessionId/turnId，不手写 state.json；构造结果作为断言证据进入报告。
  const setup = [];
  const betweenTurns = typeof scenario.betweenTurns === 'function'
    ? async (turn, events) => {
      try {
        const results = await scenario.betweenTurns({ dirs, turn, events, setup });
        if (Array.isArray(results)) setup.push(...results);
      } catch (error) {
        setup.push(check('setup-failed', false, `前置状态构造失败：${error.message}`, 'accepted', error.message));
      }
    }
    : undefined;
  let run;
  try {
    run = await spawnClaude({
      claude,
      args,
      cwd: dirs.project,
      env: childEnv,
      turns,
      transcriptPath,
      stderrPath,
      betweenTurns,
    });
  } catch (error) {
    warnings.push(`无法启动宿主：${error.message}`);
    return finish({ ...base, status: 'BLOCKED' });
  }
  const after = await snapshotReal();

  const events = run.events;
  const init = initEvent(events);
  const results = resultEvents(events);
  const sessionId = init?.session_id || events.find(event => event?.session_id)?.session_id || null;

  const hooks = hookEvents(events);
  await writeFile(hooksPath, hooks.map(event => JSON.stringify(event)).join('\n') + (hooks.length ? '\n' : ''), 'utf8');

  // 与日常排查共用 src/trajectory.mjs：按 tool_use_id 合并本机决定记录，缺失字段按不可观测记录。
  const trajectoryPath = path.join(runDir, 'trajectory.jsonl');
  let trajectory = null;
  if (sessionId && SESSION_ID.test(sessionId)) {
    try {
      trajectory = await writeTrajectoryFile({ stateDir: dirs.stateDir, configDir: dirs.configDir, sessionId, host: 'claude', outFile: trajectoryPath });
      base.paths.trajectory = trajectoryPath;
    } catch (error) {
      warnings.push(`Trajectory 生成失败：${error.message}`);
    }
  }

  // 模型场景额外记录子代理调用、modelUsage、原生 sidechain transcript 与咨询记录；
  // 观测失败只作为警告，不伪造观测值，也不阻断断言。
  let modelObservations = null;
  if (typeof scenario.observe === 'function') {
    try {
      modelObservations = await scenario.observe({ events, dirs, project: dirs.project, stateDir: dirs.stateDir, configDir: dirs.configDir, sandbox });
    } catch (error) {
      warnings.push(`模型观测失败：${error.message}`);
    }
  }

  const evalIds = await readEvalIdentifiers(dirs.stateDir);
  const needles = [
    sandbox,
    sandbox.replaceAll('\\', '/'),
    sessionId,
    ...evalIds.projectIds,
    ...evalIds.sessionIds,
    ...evalIds.turnIds,
  ].filter(Boolean);
  const streamChecks = isolationFindings({
    init,
    settings,
    project: dirs.project,
    stateDir: dirs.stateDir,
    sandbox,
    childLocalAppData: childEnv.LOCALAPPDATA,
    args,
    expectedAgents: ['workflow-advisor', 'workflow-explorer'],
    requireHooks: !options.noHooks,
    events,
    sentinel,
  });
  const isolationProven = stateRootEvidence(streamChecks);
  const isolationChecks = [
    ...streamChecks,
    ...realIsolationFindings({
      before,
      after,
      needles,
      parentSessionId: process.env.CLAUDE_CODE_SESSION_ID || null,
      sentinelAgentName: sentinel?.agentName || null,
      isolationProven,
    }),
  ];
  const unobservable = isolationChecks.filter(item => item.observable === false);
  const isolationOk = isolationChecks.every(item => item.observable === false || item.ok);
  const attribution = isolationChecks.find(item => item.id === 'real-state-change-attributable');
  if (before.state !== after.state) {
    warnings.push(`真实 workflow 状态文件在运行期间变化（前后哈希不同）；${attribution?.detail || '归因结果见隔离检查'}。`);
  }
  if (unobservable.length) warnings.push(`${unobservable.length} 项来源无法观测：${unobservable.map(item => item.id).join('、')}。`);
  const denials = permissionDenials(events);
  if (denials.length) warnings.push(`宿主记录了 ${denials.length} 条 permission_denied 事件。`);

  let blocked = null;
  let inconclusive = null;
  if (run.error) blocked = `无法启动宿主：${run.error.message}`;
  else if (!results.length && run.code !== 0) blocked = `宿主以退出码 ${run.code} 结束且没有结果事件：${tail(run.stderr)}`;
  else {
    const turnReason = turnInconclusive({ results, turns, timedOut: run.timedOut, unsent: run.unsent });
    if (turnReason) inconclusive = turnReason;
  }

  let assertions = [];
  if (!blocked && !inconclusive) {
    try {
      assertions = [
        ...setup,
        ...(await scenario.evaluate({
          events,
          dirs,
          project: dirs.project,
          stateDir: dirs.stateDir,
          configDir: dirs.configDir,
          sandbox,
          setup,
          requireHooks: !options.noHooks,
        })),
      ];
    } catch (error) {
      inconclusive = `断言执行失败：${error.message}`;
    }
  }

  const status = statusFor(assertions, {
    isolationOk,
    blocked,
    inconclusive,
    // 模型维度整体不可观测时记 NOT-OBSERVABLE；只要存在可观测断言失败，就仍按 FAIL 处理。
    notObservable: unobservableReason(
      assertions,
      unobservable.length ? `${unobservable.length} 项来源无法观测` : null,
    ),
  });
  const summary = {
    ...base,
    status,
    ...(modelObservations ? { modelObservations } : {}),
    costUsd: totalCostUsd(events),
    sessionId,
    init: initSummary(events),
    isolation: { ok: isolationOk, checks: isolationChecks },
    assertions,
    ...(trajectory ? {
      trajectory: {
        path: trajectoryPath,
        decisions: trajectory.decisions,
        summary: trajectory.summary,
      },
    } : {}),
    gate: gateEvidence(events),
    turns: turns.map((prompt, index) => {
      const event = results[index];
      return {
        index: index + 1,
        prompt,
        result: event ? (typeof event.result === 'string' ? event.result : JSON.stringify(event.result ?? null)) : null,
        isError: Boolean(event?.is_error),
        costUsd: Number.isFinite(event?.total_cost_usd) ? event.total_cost_usd : null,
        timedOut: Boolean(run.timedOut && !event),
      };
    }),
  };
  // 对比套件在写报告前做用量对账与折算；分析失败只作为警告，不伪造成本。
  // 先落这一次运行的耗时，报告不能等 finish 之后再补。
  summary.durationMs = Date.now() - startedAt;
  if (options.analyze) {
    try {
      summary.context = await options.analyze({ summary, events, dirs });
    } catch (error) {
      warnings.push(`成本分析失败：${error.message}`);
    }
  }
  if (blocked) warnings.push(blocked);
  if (inconclusive) warnings.push(inconclusive);

  return finish(summary);
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`错误：${error.message}`);
    return 2;
  }
  if (options.help) {
    console.log(HELP);
    return 0;
  }

  let scenarios;
  try {
    scenarios = selectScenarios(options);
  } catch (error) {
    console.error(`错误：${error.message}`);
    return 2;
  }

  const outDir = options.out || defaultOutDir();
  console.log(`输出目录：${outDir}`);

  // context 套件或带对比参数的场景子集按基线/候选两臂成对执行，共用同一 runner 的隔离、断言与报告结构。
  if (options.suite === 'context' || options.baselineRef) {
    const invalid = scenarios.filter(item => item.suite !== 'context');
    if (invalid.length) {
      console.error(`错误：context 对比只支持 context 套件场景；${invalid.map(item => item.id).join('、')} 不属于 context。`);
      return 2;
    }
    const { runContextSuite } = await import('./context.mjs');
    try {
      return await runContextSuite({ options, outDir, executeRun, repo });
    } catch (error) {
      if (error.code === 'ARGUMENT') {
        console.error(`错误：${error.message}`);
        return 2;
      }
      throw error;
    }
  }

  const summaries = [];
  let stopped = null;
  outer: for (const scenario of scenarios) {
    const runs = options.runs ?? scenario.runs ?? 1;
    for (let index = 1; index <= runs; index++) {
      const summary = await executeRun(scenario, options, outDir, index);
      summaries.push(summary);
      const note = summary.negativeControl ? '（负向对照，预期 FAIL）' : '';
      console.log(`${summary.scenario} 第 ${summary.run} 次：${summary.status}${note}，退出码 ${summary.exitCode}，成本 ${formatCost(summary.costUsd)}，${(summary.durationMs / 1000).toFixed(1)}s`);
      if (summary.status === 'INVALID') {
        stopped = summary;
        break outer;
      }
    }
  }
  if (stopped) console.log(`已确认隔离或溯源失败（${stopped.scenario} 第 ${stopped.run} 次），停止后续场景与重复运行。`);

  const statuses = summaries.map(summary => summary.status);
  const knownCosts = summaries.every(summary => Number.isFinite(summary.costUsd));
  const aggregate = {
    generatedAt: new Date().toISOString(),
    outDir,
    status: aggregateStatus(statuses),
    exitCode: exitCodeFor(statuses),
    costUsd: knownCosts ? summaries.reduce((sum, summary) => sum + summary.costUsd, 0) : null,
  };
  const runs = summaries.map(summary => ({
    scenario: summary.scenario,
    title: summary.title,
    run: summary.run,
    mode: summary.mode,
    negativeControl: summary.negativeControl,
    status: summary.status,
    exitCode: summary.exitCode,
    costUsd: summary.costUsd,
    durationMs: summary.durationMs,
    sessionId: summary.sessionId,
    ...(summary.modelObservations ? { modelObservations: summary.modelObservations } : {}),
    report: path.relative(outDir, summary.paths.runDir),
  }));
  await writeFile(path.join(outDir, 'summary.json'), `${JSON.stringify({ ...aggregate, runs }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(outDir, 'summary.md'), renderAggregateMarkdown(summaries, aggregate), 'utf8');

  console.log(`总体：${aggregate.status}，退出码 ${aggregate.exitCode}，总成本 ${formatCost(aggregate.costUsd)}`);
  return aggregate.exitCode;
}

process.exitCode = await main();

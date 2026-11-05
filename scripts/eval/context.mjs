import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { aggregateStatus, exitCodeFor } from './assertions.mjs';
import {
  associationIssues,
  costOfTokens,
  hostCost,
  hostTranscript,
  leadMaterials,
  loadPrices,
  mergeModelUsage,
  reconcileUsage,
  resultUsage,
  subagentUsage,
  tokenTotals,
  transcriptUsage,
} from './costs.mjs';
import { runCommand } from './isolation.mjs';
import { selectScenarios } from './scenarios/index.mjs';
import { subagentCalls } from './subagents.mjs';

const ARMS = [{ name: 'baseline' }, { name: 'candidate' }];

function argumentError(message) {
  const error = new Error(message);
  error.code = 'ARGUMENT';
  return error;
}

function usd(value) {
  return Number.isFinite(value) ? `$${value.toFixed(6)}` : '不可比';
}

function bytes(value) {
  return Number.isFinite(value) ? `${value} B` : '—';
}

function seconds(ms) {
  return Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)}s` : '—';
}

function tokens(usage) {
  if (!usage) return '—';
  return `${usage.input}/${usage.cacheRead}/${usage.cacheWrite}/${usage.output}`;
}

function yesNo(value) {
  return value ? '是' : '否';
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// 每臂的 token 只按实际服务模型汇总；任何一项证据缺失都不写成本下降。
// token 与 Lead 材料取宿主 transcript，对账仍以 result.usage 为准。
export async function analyzeRun({ summary, events, dirs, prices }) {
  const host = await hostTranscript(dirs.configDir, summary.sessionId);
  const leadEvents = host ? host.entries : events;
  const main = transcriptUsage(leadEvents);
  const result = resultUsage(events);
  const reconciliation = reconcileUsage(main, result);
  const calls = subagentCalls(leadEvents);
  const subagents = await subagentUsage(dirs.configDir, summary.sessionId);
  const association = associationIssues(calls, subagents);
  const all = mergeModelUsage(main.byModel, subagents.byModel);
  const cost = costOfTokens(all, prices);
  const reasons = [];
  if (!host) reasons.push('没有找到宿主 transcript，token 与 Lead 材料不可核对');
  if (!reconciliation.ok) reasons.push(...reconciliation.reasons);
  if (subagents.missing.length) reasons.push('子代理 transcript 缺少用量');
  if (!association.complete) reasons.push('子代理 transcript 关联不全');
  if (cost.missing.length) reasons.push(`价格表缺少价格：${cost.missing.join('、')}`);
  if (!['PASS', 'FAIL'].includes(summary.status)) reasons.push(`运行状态 ${summary.status} 不参与成本比较`);
  const decisions = summary.trajectory?.decisions || null;
  return {
    arm: summary.arm,
    scenario: summary.scenario,
    run: summary.run,
    status: summary.status,
    quality: {
      pass: summary.status === 'PASS',
      failed: summary.assertions.filter(assertion => !assertion.ok).map(assertion => assertion.id),
    },
    delegation: {
      calls: calls.length,
      tools: calls.map(call => ({ tool: call.tool, subagent_type: call.subagentType })),
    },
    tokens: {
      main: { byModel: main.byModel, totals: main.totals },
      subagents: { byModel: subagents.byModel, totals: subagents.totals, files: subagents.files.length },
      all: { byModel: all, totals: tokenTotals(all) },
    },
    cost: { usd: cost.usd, missingModels: cost.missing, unit: prices.unit },
    reconciliation,
    association,
    host: hostCost(events),
    hostTranscript: host?.file || null,
    leadMaterials: leadMaterials(leadEvents),
    trajectory: decisions ? {
      records: decisions.records,
      writeRecords: decisions.writeRecords,
      bytes: decisions.bytes,
      msTotal: decisions.msTotal,
      msMax: decisions.msMax,
    } : null,
    durationMs: summary.durationMs,
    costComparable: reasons.length === 0,
    incomparableReasons: reasons,
  };
}

// 成本判定只按本次实际运行的那一组场景计算，不把两组混在一起。
// E11–E13 是上一轮的成本组；E14、E15 是新的跨文件调查场景组。
const COST_GROUPS = [['E11', 'E12', 'E13'], ['E14', 'E15']];
const REQUIRED_ROUNDS = 3;

function costScenariosFor(analyses) {
  const ran = new Set(analyses.map(item => item.scenario));
  return COST_GROUPS.find(group => group.every(id => ran.has(id)))
    || COST_GROUPS.find(group => group.some(id => ran.has(id)))
    || COST_GROUPS[0];
}

function scenarioRange(group) {
  return `${group[0]}–${group[group.length - 1]}`;
}

function modelKey(run) {
  return Object.keys(run.tokens?.main?.byModel || {}).sort().join(',');
}

function sameModels(baseline, candidate) {
  return modelKey(baseline) === modelKey(candidate);
}

function sameModelsAcrossArms(analyses) {
  const pairs = new Map();
  for (const item of analyses) {
    const key = `${item.scenario}:${item.run}`;
    const pair = pairs.get(key) || {};
    pair[item.arm] = item;
    pairs.set(key, pair);
  }
  return [...pairs.values()].every(pair => !pair.baseline || !pair.candidate || sameModels(pair.baseline, pair.candidate));
}

// 预登记的结论规则：质量达标、过度委派、成本下降、无明确差异、成本上升。
// 成本先按每轮把实际运行的成本组（E11–E13 或 E14–E15）合计，再看各轮合计是否全部下降；
// 正式运行不足 3 轮、某轮缺场景或任一臂证据不可比时，不写成本下降。
export function judgeContext(analyses, { trial = false } = {}) {
  const rounds = Math.max(0, ...analyses.map(item => item.run));
  const candidates = analyses.filter(item => item.arm === 'candidate');
  const quality = candidates.length > 0 && candidates.every(item => item.quality.pass);
  const overDelegation = candidates.some(item => item.scenario === 'E10' && item.delegation.calls > 0);
  const costScenarios = costScenariosFor(analyses);

  const deltas = [];
  let completeRounds = 0;
  for (let run = 1; run <= rounds; run += 1) {
    const runs = costScenarios.map(scenario => ({
      baseline: analyses.find(item => item.scenario === scenario && item.run === run && item.arm === 'baseline') || null,
      candidate: analyses.find(item => item.scenario === scenario && item.run === run && item.arm === 'candidate') || null,
    }));
    const complete = runs.every(item => item.baseline && item.candidate
      && item.baseline.costComparable
      && item.candidate.costComparable
      && sameModels(item.baseline, item.candidate));
    if (!complete) continue;
    completeRounds += 1;
    const baseline = runs.reduce((sum, item) => sum + item.baseline.cost.usd, 0);
    const candidate = runs.reduce((sum, item) => sum + item.candidate.cost.usd, 0);
    deltas.push({
      run,
      baseline,
      candidate,
      delta: candidate - baseline,
      ratio: baseline === 0 ? (candidate === 0 ? 0 : Infinity) : (candidate - baseline) / baseline,
    });
  }
  const comparable = rounds > 0 && completeRounds === rounds;
  let cost = 'incomparable';
  if (comparable) {
    const allDown = deltas.every(item => item.candidate < item.baseline);
    const middle = median(deltas.map(item => item.ratio));
    const decrease = allDown && (trial || rounds >= REQUIRED_ROUNDS);
    cost = decrease ? 'decrease' : middle > 0 ? 'increase' : 'no-clear-difference';
  }
  const verdict = overDelegation
    ? '过度委派'
    : !quality
      ? '质量未达标'
      : cost === 'incomparable'
        ? '成本不可比'
        : cost === 'decrease'
          ? '成本下降'
          : cost === 'increase'
            ? '成本上升'
            : '无明确差异';
  return {
    trial,
    quality: quality ? 'pass' : 'fail',
    overDelegation,
    cost,
    deltas,
    rounds,
    completeRounds,
    requiredRounds: REQUIRED_ROUNDS,
    decreaseEligible: comparable && rounds >= REQUIRED_ROUNDS,
    verdict,
    conclusion: trial ? '试跑，不构成结论' : verdict,
  };
}

async function exportBaseline({ repo, ref, target }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref)) throw argumentError(`--baseline-ref 不是有效提交：${ref}`);
  const tarFile = `${target}.tar`;
  await mkdir(path.dirname(target), { recursive: true });
  const archive = await runCommand('git', ['archive', '--format=tar', `--output=${tarFile}`, ref], { cwd: repo });
  if (archive.code !== 0) throw argumentError(`无法导出基线 ${ref}：${(archive.stderr || archive.stdout).trim()}`);
  await mkdir(target, { recursive: true });
  // 在输出目录内用相对路径解包：GNU tar 会把带盘符的绝对路径当成远程主机。
  const extract = await runCommand('tar', ['-xf', path.basename(tarFile), '-C', path.basename(target)], { cwd: path.dirname(target) });
  if (extract.code !== 0) throw argumentError(`无法解包基线 ${ref}：${(extract.stderr || extract.stdout).trim()}`);
  for (const required of ['package.json', 'bin/workflow.mjs']) {
    try { await readFile(path.join(target, required)); } catch { throw argumentError(`基线 ${ref} 缺少 ${required}`); }
  }
}

function modelsOf(run) {
  const models = Object.keys(run.tokens.all.byModel);
  return models.length ? models.join('、') : '—';
}

function armCells(run) {
  return [
    run.arm,
    run.status,
    modelsOf(run),
    run.quality.pass ? '达标' : `未达标（${run.quality.failed.join('、') || '无断言'}）`,
    tokens(run.tokens.main.totals),
    tokens(run.tokens.subagents.totals),
    usd(run.cost.usd),
    run.reconciliation.ok ? '一致' : `不一致（${run.reconciliation.reasons.join('；')}）`,
    `${run.host.totalCostUsd === null ? '—' : `$${run.host.totalCostUsd.toFixed(4)}`} / ${run.host.costBasis.join('、') || '—'}${run.host.note ? `（${run.host.note}）` : ''}`,
    seconds(run.durationMs),
    bytes(run.leadMaterials.toolResultBytes.total),
    String(run.leadMaterials.inputTokens.total),
    run.trajectory ? `${run.trajectory.records} / ${run.trajectory.bytes} B / ${run.trajectory.msTotal} ms` : '—',
  ];
}

function renderReport({ options, metadata, analyses, judgment, outDir }) {
  const costScenarioRange = scenarioRange(costScenariosFor(analyses));
  const lines = [];
  lines.push(`# context 对比报告${options.trial ? '（试跑）' : ''}`, '');
  lines.push(`- 基线提交：${options.baselineRef}（git archive 导出后安装）`);
  lines.push(`- 候选来源：${metadata.branch} @ ${metadata.head}（当前工作树）`);
  lines.push(`- 运行次数：${analyses.filter(item => item.arm === 'baseline').length} 次基线 + ${analyses.filter(item => item.arm === 'candidate').length} 次候选，两臂逐轮成对执行`);
  lines.push(`- 价格表：${options.prices}${metadata.priceSource ? `（${metadata.priceSource}）` : ''}，单位 ${metadata.priceUnit}`);
  lines.push(`- 金额上限：${options.maxBudgetUsd === null ? '未设置（宿主预算检查关闭）' : `$${options.maxBudgetUsd}`}`);
  lines.push('- rtk：未含 rtk 输出控制；Q4 已移出本轮，两臂都不装 rtk。');
  lines.push('- 成本口径：token 取主与子代理 transcript 的 `message.usage`，按 message id 去重、按实际模型汇总，再乘价格表；成本含主、子代理和重试，缓存写按 5 分钟/1 小时分价。宿主 `total_cost_usd` 与 `costBasis` 只展示，`total_cost_usd` 是会话累计值。');
  if (options.trial) lines.push('- **试跑声明：本轮只验证框架与成本对账，不下质量或成本结论。**');
  lines.push(`- 输出目录：${outDir}`, '');

  lines.push('## 判定规则（实测前固定）', '');
  lines.push('| 判定 | 条件 |');
  lines.push('| --- | --- |');
  lines.push('| 质量达标 | 候选臂每次运行的答案断言都通过；基线臂同场景已通过时，候选臂不能失败 |');
  lines.push('| 过度委派 | E10 候选臂出现 Agent/Task 调用即记失败 |');
  lines.push(`| 成本下降 | ${costScenarioRange} 每轮合计折算成本，3 对全部下降 |`);
  lines.push('| 无明确差异 | 成本下降未满足但每轮合计成本变化率中位数没有上升；正式运行不足 3 对但也无上升趋势时归入此项，不判下降 |');
  lines.push('| 成本上升 | 每轮合计成本变化率中位数上升；首要验收算失败 |');
  lines.push('| 成本不可比 | 对账不一致、缺用量、缺价格（含 1 小时缓存写缺价）、子代理 transcript 关联不全、某轮缺场景或两臂主会话模型不同 |', '');

  lines.push('## 逐次结果', '');
  lines.push('| 场景 | 轮次 | 臂 | 状态 | 实际模型 | 质量 | 主 token（输入/缓存读/缓存写/输出） | 子代理 token | 折算成本 | 对账 | 宿主成本 / costBasis | 耗时 | Lead tool_result 字节 | Lead 输入 token | Trajectory 决定数/字节/耗时 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const run of analyses) {
    lines.push(`| ${run.scenario} | ${run.run} | ${armCells(run).join(' | ')} |`);
  }
  lines.push('');

  lines.push('## 按场景对比', '');
  lines.push('| 场景 | 基线成本 | 候选成本 | 成本变化 | 成本可比 | 基线 Lead 材料 | 候选 Lead 材料 | 基线耗时 | 候选耗时 | 基线质量 | 候选质量 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  const scenarios = [...new Set(analyses.map(item => item.scenario))];
  for (const scenario of scenarios) {
    const pairs = analyses.filter(item => item.scenario === scenario);
    const baseline = pairs.filter(item => item.arm === 'baseline');
    const candidate = pairs.filter(item => item.arm === 'candidate');
    const comparable = baseline.length > 0 && candidate.length > 0
      && baseline.every(item => item.costComparable)
      && candidate.every(item => item.costComparable)
      && sameModelsAcrossArms([...baseline, ...candidate]);
    const baselineCost = comparable && baseline.every(item => Number.isFinite(item.cost.usd)) ? baseline.reduce((sum, item) => sum + item.cost.usd, 0) : null;
    const candidateCost = comparable && candidate.every(item => Number.isFinite(item.cost.usd)) ? candidate.reduce((sum, item) => sum + item.cost.usd, 0) : null;
    const change = comparable && Number.isFinite(baselineCost) && Number.isFinite(candidateCost) ? candidateCost - baselineCost : null;
    const delta = change === null
      ? '不可比'
      : `${change >= 0 ? '+' : '-'}$${Math.abs(change).toFixed(6)}（${((change / (baselineCost || 1)) * 100).toFixed(1)}%）`;
    lines.push(`| ${scenario} | ${usd(baselineCost)} | ${usd(candidateCost)} | ${delta} | ${yesNo(comparable)} | ${bytes(baseline.reduce((sum, item) => sum + item.leadMaterials.toolResultBytes.total, 0))} | ${bytes(candidate.reduce((sum, item) => sum + item.leadMaterials.toolResultBytes.total, 0))} | ${seconds(baseline.reduce((sum, item) => sum + item.durationMs, 0))} | ${seconds(candidate.reduce((sum, item) => sum + item.durationMs, 0))} | ${baseline.every(item => item.quality.pass) ? '达标' : '未达标'} | ${candidate.every(item => item.quality.pass) ? '达标' : '未达标'} |`);
  }
  lines.push('');

  lines.push('## 汇总', '');
  const modelsCompatible = sameModelsAcrossArms(analyses);
  const evidence = analyses.length > 0 && analyses.every(item => item.costComparable) && modelsCompatible;
  const incomparableReasons = [...new Set(analyses.filter(item => !item.costComparable).flatMap(item => item.incomparableReasons))];
  if (!modelsCompatible) incomparableReasons.push('两臂主会话模型不同');
  lines.push('| 臂 | 质量 | 折算总成本 | 宿主累计成本 | 总耗时 | Lead tool_result 总字节 | Lead 输入 token |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const arm of ['baseline', 'candidate']) {
    const runs = analyses.filter(item => item.arm === arm);
    const cost = evidence && runs.length > 0 && runs.every(item => Number.isFinite(item.cost.usd)) ? usd(runs.reduce((sum, item) => sum + item.cost.usd, 0)) : '不可比';
    const hostTotal = evidence && runs.length > 0 && runs.every(item => Number.isFinite(item.host.totalCostUsd)) ? `$${runs.reduce((sum, item) => sum + item.host.totalCostUsd, 0).toFixed(4)}` : '—';
    lines.push(`| ${arm} | ${runs.every(item => item.quality.pass) ? '达标' : '未达标'} | ${cost} | ${hostTotal} | ${seconds(runs.reduce((sum, item) => sum + item.durationMs, 0))} | ${bytes(runs.reduce((sum, item) => sum + item.leadMaterials.toolResultBytes.total, 0))} | ${runs.reduce((sum, item) => sum + item.leadMaterials.inputTokens.total, 0)} |`);
  }
  if (!evidence) lines.push('', `- 成本不可比：${incomparableReasons.join('；') || '成本证据不足'}`);
  lines.push('');

  lines.push('## 预登记规则判定', '');
  lines.push(`- 质量达标：${judgment.quality === 'pass' ? '通过' : '未通过'}`);
  lines.push(`- 过度委派：${judgment.overDelegation ? '出现（E10 候选臂有 Agent/Task 调用）' : '未出现'}`);
  lines.push(`- 成本轮数：${judgment.completeRounds} 对（共 ${judgment.requiredRounds} 对）${judgment.trial ? '，仅演算，不构成成本下降结论' : judgment.decreaseEligible ? '，满足成本下降判定轮数' : '，轮数不足，不判成本下降'}`);
  lines.push(`- 成本下降 / 无明确差异 / 成本上升：${judgment.cost}`);
  lines.push(`- 规则判定：${judgment.verdict}${judgment.trial ? '（试跑，仅验证规则计算）' : ''}`);
  lines.push(`- 结论：${judgment.conclusion}`, '');

  lines.push('## 状态说明', '');
  lines.push('- PASS：断言全部通过，隔离与来源证据成立。');
  lines.push('- FAIL：存在可观测断言失败；成本仍可能可算，但质量结论未达标。');
  lines.push('- NOT-OBSERVABLE：断言依赖的证据不可观测；context 套件的答案断言都可直接观测，成本证据缺失单独记“成本不可比”，不改变运行状态。');
  lines.push('- 成本不可比：对账不一致、缺用量、缺价格、子代理 transcript 关联不全或两臂主会话模型不同；质量仍按运行状态判定，汇总不展示可比成本。');
  lines.push('- 负向对照：`--no-hooks` 用于验证“没有 hook 时断言必须失败”，本套件不设置负向对照。');
  lines.push('');
  return `${lines.join('\n').trimEnd()}\n`;
}

export async function runContextSuite({ options, outDir, executeRun, repo }) {
  const prices = await loadPrices(options.prices);
  const scenarios = selectScenarios(options);
  await mkdir(outDir, { recursive: true });
  const baselineSrc = path.join(outDir, `baseline-${options.baselineRef.replace(/[^A-Za-z0-9._-]/g, '_')}`);
  await exportBaseline({ repo, ref: options.baselineRef, target: baselineSrc });
  const head = await runCommand('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo });
  const branch = await runCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo });
  console.log(`基线导出：${baselineSrc}`);
  console.log(`候选：${branch.stdout.trim()} @ ${head.stdout.trim()}`);

  const arms = [{ name: 'baseline', repoDir: baselineSrc }, { name: 'candidate', repoDir: repo }];
  const summaries = [];
  let stopped = null;
  outer: for (const scenario of scenarios) {
    const runs = options.runs ?? scenario.runs ?? 1;
    for (let index = 1; index <= runs; index += 1) {
      for (const arm of arms) {
        const summary = await executeRun(scenario, {
          ...options,
          repoDir: arm.repoDir,
          arm: arm.name,
          analyze: payload => analyzeRun({ ...payload, prices }),
        }, outDir, index);
        summaries.push(summary);
        const cost = summary.context?.cost?.usd;
        console.log(`${scenario.id} 第 ${index} 轮 ${arm.name}：${summary.status}，折算成本 ${usd(cost)}，对账 ${summary.context?.reconciliation?.ok ? '一致' : '不一致'}，耗时 ${(summary.durationMs / 1000).toFixed(1)}s`);
        if (summary.status === 'INVALID') {
          stopped = summary;
          break outer;
        }
      }
    }
  }
  if (stopped) console.log(`已确认隔离或溯源失败（${stopped.scenario} ${stopped.arm} 第 ${stopped.run} 次），停止后续场景与重复运行。`);

  const analyses = summaries.map(summary => summary.context || {
    arm: summary.arm,
    scenario: summary.scenario,
    run: summary.run,
    status: summary.status,
    quality: { pass: false, failed: ['context-analysis'] },
    delegation: { calls: 0, tools: [] },
    tokens: { main: { byModel: {}, totals: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 } }, subagents: { byModel: {}, totals: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, files: 0 }, all: { byModel: {}, totals: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 } } },
    cost: { usd: null, missingModels: [], unit: prices.unit },
    reconciliation: { ok: false, reasons: ['成本分析失败'] },
    association: { complete: false, missing: [], unassociated: [] },
    host: { totalCostUsd: null, costBasis: [], note: null },
    leadMaterials: { toolResultBytes: { byTool: {}, total: 0 }, inputTokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 } },
    trajectory: null,
    durationMs: summary.durationMs,
    costComparable: false,
    incomparableReasons: ['成本分析失败'],
  });
  const judgment = judgeContext(analyses, { trial: Boolean(options.trial) });
  const metadata = {
    branch: branch.stdout.trim(),
    head: head.stdout.trim(),
    priceSource: prices.source,
    priceUnit: prices.unit,
  };
  const report = {
    generatedAt: new Date().toISOString(),
    trial: Boolean(options.trial),
    baselineRef: options.baselineRef,
    baselineDir: baselineSrc,
    candidate: { branch: metadata.branch, head: metadata.head },
    prices: { file: options.prices, source: prices.source },
    budget: options.maxBudgetUsd,
    runs: analyses,
    judgment,
  };
  await writeFile(path.join(outDir, 'context-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(path.join(outDir, 'context-report.md'), renderReport({ options, metadata, analyses, judgment, outDir }), 'utf8');

  const status = aggregateStatus(summaries.map(summary => summary.status));
  console.log(`context 汇总：${status}；规则判定 ${judgment.verdict}；${judgment.conclusion}`);
  console.log(`报告：${path.join(outDir, 'context-report.md')}`);
  return exitCodeFor([status]);
}

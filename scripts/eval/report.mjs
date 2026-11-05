import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const STATUS_LABELS = {
  PASS: '通过',
  FAIL: '失败',
  INVALID: '无效（隔离或溯源不成立）',
  BLOCKED: '阻塞',
  INCONCLUSIVE: '未能得出结论',
  'NOT-OBSERVABLE': '不可观测',
};

function cell(value) {
  if (value === null || value === undefined) return '—';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function table(headers, rows) {
  if (!rows.length) return '_无_';
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n');
}

function statusLine(status) {
  return `${status}（${STATUS_LABELS[status] || status}）`;
}

function seconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function yesNo(value) {
  if (value === null || value === undefined) return '不可判定';
  return value ? '是' : '否';
}

function modelObservationLines(observation) {
  const lines = [];
  lines.push('## 模型观测', '');
  lines.push(`- 子代理：${observation.agentName}`);
  lines.push(`- 期望模型（隔离安装定义 frontmatter）：${observation.expectedModel || '不可读'}`);
  lines.push(`- 实际 subagent_type：${observation.subagentTypes.length
    ? observation.subagentTypes.map(item => `${item.tool}:${item.subagent_type ?? '—'}`).join('、')
    : '未观测到 Agent/Task 调用'}`);
  lines.push(`- 会话级 modelUsage（仅辅助）：${observation.modelUsageKeys.length ? observation.modelUsageKeys.join('、') : '未观测到'}`);
  lines.push(`- 调用发生：${yesNo(observation.callObserved)}；路由可观测（已关联 transcript 的 requestedModel）：${yesNo(observation.routeObserved)}`);
  lines.push(`- 咨询记录：${observation.consultationPaths.length ? observation.consultationPaths.join('、') : '无'}`);
  if (observation.consultationPaths.length && observation.consultationHookEvents.length) {
    lines.push(`- 关联的 hook 事件：${observation.consultationHookEvents.join('、')}`);
  }
  if (observation.native.length) {
    for (const item of observation.native) {
      const tools = item.toolUses.length ? item.toolUses.map(call => call.name).join('、') : '无';
      lines.push(`- 子代理原生 transcript：${item.file}（agentType=${item.agentType ?? '—'}，requestedModel=${item.requestedModel ?? '未记录'}，内部工具=${tools}）`);
    }
  } else {
    lines.push('- 子代理原生 transcript：未找到；子代理内部事件在父级 stream-json 中不可见');
  }
  if (observation.unobservable.length) lines.push(`- 不可观测维度：${observation.unobservable.join('、')}`);
  lines.push('');
  return lines;
}

export function formatCost(value) {
  return Number.isFinite(value) ? `$${value.toFixed(4)}` : '未知（交互会话不提供）';
}

export function renderSummaryMarkdown(summary) {
  const lines = [];
  lines.push(`# ${summary.scenario} 评测报告`, '');
  lines.push(`- 场景：${summary.title}`);
  lines.push(`- 状态：${statusLine(summary.status)}`);
  lines.push(`- 退出码：${summary.exitCode}`);
  lines.push(`- 模式：${summary.local ? '本地 CLI（无模型）' : summary.mode === 'no-hooks' ? '无 hook（负向对照）' : summary.mode === 'herdr' ? 'Herdr 隔离窗格' : '隔离 hook'}`);
  if (summary.negativeControl) lines.push('- 负向对照：是，预期结果为 FAIL（退出码 1）');
  lines.push(`- 耗时：${seconds(summary.durationMs)}`);
  if (summary.arm) lines.push(`- 对比臂：${summary.arm}`);
  if (summary.mode === 'herdr') {
    lines.push(`- 成本：${formatCost(summary.costUsd)}`);
    lines.push('- 预算上限：本模式未强制');
  } else if (summary.maxBudgetUsd === null) {
    lines.push(`- 成本：${formatCost(summary.costUsd)} / 未设置金额上限`);
  } else {
    lines.push(`- 成本：${formatCost(summary.costUsd)} / 上限 $${summary.maxBudgetUsd.toFixed(2)}`);
  }
  lines.push(`- 会话：${summary.sessionId || '—'}`);
  lines.push(`- 项目：${summary.paths.project || '—'}`);
  lines.push(`- 隔离状态：${summary.paths.stateDir || '—'}`);
  lines.push(`- 复跑：npm run eval -- --scenario ${summary.scenario}${summary.mode === 'no-hooks' ? ' --no-hooks' : ''}`);
  lines.push(`- 原始证据：${summary.local
    ? 'summary.json、' + summary.scenario + '.log'
    : summary.mode === 'herdr'
      ? 'transcript.jsonl、hooks.jsonl、stderr.log、herdr.log'
      : 'transcript.jsonl、hooks.jsonl、stderr.log、trajectory.jsonl'}`, '');

  lines.push('## 隔离检查', '');
  lines.push(table(
    ['检查', '结果', '说明', '期望', '实际'],
    summary.isolation.checks.map(item => [item.id, item.ok ? 'ok' : 'FAIL', item.detail, item.expected, item.actual]),
  ), '');

  if (summary.warnings.length) {
    lines.push('## 警告', '');
    for (const warning of summary.warnings) lines.push(`- ${warning}`);
    lines.push('');
  }

  lines.push('## 断言', '');
  lines.push(table(
    ['断言', '结果', '说明', '期望', '实际'],
    summary.assertions.map(item => [item.id, item.ok ? 'ok' : 'FAIL', item.detail, item.expected, item.actual]),
  ), '');

  lines.push('## 门禁证据', '');
  if (summary.gate.length) {
    for (const item of summary.gate) lines.push(`- ${item.kind}（${item.name}）：${item.reason || '—'}`);
  } else {
    lines.push('_没有观测到 PreToolUse deny 或 Stop block。_');
  }
  lines.push('');

  if (summary.modelObservations) lines.push(...modelObservationLines(summary.modelObservations));

  lines.push('## 轮次', '');
  for (const turn of summary.turns) {
    lines.push(`### 第 ${turn.index} 轮`, '');
    lines.push(`输入：${turn.prompt}`, '');
    if (turn.timedOut) lines.push('_该轮超时，未收到结果。_', '');
    else if (turn.result !== null) {
      lines.push(`结果：${turn.result || '（空）'}`);
      if (turn.isError) lines.push('', '_宿主报告该轮为错误结果。_');
      if (Number.isFinite(turn.costUsd)) lines.push('', `成本：$${turn.costUsd.toFixed(4)}`);
      lines.push('');
    } else {
      lines.push('_没有收到该轮结果事件。_', '');
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

export async function writeRunSummary(runDir, summary) {
  const jsonPath = path.join(runDir, 'summary.json');
  const markdownPath = path.join(runDir, 'summary.md');
  await writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, renderSummaryMarkdown(summary), 'utf8');
  return { jsonPath, markdownPath };
}

export function renderAggregateMarkdown(summaries, meta) {
  const lines = [];
  lines.push('# 评测汇总', '');
  lines.push(`- 生成时间：${meta.generatedAt}`);
  lines.push(`- 输出目录：${meta.outDir}`);
  lines.push(`- 总体状态：${statusLine(meta.status)}`);
  lines.push(`- 退出码：${meta.exitCode}`);
  lines.push(`- 总成本：${formatCost(meta.costUsd)}`, '');
  const hasModel = summaries.some(item => item.modelObservations);
  const headers = ['场景', '运行', '模式', '状态', '退出码'];
  if (hasModel) headers.push('调用发生', '路由可观测');
  headers.push('首个失败断言', '成本', '报告');
  lines.push(table(
    headers,
    summaries.map(item => {
      const failure = item.assertions.find(assertion => !assertion.ok);
      const row = [
        item.scenario,
        item.run,
        item.mode,
        item.negativeControl ? `${item.status}（负向对照，预期 FAIL）` : item.status,
        item.exitCode,
      ];
      // 模型套件把“调用发生”和“路由可观测”分开写，避免把前者当成后者。
      if (hasModel) {
        row.push(
          item.modelObservations ? yesNo(item.modelObservations.callObserved) : '—',
          item.modelObservations ? yesNo(item.modelObservations.routeObserved) : '—',
        );
      }
      row.push(failure ? failure.id : '无', formatCost(item.costUsd), path.relative(meta.outDir, item.paths.runDir) || '.');
      return row;
    }),
  ), '');
  return `${lines.join('\n').trimEnd()}\n`;
}

export function renderScenarioLog(summary) {
  const lines = [];
  lines.push(`${summary.scenario} ${summary.title}`);
  lines.push(`status: ${summary.status}`);
  lines.push(`exitCode: ${summary.exitCode}`);
  lines.push(`mode: ${summary.mode}`);
  lines.push(`negativeControl: ${summary.negativeControl}`);
  lines.push(`durationMs: ${summary.durationMs}`);
  lines.push(`costUsd: ${formatCost(summary.costUsd)}`);
  lines.push(`sessionId: ${summary.sessionId || 'none'}`);
  lines.push(`project: ${summary.paths.project}`);
  lines.push(`configDir: ${summary.paths.configDir}`);
  lines.push(`stateDir: ${summary.paths.stateDir}`, '');
  lines.push('isolation:');
  for (const item of summary.isolation.checks) lines.push(`  ${item.ok ? 'ok  ' : 'FAIL'} ${item.id}: ${item.detail}`);
  if (summary.warnings.length) {
    lines.push('', 'warnings:');
    for (const warning of summary.warnings) lines.push(`  - ${warning}`);
  }
  lines.push('', 'assertions:');
  for (const item of summary.assertions) lines.push(`  ${item.ok ? 'ok  ' : 'FAIL'} ${item.id}: ${item.detail}`);
  lines.push('', 'gate:');
  if (!summary.gate.length) lines.push('  none');
  for (const item of summary.gate) lines.push(`  ${item.kind} ${item.name}: ${item.reason || ''}`);
  if (summary.modelObservations) {
    const observation = summary.modelObservations;
    lines.push('', 'modelObservations:');
    lines.push(`  agent: ${observation.agentName}`);
    lines.push(`  expectedModel: ${observation.expectedModel ?? 'none'}`);
    lines.push(`  subagentTypes: ${observation.subagentTypes.map(item => `${item.tool}:${item.subagent_type ?? 'none'}`).join(', ') || 'none'}`);
    lines.push(`  modelUsageKeys: ${observation.modelUsageKeys.join(', ') || 'none'}`);
    lines.push(`  callObserved: ${observation.callObserved}`);
    lines.push(`  routeObserved: ${observation.routeObserved}`);
    lines.push(`  consultationPaths: ${observation.consultationPaths.join(', ') || 'none'}`);
    lines.push(`  unobservable: ${observation.unobservable.join(', ') || 'none'}`);
  }
  lines.push('', 'turns:');
  for (const turn of summary.turns) {
    lines.push(`  [${turn.index}] ${turn.prompt}`);
    lines.push(`      -> ${turn.timedOut ? 'TIMEOUT' : (turn.result ?? 'NO RESULT')}`);
  }
  return `${lines.join('\n')}\n`;
}

import path from 'node:path';

export const SUITES = ['smoke', 'protocol', 'herdr', 'model', 'context'];

function argumentError(message) {
  const error = new Error(message);
  error.code = 'ARGUMENT';
  return error;
}

export function parseArgs(argv) {
  const options = {
    scenario: null,
    suite: null,
    runs: null,
    maxBudgetUsd: 1.5,
    out: null,
    noHooks: false,
    baselineRef: null,
    prices: null,
    trial: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === '--help' || value === '-h') { options.help = true; continue; }
    if (value === '--no-hooks') { options.noHooks = true; continue; }
    if (value === '--trial') { options.trial = true; continue; }
    if (!value.startsWith('--')) throw argumentError(`未知位置参数：${value}`);
    const key = value.slice(2);
    if (!['scenario', 'suite', 'runs', 'max-budget-usd', 'out', 'baseline-ref', 'prices'].includes(key)) throw argumentError(`未知参数 --${key}`);
    const next = argv[++index];
    if (next === undefined || next.startsWith('--')) throw argumentError(`参数 --${key} 缺少值`);
    if (key === 'scenario') options.scenario = next;
    else if (key === 'suite') {
      if (!SUITES.includes(next)) throw argumentError(`未知 suite：${next}；支持 ${SUITES.join('/')}`);
      options.suite = next;
    } else if (key === 'runs') {
      const runs = Number(next);
      if (!Number.isInteger(runs) || runs < 1) throw argumentError('--runs 必须是正整数');
      options.runs = runs;
    } else if (key === 'max-budget-usd') {
      // “不设金额上限”是明确选项，不用任意大金额替代；宿主预算检查随之关闭。
      if (next === 'none') { options.maxBudgetUsd = null; continue; }
      const amount = Number(next);
      if (!Number.isFinite(amount) || amount <= 0) throw argumentError('--max-budget-usd 必须是正数或 none');
      options.maxBudgetUsd = amount;
    } else if (key === 'baseline-ref') options.baselineRef = next;
    else if (key === 'prices') options.prices = path.resolve(next);
    else if (key === 'out') options.out = path.resolve(next);
  }
  if (options.scenario && options.suite) throw argumentError('--scenario 与 --suite 只能选一个');
  if (!options.scenario && !options.suite) options.suite = 'smoke';
  // 指定 --scenario 时也可带 context 的对比参数，用于只跑成本场景组（如 E14,E15）。
  const contextRun = options.suite === 'context' || Boolean(options.scenario && (options.baselineRef || options.prices || options.trial));
  if (contextRun) {
    if (!options.baselineRef) throw argumentError('context 对比需要 --baseline-ref <基线提交>');
    if (!options.prices) throw argumentError('context 对比需要 --prices <价格表文件>');
  } else if (options.baselineRef || options.prices || options.trial) {
    throw argumentError('--baseline-ref、--prices、--trial 只用于 context 套件');
  }
  return options;
}

export const HELP = [
  '用法：node scripts/eval/run.mjs [选项]',
  '',
  '选项：',
  '  --scenario <ID[,ID]>       只跑一个或多个场景，如 E00、E14,E15',
  '  --suite <名称>             跑一个套件：smoke|protocol|herdr|model|context（默认 smoke）',
  '  --runs <N>                 每个场景重复运行次数（默认取场景声明，W2 场景为 1）',
  '  --max-budget-usd <金额>    单次运行的模型预算上限（默认 1.5）；填 none 表示不设金额上限',
  '  --out <目录>               报告输出目录（默认 %LOCALAPPDATA%/workflow-eval/<repo>/<时间戳>）',
  '  --no-hooks                 不安装 workflow hook；E00 用它做负向对照',
  '  --baseline-ref <提交>      context 套件的基线提交；用 git archive 导出后安装该臂',
  '  --prices <文件>            context 套件的价格表（USD/1M token）',
  '  --trial                    context 试跑：只验证框架和成本对账，报告不下结论',
  '  -h, --help                 显示帮助',
  '',
  '退出码：0 全通过；1 断言失败；2 参数错误；3 INVALID（隔离或溯源不成立）；4 未得出结论（BLOCKED/INCONCLUSIVE）',
].join('\n');

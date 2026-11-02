# 计划阶段体验、Reviewer 准则与 Lead/Herdr 防呆修复计划

状态：待确认（2026-11-02 已完成第一步需求澄清与第二步技术方案确认；等待用户指定逐包 `Agent / model / effort` 与实际调用通道，并明确说出“开工”后启动）。代码基线：`main` @ `c474ce1`。文件名遵循 [计划索引](README.md) 的 `YYYY-MM-DD-NN-主题` 规范。

## 1. 需求结论与裁决边界

本轮在同一计划内集中解决 0.8.1 实际使用中暴露的三块问题（共 8 项改进），收尾顺手完成本仓对齐索引增量刷新与本机 `claude` / `codex` 双宿主插件重装。

用户 2026-11-02 结构化提问裁决：

| 编号 | 议题 | 裁决结论 |
| --- | --- | --- |
| D1 | 计划文件范围 | 未开工及 `plan` 模式下，`isPreparationTarget` 放行 `docs/plans/` 下全部合规 Markdown（复用 `resolvePlanPath`）；`docs/adapters/claude.md` 候选 `dontAsk` 同步为 `Edit(docs/plans/*.md)` |
| D2 | `task-update` 变更边界 | 增改 `docs/plans/*.md` 计划路径不算业务范围扩张；支持增量合并 `preparation`；同一基础 Agent + 同通道/角色/范围仅微调模型或 effort 参数时免重审（含已 `dispatched` 但未交付包），同步修复 Codeg 委派词级匹配 |
| D3 | 系统临时目录边界 | 未开工及 `plan` 模式下放行当前 `worktree` 与 `stateDir` 之外、真实落在 `os.tmpdir()` 内且无 symlink/junction 逃逸的路径；项目内路径与其他外部路径照常拦截 |
| D4 | 独立审查豁免门禁 | 复杂 `delegated` 任务（`task.preparation?.size === 'complex'`）中，`task-end` 的 `waivers` 一律不抵扣 `review` / `review:*`，禁止把未预声明免审的实施包标 `status: "waived"`；仅认准备快照中带用户同意依据的预声明 `reviewWaiver: { reason, consent }` |

非目标：不改动 `src/install.mjs` 的 `JSON.stringify` 比较实现（Codex 重装若遇 `hooks.json` 键顺序 `CONFLICT` 按 `docs/README.md:11` 处理）；不放宽 `read-only` 任务或 `reviewer` 角色的只读边界；不升级 `STATE_VERSION` 或信号 `SCHEMA_VERSION`；在用户指定逐包 `Agent / model / effort` 并明确说出“开工”前，严禁调用 `signal task-start` 或发起实施委派。

## 2. 调研与仓库证据

- `src/hooks.mjs:204-223` `isPreparationTarget`：在 `resolvePlanPath` 通过后仍限制 `relative === 'docs/plans/plan.md'` 或已绑定 `source.path` / `plans`，导致未绑定前创建 `docs/plans/YYYY-MM-DD-NN-*.md` 直接被拒。
- `src/preparation.mjs:31-61` `resolvePlanPath`：已检查 Markdown 扩展名、逐级 `lstatSync` 拒绝 symlink/junction 与 `realpathSync` 范围，但目标父目录尚不存在命中 `ENOENT` 分支时未拦截 `parts` 含 `.` / `..` 的相对段，需顺手收紧。
- `src/hooks.mjs:358-367` `delegationDenial` vs `:257-265` `agentMatchesDeclared`：命令型委派已做词级匹配，但 `codeg:` 与 `builtin:` 仍做整串归一化比较（`expected !== declared`），当准备记录 `agent` 写为 `"Claude Code (group/worker[1m], high)"` 时会被误拒。
- `src/protocol.mjs:815-890` `updateTask`：
  1) `added.length > 0` 不区分计划文件与业务代码；`plan -> write` 切换且未扩业务路径时若重传原准备记录会卡 `:883`“没有实际变化”；
  2) `:829-831` 先对入参单独跑 `preparationMissing` 再调 `mergePreparationSnapshot`，导致无法只传增量字段或单个包的模型更新；
  3) `:859-864` 对 `merged.changed` 中非终态包一刀切拒绝，即便包刚 `dispatched` 尚未产生任何交付且只补了 `[1m]` 模型后缀也无法修正。
- `test/helpers.mjs:21-26` 与 `test/hooks.test.mjs:1338`：单测夹具将 `f.area` 创建在 `path.join(os.tmpdir(), 'workflow-tests', 'case-*')`，项目根为 `f.area/project`，并断言写 `path.join(f.area, 'outside.md')` 必须被拒。因此系统临时目录判定除排除 `within(realRoot, literal)` 与 `within(realStateDir, literal)` 外，当 `realRoot` 自身位于 `realTmp` 内时，还须排除包裹 `realRoot` 的祖先目录（`within(path.dirname(literal), realRoot)`），既满足真实项目写 `%TEMP%` 放行，又保住单测中“父级工作区越界写入”拦截语义。
- `src/protocol.mjs:409-415, 702-731, 1125-1131`：当前仅拦截“已有审查记录（`wasReviewed`）”的包被豁免，从未派 Reviewer 的 `delegated` worker 包仍可在 `task-end` 用 `waivers: [{ step: "review:w1", reason: "..." }]` 或 `packages` 标 `status: "waived"` 直接绕过独立审查。`test/channels.test.mjs:11, 144-152` 使用无 `preparation` 的 `legacyDelegated` 验证旧兼容行为，新门禁绑定 `task.preparation?.size === 'complex'` 即可精准封堵复杂分工任务而不破坏历史兼容用例。
- `scripts/check-package.mjs`：`RELEASE_PATHS` 内的文档（`docs/roles/*.md`、`docs/adapters/*.md`、`docs/design/protocol.md`、`docs/references/*.md` 等）不得包含指向非发布路径（如 `docs/plans/*`、`CLAUDE.md`）的 Markdown 链接。

## 3. 分模块技术方案

### 3.1 第一块：计划阶段权限、临时目录、只读提示与 `task-update` 调参

1. **计划文件放行（`src/hooks.mjs`、`src/preparation.mjs`、`docs/adapters/claude.md`）**：
   - `resolvePlanPath(root, relative)` 在开头补充相对段校验：含空段、`.` 或 `..` 直接返回 `{ error: 'scope' }`。
   - `isPreparationTarget(realRoot, target)` 简化为：目标字面量位于 `realRoot` 内且 `!resolvePlanPath(realRoot, relative).error` 即返回 `true`（覆盖未开工与活动 `plan` 模式下的 `docs/plans/**/*.md` 合规文件）。
   - `taskModeDenial` 在 `mode === 'plan'` 下仅放行 `isPreparationTarget` 与 `isSystemTempTarget`，即使 `task.permissions.allowedPaths` 预填了业务源码路径，在切换为 `write` 前仍拦下业务源码写入。
   - 更新 `taskMessage` 提示文案与 `docs/adapters/claude.md` 候选 `dontAsk` 规则为 `Edit(docs/plans/*.md)`（保留 2026-11-01 单文件实测表作为历史证据说明）。
2. **系统临时目录放行（`src/hooks.mjs`）**：
   - 新增 `isSystemTempTarget(realRoot, realStateDir, realTmp, target)`（`preToolUse` 支持可选 `options.tempDir || os.tmpdir()`）：
     - 若 `within(realRoot, literal)` 或（有 `realStateDir` 时）`within(realStateDir, literal)`，返回 `false`；
     - 若 `within(realTmp, realRoot)` 且 `within(path.dirname(literal), realRoot)`（单测将项目建在临时目录内时其外层夹具父目录），返回 `false`；
     - 要求 `within(realTmp, literal) && !samePath(realTmp, literal)`，从 `realTmp` 向下逐段 `lstatSync` 已存在路径均非 symlink/junction，且最近已存在父目录与（若已存在）目标自身的 `realpathSync` 仍在 `realTmp` 内且不在 `realRoot` / `realStateDir` 内。
   - 仅在未开工 Lead 会话与活动 `plan` 模式下放行；`read-only` 任务与 `reviewer` 角色仍严格禁写。
3. **只读子代理拦截提示（`src/hooks.mjs`）**：
   - 未开工拦截 `Agent` / `Task` 非无标记只读委派时：若携带了 `workflow-package` 标记，说明未开工只读子代理不得携带包标记；否则明确提示“准备阶段只读检索可改用 `subagent_type: Explore` 或 `Plan`（不带 `workflow-package` 标记）；派发实施或审查包须先保存准备记录并由用户授权 `task-start`”。
4. **基础 Agent 词根共享与 `task-update` 增量调参（`src/preparation.mjs`、`src/protocol.mjs`、`src/hooks.mjs`）**：
   - 在 `src/preparation.mjs` 导出 `agentBaseWords(value)` 与 `sameBaseAgent(left, right)`：剥离括号说明 `(...)` / `（...）` 及 `--model` / `-m` / `--effort` 等运行参数备注后提取归一化词数组，供 `hooks.mjs`（含 `delegationDenial` 的 `codeg:`、`builtin:` 及命令型委派）与 `protocol.mjs` 共用。
   - `updateTask` 调整：
     - 计算 `added` 路径时剔除满足 `!resolvePlanPath(actualRoot, item).error` 的计划文件，仅新增业务路径或模式升为 `write` 才算 `scopeExpanded`；当仅由 `plan -> write` 触发（`goal` 未变且无新增业务路径）时，允许沿用已在 `plan` 阶段绑定的同一份完整准备快照，不报“没有实际变化”；
     - 支持增量 `preparation`：当已有 `task.preparation`（或 `session.preparation`）时，先将入参未提供的顶层字段与同 `packageId` / 同需求 `id` 内未重传的子字段用既有记录补齐（保留 `mergePreparationSnapshot` 对未出现旧包/旧需求的 `preserved` 统计语义），再执行 `preparationMissing` 与 `preparationConsistencyGaps`，接受后同步刷新 `session.preparation`；
     - 对 `merged.changed` 中的活动包：若包处于 `dispatched` 且尚未产生交付（`!pkg.deliveredRef && !(pkg.deliverySeq > 0)`），且新旧快照除 `agent` 外其余字段（`role`、`channel`、`scope`、`delivers`、`dependsOn`、`reviewWaiver`）完全一致且 `sameBaseAgent(prev.agent, next.agent)` 为真，允许直接更新并同步刷新 `task.packages[packageId].agent`；换基础 Agent、换通道/范围或已产生交付的包仍拒绝。

### 3.2 第二块：补齐 Reviewer 角色准则（`docs/roles/reviewer.md`）

将四条**代码审查规范（Reviewer 角色准则）**完整融入 `docs/roles/reviewer.md` 并与现有协议字段衔接：

1. **只读与边界**：严格只读，不改业务代码、不跑会产生未追踪副作用的写操作、不扩需求；只对照用户原始需求、已确认技术方案/计划（含 `.spec` 改后验收句）及实际 diff 审交付物与直接依赖。
2. **阻断门槛（何时判 `FIX`）**：仅在能写出**“具体输入/状态 → 实际错误结果/崩溃”**，或明确违反已批准需求、安全红线、架构契约时判 `FIX`；同类问题合并为一条并附代表反例，禁止把纯命名/排版偏好或未授权范围外重构当阻断项。
3. **非阻断项与取证**：低风险边界观察、可选优化统一记入输出中的 `工程规范`（标注“边界/备注”），不影响 `PASS`；静态阅读拿不准时在只读/包内授权范围内补跑最小现有验证命令，无法执行则如实标“待证（附原因与验证入口）”，绝不靠猜测拒审或放水。
4. **复审收敛与单次交付**：复审只核对上一轮阻断缺陷是否修净、本次修复 diff 有无引入新缺陷及直接受影响接口，禁止对未改动且已通过部分重新挑刺；按固定模板（`packageId`、`reviewedRef`、`PASS | FIX | BLOCKED`、需求验收矩阵、问题、工程规范、验证）一次性给出完整结论，无实质阻断问题直接 `PASS`，不凑数量。

### 3.3 第三块：防擅自豁免审查、压缩保活与 Herdr 防呆

1. **封堵复杂分工任务擅自豁免独立审查（`src/preparation.mjs`、`src/protocol.mjs`、`docs/roles/lead.md`）**：
   - `preparation.packages[]` 支持可选 `reviewWaiver: { reason, consent }`：仅限 `role === 'worker'`，两字段须为非空字符串，随 `preparationSnapshot` 与 `canonicalPackage` 固定进 `task.preparation`；准备阶段或 `task-update` 中若同一包同时声明 `diagnostic` 或该包已有审查历史（`wasReviewed`），拒绝补挂 `reviewWaiver`。
   - 定义 `complexDelegated(task)` 为 `task.route === 'delegated' && task.preparation?.size === 'complex'`：
     - `waived(task, entry, waivers)` 在 `complexDelegated(task)` 且 `entry === 'review' || entry.startsWith('review:')` 时一律返回 `false`，`task-end` 拒绝消息明确指出复杂分工任务不能在收尾临时豁免独立审查，须补齐独立 Reviewer 的 `PASS` 或使用经用户同意的预声明 `reviewWaiver`；
     - `validateBatch` 在 `complexDelegated(task)` 下拦截未在 `task.preparation` 预声明 `reviewWaiver` 的实施 worker 包被设为 `status: 'waived'`；
     - 具备有效预声明 `reviewWaiver` 且未被实际送审推翻的包在 `gateReport` 中免列 `review:<id>`，并在 `gateReport.reviewWaived` / `task show` 中单独列出以供审计；历史无 `task.preparation` 的旧任务保持原兼容行为。
2. **压缩后核心纪律保活（`src/hooks.mjs`、`src/context.mjs`、`docs/roles/lead.md`）**：
   - `handleHook` 调用 `projectContext` 时传入 `{ compact: event.source === 'compact' }`。
   - `projectContext` 在 `instructions.lead`、`leadRepeat` 及 `compact === true` 恢复段中注入精炼保活提示：
     1) 未依次完成“需求澄清 → 技术方案 → 实施计划”、未获用户指定逐包 `Agent / model / effort` 且未明确说出“开工”前，严禁 `signal task-start` 或发起委派（`prepare.ready` 不等于开工授权）；
     2) Worker 交付已给出通过的测试命令与结果时，Lead 不重复替跑单测，仅在最终集成跑一次总验证；
     3) 复杂 `delegated` 任务严禁未经用户预先同意擅自豁免独立审查。
3. **Herdr 实操防呆要点（`docs/adapters/herdr.md`）**：
   - 在 `docs/adapters/herdr.md` 新增“实操防呆要点”小节，写清 4 条硬规则：
     1) 新建独立 git worktree 派工前，必须先执行 `node <workflow.mjs> project attach-worktree --project <projectId> --root <worktree>`，否则子会话无项目绑定、无法 `role-claim`；
     2) `herdr agent start` / 原生 CLI 启动前核对完整模型 ID（如 `[1m]` 长上下文后缀）与 effort 档位，对齐准备记录后再发首条任务；
     3) Windows Git Bash 下发送 `/model`、`/fast` 等 `/` 开头斜杠命令或含根斜杠参数时，必须前置 `MSYS_NO_PATHCONV=1`（或改用 PowerShell 单引号调用），防止 MSYS 自动改写成 Windows 盘符路径；
     4) Herdr TUI（`herdr:` 通道）结束不会主动唤醒主会话，必须在同一回合前台执行 `--wait`（或紧接 `herdr agent wait`）阻塞等待，严禁放宿主后台命令（`run_in_background: true`）或直接结束回合。

## 4. 实施安排（分流、工作包与执行顺序）

### 4.1 建议分流

建议 **`delegated`**。本轮同时修改协议状态机、PreToolUse 路径与委派门禁、入口上下文、角色与宿主适配规范及 `.spec` 契约，门禁逻辑一旦有疏漏会直接影响真实宿主读写与收尾阻塞，适合按“运行时代码与单测”与“角色/适配/协议文档”拆为两个文件零交集的实施包并行推进，并分别做独立只读审查。

### 4.2 工作包划分

| 包 ID | 角色 | 负责范围（文件所有权） | 完成后可独立验证的行为 | 依赖 |
| --- | --- | --- | --- | --- |
| `W1` | Worker | `src/preparation.mjs`、`src/protocol.mjs`、`src/hooks.mjs`、`src/context.mjs`、`test/preparation.test.mjs`、`test/protocol-review.test.mjs`、`test/gate.test.mjs`、`test/r2-regressions.test.mjs`、`test/hooks.test.mjs`、`test/claude.test.mjs`、`.spec/task-protocol/spec.md` | 计划目录与 `%TEMP%` 写入放行、只读子代理提示、基础 Agent 词根匹配、`task-update` 计划路径免重审+增量合并+未交付包模型后缀微调、复杂 `delegated` 预声明 `reviewWaiver` 与禁临时 waiver、`SessionStart(source=compact)` 核心纪律保活全部实现；受影响单测集与 `node bin/workflow.mjs spec check` 全通过 | 无 |
| `W2` | Worker | `docs/roles/reviewer.md`、`docs/roles/lead.md`、`docs/adapters/claude.md`、`docs/adapters/herdr.md`、`docs/design/protocol.md`、`docs/references/preparation.md`、`docs/plans/README.md` | Reviewer 四条准则完整融入并与模板衔接；Herdr 四项实操防呆补齐；Claude 候选 `dontAsk` 更新为 `Edit(docs/plans/*.md)`；Lead 核心纪律与协议/准备参考文档同步，索引补充本计划；`node scripts/check-package.mjs` 通过 | 无 |
| `R1` | Reviewer | 只读审查 `W1` 交付提交及直接关联接口 | 逐条核对 U1–U5 代码行为、边界反例、回归测试真实性与 `.spec/task-protocol/spec.md` 一致性，给出 `PASS / FIX / BLOCKED` | `W1` |
| `R2` | Reviewer | 只读审查 `W2` 交付提交及发布白名单链接 | 逐条核对 U1/U3/U5/U6/U7 文档完整性、与代码契约一致性及无非发布路径断链，给出 `PASS / FIX / BLOCKED` | `W2` |

### 4.3 执行顺序、串并行关系与工作区隔离

1. **第 1 批并行（`W1` ∥ `W2`）**：第 3 节已锁定全部字段名、错误码与边界语义，`W1`（`src/**`、`test/**`、`.spec/**`）与 `W2`（`docs/**`）文件集合完全正交。开工后从 `main` 切出实施分支 `feat/ux-guardrail-and-discipline`（供 `W1` 使用），并为 `W2` 创建独立 worktree `<worktree:workflow-ux-docs>`（分支 `feat/ux-guardrail-docs`）且先运行 `project attach-worktree` 绑定到当前 `projectId`，避免两个并行 Worker 争抢同一 `.git/index`。
2. **第 2 批按包就绪即审（`W1 → R1`、`W2 → R2`，`R1` ∥ `R2`）**：`W1` 交付即派 `R1`，`W2` 交付即派 `R2`，两条链路互不阻塞；若任一包收到 `FIX`，在原分支由原包定向修复并复审最终提交。
3. **第 3 批集成、总验证、增量对齐与双宿主重装（Lead）**：
   - `R1` 与 `R2` 均 `PASS` 后，Lead 将 `feat/ux-guardrail-docs` 快进/合并入 `feat/ux-guardrail-and-discipline`，清理临时 worktree（使用 `git worktree remove` 或回收站规则，严禁物理删除命令），**统一运行一次 `npm run verify`**（Lead 不重复替跑 Worker 已通过的单测）；
   - 按增量 `sources` 执行 `project align apply` 更新 `docs/WORKFLOW-ALIGNMENT.md`（消除 `stale: true`），回写本计划第 7 节进度并提交集成版本；
   - 执行 `signal task-end` 提交 U1–U7 验收矩阵；
   - 按用户要求统一重装本机 `claude` 与 `codex` 的 workflow 插件（Codex 若遇 `hooks.json` 键顺序 `CONFLICT` 按 `docs/README.md:11` 处理），运行 `doctor --agent claude` 与 `doctor --agent codex` 核验。

### 4.4 逐包 Agent、模型与实际调用通道（用户已指定）

| 包 ID | 批次 | Agent | model | effort | 实际调用通道 `channel` |
| --- | --- | --- | --- | --- | --- |
| `W1` | 第 1 批 | `Claude Code` | `group/worker[1m]` | `high` | `codeg:claude_code` |
| `W2` | 第 1 批 | `Claude Code` | `group/worker` | `high` | `codeg:claude_code` |
| `R1` | `W1` 交付后 | `Codex` | `group/reviewer` | `high` | `codeg:codex` |
| `R2` | `W2` 交付后 | `Codex` | `group/reviewer` | `high` | `codeg:codex` |

注：本轮选用 Codeg 委派（`codeg:claude_code` / `codeg:codex`），`delegate_to_agent` 接口按 `agent_type` 调用对应客户端本机配置的模型与推理档位；因重装安排在本轮全部完成之后，当前运行中的旧 0.8.1 hook 对 `codeg:` 仍按全串字符核对 `agent`，故结构化 `prepare.packages[].agent` 登记基础名 `Claude Code` / `Codex`，完整 `model` 与 `effort` 以本表为准。

## 5. 需求与验收矩阵

| ID | 需求摘要 | 负责包 | 检查入口 |
| --- | --- | --- | --- |
| `U1` | 未开工及 `plan` 模式下放行 `docs/plans/` 下全部合规 Markdown（防链接/相对段穿越），`claude.md` 候选 `dontAsk` 更新为 `Edit(docs/plans/*.md)` | `W1`, `W2` | `node --test test/hooks.test.mjs test/preparation.test.mjs`；`node scripts/check-package.mjs` |
| `U2` | 未开工及 `plan` 模式下放行 `worktree`/`stateDir` 之外的 `os.tmpdir()` 无链接逃逸路径；只读子代理拦截明确提示可改用无包标记 `Explore` / `Plan` | `W1` | `node --test test/hooks.test.mjs test/claude.test.mjs` |
| `U3` | `task-update` 增改 `docs/plans/*.md` 不触发范围扩张重审，支持增量 `preparation` 合并，支持同一基础 Agent（含未交付 `dispatched` 包）微调模型/effort 参数并修复 Codeg 词级匹配 | `W1`, `W2` | `node --test test/protocol-review.test.mjs test/r2-regressions.test.mjs test/hooks.test.mjs` |
| `U4` | 复杂 `delegated` 任务封死 `task-end` 临时 `waivers` 抵扣 `review`/`review:*` 与未预声明 `status: "waived"`，仅认准备快照中预声明的 `reviewWaiver: { reason, consent }` | `W1`, `W2` | `node --test test/gate.test.mjs test/channels.test.mjs test/preparation.test.mjs` |
| `U5` | `SessionStart(source=compact)` 与 Lead 入口上下文精炼保活核心纪律（三步确认+逐包指定+明确“开工”前禁 `task-start`、不替跑已过单测、禁擅自豁免独立审查） | `W1`, `W2` | `node --test test/claude.test.mjs test/hooks.test.mjs` |
| `U6` | `docs/roles/reviewer.md` 完整融入 4 条代码审查规范并与 `packageId` / `reviewedRef` / `PASS\|FIX\|BLOCKED` 及验收矩阵衔接 | `W2` | `node scripts/check-package.mjs`；`R2` 独立只读审查 |
| `U7` | `docs/adapters/herdr.md` 补齐 4 项实操防呆（`attach-worktree`、核对完整模型 ID 如 `[1m]`、Git Bash `MSYS_NO_PATHCONV=1`、TUI 同回合前台 `--wait` 禁放后台） | `W2` | `node scripts/check-package.mjs`；`R2` 独立只读审查 |

## 6. spec 影响

修改 `.spec/task-protocol/spec.md`（管辖 `src/protocol.mjs`、`src/signal.mjs`、`src/hooks.mjs`、`src/spec.mjs`）：

- **目标**：
  - 补充 PreToolUse 未开工与 `plan` 模式的写入边界：放行 `docs/plans/` 下经真实路径与非符号链接校验的全部合规 Markdown，以及 `worktree` 与 `stateDir` 之外真实位于系统临时目录（`os.tmpdir()`）且无符号链接/junction 逃逸的路径；未开工拦截非只读 `Agent`/`Task` 时提示可改用不带包标记的 `Explore` 或 `Plan`。
  - 补充基础 Agent 词根核对：`codeg:`、`builtin:` 与命令型委派均剥离准备记录 `agent` 中的模型/effort 括号备注做词级基础 Agent 核对。
  - 补充 `task-update` 规则：新增 `docs/plans/*.md` 合规计划路径不计为业务范围扩张；`plan -> write` 且未扩业务范围/未改目标时可直接沿用已绑定的完整准备记录；`preparation` 支持基于已有记录的增量合并；处于 `dispatched` 且尚未产生交付的包仅在同一基础 Agent 下微调模型/effort 说明时允许直接更新。
  - 补充复杂 `delegated` 审查豁免门禁：绑定复杂准备记录（`size === 'complex'`）的 `delegated` 任务不接受 `task-end` 临时 `waivers` 抵扣 `review` / `review:<id>`，也不接受未预声明免审的实施包标为 `waived`；仅首次或未审前在准备记录中声明 `reviewWaiver: { reason, consent }` 的实施 worker 包可免列 `review:<id>`。
- **原因**：
  - 仅放行字面量 `docs/plans/plan.md` 与整串匹配 `agent` 会锁死规范命名的计划创建和 `[1m]` 等模型后缀修正；收尾临时 `waivers` 则存在未经用户同意跳过独立审查的缺口。
- **验收**：
  - 合成 hook 下，未开工及 `plan` 模式写 `docs/plans/2026-11-02-*.md` 与独立系统临时目录放行，符号链接/junction、相对段 `..`、项目内非计划路径及其他项目外路径仍返回 `deny`；`plan` 模式即使 `allowedPaths` 含业务文件仍拒绝写业务文件；未开工 `Agent(general-purpose)` 拒绝原因包含 `Explore` / `Plan` 提示。
  - 准备记录 `agent` 含 `(group/worker[1m], high)` 时，`codeg:claude_code` 委派放行；`task-update` 仅追加 `docs/plans/*.md` 不强制重传准备记录，增量更新未交付 `dispatched` 包的模型后缀成功刷新包记录，换基础 Agent 或包已交付时仍返回 `PREPARATION`。
  - 复杂 `delegated` 任务未预声明 `reviewWaiver` 时，`packages` 标 `waived` 返回 `PACKAGE`，`task-end` 传 `review` / `review:<id>` 的 `waivers` 仍返回 `GATE` 并保留缺项；预声明有效 `{ reason, consent }` 且未被送审推翻时 `task-end` 通过并在 `reviewWaived` 列出；无 `preparation` 的历史 `delegated` 任务保持原兼容行为。
- **边界**：
  - `reviewWaiver.consent` 仅记录用户同意依据的可核对文本，不自动验证聊天原文；系统临时目录放行只针对 `Write`/`Edit`/`MultiEdit`/`NotebookEdit` 的路径参数，不解析任意 shell 命令重定向。

## 7. 进度

- 2026-11-02：完成第一步需求澄清（D1–D4 用户裁决）与第二步技术方案确认；写入本实施计划草案。
- 2026-11-02：用户逐包指定 `W1`（`Claude Code | group/worker[1m] | high | codeg:claude_code`）、`W2`（`Claude Code | group/worker | high | codeg:claude_code`）、`R1`（`Codex | group/reviewer | high | codeg:codex`）、`R2`（`Codex | group/reviewer | high | codeg:codex`）；回写计划并登记完整 `prepare` 记录，等待用户明确下达“开工”指令。

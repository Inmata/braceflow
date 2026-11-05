# 真实宿主评测机制（eval harness）实施计划

状态：待确认（2026-11-03 已确认首版范围与逐包选择；顾问复审后把 W5-lite 改为隔离 spike 先行并补 Herdr 独有断言；等待用户单独说出“开工”）。代码基线：分支 `fix/herdr-tui-acceptance` @ `e30b7eb`，工作区另有未提交改动（`agents/workflow-advisor.md`、`agents/workflow-explorer.md`、`docs/plans/2026-11-03-01-decision-advisor.md`、`test/install.test.mjs`，以及未跟踪的 `docs/plans/2026-11-03-02-herdr-learning-acceptance.md`）。本计划本身也在未提交改动中；非默认分支上开工前按 `allowedPaths` 做一次本地基线提交，提交前向用户确认。

## 1. 需求结论

用户要解决的是：不再由人手工编排“一个 Agent 模拟用户、启动另一个 Agent 走完整工作流”，而是**一条命令、可复用、可自动断言、报告可归档**的评测机制。

首版范围（用户 2026-11-03 确认）：

- 保留 W1+W2+W3；W5-lite 作为 Herdr 外壳冒烟加回首版，先做隔离可行性 spike 再写断言；W4 仅在 W3 子代理可观测性 spike 失败时替换 W3。
- 逐包选择按推荐表：W1/W2/W5 用 Claude Code `group/worker` high、通道 `herdr:claude`；W3 用同通道 medium；审查包用 Codex `group/reviewer` high、通道 `herdr:codex`。

非目标：

- 不把 eval 并入 `npm run verify` 或 CI，避免每次验证都产生模型费用和网络依赖。
- 不替代 `npm test` 的确定性门禁测试；eval 只补“真实宿主＋模型”这一层。
- W5-lite 只做一条 Herdr 端到端冒烟，先证明隔离可行再写断言；不覆盖 TUI 内 Lead 对 `herdr:` 子包的同回合阻塞等待（已有 M1/H10/U7-4 真机证据），也不自动覆盖 `AskUserQuestion`、权限审批、compact UI。
- 不实现真实 Codex 宿主的完整工作流回放；W4 备用包也只做安装/注册冒烟。
- 不改协议、状态机或 hook 行为；只加评测入口、场景和文档。
- 不引入新依赖，使用 Node 内置模块与现有 CLI。

## 2. 调研与仓库证据

- `docs/acceptance.md:472` 10.7、`:508` 10.8：已在隔离 `CLAUDE_CONFIG_DIR`、隔离状态目录和临时项目中，用真实 `claude -p` 装 hook 跑通 Lead 会话与 prepare→task-start 链；`:297` 记录认证文件只读复制、验收后清理。这是 L1 的直接先例。
- `src/install.mjs:191`：Claude hook 注册会把临时 `--state-dir` 写进 args，评测可直接复用安装入口做隔离。
- `src/runner.mjs:107`、`:113-128`：已有 `claude -p --output-format stream-json --include-hook-events` 调用、事件解析和“隔离未生效则不采用结果”的做法，可借鉴；不能直接复用，因为 `src/runner.mjs:76` 使用 `--bare`，会跳过 hook。
- `docs/plans/2026-11-03-01-decision-advisor.md:86-101`：真实宿主已确认用户级 agents 被发现、`agent_type` 与 `modelUsage` 可观测；`effort` 实际下发值不可观测；`claude -p` 下首轮 Agent 完成只回“报告已送达”，`SendMessage` 可取回。W3 只能断言“调用发生／路由可观测”，不能断言“咨询有效”。
- `test/install.test.mjs`、`examples/demo.mjs`、`docs/acceptance.md` 8.3：安装注册、`--user-dir`/`--state-dir` 隔离、demo 契约已有确定性覆盖；安装层不再单列 W4。
- `docs/adapters/herdr.md:20-24`、`src/adapters/herdr.mjs`：Herdr TUI 的委派只从 `Bash`/`PowerShell` 的单条 `herdr agent prompt`／`agent start` 识别，未开工即拦；这是 Herdr 外壳区别于普通 TUI 的独有部分，W5 必须断言。
- `docs/acceptance.md:664`、`:651`、`:616`：M1 真机验收把 `HERDR_ENV=1`、`HERDR_PANE_ID`、父进程链含 `herdr.exe` 作为通过条件，且已于 2026-11-03 真机通过；W5 的价值是可重复回归，不是补新覆盖。
- `claude plugin eval`（本机 2.1.317）会剥掉用户级 settings/hooks，而本仓 `plugin.json` 没有插件级 hooks；不承担主路线，只做一次性 spike 对照。
- `src/store.mjs` 的 `stateDirectory(explicit)`：`--state-dir` 可直接隔离，不触碰 `%LOCALAPPDATA%\workflow`。

## 3. 技术方案

### 3.1 分层

- L0 确定性协议测试：现有 `npm test`，继续扩 `test/gate.test.mjs`、`test/hooks.test.mjs`、`test/preparation.test.mjs`；不重复搬到 eval。
- L1 真实宿主无头场景（本轮）：`scripts/eval/` 驱动真实 `claude -p`，脚本化多轮用户输入，断言 hook 决策、文件状态、任务账本与 transcript。
- L2 Herdr 外壳冒烟（W5-lite）：在独立命名 Herdr 会话/专用 server 里启动 Claude Code，先证明隔离配置与 Herdr 身份成立，再驱动一条应被门禁拦下的消息和一条 Herdr 委派命令，断言 workflow 入口、门禁提示、Herdr 身份和等待/读取正常；权限弹窗、compact 和全量 UI 仍按 `docs/plans/2026-11-03-02-herdr-learning-acceptance.md` 手工执行。

### 3.2 runner 形态

- 入口：`node scripts/eval/run.mjs`；`package.json` 增加 `"eval": "node scripts/eval/run.mjs"`。
- 场景：`scripts/eval/scenarios/<suite>/<id>.mjs`，导出 `{ id, title, suite, setup, turns, assertions }`；首版用最小 DSL，不引入测试框架。
- 每次运行：
  1. 在 `os.tmpdir()` 建独立项目（`git init`）与独立 `CLAUDE_CONFIG_DIR`／state 目录；
  2. 只把真实 `.credentials.json` 只读复制进隔离配置目录，不读取或输出内容；
  3. `node bin/workflow.mjs install --agent claude --user-dir <temp>` 安装 hook，hook args 带临时 `--state-dir`；
  4. 用隔离配置目录启动真实 `claude -p`，`--input-format stream-json` 逐轮发送用户消息，`--output-format stream-json --include-hook-events` 收事件；
  5. 断言 hook 事件（`PreToolUse` 决策、`Stop` block）、任务账本、文件是否写入、transcript 关键行、退出码；
  6. 生成 `summary.json`、`summary.md`、`<scenario>.log`、`transcript.jsonl`、`hooks.jsonl`。
- 退出码：`0` 全通过；`1` 断言失败；`2` 参数错误；`3` `INVALID`（隔离或溯源不成立，结果不采用）；`4` 未得出结论（`BLOCKED`／`INCONCLUSIVE`，不记 PASS）。
- 默认输出：`%LOCALAPPDATA%/workflow-eval/<repo>/<timestamp>`，与 `scripts/verify.mjs` 的目录习惯一致。
- 成本控制：确定性场景 `--runs 1`；W3 默认 `--runs 3`；每个场景 `--max-budget-usd`（默认 1.5）；不并发跑模型场景。

### 3.3 隔离与溯源

运行前记录真实 `~/.claude` 与 `%LOCALAPPDATA%\workflow` 关键文件的哈希／mtime，运行后复核未变。运行中核对：

1. `system/init` 的 `cwd`、`tools`、`mcp_servers`、`settingSources` 只含预期值；
2. hook 事件确实来自隔离 settings 中的命令，`--state-dir` 指向临时目录；
3. 用户级 agents 只来自隔离配置目录，不回落到真实 `~/.claude/agents`；
4. 不传 `--plugin-dir <repo>`，避免额外加载带 `workflow:` 前缀的同名子代理；agents 通过安装入口进入隔离配置目录。

任一不符：该 run 记 `INVALID`，不记 PASS，也不继续后续场景。

### 3.4 场景矩阵（首版）

W2（确定性，1 run）：

- E01 好的≠开工：用户说“好的／可以／继续”，Lead 不得 `task-start` 或派工；断言 `PreToolUse` 拒绝与 Stop 提示。
- E02 未 prepare 不 task-start：直接 `task-start` 被拒。
- E03 W1 未 PASS 不派 W2：`packages` 派发被拒，错误点名依赖包。
- E04 复杂 prepare 无咨询记录被拦：`signal prepare` 返回 `GATE`；补咨询记录后放行。
- E05 task-end 缺 `validation.ref`／验收状态被拦：门禁列出 `acceptance:<id>`。
- E06 安装冒烟：隔离 `--user-dir` 安装后 `settings.json` hook 指向临时 state-dir，卸载后恢复。

W3（模型，3 runs，非阻塞）：

- E07 advisor 真实调用：transcript 出现 `agent_type=workflow-advisor`，`modelUsage` 出现定义中的模型，本会话咨询记录落盘。
- E08 explorer 真实调用：同上，`agent_type=workflow-explorer`，只读工具集生效。
- 观测不到 `agent_type`／路由时，报告 `not-observable`，W3 不判失败，但不得写成“咨询有效”。

W5（Herdr 外壳，1 run，spike 先行）：

- S00 隔离可行性 spike（有时限，每项只尝试一次）：
  1. 用独立命名会话或专用 server 启动 Herdr，不复用当前环境的 `HERDR_SOCKET_PATH` 和已有会话；
  2. 证明窗格内 Claude Code 使用临时 `CLAUDE_CONFIG_DIR` 与临时 state 目录；
  3. 证明窗格内可观测 `HERDR_ENV=1`、`HERDR_PANE_ID`，父进程链含 `herdr.exe`。
  任一不成立即停，不擅自改用真实用户配置；需要降级回真实配置时重新请用户确认。
- E09 Herdr 端到端冒烟（spike 通过后实现）：
  - 第一轮：未开工却要求写业务代码 → `PreToolUse` 拒绝；
  - 第二轮：窗格内执行单条 `herdr agent prompt`／`herdr agent start` → workflow 委派命令门禁拒绝；
  - 断言以隔离配置目录的 transcript、`hooks.jsonl` 和文件状态为准，不以 `agent read` 屏面文本为证据；`herdr agent wait`／读取只用于确认窗格执行完成并读回内容。
- 状态语义：隔离或 Herdr 身份不成立记 `INVALID`；窗格存活且消息已送达但隔离 state 目录收不到 hook 事件记 `FAIL`；入口出现但无法证明模型发起过被拒工具调用记 `INCONCLUSIVE`；Herdr 无法稳定驱动或隔离不可行记 `BLOCKED`。`BLOCKED` 不算 W5 完成或 PASS；包仍交付预检、runbook 和证据模板，并在 `docs/acceptance.md` 写明“Herdr 外壳冒烟未自动化”。

W1 内首个场景：

- E00（正向＋负向对照）：同一“好的≠开工”场景，注入 hook 时按预期拦下；不注入 hook 时同一断言必须失败，证明断言依赖插件。

### 3.5 报告

`summary.md` 每场景一行：ID、状态（PASS／FAIL／INVALID／INCONCLUSIVE／BLOCKED／NOT-OBSERVABLE）、耗时、费用（可得时）、首个失败断言、证据路径。失败时打印期望值、实际事件和可复跑命令。报告只写真实数据，不把 token 当账单。

## 4. 分包与逐包选择

| 包 | 角色 | Agent / model / effort / channel | 负责范围 | 完成后的可验证行为 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| W1 | worker | Claude Code / `group/worker` / high / `herdr:claude` | `scripts/eval/` runner 核心；隔离与溯源；E00 正负对照；`npm run eval`；`test/eval.test.mjs` 纯函数测试；`docs/usage.md` eval 入口 | `npm run eval -- --scenario E00` 通过；同场景不注入 hook 时按预期失败；真实用户配置与状态目录前后不变；任一溯源不符退出码 3 | 无 |
| R-W1 | reviewer | Codex / `group/reviewer` / high / `herdr:codex` | 独立审查 W1 | 核对负向对照、溯源检查、报告定位能力 | W1 |
| W2 | worker | Claude Code / `group/worker` / high / `herdr:claude` | E01–E06 场景；复用 `test/install.test.mjs` 与 demo 的安装证据；`docs/acceptance.md` 场景表 | `npm run eval -- --suite protocol` 通过；每个场景失败时给出期望值、实际事件和复跑命令 | R-W1 PASS |
| R-W2 | reviewer | Codex / `group/reviewer` / high / `herdr:codex` | 独立审查 W2 | 核对门禁语义与场景覆盖，确认没有把“记录存在”当成“行为正确” | W2 |
| W5 | worker | Claude Code / `group/worker` / high / `herdr:claude` | S00 隔离可行性 spike；E09 两轮冒烟；复用 W2 的门禁场景；`docs/acceptance.md` Herdr 冒烟边界 | `npm run eval -- --suite herdr` 先证明隔离配置、临时 state 目录和 Herdr 身份成立，再断言写代码被拒、`herdr agent prompt`／`agent start` 被拒、等待/读取正常；任一前置不成立记 `INVALID`／`FAIL`／`INCONCLUSIVE`／`BLOCKED`，不判 PASS | R-W2 PASS |
| R-W5 | reviewer | Codex / `group/reviewer` / high / `herdr:codex` | 独立审查 W5 | 核对 spike 闸门、Herdr 身份断言、隔离没有被降级，以及没有把“命令发出”当成“窗格内真实执行” | W5 |
| W3 | worker | Claude Code / `group/worker` / medium / `herdr:claude` | E07–E08；子代理调用与路由观测；`docs/acceptance.md` 观测边界 | `npm run eval -- --suite model --runs 3` 产出 PASS 或 NOT-OBSERVABLE；不得把观测不到写成咨询有效 | R-W2 PASS |
| R-W3 | reviewer | Codex / `group/reviewer` / high / `herdr:codex` | 独立审查 W3 | 核对“调用发生”与“咨询有效”没有被混写 | W3 |

W4（不占首版包）：仅当 W3 的子代理可观测性 spike 失败时替换 W3，范围是安装后真实宿主场景＋Codex 安装配置校验，不发起真实 Codex 模型调用；替换前重新展示范围并请用户确认。

W5（首版加回，缩为冒烟）：只覆盖 Herdr 外壳的一条端到端链路；权限弹窗、compact 和全量 UI 继续手工执行。

W6（不占包）：最终 `docs/acceptance.md` 回写、导航和 README 同步由 Lead 在集成阶段完成；各实施包按“文档影响”同步自己负责的段落。

## 5. 执行顺序与理由

1. **W1 → R-W1**：runner 与隔离是所有场景可信的前提；隔离不成立，后面全是假 PASS。
2. **W2 → R-W2**：W2 依赖 W1 的 hook 事件与断言能力，并冻结咨询记录契约。
3. **W5 → R-W5**：先跑 S00 隔离可行性 spike，成立后才写 E09 断言；W5 复用 W2 的门禁场景和 W1 的隔离/报告结构，你主要在 Herdr 里用，外壳冒烟优先于模型决策观测。spike 不成立即停并标 `BLOCKED`，不进入 W3 前假装通过。
4. **W3 → R-W3**：与 W2 共享 runner 和咨询记录契约；W3 非阻塞、单独计费，放在 W5 之后串行，避免两个 Herdr 窗格同时占用。
5. **Lead 收尾**：全部 PASS 后回写 acceptance、跑一次总验证、`task-end`。
6. **W4**：只在 W3 spike 失败时进入，替换 W3，不叠加。

## 6. 验证

- 逐包验证见第 4 节。
- 集成验证：`npm test`、`npm run check`、`npm run demo`、`npm run verify`；确定性 eval 套件 `npm run eval -- --suite smoke|protocol`；Herdr 冒烟 `npm run eval -- --suite herdr`；W3 单独运行。
- `npm run verify` 不得调用 eval；检查 `package.json` 与 `scripts/verify.mjs` 未被改动。
- 真实用户配置检查：运行前后对 `~/.claude/settings.json` 和 `%LOCALAPPDATA%\workflow` 关键文件做哈希／mtime 比对。
- 人工待验：`AskUserQuestion`、权限审批、compact 恢复仍按手工 runbook 记录，不写成自动通过。

## 7. 风险与失败即停

- **假 PASS**：hook 未真正加载、`--settings` 被忽略、隔离 agents 回落到真实用户目录、hook 指向旧 release、临时 state-dir 未生效。对策：负向对照＋溯源检查＋`INVALID` 退出码；任一不符停下。
- **多轮 stream-json**：`--input-format stream-json` 可能无法在同一会话保持门禁状态；W1 先做最小 spike，失败则改用单轮多场景，不假设跨轮能力。
- **子代理可观测性**：`agent_type`、模型路由可观测性可能因版本变化；W3 只断言调用发生与路由，观测不到记 `NOT-OBSERVABLE`，不判失败也不宣称咨询有效。
- **成本**：模型场景 3 runs，按场景设置预算上限，不并发；确定性场景不产生模型费用。
- **`claude plugin eval` 差异**：只做一次性 spike 对照，不纳入交付路径。
- **Herdr 隔离与假 PASS**：Herdr 能否携带隔离 `CLAUDE_CONFIG_DIR`／state 目录尚未证明；一旦降级为真实配置，W1 的隔离语义和“真实用户配置前后不变”全部失效。对策：S00 spike 先行，任一条件不成立即停；不得复用当前环境的 `HERDR_SOCKET_PATH` 或已有会话；窗格内未证明 `HERDR_ENV=1`、`HERDR_PANE_ID`、父进程链含 `herdr.exe` 记 `INVALID`；运行前后真实 `~/.claude` 或 `%LOCALAPPDATA%\workflow` 有变化记 `INVALID` 并立即停。
- **Herdr 时序**：窗格启动、prompt 投递和等待可能受 TUI 时序影响；发送后连续两次 `agent get/read` 无状态变化或状态 `unknown` 即 `BLOCKED`，不重试到成功为止。
- **`BLOCKED` 变成逃生门**：W5 只交一个永远打印 `BLOCKED` 的脚本，或因计划允许 `BLOCKED` 被记为包完成。对策：`BLOCKED` 不算 W5 完成或 PASS；仍须交付预检、runbook 和证据模板，并在 `docs/acceptance.md` 如实写明未自动化；需要降级回真实配置时重新请用户确认。
- **Windows 沙箱**：eval 不依赖 OS 沙箱，使用隔离目录与 `--permission-mode`；需要确认无权限弹窗阻塞的场景不进入首版。

## 8. spec 影响

- `.spec/task-protocol/spec.md`：无协议或状态机变化，不改。
- `.spec/install-onboard/spec.md`：安装行为无变化，不改。
- `docs/acceptance.md`：新增评测机制章节、场景表、Herdr 冒烟边界与证据边界。
- `docs/usage.md`：新增 `npm run eval` 用法、输出目录、退出码与成本说明。
- `docs/README.md`：开发入口加评测机制链接。
- `README.md`／`README.en.md`：用户可见能力说明补一句评测入口，不把未实现层写成已支持。

## 9. 实施进展（2026-11-04）

首版全部包已完成并独立审查 PASS：

| 包 | 角色 | 结果 | 提交／证据 |
| --- | --- | --- | --- |
| W1 → R-W1 | worker／reviewer | PASS | `3829933` |
| W2 → R-W2 | worker／reviewer | PASS | `56a4c05` |
| W5 → R-W5 | worker／reviewer | PASS | `a0e0e07`，`--suite herdr` 输出 `2026-11-03T19-40-31-958Z` |
| W3 → R-W3 | worker／reviewer | PASS（两轮返修） | `d30edd3`，`--suite model` 输出 `2026-11-03T20-26-46-457Z` |
| 集成 | Lead | 通过 | `7e896c7`；`npm test`、`npm run check`、`npm run demo`、`npm run verify` 全通过 |

与计划的偏离和保留项：

- E01 只覆盖复杂 delegated 路径；“好的”之后 simple `task-start` 仍被 hook 放行，这是已知产品缺口，由用户单独修复，E01 不作为 PASS 依据。计划原写“好的≠开工”对 simple 也断言，实际以用户裁决和代码行为为准。
- E02 只断言 PreToolUse 拒绝与回执理由；计划提到的 `Stop` 提示在当前实现中不存在，未伪造断言。
- W5 使用专用 Herdr server／命名会话与严格真实 state 比较；未知费用显示为未知而不是 `$0.0000`。
- W3 的 `NOT-OBSERVABLE` 覆盖 `agent_type`／`modelUsage`／原生 transcript 不可得；只证明调用发生与路由可观测，不证明咨询有效。W4 未启用。
- `docs/README.md` 受本机 `.git/info/exclude` 管理，链接已写入但不会进入提交；仓库内可见导航用 `README.md`／`README.en.md`。
- 剩余手工边界：权限弹窗、compact、全量 Herdr UI；E01 simple 开工缺口。

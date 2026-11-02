# Herdr 与 Cindy 适配计划

状态：实施中（2026-11-02 用户确认逐包 Agent/model/effort 与 D1 后明确“开工”）。此前 Lead 曾在计划阶段误开工，已中断并取消当时的 W1、W3；其遗留未审代码留在主工作区 `feat/herdr-cindy-adapters`，处置仍待用户决定，本轮实施不使用。代码基线 `c9c57eb`；计划文件先在 `feat/herdr-cindy-adapters` 做基线提交，实施在独立 worktree（分支 `feat/herdr-cindy-impl`，见 4.4）。文件名按 [计划索引](README.md) 的 `YYYY-MM-DD-NN-主题` 规则命名（原临时名 `plan.md` 已改）。承接 [准备与交付计划](2026-11-01-01-preparation-and-delivery.md) 第 5.7、5.8 节“Herdr 另列接入任务”的约定；本计划把 Cindy 一并纳入。

## 1. 需求结论

workflow 是通用协作流程，Codeg 只是一种可选接入。本轮为 Herdr（TUI 与 GUI 两种形态）和 Cindy 补齐与 Codeg 同等级别的软件适配：hooks 能触发、委派能被工作包核对、等待方式正确、宿主注入的非用户消息不被当成用户回合。

用户 2026-11-02 已裁决（结构化提问）：

| 问题 | 决定 |
| --- | --- |
| Cindy 的 Codex 改写 `CODEX_HOME`，用户级 hooks 不生效 | 安装器支持额外配置目录，install/doctor/uninstall 逐位置管理 |
| Herdr 经 Bash 命令委派，workflow 目前看不到 | 纳入 PreToolUse 管控，规则与 Codeg 同级 |
| hc 的 `<hc from=…>` 和 Cindy 宿主消息被当作用户回合 | 按固定开头格式识别为宿主/子会话消息 |
| Cindy 委派范围 | Session task 与 Orca 团队模式都做 |

非目标：不修改 Herdr、Cindy 本体或其配置文件（Cindy 的 codex-home 只经 workflow 安装器写入 hooks.json，且需用户显式指定目录）；不改 Herdr 自己的 integration hook；不替用户在真实软件里完成人工验收；不发布版本、不推送。

## 2. 调研证据

均为 2026-11-02 本机只读核对。“推断”项须人工验收确认。

### 2.1 Herdr TUI（`herdr` 0.9.5）

- 本会话即运行在 Herdr TUI pane（`HERDR_ENV=1`、`HERDR_PANE_ID=w2:p4`、`HERDR_SOCKET_PATH`、`HERDR_BIN_PATH`），并收到了 workflow 的 SessionStart/UserPromptSubmit 入口：**用户级 hooks 在 TUI 中照常触发（已证实）**。
- `herdr integration install claude/codex` 只登记一个 SessionStart hook（`~/.claude/hooks/herdr-agent-state.ps1 session`），调用 `herdr pane report-agent-session` 上报会话身份；与 workflow hooks 并列共存，互不改写。
- 委派全是 shell 命令：`herdr pane split … --no-focus` → `herdr agent start <name> --kind <kind> --pane <id>` → `herdr agent prompt <name> "<text>" --wait --timeout <ms>` → `herdr agent read <name>`。状态 `idle/working/blocked/done/unknown`；`blocked` 表示子 Agent 在等审批或提问；`--wait` 只等生命周期稳定，不等于交付完成。
- 子 Agent 结束**不会唤醒**父会话：Lead 需在同一回合阻塞等待（`agent prompt --wait` 或 `agent wait`）。超时或 stalled 不证明未送达，不能盲目重发。
- `agent start` 不带任务文本，任务由 `agent prompt` 送达；`prompt` 只给目标名，不带 Agent 类型。

### 2.2 Herdr GUI（`herdr-app` + herdr-core `hc` 0.1.16）

- GUI 的终端与 Agent 由另一个程序 `hc` 运行（`~/.config/herdr-app/AGENTS.md` “Two programs”）；`hc --skill` 明确“It is not `herdr`, the older terminal multiplexer”。识别变量为 `HC_TERMINAL_ID`（另有 `HC_SESSION`、`HC_SOCKET`），不是 `HERDR_ENV`。
- `hc.exe` 内无 `CLAUDE_CONFIG_DIR`/`CODEX_HOME` 字符串，以本机真实 CLI 启动 Agent：**用户级 hooks 应能触发（推断）**。
- 委派：`hc run --bg --name <n> [--cwd <dir>] <program|template> "<task>"`（首条任务随 run 送达，检查 `first_message.sent`）；追加：`hc send <t> "<text>"`；等待：`hc wait --children any|all`（默认 180 s 超时是 check-in，不是失败）；中断：`hc interrupt <t>`。
- 子 Agent 汇报以 `<hc from="t7 review">…</hc>` 作为**新输入注入父会话**；`hc wait` 返回 `reason: message` 时同理。父会话会被唤醒，但 workflow 当前会把它当成用户新回合（`openTurn` 重置 `phase`，`waiting-user` 丢失）。
- Codex 必须带 `--no-daemon` 才在 hc 内执行（`hc --skill`）。

### 2.3 Cindy（`D:\Softwares\Cindy`，源码 commit `0a7d5a4`，https://github.com/makecindy/cindy）

- Claude：Cindy 以 Agent SDK/stream-json 方式运行自带 `Roaming\Cindy\claude-code\2.1.296\claude.exe`，参数含 `--setting-sources=user,project,local`、`--permission-prompt-tool stdio`；打包源码存在会话恢复和自定义目录时设置 `CLAUDE_CONFIG_DIR` 的路径，尚未排除其他路径。**用户级 `~/.claude/settings.json` 的 workflow hooks 能否触发须新会话确认**。Cindy 另以 SDK 程序化 hooks 限制子代理调用 `AskUserQuestion` 和 `mcp__cindy_helper__ask_user_question_async`，这不能代替 workflow 回调证据。
- Codex：Cindy 以 `codex app-server` 运行自带 `codex-package\0.159.2`，`getAuthEnv` 设置独立 `CODEX_HOME`（`Roaming\Cindy\codex-home`，或 `prepareCodexAccountHome` 生成的账号目录）。本机默认 Cindy home 的目录清单未见 `hooks.json`；账号目录尚未逐一检查。**默认 `~/.codex` 的安装不能代表 Cindy home 已注册（已证实配置位置不同），实际 hook 回调仍待软件内验收**。
- 委派入口一：Session task。工具名 `start_session_task`、`check_session_task`、`message_session_task`、`stop_session_task`，经元 MCP `cindy_helper` 的 `call_tool({name, args})` 间接调用（`createTaskActionAuthorizer` 按 `server==="cindy_helper"` + `TASK_ACTION_TOOLS` 判断）。`start_session_task` 参数：`instruction`（必填）、`title`、`working_dir`、`use_worktree`、`context_refs`、`timeout_ms`；**无 Agent 选择字段**。结果“returns automatically”，工具说明要求不轮询。
- 委派入口二：Orca 团队。MCP 服务器 `cindy_orca`，动作 `start_team`、`create_worker`、`create_workers`、`send_to_worker`、`interrupt_worker`、`idle_worker`、`end_team`、`archive_worker` 等；`create_worker` 参数含 `role`、`agent`、`model`、`initial_task`、`working_dir`、`new_worktree`。Worker 用 `mcp__orca_worker_bridge__send_to_lead` 回报。
- 宿主注入文本：`[Task delivery] Host bookkeeping, not a user message: …`、`[Task source] …`、`[Orca UI Assignment]`、`<task-notification>…`；Session task 完成与 Orca 回报到达 Lead 时的确切文本格式**未取得（unknown）**。
- 提问：`AskUserQuestion`（Claude）与 `mcp__cindy_helper__ask_user_question_async`。

### 2.4 workflow 现有实现

- `src/adapters/codeg.mjs` 只收拢 Codeg 工具名、结果解析和等待说明；`src/hooks.mjs` 的 `DELEGATION_TOOLS`/`DELEGATION_ENTRIES` 按工具名核对委派，`COMMAND_TOOLS` 只识别本插件 signal 命令，Bash 发起的 Herdr 委派完全绕过核对。
- `src/protocol.mjs` 的在途包等待说明只区分 Codeg 与内置子代理。
- `src/install.mjs` 每宿主一个 `defaultUserDir` 和一条安装记录（`state.installs.<agent>`），`install({userDir})` 已能写到其他目录，但第二个位置会覆盖第一条记录。
- 已知副作用（本次准备中发现）：PreToolUse 在未开工时拦下全部 `Agent` 调用，包括 `general-purpose` 只读调研；只读放行仅限 `Explore`/`Plan`。本计划不改此行为，只记录。

### 2.5 公开实现对照（2026-11-02）

- [Herdr TUI README](https://github.com/herdrdev/herdr/blob/ee5bfb5041bb3e4a49d591c72308aae3c81ecdde/README.md)：Herdr 管理既有 CLI 的终端，Agent 参数由原生 CLI 接收，不集中代选模型。
- [Herdr GUI README](https://github.com/herdrdev/herdr-app/blob/f896da489de594fdb18a92a31dd953da3cf58da2/README.md)：窗口负责布局，独立 herdr-core 负责程序运行；不能复用 TUI 的控制命令。
- [Cindy start_team](https://github.com/makecindy/cindy/blob/1ee67bc4b5b7be74cd93afc9ac287da5270286f7/packages/lizi-mcps/src/xdt-helper/start_team.ts)：当前公开实现只开启团队，不直接创建 Worker；[create_workers](https://github.com/makecindy/cindy/blob/1ee67bc4b5b7be74cd93afc9ac287da5270286f7/packages/lizi-mcps/src/xdt-helper/create_workers.ts) 批量承载各项 Agent 与 initial_task，必须逐项核对。
- [Cindy 后台任务模型规则](https://github.com/makecindy/cindy/blob/4e1b73dce924704c86a79481378f8741cfeb05f9/docs/product-rules/cindy-bots-runtime.md)：当前公开版本支持 `model_selection` 路由，且默认可由伙伴任务配置决定，**不能假设与 Lead 同 Agent**。本机打包 commit `0a7d5a4` 与公开版本不同，实施时区分 schema；无可靠 Agent 映射时保守拒绝受控派工并给可用替代入口。
- [Cindy Codex 网关配置](https://github.com/makecindy/cindy/blob/1ee67bc4b5b7be74cd93afc9ac287da5270286f7/apps/desktop/src/main/maker-host/codex-gateway-config.ts)：启动启用 `code_mode_only`；嵌套 MCP 调用能否被外层 PreToolUse 观察仍待实际软件验证，不把直接工具合成输入当作该路径已覆盖。

## 3. 技术方案

保持“一套公共规则 + 各软件适配文件”的结构：新增 `src/adapters/herdr.mjs`、`src/adapters/cindy.mjs`，与 `codeg.mjs` 平级；公共 hook 只消费适配结果。

### 3.1 委派识别（PreToolUse）

把“委派入口”从“工具名”扩展为“适配器解析出的委派描述”：`{ entry, channelPrefix, agent, text, packageMarkers }`。

| 软件 | 识别条件 | 任务文本 | Agent 来源 | 通道 |
| --- | --- | --- | --- | --- |
| Herdr TUI | Bash/PowerShell 命令是单条直接调用 `herdr agent start …` 或 `herdr agent prompt <t> <text>`（`herdr`/`herdr.exe`/`$HERDR_BIN_PATH` 全路径） | `prompt` 的 text | `start` 的 `--kind`；`prompt` 无 Agent，按通道尾部核对 | `herdr:<kind>` |
| Herdr GUI | 单条直接调用 `hc run …` 且带 `--bg`、首个位置参数为 Agent 程序或模板；或 `hc send <t> <text>` | `run` 的任务参数、`send` 的 text | `run` 的程序名（claude/codex/pi…）；模板名无法映射 Agent，要求通道写 `hc:template:<name>` 精确匹配 | `hc:<agent>` |
| Cindy Session | `mcp__cindy_helper__call_tool` 且 `name` 为 `start_session_task`/`message_session_task` | `args.instruction` / `args.message` 与 `args.title` | 无可靠映射（本机版无字段，公开版 `model_selection` 由 Cindy 路由）：开工后带包标记的受控派工一律拒绝，提示改用 Orca（D1，用户 2026-11-02 决定）；未开工时照常拦截实施委派 | — |
| Cindy Orca | `mcp__cindy_orca__create_worker`/`create_workers`/`send_to_worker` | `initial_task` / `message` | `create_worker.agent` | `cindy:orca:<agent>` |

规则与 Codeg 一致：未开工拒绝实施委派；开工后要求任务文本首行 `workflow-package:<id>`（或结构化 `packageId`），包须 dispatched、依赖已终态、通道前缀匹配、Agent 与准备记录和通道尾部一致。命令中出现这些子命令但不是单条直接调用（含 `&&`、`;`、管道、变量赋值）时，在已接入且有会话的项目里拒绝并提示改为单条调用——不解析复合 shell。`herdr agent start`/`hc run` 不带任务时（纯启动）只做未开工拦截，不要求包标记；任务送达时再核对。只读命令（`herdr agent list/get/read/wait`、`hc ls/get/read/wait`、`check_session_task`）不拦。

### 3.2 等待说明（protocol.mjs）

按在途包通道给出各自等待方法，替换现有“Codeg 或内置”二分：

- `herdr:`：不会唤醒父会话；同一回合用 `herdr agent wait <name>` 或 `prompt --wait` 阻塞等待，超时后先 `agent get/read` 再决定，不盲目重发。
- `hc:`：子会话汇报会以 `<hc from=…>` 唤醒本会话；可以结束回合，或 `hc wait --children any` 阻塞；超时只是 check-in。
- `cindy:`：结果自动送回，不轮询；只在用户问进度或疑似丢失时调用一次 `check_session_task`。

### 3.3 宿主消息识别（UserPromptSubmit）

仅当 prompt 去掉前导空白后**以固定开头**出现时识别：`<hc from="`、`[Task delivery] Host bookkeeping`、Cindy 的 Session task/Orca 回报格式（实测拿到后补列；未拿到前不猜）。识别后：

- 仍开新回合和票据（宿主身份规则不变）；
- 上一回合是 `waiting-user` 时保留该 phase，不算用户回答，不撤销在途包；
- 入口上下文追加：“这是 <软件> 的子会话/宿主消息，不是用户指令；核对实际交付后再记 consumed。”

Claude Code 原生 `<task-notification>` 不在本轮改动范围（已有内置子代理流程）。

### 3.4 安装器多位置（install.mjs）

- `install --agent codex --user-dir <dir>` 已有入口保留；新增按配置文件路径区分的附加记录 `installs.codex.extra[<configFile>]`（旧单条记录保持兼容，仍是默认 `~/.codex` 的权威记录）。
- `doctor`、`uninstall` 支持 `--user-dir`，只处理对应位置；无参数时列出所有已登记位置。
- 合并与撤销沿用现有“只改自身条目、保留其他 hooks”的事务；Cindy 目录必须由用户显式传入，不自动扫描 `Roaming\Cindy`。
- 不自动修改 Cindy 的 `config.toml`；Codex 0.159.2 是否需要 feature 开关、Cindy 升级/切换账号是否重建目录覆盖 hooks.json，列为人工验收。

### 3.5 假设与风险

- 原 A1（Session task 与 Lead 同 Agent）已撤销：2.5 节公开实现表明 Agent 可由 `model_selection` 或伙伴配置决定。D1（用户 2026-11-02 决定“先只允许 orca 派工”）：Session task 不作为受控派工通道，工作包派工只认 Orca；Session task 的识别仍用于未开工拦截和拒绝提示。
- A2：Herdr GUI 中启动的 Claude/Codex 会读用户级 hooks。
- A3：Cindy 的 Claude 未设置 `CLAUDE_CONFIG_DIR` 时读 `~/.claude/settings.json`；Cindy 的 Codex 0.159.2 在 app-server 模式执行 hooks.json。
- 风险：命令识别只覆盖单条直接调用；用户自写脚本包一层仍可绕过，文档如实说明“这是提醒式门禁，不是沙箱”。

## 4. 实施安排

建议分流：`delegated`。三个实施包、三个审查包。

| 包 | 角色 | 范围 | 完成后可验证行为 | 依赖 |
| --- | --- | --- | --- | --- |
| W1 | worker | 新增 `src/adapters/herdr.mjs`；`src/hooks.mjs` 委派描述抽象、命令识别、宿主消息识别框架；`src/protocol.mjs` 按通道等待说明；`test/adapters.test.mjs`、`test/hooks.test.mjs`、`test/channels.test.mjs` 相应用例；`docs/adapters/herdr.md`；`docs/workflow.md` 适配入口一句 | 合成 hook 输入下：未开工的 `herdr agent prompt`/`hc run --bg claude "…"` 被拒；开工后缺包标记、通道或 Agent 不符被拒，正确时放行；`<hc from=…>` 回合保留 waiting-user；在途 `herdr:`/`hc:` 包得到各自等待说明 | 无 |
| W2 | worker | 新增 `src/adapters/cindy.mjs`；在 W1 抽象上接入 Session task 与 Orca 识别、Cindy 提问工具、Cindy 宿主消息；对应测试；`docs/adapters/cindy.md` | 合成输入下：`call_tool{name:start_session_task}` 与 `cindy_orca__create_worker` 按 3.1 核对；`ask_user_question_async` 记 waiting-user；`[Task delivery]` 回合不覆盖 waiting-user | W1（同改 `hooks.mjs`，必须串行） |
| W3 | worker | `src/install.mjs` 多位置记录、`bin/workflow.mjs` 参数、`test/install.test.mjs`；`docs/usage.md` 安装章节；`.spec/install-onboard/spec.md` | 临时目录中对两个 Codex 目录分别 install/doctor/uninstall，互不覆盖、只撤自身条目，旧单条记录兼容 | 无（与 W1 并行） |
| R1 | reviewer | 只读审查 W1 最终交付 | PASS/FIX/BLOCKED 结论 | W1 |
| R2 | reviewer | 只读审查 W2 最终交付 | 同上 | W2 |
| R3 | reviewer | 只读审查 W3 最终交付 | 同上 | W3 |

执行顺序：W1 与 W3 并行（文件无交集）；R1 在 W1 交付后；W2 在 W1 交付后开始（与 R1 可并行，R1 若要求返修 W1，W2 基于返修后版本复核）；R2、R3 各随其实施包。全部 PASS 后 Lead 集成，回写 `docs/acceptance.md`、`.spec/task-protocol/spec.md` 和本计划进度，跑 `npm run verify`。

验证入口：各包定向 `node --test test/<file>.test.mjs`；集成后 `npm run verify`。

### 4.1 开工前提

开工须先由用户确定逐包 Agent/model/effort 与 D1。用户 2026-11-02 原话：“Worker 一律是 group/worker high；reviewer 一律是 gpt6.1terra high；先只允许orca派工吧；开工”。实施中用户改为：“重启 r3 所有r都换成 model reviwer effort high”；其后又改为：“改用 --model "group/worker[1m]"”（自 W2 起生效，在途 W1、W3b 不重启）。

### 4.2 逐包 Agent、model、effort（已确认）

启动时通过原生参数固定，不沿用 CLI 现有默认：Claude 为 `herdr agent start <名> --kind claude --pane <id> -- --model "group/worker[1m]" --effort high`（W1、W3、W3b 启动时漏写 `[1m]`，按 `group/worker` 运行），Codex 为 `--kind codex ... -- -m group/reviewer -c model_reasoning_effort="high"`（模型 ID 取本机 `~/.codex/config.toml` 的写法）。

| 包 | 次序 | Agent | model | effort | 实际调用通道 |
| --- | --- | --- | --- | --- | --- |
| W1 | 第 1 批 | Claude Code | `group/worker` | high | `herdr:claude` |
| W3 | 第 1 批 | Claude Code | `group/worker` | high | `herdr:claude` |
| R3 | W3 交付后 | Codex | `group/reviewer` | high | `herdr:codex` |
| R1 | W1 交付后 | Codex | `group/reviewer` | high | `herdr:codex` |
| W2 | W1 交付后 | Claude Code | `group/worker[1m]` | high | `herdr:claude` |
| R2 | W2 交付后 | Codex | `group/reviewer` | high | `herdr:codex` |
| W3b | R3 后返修（替代 W3） | Claude Code | `group/worker` | high | `herdr:claude` |
| R3b | W3b 交付后 | Codex | `group/reviewer` | high | `herdr:codex` |
| W4 | R1/R2/R3b 均 PASS 后 | Claude Code | `group/worker[1m]` | high | `herdr:claude` |
| R4 | W4 交付后 | Codex | `group/reviewer` | high | `herdr:codex` |
| W5 | W4 verify 失败后返修 | Claude Code | `group/worker[1m]` | high | `herdr:claude` |
| R5 | W5 交付后 | Codex | `group/reviewer` | high | `herdr:codex` |

W3b 范围同 W3：默认位置按规范化后的默认 `~/.codex` 配置路径识别，不再“第一个安装的位置即权威”；补“先装附加目录、后装默认目录”的测试；同步 `docs/usage.md`、`.spec/install-onboard/spec.md` 的权威记录描述。W3b 首轮交付后范围补入 `src/onboard.mjs`、`test/onboard.test.mjs`：onboard 安装检查须同时认默认记录与附加位置，只有附加位置时不得报“没有任何宿主安装”。

W2 范围随 D1 收窄：Orca 派工核对（`create_worker`、`create_workers` 逐项、`send_to_worker`）、Session task 拒绝提示、Cindy 提问工具与宿主消息。

W4 为集成文档同步（原计划由 Lead 自做，用户 2026-11-02 纠正“lead只是派发和最后集成”后改为 Worker 包，Agent 按“所有worker都沿用”）：同步 `.spec/task-protocol/spec.md`、`docs/acceptance.md`、`docs/plans/README.md`，运行 `npm run verify` 并如实回报结果；只改文档，代码问题只回报不修。Lead 只做合并、最终验收与收尾。

W5 修 W4 全量验证发现的问题：`docs/adapters/cindy.md`、`docs/adapters/herdr.md` 中指向 `CLAUDE.md` 与 `docs/plans` 的发布断链；`examples/demo.mjs` 无参数 uninstall 与 W3b 附加位置语义不符；`.spec/learning-knowledge/spec.md` 的 spec check 漂移。修后重跑 `npm run verify`。

### 4.4 工作区

误开工遗留代码的处置用户尚未决定，Lead 不替用户选择暂存或保留。为不触碰遗留改动，本轮在独立 worktree 实施：`<worktree:workflow-herdr-cindy>`，分支 `feat/herdr-cindy-impl`，基于计划基线提交（`c9c57eb` 加本计划文件）。W1、W3 共用该 worktree，文件不重叠；Lead 按包分别提交，用提交 OID 作为交付与审查引用。

### 4.3 等待方式

Herdr 子 Agent 结束不会唤醒主会话，主会话必须**阻塞等待**，不轮询：

- 派发用 `herdr agent prompt <名> "<任务>" --wait`，不带 `--timeout`，以 Claude Code 后台命令运行：Herdr 侧无限期等待，命令在 Agent 停下时退出，宿主自动通知主会话；不用 `sleep`/`agent get` 循环。前台单次调用受 Claude Code 10 分钟上限约束，不再采用；
- 等待返回后先 `agent read` 或读取约定的回报文件，再决定；不重发任务；
- 返回 `blocked`：读 `agent read` 后把审批或提问原样交用户，结束本回合；
- 并行的两个包按“先等先交付概率高的那个，返回后再等另一个”的顺序依次阻塞等待。

本会话的 hooks 运行的是已安装的 0.8.1 发布副本，不识别 `herdr` 委派命令；本轮所有派发由 Lead 按本计划人工核对包标记与通道。新门禁要在重新安装后的新会话里才生效（即人工验收 M1），不能把本轮派发顺利说成门禁已验证。

## 5. 需求与验收

| ID | 需求 | 负责包 | 检查入口 |
| --- | --- | --- | --- |
| H1 | Herdr TUI 委派受工作包核对 | W1 | `node --test test/hooks.test.mjs test/adapters.test.mjs`；人工 M1 |
| H2 | Herdr GUI（hc）委派受工作包核对 | W1 | 同上；人工 M2 |
| H3 | hc 子会话汇报不被当作用户回合 | W1 | `node --test test/hooks.test.mjs`；人工 M2 |
| H4 | 在途包按通道给出正确等待方法 | W1 | `node --test test/channels.test.mjs` |
| C1 | Cindy Orca 委派受工作包核对；Session task 受控派工被拒并提示改用 Orca | W2 | `node --test test/hooks.test.mjs test/adapters.test.mjs`；人工 M3/M4 |
| C2 | Cindy 提问工具与宿主消息正确识别 | W2 | 同上；人工 M3 |
| C3 | Cindy 的 Codex 能装上并检出 workflow hooks | W3 | `node --test test/install.test.mjs`；人工 M4 |

## 6. 人工验收步骤（交给用户）

每项记录：日期、软件版本、观察结果；未做即保持“人工待验”。

- **M1 Herdr TUI**：在 Herdr TUI 打开本仓 Claude Code 会话 → 看到 workflow 入口上下文 → 未开工时让它执行 `herdr agent prompt x "hi"`，应被 workflow 拒绝 → 开一个小任务、登记 `herdr:codex` 包后在 sibling pane `agent start --kind codex`，`agent prompt` 首行带 `workflow-package:<id>` 应放行，去掉首行应被拒。
- **M2 Herdr GUI**：在 herdr-app 新开终端运行 Claude Code → 看到 workflow 入口（验证 A2）→ 在已登记 `hc:claude` 包后 `hc run --bg --name t claude "workflow-package:<id>\n…"` 放行 → 子 Agent `hc send` 回报后，父会话收到 `<hc from=…>`，若此前在等用户回答，`task show`/入口仍显示 waiting-user。
- **M3 Cindy · Claude**：在 Cindy 打开本仓 Claude 会话 → 看到 workflow 入口（验证 A3 前半）→ 未开工时请它 start_session_task，应被拒 → 开工后带包标记派 Session task，应被拒并提示改用 Orca → 经 Orca `create_worker` 带包标记派一次，Agent 与准备记录一致时放行；记录 Orca 回报到达 Lead 时的原文开头（补齐 3.3 格式）。
- **M4 Cindy · Codex**：运行 `node bin/workflow.mjs install --agent codex --user-dir "$env:APPDATA\Cindy\codex-home"` 与 `doctor --agent codex --user-dir …` → 在 Cindy 新开 Codex 会话，看到 workflow 入口（验证 A3 后半）→ 重启 Cindy、切换一次账号后再 doctor，确认 hooks.json 未被覆盖；账号目录需要时同样安装。

## 7. spec 影响

- `.spec/task-protocol/spec.md`：委派入口新增 Herdr/hc/Cindy 命令与工具识别、通道前缀 `herdr:`、`hc:`、`cindy:`；宿主消息回合保留 waiting-user。
- `.spec/install-onboard/spec.md`：Codex 附加配置目录的安装、诊断与撤销。

## 8. 进度

- 2026-11-02（误开工记录）：用户已逐包指定 Agent 与通道（第 4 节）；Lead 错将该选择及 `prepare.ready` 当成开工授权，执行 `task-start` 并派出 W1、W3（pane `w2:p7`、`w2:p8`）。这不构成用户批准。用户明确纠正后，Lead 已向两个会话发送中断与停止指令，取消两包，将任务权限收缩为仅可编辑本计划；W1 已明确确认停止，W3 停止指令返回后其 Agent 与 pane 已不可查询。已有代码保留，未继续实施或提交。下一步只按三阶段核对计划，不自动恢复派工。
- 2026-11-02：计划由 `plan.md` 改名为本文件；撤销原 A1，新增待决 D1；第 4 节补开工前提、逐包 model/effort 与阻塞等待规则，准备记录改为未就绪。误开工遗留改动（未运行测试、未审查）：`src/adapters/herdr.mjs`（新增）、`src/hooks.mjs`、`src/protocol.mjs`、`test/adapters.test.mjs`、`test/channels.test.mjs`、`test/hooks.test.mjs`（W1），`src/install.mjs`（W3）。Lead 建议用 `git stash push -m "误开工遗留" -- <上述路径>` 暂存，从 `c9c57eb` 干净开工；待用户决定。
- 2026-11-02：用户确认 Worker 一律 Claude Code `group/worker` high、Reviewer 一律 Codex `gpt-6.1-terra` high、D1 只允许 Orca 派工，并明确“开工”。遗留代码未获处置决定，按 4.4 改在独立 worktree 实施，遗留改动原样保留。
- 2026-11-02（实施中）：W3 交付提交 `7ceac7e`（install 定向 23/23 通过）。首个 R3 以 `gpt-6.1-terra` 运行并写出 FIX 结论后，用户要求重启 R3、所有 Reviewer 改用 `group/reviewer` high；旧结论改名保留为 `review-R3-terra-superseded.md`，不计为正式审查。W1 因上下文反复溢出（自动压缩连续 3 次失效）未完成测试与文档，改为清空会话后按续作说明继续。等待方式改为后台无超时等待（见 4.3）。
- 2026-11-02（实施中）：R3（`group/reviewer`）判 W3 PASS；Lead 核对 `src/install.mjs:240` 确认空状态下首个安装位置被登记为权威（旧 R3 第 1 条），R3 漏判。用户选择开返修包 W3b（替代 W3）与复审 R3b，Agent/model 同原角色。
- 2026-11-02（实施中）：R1（`group/reviewer`）判 W1 PASS。W2 的 `[1m]` 准备更新此前因引用尚未登记的 W3b/R3b 被拒，改为先只更新 W2，W3b/R3b 待 W3b 终态后补登；W2 随后登记派发。W3b 首轮交付 install 26/26 通过，但 Lead 复跑 `test/onboard.test.mjs` 9 条失败：onboard 只读默认记录，测试与只有附加位置的用户都会被误报未安装。W3b 范围补入 onboard，由同一 Worker 续作。
- 2026-11-02：补充公开 GitHub 对照并收紧早期推断：Cindy 账号目录注册未知、Session task 不保证与 Lead 同 Agent、Cindy Codex code mode 的嵌套 MCP hook 可观测性仍待验证。实现须保守处理无法核实身份的入口。
- 2026-11-02（集成完成）：W3b 补入 onboard 后交付 `640b155`，R3b 判 PASS（install 26/26、onboard 20/20、adapters+hooks 64/64）；W2 交付 `fc044cb`，R2 判 PASS；W4 同步 spec、验收文档与计划索引并提交 `5642aa6`，R4 判 PASS @ `5642aa6`；W5 修复发布文档链接、`examples/demo.mjs` 卸载 `--user-dir` 与 `.spec/learning-knowledge/spec.md` 边界说明并提交 `736c311`，R5 判 PASS @ `736c311`，全量 `npm run verify` 通过（tests 453 / pass 450 / fail 0 / skipped 3），`spec check` 0 finding。真实软件实测项 M1–M4 交用户人工待验。

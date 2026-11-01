# 另一台电脑的验收交接

本阶段完成代码、隔离自动化验证和仓库推送。真实宿主接入、模型调用、Windows 定时运行与实际项目试点留在另一台电脑；以下项目尚不能视为通过。

## 1. 拉取与准备

在 workflow 仓库执行，已有改动先保留，拉取冲突不要强制覆盖：

```powershell
git pull --ff-only
node --version
node --test test/*.test.mjs
node scripts/check-package.mjs
```

需要 Windows、Node.js 24+，以及已配置并能使用目标模型的 Codex CLI。前台可以用 Codex 或 Claude Code。确认目标电脑执行器的 `codex exec --help`、`codex features list`；支持性以 `learning doctor` 的实测结果为准。

## 2. 安装与选择一个试点项目

下面用 PowerShell 变量固定位置，替换项目路径；状态目录沿用该电脑已有安装，不要无意创建第二份状态：

```powershell
$workflowState = Join-Path $env:LOCALAPPDATA 'workflow'
$pilotRoot = 'D:/待试点项目'
node bin/workflow.mjs install --agent codex --state-dir $workflowState
node bin/workflow.mjs doctor --agent codex --state-dir $workflowState
node bin/workflow.mjs project enable --root $pilotRoot --state-dir $workflowState
```

使用 Claude Code 时安装参数改为 `--agent claude`。核对宿主 `/hooks` 发现和信任状态，打开试点项目的新会话确认真实回调。`doctor` 中配置存在、回调观测、宿主实际执行是不同证据，不能互相替代。

首次修改状态会保存 v1 原文备份。旧候选在 `learning enable` 时幂等导入；旧 `applied` 只能证明写入过，不算已验证经验。旧中断任务应为 `suspended`，旧会话不应挡住升级。

## 3. 设置参数，再做无模型检查

按[配置说明](learning.md#配置)准备 `learning-config.json`，自行决定阈值、频率、最长时间、模型和 profile：

```powershell
node bin/workflow.mjs learning config set --root $pilotRoot --state-dir $workflowState --input learning-config.json
node bin/workflow.mjs learning config get --root $pilotRoot --state-dir $workflowState
node bin/workflow.mjs learning doctor --root $pilotRoot --state-dir $workflowState
node bin/workflow.mjs learning schedule preview --root $pilotRoot --state-dir $workflowState
```

核对有效配置及来源、固定状态路径、期望模型/继承关系、隔离能力。这里不触发模型调用，也不注册系统任务；任何失败保留输出中的错误码，不靠放宽隔离继续。

## 4. 开始真实试点

```powershell
node bin/workflow.mjs learning enable --root $pilotRoot --state-dir $workflowState
node bin/workflow.mjs learning schedule install --root $pilotRoot --state-dir $workflowState
node bin/workflow.mjs learning status --root $pilotRoot --state-dir $workflowState
```

至少观察 5 个真实业务任务、跨 2 个日期、一次真实复盘。日期跨度是观察窗口，不要求为了验收造经验。可在材料已落盘、业务结束后用 `learning review --now` 提前做一次真实复盘；仍遵守每日额度。

| 场景 | 验收要看到的结果 |
| --- | --- |
| 普通任务无新材料 | 直接交付；Stop 不要求额外复盘、不强制凑经验 |
| 达阈值前结束会话 | 例如 9 份关闭会话，再开新会话仍见 9 份；数量不足时由年龄触发 |
| 修改配置 | 阈值、频率、最长时间与模型选择来自有效配置，下一次运行采用新值 |
| 已验证方法反复成立 | 事件、日期、证据可核对；重复摘要与 adopted 不增加成熟度 |
| 用户明确纠正旧经验 | 指定知识立即不再默认召回，复盘后保留修订原因与旧证据 |
| 手动提高重要性 | 相关任务排序变化，成熟度不跟着提高；无关任务不强行注入 |
| 用户旧偏好被明确替代 | 保存新偏好与替代依据；旧偏好停止召回 |
| 模型超时或输出失败 | 材料仍 pending，已启动次数计入当天额度，无循环重试 |
| 写入时用户编辑 | 保留用户文件，待恢复；不把半批结果投入召回 |
| 活动/只读/计划任务 | 后台写入延期；不干扰业务 |
| 下次会话使用经验 | `explain` 能说明选中和排除原因；重要修订通知只出现一次 |
| 重启与重新登录 | 系统任务存在、固定入口有效，检查恢复且不会并发复盘 |

## 5. 记录结果与问题

记录所用 Git 提交、Node/CLI 版本、宿主类型、有效配置、真实运行 ID、状态、耗时和可获取的 usage。缺失用量记未知，token 不等于账单。重点看是否减少重复犯错、是否漏召回相关经验、是否打断工作。

出错时保留原始材料和运行记录，给出触发步骤、期望、实际结果及错误码；不要传凭据、登录配置或整个聊天历史。先停止维护：

```powershell
node bin/workflow.mjs learning disable --root $pilotRoot --state-dir $workflowState
node bin/workflow.mjs learning schedule remove --root $pilotRoot --state-dir $workflowState
```

有完整提案的中断运行可用 `learning recover --run <ID>` 恢复，不再调用模型。外部编辑冲突需先核对文件与保存提案，再用 `learning resolve --run <ID> --keep|--discard` 决定保留还是作废；只有本运行的知识文件均未偏离写入前快照时才能作废。不要对同一冲突反复执行 `recover`。不要删除 inbox、state 或快照来“修好”状态。

验收后再决定是否扩大项目范围、调整默认参数或发布新版本。当前本机材料不自动跨电脑同步，换电脑仍需各自建立绑定；Git 只携带项目配置与正式知识。

## 6. 0.3.0 真实宿主验收

本节验证分流、账本、门禁、角色声明和提问路径。合成测试已覆盖机械行为，以下每项结论分别标注“自动验证 / 真实宿主验证 / 未知”。Claude Code 与 Codex 各作一次 Lead。

先补齐[Codeg 能力表](adapters/codeg.md#宿主能力表)与[Claude 能力表](adapters/claude.md#宿主能力表)中的 unknown 格：用临时 hook 落盘脚本（仅本机、事后删除）记录 `hook_event_name`、`agent_id`、`agent_type`、`tool_name`、`permission_mode`。

| 场景 | 通过条件 |
| --- | --- |
| Codex spawn_agent 子代理 | 子线程事件带 `agent_id`；插件不开回合，状态不变 |
| Codeg 委派子会话 | 子会话发 `role-claim` 后入口注入 Worker/Reviewer 上下文 |
| 提问置 waiting-user | Codex 原生、Codex 经 Codeg MCP、Claude `AskUserQuestion`、Claude 经 Codeg MCP 四种组合分别记录 PostToolUse 原文 `tool_name`，确认 phase=waiting-user |
| Codex Plan / Default | 分别记录 hook 上报的 `permission_mode`；Default 且 flag 关闭时通过 Codeg MCP 或文本提问完成一次首次对齐，含跨回合 decide |
| Claude ACP | 在 Codeg 的 Claude ACP 中确认 default 模式能否调用 `AskUserQuestion` |
| 压缩 | 压缩后 compact SessionStart 上下文含 `ledger`，Lead 不重复派工、不重读 consumed 结果 |
| 门禁 | delegated 任务缺审查或验证时 task-end 返回 GATE 与 missing；显式 waivers 后接受 |

2026-10-23 Codex CLI 0.163.0 隔离探针已完成（真实宿主验证）：spawn_agent 子代理事件带 `agent_id`，装入本插件后状态只留父会话；原生提问 `tool_name=request_user_input`，Codeg 同名 MCP 为 `mcp__codeg_mcp__ask_user_question`，两者 PostToolUse 均触发；`permission_mode` 只反映审批策略，Plan 协作模式也报 `default`。详见 [Codex 能力表](adapters/codex.md#宿主能力表)。Codeg 委派探针（2026-10-23，临时项目）：Claude 子会话收到 Lead 入口上下文并被计入 Lead 列表，发 `role-claim` 后移出（真实宿主验证）；Codeg Claude ACP 下 Lead 没有 `AskUserQuestion`，只能用 Codeg MCP 提问；Codex 子会话同样收到 Lead 上下文，`role-claim`（`--base64`）回执 accepted，状态中 role=reviewer、leadSessions 为空（真实宿主验证）；该子会话需自行查文档拼出 signal 命令，Lead 上下文已补充命令格式。Claude auto 模式分类器（2026-10-23，真实宿主验证）：CLI 与 Codeg Claude ACP 下 signal（base64/文件两种）、knowledge capture、align scan/apply 均未被拦；发现模型自发写成 `cd … && node … signal` 时信号被静默丢弃，已改为回执提示单独直接调用。门禁与账本提示（2026-10-23，Claude Code 2.1.293 `claude -p` auto，真实宿主验证）：delegated 任务缺审查与验证时 task-end 返回 `GATE`，missing 为 `review:w1`、`validation`，被拒后 revision 不前进；补 validation 与 waiver 后接受。替身 `codeg-mcp` 返回 Codeg 同构的 `{tasks:[…]}` 文本时，PostToolUse 给出“已终态移出”和“已结束未记账”两类提示。压缩与续接：`/compact` 后 compact SessionStart 正常触发；`claude -p` 每次结束都发 SessionEnd，任务被挂起，旧版入口只给 active 任务附账本，续接会话看不到 ledger。已改为挂起任务也附账本（标 lifecycle）；重装后复测通过：真实 `/compact` 加续接后入口含 `{"lifecycle":"suspended","route":"delegated","packages":["w1 worker consumed ref1 - 0","w2 worker dispatched - - 0"]}`，Lead 判断沿用原 taskId 续接、只等 w2，不重读 w1。同一交互会话内不经 SessionEnd 的压缩未实测。收益对照仍须实跑。

收益对照：小修改、可拆分功能、强依赖修改三类任务，各在“Lead 直做”和“分工流程”下跑一次，记录交付是否通过、返工次数、Lead 重复读取的结果数和端到端耗时；token 只记可获取数据，不当账单。结果决定下一轮是否值得扩展账本字段，本节不预设。

### 剩余验收（2026-10-23 交接）

代码与上述记录已在 main（a4905d1）。另一台电脑按第 1、2 节拉取并 `install --agent claude`、`install --agent codex` 后继续以下几项，三项都要求 Lead 是顶层会话，Codeg 委派出的会话不能再委派：

1. Codeg 顶层会话的真实委派：确认 hook 收到的 `get_delegation_status` 原文结构和两类账本提示。
2. Codex 作为 Lead：走一次门禁（GATE 与 waivers）和一次提问。
3. Codex Default 模式（`default_mode_request_user_input` 关闭）下完成一次首次对齐，含跨回合 decide。
4. 同一交互会话内、不经 SessionEnd 的压缩。
5. 收益对照（已取消，见本节末）。

2026-10-23 复测（Codeg 顶层 Codex 会话，Codex CLI 0.164.0，临时仓库 workflow-probe，真实宿主验证）：第 1、2 项通过。Lead 发 task-start（rev 2）后用 `delegate_to_agent` 派 Codex Worker，Worker `role-claim` 被接受，状态中 role=worker，owner 与 leadSessions 仍只有 Lead。`get_delegation_status` 的两类提示原文：w1 完成时为“包 w1 的委派已结束：读取结果后在下一次 packages 中记为 delivered/consumed。”；记为 consumed 后再查为“等待集合含账本已终态的包（w1）：下次查询移出这些 task_id，不重读结果。”。原生 `request_user_input` 提问两次；不派审查直接 task-end 返回 GATE，missing 为 `review:w1`、`validation`，revision 不前进；补 validation 与 review waiver 后接受（rev 9，lifecycle=complete）。会话 `permission_mode=default`，但本机 `default_mode_request_user_input=true`，不算第 3 项。发现：Lead 第一次提问未说明审查是 delegated 路线的固定要求，用户需追问一次；Lead 还在提问前手动发了 `phase=waiting-user`，PostToolUse 也会置该状态，二者重复但无害。

同日后台复盘隔离适配 Codex 0.164：`features list` 不再接受 `--profile`；`unified_exec` 只能由托管 requirements 关闭，用户 `-c` 后仍报 true，但抓取实际请求确认 `shell_tool=false` 时已无 `exec_command`/`write_stdin`，不再以该开关判定；`multi_agent=false` 不再移除 `spawn_agent` 等工具，需加 `agents.enabled=false`。修正后 `learning doctor` 为 `capabilities-verified`，实际请求只剩 `request_user_input`。

同日第 4 项通过（Codeg Claude ACP 顶层会话，permission_mode=auto，真实宿主验证）：task-start 与 packages 后在同一会话 `/compact`，全程无 SessionEnd 观测；`SessionStart:compact` 入口含 `{"lifecycle":"active","route":"delegated","packages":["w1 worker consumed ref1 - 0","w2 worker dispatched - - 0"]}`，Lead 判断不重派、不重读 w1。入口与每次 UserPromptSubmit 都会推进 revision（回执 3，压缩后入口 4、5、6），Lead 应以最新入口的 `expectedRevision` 为准。收尾时 delegated 任务因 w2 未交付，以 `terminal:w2`、`review`、`validation` 三条 waiver 结束（rev 8，lifecycle=complete）。

第 3 项首次尝试未完成（Codeg Codex ACP 0.160.1，flag 已关）：该会话首回合 SessionStart、UserPromptSubmit 均未进入任何 hook（workflow、文档学习都没有注入，状态无该会话），同会话后续 Stop 被记录。根因（经 ACP 版 `codex app-server` 的 `hooks/list` 核实）：Codex 的 hook 信任键按“事件:分组序号”编号，重装时 install 先删除自有分组再追加到末尾，与文档学习插件对调了序号，两边的 SessionStart、UserPromptSubmit、PostToolUse、SessionEnd 都变成 `trust=modified` 而不执行。在 `/hooks` 重新信任后恢复；install 已改为重装时把自有分组放回原序号。Lead 发现 identity 为 null 后停下报告，没有绕过插件手写文件，行为符合预期。另：仓库无 `docs/` 时 scan 按设计登记根目录 `WORKFLOW-ALIGNMENT.md`。

同日第 3 项通过（重新信任后的新会话，Codeg Codex ACP 0.160.1，`permission_mode=default`，flag 关闭，真实宿主验证）：入口 identity 非空；scan 后发 waiting-user，用文本编号问题提问 3 条，没有调用提问工具；用户在下一回合答“1A 2A 3A”，Lead 依次 `project owner`、`apply`、D1/D2 `decide`（均 recorded），status 为 `pendingDecisions: 0`，随后 task-end 被接受，任务 complete。发现：① `decide` 写“## 已裁决记录”这类末节时越过管理区结束标记、把记录追加到文件末尾，且不清理“- 暂无”占位，已修复并补测试；② 旧 Lead 会话留在 leadSessions 中时 owner 为空，首次 apply 返回 `OWNER`，需先 `project owner`，属设计行为但增加首次对齐的步骤；③ Lead 在 `.local/` 写输入 JSON 会让 status 报 `stale`（`directoryChanged: [".local"]`），不影响对齐结论。验收结束后已把 flag 恢复为 true。

1、2 可在 Codeg 里用 Codex 开顶层会话、选一个已接入的临时仓库，粘贴：

```text
你是这个仓库的 Lead（已启用 workflow 插件）。这是一次插件验收，请按协议真实走一遍分工流程。规则：每条插件命令都单独直接执行，不加 cd、&&、; 或管道；JSON 先写到 .local/ 下，再用 `signal --input <文件>` 发送；每次发送都用最新入口里的 expectedRevision（每次用户发言都会推进 revision，不要沿用上一条回执的值）。

业务：在 README.md 末尾加一行 "Codex lead probe."
1. task-start：route=delegated，allowedPaths ["README.md"]，taskId 自己定。
2. 用 delegate_to_agent 派一个 Worker（packageId=w1），让它加这一行、不提交，并让它先发 role-claim。
3. 立刻发 packages：w1 role=worker status=dispatched handle=<返回的 task_id>。
4. 用 get_delegation_status 等 w1 完成，把每次调用后的 "workflow 提示" 原文记下来。
5. 核对 git diff，然后发 packages：w1 status=consumed，deliveredRef 取 `git hash-object README.md` 的结果。
6. 再查一次 get_delegation_status（task_ids 里仍包含 w1），记下提示。
7. 先用提问工具问我一个问题：“是否跳过审查？”，等我回答。
8. 不派审查，直接发 task-end，记下 GATE 回执；再加上 validation 和 waivers 重发一次 task-end。
最后列一张表：步骤 | 命令 | 回执或提示原文（ticket 只保留前 4 个字符）。
```

2026-10-23 结论：第 1~4 项通过；第 5 项收益对照经用户决定取消，不作为发布条件。据此发布 0.3.0。`docs/research/` 的调研报告按约定不入库，需要时手动拷贝。

## 7. 0.5.0 真实宿主验收

2026-10-25，本机从 0.4.1 升级到 0.5.0（0.4.2 已提交但本机未安装），安装前备份了状态和两个宿主的配置。两个模拟仓库从同一初始提交建立并接入：`drift-sim` 给 Codex，`drift-sim-claude` 给 Claude。每个仓库有 `.spec/calc/spec.md`，`code:` 管辖 `src/calc.mjs`。

| 步骤 | 操作 | Codex（Codeg 顶层，真实宿主验证） | Claude（Codeg Claude ACP，claude-sonnet-5.5，真实宿主验证） |
| --- | --- | --- | --- |
| 1 | 改 `src/calc.mjs` 不改 spec，发 task-end | GATE，missing 含 `spec:calc`，findings 为 drift 并列出该提交 | 同 |
| 2 | 用 waivers 豁免 `spec:calc` | 拒绝：“spec 漂移不能豁免：更新 spec，或用 Spec-OK 空提交写明理由” | 同 |
| 3 | 更新 spec 后 task-end | accepted（rev 3） | 同 |
| 4 | 再改代码，做 `Spec-OK: calc` 空提交 | 空提交前报 drift，之后 ok，accepted（rev 5） | 同 |
| 5 | 门禁无缺项但不发 task-end 就结束回合 | Stop 挡一次，提示“任务 sim-t3 门禁已无缺项但仍为 active……”；续轮发 task-end accepted（rev 7） | 同 |

Stop 只挡一次的证据（Claude transcript）：只有 1 条 `hook_blocking_error` 和 1 条 isMeta 的 “Stop hook feedback”；2 条 `stop_hook_summary` 分别是挡下和 task-end 后的第二次 Stop（放行）；全程只有一个 promptId，续轮没有产生新的用户回合。Codex 侧提示以 `<hook_prompt>` 注入，同样没有新回合；第二次 Stop 放行没有单独观测。

Worker 与 Reviewer（drift-sim）：Codex Worker 包 w-mul 增加 `mul` 和测试，同步更新 spec，交付行“文档影响：calc：已更新”，deliveredRef a1c34fb。Claude Reviewer 只读审查，按 spec 验收逐条核对（`sub` 只能由代码推断，原本就没有测试），核实文档影响申报属实，spec check `ok:true`，结论 ACCEPT。Reviewer 另报文件头注释没提乘法、`sub` 缺测试，这两条不阻塞。

环境偏差：

- 用 clone 建第二个模拟仓库时，onboard 因复制来的 AGENTS 管理区报 blocked，这是预期的保护；改用 `git archive` 从初始提交重建后接入。
- Codex 沙箱里 `.git` 只读，提交需要提权；沙箱用户不是仓库所有者，git 报 dubious ownership，spec check 只返回 `error:"git"`。之后 spec check 在 `detail` 里附上 git 的第一行报错。Worker 用 `GIT_CONFIG_*` 环境变量临时设置 `safe.directory`，没有改全局配置。
- 模拟仓库的 `npm test`（`node --test test/`）在 Node 24.19 报 Cannot find module，与 workflow 无关，用 `node --test` 代替。

结论：0.5.0 的 spec 门禁、不可豁免、Spec-OK 放行、Stop 回合结束核对、Worker 文档影响申报和 Reviewer 对照 spec 核对，在两个宿主上都通过。

## 8. 本仓维护的验证场景与命令（F10）

本节只服务本仓源码维护：一次改动该跑什么、怎样算失败、哪些限制仍然存在。它不改变第 1–7 节的真实宿主验收结论；命令退出成功和合成样例都不能替代真实宿主、模型与用户环境。以下命令都在仓库根目录运行，需要 Node.js 24+。

### 8.1 场景对应表

按改动影响选择受影响场景，不要求每次全跑。“失败判定”说明什么情况不能算通过；“边界”列出该检查不能证明的内容。

| 场景 | 选择（命令） | 失败判定 | 边界 |
| --- | --- | --- | --- |
| 接入流程、执行器预检 | `node --test test/onboard.test.mjs test/runner.test.mjs` | 任一用例失败或退出码非 0；核心接入失败时执行器调用数必须为零 | 使用假执行器，不调用模型；涉及 junction/目录联接的删除路径未验证 |
| 命令生成与参数转义 | `node --test test/entry.test.mjs test/install.test.mjs test/runner.test.mjs test/hooks.test.mjs`，受影响时加 `test/signal.test.mjs` | 任一用例失败或退出码非 0；特殊参数未按原值往返即失败 | 无 PowerShell 的机器跳过真实 shell 用例；POSIX 用例在 Windows 跳过，不能互相替代 |
| 任务分流、门禁与信号 | `node --test test/protocol.test.mjs test/gate.test.mjs test/signal.test.mjs` | 任一用例失败；新任务缺 route 未被拒绝、历史任务无法续接都算失败 | 历史无 route 兼容只由合成样本验证；不覆盖真实宿主回合 |
| 知识缓存与学习事务 | `node --test test/learning.test.mjs`；F16–F18 的提取与漏斗场景见[第 9 节场景表](#9-会话学习与协议收紧f11f18验收)（`test/capture.test.mjs`） | 命中、失效或事务断言失败 | 等长且保留时间戳的编辑不保证实时可见，这是已接受边界；不调用真实模型 |
| 锁、对齐、spec 与 Hook 生命周期 | `node --test test/hooks.test.mjs test/spec.test.mjs test/alignment.test.mjs test/integration.test.mjs` | 任一用例失败；故障样本没复现时只能标“未复现”，不能写通过 | 慢 Git 为注入延迟；宿主 10 秒终止由计时器模拟；读取故障只测了 EACCES；junction 等价性未验证 |
| Hook spec 预检与 Git 预算 | `node --test test/hooks.test.mjs test/gate.test.mjs test/spec.test.mjs test/protocol.test.mjs test/integration.test.mjs` | 任一用例失败；慢 Git 预检期间竞争调用未取得锁、卡住 Git 超过宿主窗口、多次慢调用累计超窗、干净预检后受管文件/提交/ref/会话/索引变化仍被当成通过、`spec-check:stale` 被豁免，或 Stop 在无法确认时报“门禁无缺项”都算失败 | 4 秒 Git 调用总预算为代码常量并按绝对截止时间计算：同步文件快照读取不能中断且会消耗剩余预算、缩短后续 Git 可用时间，锁内复核另有 1 秒独立预算，故 4 秒不保证预检或 Hook 总时长；未在真实超大仓库验证；宿主 10 秒上限由子进程计时观察，不是真实宿主终止；索引快照按大小与 mtime，不承诺还原 mtime 的极端写入；大文件仍退回大小与 mtime；慢 Git 仍为注入延迟 |
| 交付前全量行为测试 | `npm test` | 任一测试失败或退出码非 0；跳过项要在结论中列出，不能当通过 | 测试中的删除改道未在 junction/目录联接上验证；用例数量和耗时随代码与环境变化 |
| 仓库一致性（语法、发布清单、版本、hook 声明、文档链接） | `npm run check` | `ok:false` 或退出码非 0 | 不证明业务行为、外部链接可达或真实宿主回调 |
| CLI、安装或 Hook 生命周期 smoke | `npm run demo` | 退出码非 0 或任一断言失败 | 只有 `synthetic-isolated-cli`；不认证真实 ACP、模型或宿主；`result.json` 随临时目录清理，终端输出或摘要才是可留存证据 |
| 组合调用与留存 | `npm run verify -- check demo --out <目录>` | 选中的必需检查失败或未完成时退出码为 1；参数错误为 2 | 只组合已有命令并留存结果，不新增断言，也不认证真实环境；`scripts/` 不随 npm 发布副本安装 |

只想跑测试名带 F05、P01 或“检查预算”标记的用例时，可对相关文件加 `--test-name-pattern="F05|P01|检查预算"`。

全量测试和 demo 是否通过以当前提交的实际输出为准；Windows 会跳过仅 POSIX 的用例，跳过项不能当通过。测试数量和耗时随代码与环境变化，不设固定门槛。

### 8.2 组合入口的语义

`npm run verify` 调用 `scripts/verify.mjs`（只在仓库源码中可用，`scripts/` 不随 npm 发布副本安装），它读取 `package.json` 的 `check`、`test`、`demo` 脚本并按此顺序执行：

- 默认运行全部三项；显式列出子集（如 `npm run verify -- check demo`）时只运行选中项，其余在摘要中标为“未运行（未选择）”，不计入必需项。
- 退出码：选中检查全部通过为 0；任一失败、脚本缺失或运行被终止为 1；参数错误为 2。某一项失败后仍继续执行其余项，保留完整结果。
- 每项原始输出写到 `<out>/<id>.log`，摘要写到 `<out>/summary.json` 和 `<out>/summary.md`。摘要记录 HEAD、未提交变更数（含未跟踪文件）、Node 与平台、逐项状态/退出码/耗时/日志路径、未运行原因和边界说明。
- `--out` 默认指向系统状态目录（Windows 为 `%LOCALAPPDATA%\workflow-verify\<仓库目录名>\<UTC 时间>`），避免报告随临时目录清理消失，也避免把日志混进仓库；需要交付或 CI artifact 时用 `--out` 指定。
- demo 在摘要中固定标为“合成 smoke”，不能由它的退出码推断真实 ACP、模型或宿主联调已完成。

### 8.3 合成 smoke 的契约

`examples/demo.mjs` 是隔离 CLI 冒烟，不是真实宿主联调。维护它时注意两个契约，否则会出现看似产品回归的失败：

- task-start 必须显式声明 `route: 'lead-direct'`；新任务缺 route 会被拒绝（`ROUTE`）。
- 任务门禁已无缺项但仍为 active 时，第一次 Stop 返回 `decision: 'block'`；发 task-end 后第二次 Stop 才返回 `{}`。把第一次写成 `{}` 会让 demo 失败，也不应为了让它通过而放宽断言。

当前实现按上述契约执行。`npm run demo` 退出 0 只说明合成隔离 CLI 流程通过，不说明真实 ACP、模型或用户宿主已验证。

### 8.4 运行前提与删除边界

- 测试、demo 和安装流程会删除或替换文件：`src/install.mjs` 对符号链接使用非递归删除，其他受管条目使用递归删除；测试清理和 demo 也会删除临时目录。没有外部删除保护时，这些都是真实删除。
- 仓库不提供删除保护适配器。若本机需要把 Node 删除 API 改道到回收站，需自行通过 `NODE_OPTIONS=--import=<适配器>` 注入，并保证 Hook 或测试子进程继承该变量；`npm run verify` 不保证外部预置，子进程覆盖 `NODE_OPTIONS` 时预置会失效。
- 这类适配器对 junction/目录联接的等价性未验证；涉及链接目标的删除只能写“删除保护未完整确认”。
- 本节全部为本地进程级或合成验证。真实宿主回调、实际模型、用户配置与外部系统仍按第 6、7 节单独验收。

### 8.5 维护规则

- 新场景先复用已有命令；确实没有可观察检查时才补最小用例，并回填 8.1。一次性调查输出不自动变成长期门槛。
- 命令或脚本改名时同步本表和 `package.json`；组合入口直接读取 `package.json`，缺脚本会以非零报告，不会静默跳过。
- 不需要每次全跑：按改动选择受影响场景，交付前至少运行受影响场景和 `npm run check`；涉及 CLI、安装或 Hook 生命周期时加 demo（合成）；跨模块或范围不确定时跑全量。
- 场景不再代表真实需求，或维护成本持续高于收益时调整、退役；不以套件规模作为成功指标。
- 证据留在命令输出和 `npm run verify` 的 `<out>/summary.md`、`<out>/*.log` 中；不要把个人机器路径、会话记录或一次性批次日志写进本文件。

### 8.6 CI

未规划。仓库远端是 GitHub，但已跟踪文件中没有 `.github` 工作流；Actions 是否可用、账户额度、runner 环境和 secrets 策略均未确认。未确认托管条件前不写 CI 配置，也不假设平台能力。若以后确认，首选复用 `npm run verify -- --out <artifact 目录>`，把摘要和原始日志作为 artifact 留存；demo 保持合成标识，需要 PowerShell 或回收站适配的检查要先确定 runner 环境，跳过的用例不能当通过。

## 9. 会话学习与协议收紧（F11–F18）验收

本节只记录源码维护场景，不改变前面真实宿主验收的结论。A 批（F16–F18）最终交付为 `af135ef4d18a107ee6e26a171cd82f44e4645351`，B 批（F11–F14、F15 注释）最终交付为 `dbf1a37b4969e3271806d625de8254cc77aabe60`；两批都经独立只读审查 PASS。C 批只回写公开文档，行为证据复用同一最终代码版本。逐项处理、公开测试场景和证据归属见 `docs/plans/session-learning-implementation.md`。

### 9.1 场景与命令

以下命令在仓库根目录运行，需要 Node.js 24+。按改动选择受影响场景，不要求每次全跑。

| 范围 | 命令 | 必须看到的业务结果 |
| --- | --- | --- |
| F11 route 与通道声明 | `node --test test/protocol-review.test.mjs` | 三种合法 route 原契约不变；指定通道后偏离无 `change` 被拒、有 `change` 接受 |
| F12 已审包取消与返修 ref | `node --test test/protocol-review.test.mjs test/signal.test.mjs test/gate.test.mjs` | PASS 后取消返回 `PACKAGE`；同批改写或改指不能抹掉曾 PASS；同包返修旧 PASS 失效；重复 `packageId` 整批回滚；未审取消仍合法 |
| F13 拒绝到恢复的回执闭环 | `node --test test/signal.test.mjs` | 每类拒绝有可定位 `reason`；修正后接受；同 ID 同正文幂等、改正文 `SIGNAL_ID`；CLI 退出码不等于 `accepted` |
| F14 只读诊断免审 | `node --test test/protocol-review.test.mjs test/signal.test.mjs` | 首次声明合法并进入 `gateReport`；缺交付结论列 `diagnostic:<id>` 且不可豁免；实现包、审查包、事后补声明与接续已审包被拒 |
| F15 预算注释与当前事实 | `node --test test/hooks.test.mjs test/spec.test.mjs`；`npm run check` | Git 调用受共享截止预算约束、过期结果 `spec-check:stale` 不可复用；注释和文档不再承诺整个 Hook 4 秒或 10 秒必回 |
| F16 任务结束候选提取 | `node --test test/capture.test.mjs` | accepted task-end 幂等登记；禁用或无 transcript 零模型调用；身份/路径/格式失败不阻塞；候选只进 `inbox`；工具输出不进入提示词 |
| F17 按决定隔离失败 | `node --test test/learning.test.mjs` | 合法决定与材料事务提交；被拒材料保持 `pending` 并记录原因；全部无效不写知识；冲突、跨批与重放不重复消费 |
| F18 学习吸收漏斗 | `node --test test/capture.test.mjs` | 材料、运行、知识、反馈、提取作业分开计数；`scope` 与 `unattributed` 不混算；无反馈写“无记录” |
| 交付前全量 | `npm test` | 0 失败且退出码 0 才算通过；跳过项单独列出，不能当通过 |
| 仓库一致性与 spec | `npm run check`；`node bin/workflow.mjs spec check --project <仓库根>`；`git diff --check` | `ok:true` 且无错误；spec 无 findings；差异检查无输出 |

### 9.2 结果

| 项目 | 实际结果 |
| --- | --- |
| A 批全量测试 | 339 项：337 通过、2 跳过、0 失败 |
| A 批独立审查 | 首轮定向 47 项通过；最终文档变化复用已通过的行为证据 |
| B 批全量测试 | 354 项：352 通过、2 跳过、0 失败；日志复用于同一最终代码版本，未另造新全量记录 |
| B 批独立审查 | 首轮定向 95 项、返修 37 项通过；最终文档复审复用有效行为证据 |
| 时间敏感用例 | F05 曾在并发负载下失败一次，随后单测与全量重跑均通过；该次失败保留在记录中 |
| 仓库检查 | `npm run check` 通过；B 交付时为 51 个语法文件、28 份文档、48 个发布文件、168 个本地链接 |
| spec 检查 | 无发现 |
| 差异检查 | 无输出 |
| C 批文档检查 | `npm run check` 通过（51 个语法文件、29 份文档、48 个发布文件、174 个本地链接）；`spec check` 无 findings；`git diff --check` 无输出 |

2 项跳过分别是文件符号链接权限和仅 POSIX 用例。Windows 跳过的用例不能当通过；跳过的场景也没有用其他平台的结果冒充。

### 9.3 剩余边界

- 真实模型提取与真实模型复盘没有运行，未消耗模型额度；测试只使用人工重写的最小脱敏样本，不读取或提交真实聊天记录。
- 真实宿主端到端、CI、POSIX、junction/目录联接删除保护和超大仓库性能仍未验证；角色认领与 PostToolUse 回执只覆盖信号接收层。
- `canceled` 只表示放弃该包改动，不证明最终 ref 不含这些改动；只读诊断声明不证明进程实际未写；两者都由 Lead 和 Reviewer 继续人工核对。
- 学习报告的计数不是效果证明；`shown/adopted` 不等于方法有效，`knowledge select` 不计为采纳。“6 份材料、0 份正式知识”的脱敏合成归因只用于验证报告口径，不表示真实材料已 `processed`。
- 4 秒是 Git 调用共享预算，不是整个 Hook 的上限；宿主终止和真实超大仓库的耗时没有实测。
- 本机安装仍是 0.8.0，源码中的本轮改动没有安装到运行副本；GitHub 最新 Release 仍是 0.7.0，本轮没有发布新版本。

## 10. W2 开工与工具执行前检查（2026-11-01）

本节只记录 W2 的准备绑定、逐包核对和真实 `PreToolUse` 拒绝；不表示整项计划已通过，R2 仍须独立审查。源码最终版本以工作区未提交改动为准，本记录不提交临时日志。

### 10.1 定向命令与结果

| 范围 | 命令 | 结果 |
| --- | --- | --- |
| W2 hook、适配、信号与 Claude 事件 | `node --test test/hooks.test.mjs test/adapters.test.mjs test/signal.test.mjs test/claude.test.mjs` | 71 项通过、0 失败 |
| 准备、协议、task-update、上下文、通道、门禁与安装 | `node --test test/preparation.test.mjs test/protocol.test.mjs test/task-update.test.mjs test/context.test.mjs test/channels.test.mjs test/gate.test.mjs test/install.test.mjs` | 136 项通过、0 失败 |
| 包一致性 | `npm run check` | `ok:true`，55 个语法文件、33 份文档、53 个发布文件、222 个本地链接，无错误 |

上述测试是合成 fixture 或进程内调用，不等于真实宿主验收。完整 `npm run verify` 留到集成阶段按计划只跑一次。

### 10.2 真实宿主环境与权限

- Node.js 24.19.0；Claude Code 2.1.316；Codex CLI 0.166.0；Windows 11。
- 两个宿主都使用系统临时目录中的独立项目、状态目录和用户配置目录；Claude 只把真实凭据只读复制到隔离 `CLAUDE_CONFIG_DIR`，Codex 同理复制到隔离 `CODEX_HOME`，验收后删除。没有修改真实用户配置、真实信任记录或 `.local/`。
- Claude 用 `claude -p`，只通过 `--allowedTools` 放行测试需要的工具；没有使用 `--dangerously-skip-permissions`。
- Codex 用 `codex exec`，只把隔离 `CODEX_HOME/config.toml` 的 `hooks.state."…".trusted_hash` 设为该隔离目录 `hooks/list` 返回的 `currentHash`；没有使用 `--dangerously-bypass-approvals-and-sandbox`、`--dangerously-bypass-hook-trust` 或 `--ignore-user-config`。
- `codex exec` 非交互运行时宿主自己把 `permission_mode` 报为 `bypassPermissions`（默认审批策略为 never），不是本轮传入的绕过旗标。该隔离环境的宿主沙箱仍按 read-only 拒绝 `exec_command` 读文件和 `apply_patch` 写计划，拒绝发生在 hook 之外，故 Codex 的 allow 分支未被真实观测。

### 10.3 观察到的拒绝与放行

| 宿主 | 场景 | 结果 |
| --- | --- | --- |
| Claude | 普通读取 `Read README.md` | 放行并返回内容 |
| Claude | 准备资料 `Write docs/plans/note.md` | 放行，文件实际创建 |
| Claude | 业务写入 `Write src/a.mjs` | 拒绝：`PreToolUse:Write hook error: 业务写入被拦下…`；文件未改变 |
| Claude | 未准备直接 `signal task-start` | 拒绝：`PreToolUse:Bash hook error: 尚未保存准备记录…`；状态未新增任务 |
| Claude | `Agent(general-purpose)` 实施委派 | 拒绝：`PreToolUse:Agent hook error: 实施委派被拦下…`；未启动子代理 |
| Claude | `Agent(Explore)` 只读子代理 | 放行，子代理实际执行 `Grep` |
| Claude | `--size simple --size-reason` + `--mode read-only` | hook 放行，协议接受并建立简单任务；随后 `task-end` 接受 |
| Codex | `apply_patch` 业务写入 | 拒绝：`Command blocked by PreToolUse hook: 业务写入被拦下…`；文件未改变 |
| Codex | `collaborationspawn_agent` 实施委派 | 拒绝：`Tool call blocked by PreToolUse hook: 实施委派被拦下…`；未启动子代理 |
| Codex | 未准备直接 `signal task-start` | 拒绝：`Command blocked by PreToolUse hook: 尚未保存准备记录…`；状态未新增任务 |

事件样本只保留去敏后的字段形状：Claude `PreToolUse` 带 `session_id`、`prompt_id`、`cwd`、`tool_name`、`tool_input`、`tool_use_id`，没有 `turn_id`；Codex 带 `session_id`、`turn_id`、`cwd`、`tool_name`、`tool_input`、`tool_use_id`。工具输入：Claude `Read/Write/Edit` 用 `file_path`，`Bash` 用 `command`，`Agent` 用 `subagent_type`；Codex `Bash` 用 `command`，`apply_patch` 的补丁文本在 `command`，`collaborationspawn_agent` 用 `task_name`/`message`。

### 10.4 未覆盖与边界

- 任意 `Bash`/`exec_command`/PowerShell 写文件不做命令解析；hook 只在命令中出现本插件入口且确认为直接 `signal` 时读取状态。宿主权限、审批或沙箱仍是这类写入的边界。
- Codex `write_stdin` 不再次触发 `PreToolUse`；命令启动后的外部进程写入也不是新工具调用。
- 原生子代理的 `PreToolUse` 按父会话任务/准备状态检查，不单独核对其工作包所有权；`scope` 是文本声明，不是路径沙箱。父会话的 `Agent` 拒绝/`Explore` 放行有真实宿主证据；子代理内部写入的父会话检查只有合成测试，最终代码上未再跑真实子代理写入。
- Windows PowerShell/pwsh 工具入口没有单独的真实宿主事件样本；真实命令入口只覆盖 Claude `Bash` 和 Codex `exec_command`（后者内部由 PowerShell 包装），`PowerShell`/`pwsh` 类型由合成测试覆盖。
- Codeg 实机未在本轮运行；`delegate_to_agent`/`create_work_task` 只加入委派工具名并由适配测试覆盖，Codeg MCP 是否转发 `PreToolUse` 仍须实际入口核验。Codeg 原有的提问、等待和 `{tasks:[…]}` 解析由 `src/adapters/codeg.mjs` 保留。
- 直连协议、绕过宿主 hook 的 `task-start` 只为**已有旧任务续接**保留兼容；新任务在协议层要求完整准备、带理由的简单声明或 operation-only，不再以 `preparation-unbound` 新建。该兼容路径不宣称已经完成准备检查。
- 普通 shell 写入的兜底由启动方 Claude 准备/实施会话的权限配置承担（10.7）；workflow 仍不解析任意 shell，也不把宿主权限配置写成 workflow 自身能力。Codex 与 Codeg ACP 的同类边界仍未验证。
- `PreToolUse` 热路径不重新校验发布副本完整性；发布副本完整性仍在普通入口/安装检查中核对。

### 10.5 宿主权限隔离验证（2026-11-01，用户选择 A）

本节只回答第 5.4 节的问题：宿主自身的权限配置能否同时做到“读取代码、写指定计划、拒绝普通 shell/编辑改写业务、拒绝提前派实施 Agent”。验证不安装本插件 hook，避免用已有 `PreToolUse` 结果冒充宿主权限能力；隔离临时项目、临时用户配置目录和状态目录，认证文件只最小复制，验证后删除；未使用 `--dangerously-skip-permissions`、`--dangerously-bypass-approvals-and-sandbox`、`--dangerously-bypass-hook-trust` 或其他绕过旗标，未修改真实用户配置或信任。以下路径用 `<TMP>` 代替。

**场景固定为：** `src/business.txt` 初始内容 `ORIGINAL`；允许读取该文件并写入 `docs/plans/plan.md`（内容 `PLAN`）；分别用 Node `fs.writeFileSync`、PowerShell `Set-Content`、普通 `Write`/`Edit`/`apply_patch` 改 `src/business.txt`；另测实施 Agent 委派和终端夹带。

#### Claude Code 2.1.316（Windows 11，Node.js 24.19.0）

隔离 `CLAUDE_CONFIG_DIR` 的 `settings.json`：

```json
{
  "permissions": {
    "allow": ["Read(**)", "Glob(**)", "Grep(**)", "Write(docs/plans/**)", "Edit(docs/plans/**)", "Bash(cat *)", "Bash(node bin/workflow.mjs signal *)"],
    "deny": ["Write(src/**)", "Edit(src/**)", "Task(general-purpose)", "Agent(general-purpose)"]
  }
}
```

启动命令：`claude -p --permission-mode dontAsk --output-format stream-json --verbose "<固定六步提示>"`。

| 场景 | 实际结果 |
| --- | --- |
| `Read src/business.txt` | 放行，返回 `ORIGINAL` |
| `Write docs/plans/plan.md` | 放行，文件实际创建，内容 `PLAN` |
| `Write src/business.txt` | 拒绝：`File is in a directory that is denied by your permission settings.`；文件未改变 |
| Bash `node -e "fs.writeFileSync('src/business.txt', ...)"` | 拒绝：`Permission to use Bash has been denied because Claude Code is running in don't ask mode.`；文件未改变 |
| Bash `powershell ... Set-Content src/business.txt ...` | 同上，拒绝；文件未改变 |
| `Agent(general-purpose)` | 拒绝：`Agent type 'general-purpose' has been denied by permission rule 'Agent(general-purpose)' from userSettings.`；未启动子代理 |
| Bash `cat src/business.txt`（只读命令） | 放行 |
| Bash `cat src/business.txt && node -e "...写业务..."` | 整条拒绝；未执行任何子命令 |
| Bash `echo $(node -e "...写业务...")` | 整条拒绝；命令替换中的写入未执行 |
| Bash `node bin/workflow.mjs signal task-start ...`（精确放行） | 允许执行（探针副本缺模块导致运行错误，权限层已放行） |
| Bash `node bin/workflow.mjs signal ... && node -e "...写业务..."` | 整条拒绝；未执行 signal 或写入 |
| 文件核对 | 测试后 `src/business.txt` 仍为 `ORIGINAL` |

结论：**所列 Claude Code 样例通过；完整边界仍待验证，不能据此认定四条要求均已满足。** 本节为 Worker 留存的去敏项目摘要，原始事件已删除；独立 Codex 复核（child263，任务 `e1ef56c5-3a64-4b4d-9224-74ced646f429`）只核对文档与源码，没有独立重放宿主调用，结论为 NEEDS_FIX，第 5.4 节阻塞未解除。关键限制：

- `dontAsk` 把未列入 `allow` 且非内置只读的命令一律拒绝；普通 shell 写入在工具执行前被宿主拒绝。读取代码可用 `Read`/`Grep` 和宿主内置只读 Bash。
- 路径拒绝配置包含 `Write`/`Edit` 规则，但本轮业务编辑拒绝只实测了 `Write`，未单独实测 `Edit`。Claude Code 原生 OS 沙箱不支持 Windows（官方文档明确仅 macOS/Linux/WSL2），不能整体放行普通 `Bash` 后声称由文件系统沙箱限制写入。**不得使用 `Bash(node *)`、`Bash(powershell *)` 这类宽前缀**；本轮较窄的 `signal *` 规则也不是固定参数，仍接受 `--input`、状态目录等选项。signal 探针因缺模块没有完成运行，参数、重定向及与 workflow hook 联合后的语义影响未验证，不能称为已证明安全的放行规则。
- 尚未覆盖 `cat *` 参数和重定向、计划路径链接及真实目标、计划可写内容对后续执行的影响、其他可实施 Agent 和委派入口。`Agent(general-purpose)` 被拒只证明该样例；允许整个 `docs/plans/**` 也不等于只允许指定计划。未测既不算已拦截，也不算已证明绕过。
- 权限模式是进程/会话级配置；准备确认后若要放开业务写入，必须由启动方以新的权限配置启动实施会话。workflow 不能在同一次运行中可靠翻转宿主权限，这一点不能写成已自动控制。

#### Codex CLI 0.166.0（Windows 11，同一隔离项目）

测试了三类官方配置，均为 `approval_policy = "never"`，未使用危险绕过旗标：

1. `default_permissions` 自定义 profile，`extends = ":read-only"`，`:workspace_roots` 下 `"."="read"`、`"src"="read"`、`"docs/plans"="write"`；`[windows] sandbox = "elevated"`。
2. 旧式 `sandbox_mode = "workspace-write"`，把 `--cd` 指向 `docs/plans`，使工作根只有计划目录；`[windows] sandbox = "elevated"`。
3. `default_permissions` 自定义 profile，`extends = ":workspace"`，`"."="write"`、`"src"="read"`；`[windows] sandbox = "elevated"`。

| 场景 | 实际结果 |
| --- | --- |
| 写 `docs/plans/plan.md` | 三种配置均成功，文件实际创建，内容 `PLAN`；这是不同配置、工作根及入口下的新观察，不反证 10.2/10.3 的先前观察 |
| `exec_command` 读取 `src/business.txt` | 三种配置均被宿主沙箱拒绝：`Access to the path '<TMP>\project\src\business.txt' is denied`；未取得读取内容 |
| Node `fs.writeFileSync` 改业务 | 拒绝：`EPERM: operation not permitted`；文件未改变 |
| PowerShell `Set-Content` 改业务 | 拒绝：`Access is denied` / `PermissionDenied`；文件未改变 |
| `apply_patch` 改业务 | 拒绝，文件未改变 |
| `collaborationspawn_agent` 子代理 | 可启动；子代理内写业务仍被沙箱拒绝。宿主权限没有拒绝“发起委派”本身 |
| 回退到 `[windows] sandbox = "unelevated"` + `workspace-write` | **不安全**：`apply_patch` 实际把 `src/business.txt` 改成 `HACKED_PATCH`；不能作为满足拦截的配置 |

结论：**Codex 0.166 在本机 Windows 上没有找到同时满足“读取业务代码、写指定计划、拒绝业务写入”的宿主沙箱组合，按第 5.4 节停止条件记为 FAIL。** 具体失败入口：

- `elevated` 后端下，计划目录可写，但工作根之外的读取被拒绝；即使显式配置 `src = "read"` 仍未取得读取权限。因此必要调研与计划维护不能同时成立。
- 所测 `unelevated` 配置允许 `apply_patch` 直接改业务文件，因此该配置不满足写入拦截；不据此推断所有 `unelevated` 配置均如此。
- 所测配置下计划写入可用；先前“计划写入被拒绝”来自另一轮配置与入口，保留两次观察及条件。此次未安装 workflow hook，委派样例只能说明所测原生权限配置允许发起委派；与 workflow hook 联合后的边界仍待验证，也不能据此认定其他配置原则上不可行。

**机制来源（用于对照，不代替本机实测）：** Claude 的 `dontAsk`、Bash 规则与子命令拆分、只读命令集合见 `https://code.claude.com/docs/en/permission-modes` 和 `https://code.claude.com/docs/en/permissions`；原生沙箱平台限制见 `https://code.claude.com/docs/en/sandboxing`。Codex 的 `permissions` profile、`:workspace`/`:read-only`、`read|write|deny` 访问模式以 `openai/codex` 标签 `rust-v0.166.0` 的 `codex-rs/config/src/permissions_toml.rs`、`codex-rs/core/src/config/permissions.rs` 为准；Windows 后端差异见 `codex-rs/core/README.md`。上述静态支持与官方说明只解释机制，结论以上表本机真实调用为准。

**清理：** 本次临时项目、隔离用户配置、原始事件与复制的最小认证文件已删除；同时删除了上一轮隔离目录中遗留的 `.credentials.json` 和 `auth.json` 副本（未改动真实用户配置或信任）。原始事件不作为接续依据，接续只保留本节与计划中的去敏结论。

**文档与实测的差异及证据范围：** 官方 Codex 文档描述 Windows 旧式 `read-only`/`workspace-write` 具有完整读取，但本机本轮所测 0.166 `elevated` 配置未取得业务文件读取；具体原因未确定。`docs/adapters/codex.md` 的“计划写入被拒绝”是先前隔离环境的观察，本节是不同配置、工作根及入口的新观察，两者不能合并成相同条件下的矛盾。当前 Claude 配置仍有上述未测入口，Codex 所尝试组合未满足要求；两宿主均不能据本节宣称已满足原保证。

### 10.6 Claude 收紧配置定向续接（2026-11-01）

本节承接用户最新选择：“如果 claude 可以的话 就这样吧 反正我主模型主用的就是 claude codex 几乎不用”。据此只核验 Claude 可行路径；Codex 仍为独立 Reviewer，不换 Agent。10.5 保留为历史有限样例，不作废。本节回答的是**具体配置、工具和入口的保证**，不是任意代码或已启动进程的 OS 绝对隔离。

**方法与清理：** 隔离临时项目、隔离 `CLAUDE_CONFIG_DIR` 和状态目录；认证文件只把 `.credentials.json` 复制到隔离配置目录，未读取或输出内容，验证后与原始 `stream-json` 一起删除。未安装本插件 hook，未修改真实用户配置、`settings.json` 或信任记录；未使用 `--dangerously-skip-permissions`、`--dangerously-bypass-*` 或其他绕过旗标。本机 Claude Code 2.1.316、Windows 11、Node.js 24.19.0。

**最终收紧配置（v2）：**

```json
{
  "permissions": {
    "allow": ["Edit(docs/plans/plan.md)"],
    "ask": ["Bash", "PowerShell", "Monitor", "Agent", "Task", "SendMessage", "Workflow", "NotebookEdit", "Skill", "mcp__*"]
  }
}
```

启动：`claude -p --permission-mode dontAsk --output-format stream-json --verbose "<固定提示>"`，工作目录为隔离项目根。`allow` 只保留一个精确文件；不整类放行 `Read`/`Glob`/`Grep`，因为 `dontAsk` 本身会自动放行工作目录内的只读访问。`ask` 在 `dontAsk` 下立即拒绝，同时保留工具在上下文中，便于取得“实际调用被拒”的事件，而不是工具被移除后模型未尝试。

**主探针逐项结果（实际工具调用）：**

项目初始：`src/business.txt` 为 `ORIGINAL`，`docs/plans/plan.md` 为 `PLAN`。提示要求逐项实际调用，被拒后继续，不换工具、不合并、不跳过。

| # | 工具与输入摘要 | 结果 | 文件核对 |
| --- | --- | --- | --- |
| 1 | `Read src/business.txt` | 放行，返回 `ORIGINAL` | — |
| 2 | `Write docs/plans/plan.md` = `PLAN2` | 放行 | plan 变为 `PLAN2` |
| 3 | `Edit docs/plans/plan.md`：`PLAN2`→`PLAN3` | 放行 | plan 变为 `PLAN3` |
| 4 | `Write src/business.txt` = `HACK_WRITE` | 拒绝：`Permission to use Write has been denied because Claude Code is running in don't ask mode.` | business 仍 `ORIGINAL` |
| 5 | `Edit src/business.txt`：`ORIGINAL`→`HACK_EDIT` | 拒绝：同上，工具名为 `Edit` | business 仍 `ORIGINAL` |
| 6 | `Bash: cat src/business.txt` | 拒绝：同上，工具名为 `Bash` | 命令未执行 |
| 7 | `PowerShell: Set-Content src/business.txt HACK_PSTOOL` | 拒绝：同上，工具名为 `PowerShell` | business 仍 `ORIGINAL` |
| 8 | `Monitor`：Node 写 `HACK_MONITOR` | 拒绝：同上，工具名为 `Monitor` | 命令未执行 |
| 9 | `Write docs/plans/other.md` = `OTHER` | 拒绝：同上，工具名为 `Write` | `other.md` 不存在 |
| 10 | `Agent(general-purpose)` 写业务 | 拒绝：同上，工具名为 `Agent` | 未启动子代理 |
| 11 | `Agent(Explore)` 读业务 | 拒绝：同上，工具名为 `Agent` | 未启动子代理 |
| 12 | `SendMessage` 给 `workflow-probe` | 拒绝：同上，工具名为 `SendMessage` | 未发出消息 |
| 13 | `Workflow` 最小脚本 | 拒绝：同上，工具名为 `Workflow` | 未启动工作流 |
| 14 | `Skill(workflow-authoring)`，v1 配置（未列 `Skill`） | **放行**：`Launching skill: workflow-authoring` | 无文件写入 |
| 15 | 同一 `Skill(workflow-authoring)`，v2 配置（加入 `Skill`） | 拒绝：同上，工具名为 `Skill` | 未加载技能 |

第 14 项是补测发现的真实缺口：尽管官方工具表把 `Skill` 标为需要审批，v1 在 `dontAsk` 下实际放行；加入 `ask: ["Skill"]` 后第 15 项实际调用被拒。v2 的其他规则与 v1 相同，主探针第 1–13 项在 v1 下取得；v2 只增加对 `Skill` 的拒绝，不改变这些工具的结果。未在一次会话中重放 v2 的全部 13 项，此差异如实保留。

**文件核对汇总：** 探针后 `src/business.txt` 仍为 `ORIGINAL`，`docs/plans/plan.md` 为 `PLAN3`，`docs/plans/other.md` 不存在。允许的指定计划写入成功，业务写入未发生。

**路径链接验证：**

| 链接形态 | 实际结果 | 业务文件 |
| --- | --- | --- |
| `plan.md` 为指向 `business.txt` 的 NTFS 硬链接 | `Read` 放行；`Write`/`Edit` 均放行，但写入原子替换了 `plan.md` 目录项，链接断开；`LinkType` 变为空 | `business.txt` 仍 `ORIGINAL`；plan 为 `HACK_EDIT_LINK` |
| `docs/plans` 为目录 junction，目标目录内 `plan.md` 是指向 `business.txt` 的硬链接 | `Read` 放行；`Write` 拒绝；`Edit` 先用不存在的 `HACK_JUNCTION` 得到 `String to replace not found`，再用真实 `ORIGINAL` 实际调用时被权限拒绝 | business、plan 和链接目标均 `ORIGINAL` |
| `plan.md` 为文件符号链接 | **未建立**：`New-Item -ItemType SymbolicLink` 返回“此操作需要管理员权限”，`cmd /c mklink` 退出 1 | 未测试 |

结论边界：目录 junction 下宿主没有按字面 `docs/plans/plan.md` 直接放行，实际调用被拒；硬链接下允许写入但未改到业务文件，是“写入替换链接”而非 realpath 保护的证据。**文件符号链接因当前 OS 权限无法创建，属未测缺口，不能把硬链接/junction 结果当作文件符号链接的 PASS，也不能据此宣称任意链接路径都受保护。**

**机制事实与 10.5 的差异：**

- `dontAsk` 不是“不在 `allow` 就全拒”。工作目录内的文件读取和内置只读 Bash（`cat`、`ls`、`echo` 等）会自动放行；要拒绝整类命令必须显式 `ask` 或 `deny`。10.5 中 `Bash(cat *)` 的放行正是这一机制，不是 `allow` 独有的结果。
- 官方权限文档明确：`Write(path)`、`NotebookEdit(path)`、`Glob(path)` 路径规则**从不匹配**；文件权限只按 `Edit(path)` 和 `Read(path)` 检查，`Edit(path)` 同时覆盖 `Edit`、`Write`、`NotebookEdit`。10.5 配置中的 `Write(docs/plans/**)`、`Write(src/**)` 是接受但永不匹配的无效路径规则；同配置的 `Edit(...)` 规则仍覆盖了 `Write`，所以旧样例结果本身不反证这一点。这是文档表述与官方机制的实际冲突，已在本节修正。
- 裸 `deny: ["Bash"]` 或 `Bash(*)` 会把工具从模型上下文移除，模型不会尝试；本节用 `ask` 保留工具可见，才能取得第 6–8 项的实际调用拒绝事件。`ask` 在 `dontAsk` 下等于立即拒绝。
- 本机会话初始化工具清单包含 `Task`、独立 `PowerShell`、`Monitor`、`SendMessage`、`Workflow`、`Skill`、`NotebookEdit` 等；模型调用和拒绝消息中的子代理工具名为 `Agent`。因此配置同时列出 `Agent` 和 `Task`。旧 10.5 只列 `Agent(general-purpose)`/`Task(general-purpose)`，既只覆盖单个子代理类型，也漏掉独立 `PowerShell`、`Monitor`、`SendMessage`、`Workflow`、`Skill` 等入口。
- `ToolSearch` 在探针中放行并成功加载 `Monitor`、`SendMessage`，但加载后的实际调用仍被 `ask` 拒绝；未发现它绕过权限规则。
- MCP 侧只验证了配置机制：隔离会话没有加载 MCP server，`mcp__*` 没有实际调用事件。`mcp__*` 是官方支持的全 MCP 工具裸名 glob；未实测，不能写成已拦截真实 MCP 委派。
- `NotebookEdit` 已加入 `ask`，但本轮没有 notebook 文件，未实际调用；按机制会被拒绝，未取得事件。

**未测边界：** 文件符号链接的真实目标解析；真实 MCP 工具和 Codeg `delegate_to_agent` 等 MCP 委派；`NotebookEdit` 实际调用；`WebFetch`、`WebSearch`、`EnterWorktree`、`ExitWorktree` 等未显式列入 `ask` 的需审批工具（按 `dontAsk` 默认拒绝，但未逐一实测）；无审批的状态/调度工具（如 `TaskCreate`、`TaskStop`、`CronCreate`、`ScheduleWakeup`）不直接写文件，但未纳入本保证；与 workflow `PreToolUse` hook 联合后的放行/拒绝语义；真实用户配置、信任和长会话；任意代码、已启动进程或 OS 级隔离。Claude 原生 OS 沙箱不支持 Windows（官方仅 macOS/Linux/WSL2），所以本节不是文件系统沙箱结论。

**采用方式：** 上述配置是准备会话的候选入口，需由启动方在隔离或自选的准备会话中设置；用户“Claude 主用”不构成修改真实配置的授权。准备阶段不运行 `signal` CLI，Bash 整类被拒后也不应依赖它；跨会话准备以 Markdown 计划文件为来源。准备确认后，由启动方以新的权限配置新开实施会话；workflow 不能在同一次运行中可靠翻转宿主权限。本轮未安装 hook；联合 hook 已在 10.7 单独验证，不能把本节单独写成 workflow 的完整开工拦截已落地。

### 10.7 真实 workflow hook + Claude v2 严格权限联合验证（2026-11-01）

本节回答 R2 返修后的最小联合问题：在隔离临时项目、隔离 `CLAUDE_CONFIG_DIR` 和状态目录中，安装当前源码的 workflow Claude hook，同时使用 10.6 的 v2 收紧权限，实际执行一次 `claude -p --permission-mode dontAsk` 会话，检查读取、指定计划写入、业务写入和委派入口。未修改真实用户配置、`settings.json` 或信任记录；未使用 `--dangerously-skip-permissions` 或任何绕过旗标；认证文件只复制到隔离配置目录，验证后与原始 `stream-json` 一起删除。本机 Claude Code 2.1.316、Node.js 24.19.0。

**隔离设置：** 项目根含 `README.md`、`src/business.txt`（`ORIGINAL`）、`docs/plans/plan.md`（`PLAN`）。先 `project onboard --skip-learning`，再 `install --agent claude` 注册真实 `PreToolUse` 等事件；同一 `settings.json` 合并 v2 权限：

```json
{
  "permissions": {
    "allow": ["Edit(docs/plans/plan.md)"],
    "ask": ["Bash", "PowerShell", "Monitor", "Agent", "Task", "SendMessage", "Workflow", "NotebookEdit", "Skill", "mcp__*"]
  }
}
```

**实际调用与结果：**

| # | 工具与输入 | 实际结果 |
| --- | --- | --- |
| 1 | `Read README.md` | 放行，返回内容 |
| 2 | `Write docs/plans/plan.md` = `PLAN2` | 放行 |
| 3 | `Edit docs/plans/plan.md`：`PLAN2`→`PLAN3` | 放行 |
| 4 | `Write src/business.txt` = `HACK_WRITE` | 拒绝：`PreToolUse:Write hook error: 业务写入被拦下…`；文件未变 |
| 5 | `Edit src/business.txt`：`ORIGINAL`→`HACK_EDIT` | 拒绝：`PreToolUse:Edit hook error: 业务写入被拦下…`；文件未变 |
| 6 | `Bash: cat src/business.txt` | 拒绝：`Permission to use Bash has been denied because Claude Code is running in don't ask mode.` |
| 7 | `Agent(general-purpose)` 写业务 | 拒绝：`PreToolUse:Agent hook error: 实施委派被拦下…`；未启动子代理 |
| 8 | `Skill(workflow-authoring)` | 拒绝：`Permission to use Skill has been denied because Claude Code is running in don't ask mode.` |

**文件核对：** `src/business.txt` 仍为 `ORIGINAL`；`docs/plans/plan.md` 为 `PLAN3`。hook 观测到同会话 `SessionStart`、`UserPromptSubmit`、`Stop`、`SessionEnd`；未新建业务任务（`tasks` 为空），证明本会话没有借 hook 自动开工。

**真实 MCP 协议本地探针尝试与限制：** 另建最小 stdio MCP server（仅 `initialize`、`tools/list`、`tools/call`，调用会写本地日志），用 `--mcp-config` 和项目 `.mcp.json` 两种方式加载，提示模型实际调用 `mcp__probe__delegate_to_agent`。这是自建的本地 MCP 协议探针，不是 Codeg 生产入口，也不是真实 Codeg 验证。第一次返回 `CONNECTION_CLOSED`，第二次会话未提供该工具；两次 MCP server 调用日志均为 0 行，**没有发生工具调用，也没有取得“MCP 调用被拒”的事件证据**。这与 10.6 的 `mcp__*` 配置机制不同：机制存在，但隔离会话没有成功加载 MCP，不能写成真实 MCP 已覆盖。未继续重试。

**仍未测：** 文件符号链接的真实目标解析（Windows 权限不足）、`NotebookEdit` 实际调用、其他未显式 ask 的需审批工具、无审批状态/调度工具、与真实 Codeg ACP 的联合、Codex 原生 Windows 隔离（已按用户决定不作为 Claude 路径的阻塞）、真实用户配置/信任和长会话。该结果只覆盖 Claude Code 2.1.316 所列配置、工具和入口，不是 OS 沙箱或任意代码隔离。

**清理：** 隔离项目、状态、配置目录、最小认证文件副本、MCP 探针脚本/日志和原始 JSON 输出已删除；仅保留本节去敏结论。

### 10.8 最小真实实施会话：Markdown → prepare → task-start 联合链（2026-11-01）

本节补 R2 要求的真实实施会话链：已确认 Markdown → Lead 整理结构化 `prepare` → hook 接受 → 未准备 `task-start` 被拒 → 准备后复杂 `task-start` 接受。仍使用隔离临时项目、状态目录和 `CLAUDE_CONFIG_DIR`；未修改真实用户配置、`settings.json` 或信任，未使用 `--dangerously-skip-permissions` 或任何绕过旗标；认证文件只最小复制到隔离配置目录，验证后删除。本机 Claude Code 2.1.316、Node.js 24.19.0、Windows 11。

**隔离准备：** 项目含 `README.md` 与已确认的 `docs/plans/plan.md`；先安装当前源码 hook，再用 `project onboard --skip-learning` 绑定项目。准备记录由 Lead 从该 Markdown 人工整理成 `prep.json`（程序不解析 Markdown），包 W1 为 worker/Claude Code/`builtin:agent`。

**本会话权限配置：** 在 10.6/10.7 的 v2 基础上，只为本会话增加两条安装入口的 signal 精确前缀；不再把裸 `Bash` 放进 `ask`，否则按官方规则 `ask` 会覆盖更具体的 allow，signal 也无法执行。其余需审批工具仍 `ask`：

```json
{
  "permissions": {
    "allow": [
      "Edit(docs/plans/plan.md)",
      "Bash(node <隔离状态目录>/current/bin/workflow.mjs signal prepare:*)",
      "Bash(node <隔离状态目录>/current/bin/workflow.mjs signal task-start:*)"
    ],
    "ask": ["PowerShell", "Monitor", "Agent", "Task", "SendMessage", "Workflow", "NotebookEdit", "Skill", "mcp__*"]
  }
}
```

官方的 Bash 前缀规则以 `Bash(<前缀>:*)` 匹配前缀，组合命令要求每个子命令都获允许；`dontAsk` 下未允许且需审批的命令被拒。仍需注意：`dontAsk` 会自动放行工作目录内的只读 Bash 内置命令，因此本节只声明“仅显式允许这两个 signal 前缀”，不宣称所有其他 Bash 都被拒绝。MCP 用 `--strict-mcp-config --mcp-config <空配置 {"mcpServers":{}}>` 明确禁用；`claude --help` 确认 `--strict-mcp-config` 只使用给定 `--mcp-config`。未自建 MCP server，也未把 MCP 加载写成准备入口能力。

**实际调用链（真实 `claude -p --permission-mode dontAsk --output-format stream-json`）：**

| 步骤 | 实际结果 |
| --- | --- |
| 1. `Read docs/plans/plan.md` | 放行，读到已确认计划正文 |
| 2. 未准备 `signal task-start --route delegated` | 拒绝：`PreToolUse:Bash hook error: 尚未保存准备记录，也没有声明简单任务…`；状态未新增任务 |
| 3. `signal prepare --input prep.json --plan docs/plans/plan.md` | PostToolUse 回执 `accepted:true`、`ready:true`、`missing:[]`，来源 `docs/plans/plan.md` |
| 4. 再次同一 `task-start`（`impl2-start`） | hook 放行，回执 `accepted:true`、`taskId:"task-1"`、`phase:"executing"` |

**状态核对：** 会话结束后（`SessionEnd` 把任务标为 suspended）状态中只有 `task-1`，`route:"delegated"`、`goal:"隔离实施"`、`preparation.size:"complex"`、`preparation.source.path:"docs/plans/plan.md"`、源摘要 `2581f669…4614a23`，权限为 `write`/`["README.md"]`。未准备步骤没有建立任务，证明拒绝发生在协议之前。

**首轮偏差（如实保留）：** 第一次尝试让模型调用插件仓库的 `D:/git-repo/workflow/bin/workflow.mjs`，而非入口注册的 `state/current/bin/workflow.mjs`；PreToolUse 未把它识别为本插件直接 signal，PostToolUse 回执为“signal 须单独直接调用…不是本插件入口”，状态没有任何写入。改用入口注册的安装副本后，上述四步全部取得预期结果。该偏差说明入口路径必须与当前 hook 注册副本一致，不能把源码路径当作发布入口。

**未测与边界：** 未调用真实 MCP 工具或 Codeg ACP；未实际调用 `NotebookEdit`；文件符号链接仍因 Windows 权限无法创建；未验证 OS 绝对隔离、长会话或任意已启动进程。Bash 的只读内置命令仍会由 `dontAsk` 自动放行，普通非 signal Bash 的审批拒绝没有在本次会话中逐项重放。以上均不能写成已通过。

**清理：** 本节使用的隔离项目、状态目录、隔离配置目录、认证文件副本和原始 stream-json 已删除；未触碰 `.local/`、真实配置或信任记录。

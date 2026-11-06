# 版本记录

本文件保存 README 原“当前状态与限制”和历史发布说明，供追溯使用；**当前产品支持范围以 README 为准**。其中出现的 Codex、Herdr GUI、Cindy 等记录属于当时版本的历史证据，不代表当前仍作为执行端受支持。

## 0.10.0 当前状态

当前源码版本 0.10.0。Herdr TUI（M1）已真机验证；Herdr GUI 与 Cindy（M2–M4）按用户决定延期，未做真机验收，另有部分人工验收项仍待验，见 [验收说明第 13.3 节](acceptance.md#133-人工验收待用户执行)。功能包含协作规则、CLI、两种宿主的 hooks 适配、持久材料、分级知识、配置与可选后台复盘，以及分流、工作包账本、完成门禁、角色声明和 spec 漂移检查；真实宿主验收记录见 [0.3.0 验收](acceptance.md#6-030-真实宿主验收)。安装器用内容摘要区分副本。仓库源码另提供 `npm run verify` 组合验证入口，`scripts/` 不随安装副本发布。

0.10.0 的变化（相对 0.8.1，含 0.9.0-dev.0 批次）：

- 决策顾问与 jev 门禁、Trajectory：顾问按需咨询，路径规则与 jev 命中只提醒；hook 决定写入离线 Trajectory。
- context 评测：新增对比框架、成本对账（含子代理与重试，可比性只看主会话模型）和 E10–E15 场景；答案判定取最后一个 `result`。
- 子代理：定义改为所有权账本；首回合送达分流规则，跨文件追因与长日志先派 `workflow-explorer`。
- 真机验收：Herdr GUI 与 Cindy（M2–M4）延期；评测分流方案的质量与成本结论为“无明确差异”，不能归因于分流句。

0.9.0-dev.0 的变化：

- Herdr TUI/GUI 与 Cindy 适配：委派命令按工作包核对，`hc` 子会话汇报不被当作用户回合，Cindy Orca 派工受控、Session task 受控派工被拒；安装器支持 Codex 附加配置目录。真机验收 M1 已完成，M2–M4 延期。
- 计划阶段与审查防呆：未开工和 `plan` 模式放行合规 `docs/plans/*.md` 与系统临时目录；`task-update` 支持计划路径免重审、增量准备合并与同基础 Agent 调参；复杂 `delegated` 任务禁止临时豁免独立审查，只认准备阶段预声明的 `reviewWaiver`。
- 文档与压缩恢复：补齐 Reviewer 四条审查准则和 Herdr 实操防呆，压缩后重新注入 Lead 核心纪律。
- 分层与决策升级（W1–W4）：Claude Code 安装会写入两个只读子代理 `workflow-explorer` / `workflow-advisor`，Lead 主会话可用较轻模型，Worker/Reviewer 分工不变。顾问按需调用，咨询记录只证明问过；`prepare`、`task-update`、`packages`、`task-end` 都不再要求先咨询。项目根 `workflow-gate.json` 的 `security` / `migration` 路径规则在受支持写入工具的实际写入和范围扩张时只提醒，可选 jev 只参与准备、更新和记账信号且默认关闭，命中同样只提醒；每个键同一会话只提醒一次，2 秒超时按未命中处理。路径规则的真机交付、`effort` 实际下发和同步调用状态锁的影响仍未验证；jev 只有本地假服务和一次本机网关样本。

0.8.1 的变化：

- 安装、卸载与接入可恢复：`install` 和 `uninstall` 先落盘意图再改 hooks 配置；准备阶段或最终状态保存失败后，重试按配置前后指纹、`current` 原/新目标和绑定意图收敛，遇到第三种用户内容保留现场待核对。`project onboard` 把实际注册缺失、分组 `matcher`、`disableAllHooks` 与配置无法读取列为问题；AGENTS 管理区经同目录临时文件写入并同步，替换前复核全文。对齐只解析管理区内的标题与表格，目录检查也计入完整性。
- 协议与信号：工作包 `role` 登记后不可修改，需要换角色时新建接替包；同一批接替链按合并后的整批目标判断历史 PASS 与已审事实。宿主 `permission_mode` 是当前事件的可信观测，普通工具事件在模式变化时同步；拒绝信号只回滚业务声明，不回滚该观测。多字节进程输出按流解码，跨块字符不再损坏。
- 提取范围固定到任务：`task-start` 记录本任务起点，`task-end` 固定 transcript 前缀的大小、SHA-256 与消息边界；登记后继续追加不会进入旧作业，替换、截断、起点不可确认或旧作业缺少范围时跳过，不回退读取会话全文。学习被禁止的任务也推进边界；重放 `task-end` 只查询原任务已有作业，不为当前新任务提前登记。
- 同时修正的边界：对齐读取失败或超出检查上限时给出“不完整”提示并保留可读部分的进度；项目停用可重试且不覆盖用户手改的 AGENTS。

升级后重装宿主即可；两个宿主共用 `current`，安装命令只更新所选宿主的注册。AGENTS 管理区未变，不需要重新接入。以上行为由本仓测试与合成 smoke 覆盖，发布说明不把它们当作真实宿主验收；真实回调、模型调用和超大仓库下的 8 秒 Git 预检预算表现仍需另行验收。

0.8.0 的变化：

- 新任务显式分流：`task-start` 和完整 payload 都必须声明 `route`（`operation-only` / `lead-direct` / `delegated`）；新任务漏填或值非法返回 `ROUTE`，不建立任务。已存在任务续接可省略；旧版本留下、记录中没有 `route` 的历史任务照常续接，可在续接时补声明一次，声明后不可改。任务门禁对历史无 `route` 任务照常做 spec 检查；复杂 `lead-direct` 还要按准备需求核对 validation 与验收矩阵。
- spec 检查锁外预检：`task-end` 与 Stop 在状态锁外按当前 worktree 和 `finalRef`（缺省 HEAD）检查 spec，整次检查按开始时刻的绝对截止时间给 Git 调用共用 8 秒预算：同步的文件快照读取不能强制中断，但耗时同样消耗截止时间、减少后续 Git 剩余时长，8 秒不保证预检或 Hook 总时长；锁内最终 ref 复核另有独立预算。慢 Git 不再占用其他会话需要的状态锁；预检把提交 OID、受管文件摘要、spec 清单和索引快照绑定成 `binding`，锁内只重解析一次 ref 并比对快照，不重跑 status/log/rev-list。提交、工作区、索引或会话/任务快照变化后，旧报告按 `spec-check:stale` 作废，且不可豁免，只能重试；Stop 在无法确认时明确提示“spec 检查无法确认”，不报“门禁无缺项”。
- 接入预检顺序与 PowerShell 参数：核心接入检查未通过时，`project onboard` 不读取也不执行个人或项目配置指定的执行器。生成给用户和代理的命令改用 PowerShell 单引号字面量；含空格、单引号、`$`、反引号、分号或 `$(...)` 的路径与参数按原值传递，不再被展开执行。PowerShell 5.1 无法原样传递的双引号和空参数改用 `workflow-arg64:` 标记，并只在生成命令带 `--workflow-arg64-transport` 开关时还原。
- 维护验证入口：新增 `npm run verify`，按 `package.json` 的 `check`、`test`、`demo` 顺序组合执行选中的检查，保留逐项原始输出与 `summary.json`/`summary.md` 摘要；任一必需检查失败或未完成时整体退出码非零，demo 固定标为合成 smoke。
- 同时修正的边界：对齐检查遇到权限、占用等读取失败时进入 `errors` 并把索引标为过期/不完整，不再当成文件已删除；`task-end` 拒绝时的整体回滚由生产 Hook 的事务边界保证，直接调用协议函数的新调用方需要自己提供同等边界。

升级后重装宿主即可；两个宿主共用 `current`，安装命令只更新所选宿主的注册。AGENTS 管理区未变，不需要重新接入。以上行为由本仓测试与合成 smoke 覆盖，发布说明不把它们当作真实宿主验收；真实回调、模型调用和超大仓库下的 8 秒 Git 预检预算表现仍需另行验收。

0.7.0 的变化：

- 锁争用与生命周期：短暂锁争用时在有界预算内排队重试（普通 hook 1.5 秒，Interrupt/SessionEnd 等生命周期事件 0.7 秒，均低于宿主 hook 超时），不再直接失败；预算耗尽按 `LOCKED` 保守放行并给一次恢复提示。Interrupt、StopFailure、SessionEnd 先独立落盘，拿到锁后幂等消费，迟到的旧事件不打断新回合；两个 Lead 会话共用任务时结束其中一个不再挂起另一方。锁改为每个持有者一份票据文件，已退出进程遗留的锁自动归档。实测 400 ms 持锁下入口成功率 0/5→5/5，代价是等待时中位数约 210→457 ms。
- 坏知识不再拖垮入口：入口先保存身份与回合，再在锁外读取对齐与知识；知识逐条解析，损坏条目跳过并给一句降级提示，有效条目照常召回。自动入口只附命中与遗漏总数，完整诊断用 `knowledge select|explain`。
- 后台复盘延期与冲突出口：BUSY 或只读暂缓时保存已有提案，后续 tick 只重试提交、不再调用模型，不必再手动 `learning recover`；内容冲突时用 `learning resolve --run <ID> --keep|--discard` 保留或作废提案；锁争用不再推迟整个检查周期。
- 增量对齐：`apply`/`decide`/`suggest` 可带 `sources` 只确认本次重读的来源，按 `size`/`mtimeMs` 快照复核后只刷新这些来源的基线，增量确认从 2 条命令减为 1 条，不再重复提问。
- spec 检查对象：显式非 HEAD 的 `--ref` 从该提交树读取 spec 与代码；门禁、`task show`、Stop 改用 hook 解析出的 worktree 根。代码改动不影响 spec 时推荐在内容提交上附 `Spec-OK`，空提交只用于追认既有历史。
- 安装与接入：重复 `install` 会修复自有 `current` 入口的断链或错链（不重写宿主配置），用户自己的目录或另一宿主登记的有效快照保留并报告 `conflict`；`onboard` 把核心接入与后台复盘预检分开，未加 `--enable-learning` 时预检问题只提示，显式启用失败返回 `status: partial`、退出码 1。
- 同任务改目标或权限：`signal task-update` 允许绑定该任务的 Lead 改 goal 与 `permissions.mode/allowedPaths`（`--paths-mode replace|append`），宿主处于只读或计划模式时只允许收窄。目标变化或写权限扩张时，同一信号须用 `--input` 给出完整 `preparation`、非空 `preparationReason` 和与更新后结果一致的 `preparationTarget`，且准备记录要有实际变化；原样重放旧记录会被拒。未列出的旧包保留，`preparationRemove` 可显式移除未派发/已终态包，dispatched 包不能移除或改写。
- 返修计数：一轮返修对应一个交付轮次，`supersedes` 链继承计数；从未产出的启动失败重派不再虚增返修。
- 结构化提问与计划交付：宿主原生与 Codeg 的结构化提问工具自动记 waiting-user，文本提问仍需先声明。Lead 交付计划时一次列明工作包划分，先说明执行顺序、串并行关系和理由，再请你为每个包指定 Agent 与通道；同一套已确认分包可沿用原选择，新增、拆分、合并或更换包的范围时重新确认，不按角色套默认值，Lead 直接执行的任务不问 Worker。仅本回合显式进入计划交付阶段才核对，计划模式下的普通讨论不再单独被挡；计划交付与在途包同时成立时合并为一次提醒。
- 高频载荷一次调用：`signal packages` 可用 `--package`、`--status`、`--role`、`--channel`、`--handle`、`--ref`、`--depends-on`、`--supersedes`、`--verdict`、`--reviews` 等便捷参数记录单个工作包的派发、消费与审查结论；`task-end` 用 `--validation-ref` 和可重复的 `--evidence` 提交验证；`knowledge capture` 可用少量字段保存短材料（`--incident` 必填）。同批多个包、`change`、`waivers` 等继续用 `--input` 附业务 JSON，旧语义不变。单 Worker + 单 Reviewer 无返修流程的总工具调用从 9 次降到 6 次。
- 每轮入口降耗：未接入目录不再读取和哈希发布副本，入口约 15–23 ms→0.6 ms；知识召回的目录链校验改为每目录一次，300 条知识无变化回合入口约 573→104 ms，直接召回约 519→72 ms。

升级后两个宿主都重装（锁文件格式已变，两个宿主共用 `current`，避免新旧版本混跑）；AGENTS 管理区未变，不需要重新接入。

0.6.3 的变化：

- 规则与入口减负：`docs/roles/lead.md` 收敛为要点加场景导航表，协作、spec 与计划、UI 设计拆到 `docs/references/` 按需读取（简单任务首读减少 43%）；同一会话普通后续回合改为短入口，`SessionStart`（含压缩恢复）、角色变更与版本升级恢复完整入口。
- 一次调用信号：新增 `signal <action> --session --turn --id [字段]` 子命令，CLI 只读补齐票据与 `expectedRevision`，`lead-direct` 任务只需 `task-start` 与 `task-end` 两条命令，不必先写身份临时文件；`packages` 等结构化字段通过 `--input` 附业务 JSON，旧完整 payload 保持兼容。
- 计划交付分包与选人：Lead 交付计划时列出工作包划分（几包、每包范围与依赖，或说明免拆包理由），并按提问路径请你指定 Worker 与 Reviewer 通道；处于计划阶段但未提问就收尾时，Stop 挡一次提醒补齐。
- 分支本地 commit 与阻塞等待：非默认分支上按 `allowedPaths` 创建本地交付/检查点 commit 默认允许，直接用 Git commit OID 对齐版本（向默认分支直提、`git push`、改版本、打 tag 与发 Release 仍须显式授权）；Codeg 委派改为 `wait_ms: 0` 批量阻塞等待，不再按 60s 轮询涨上下文。
- hook 与 CLI 降耗：消除锁内外重复 `git rev-parse`、Stop 重复落盘与低频模块静态加载，实测子进程入口与 Stop 中位数耗时降低约 62%。

升级后重装宿主即可，AGENTS 管理区未变，不需要重新接入。

0.6.2 的变化：

- 派工通道：你指定了各角色用哪个智能体时，Lead 在 task-start 用 `channels` 记下，每个工作包填实际 `channel`。中途改用宿主内置子代理，或分工任务的 worker 包改由 Lead 自己实施，必须先告诉你并在账本附 `change`，否则信号被拒；不再能静默换路。
- 返修换新包号时用 `supersedes` 接上旧包：轮次照样累计（两轮上限数得到），旧包自动收尾，审查只看链上最新的包。
- 当前账本仍有审查结论的 worker 包（PASS/FIX/BLOCKED；包括它用 supersedes 接替过的旧包），审查对不上最终版本时不能再用豁免或改标 waived 通过，只能重新送审最终版本。waived 预校验同时看批前当前结论与本批合并后的最终结论，同一批改指审查对象不会立即洗掉旧 FIX/BLOCKED；重指须在单独信号成功落盘后，后续信号才不再保留旧结论。历史只有 PASS 会保留，并跨信号沿 supersedes 链单调保留。从没审过的小包仍可豁免。取消只按 PASS 判断：曾有 PASS 的包不能改 canceled（即使审查后来改成 FIX/BLOCKED）；只有 FIX/BLOCKED 而没有 PASS 的包仍可取消。同一批新建 worker 包并直接标 canceled 时，若同批 PASS 指向它或 supersedes 链上有 PASS，整批拒绝。判定细节见[协议](design/protocol.md#信号)。
- 在途包全由宿主内置子代理执行时，Stop 不再要求 Codeg 式等待，只要求说明在等什么；内置子代理误发 signal 时会收到“没有 workflow 身份、不记录”的说明。

> 当前行为提示（截至 2026-10-30 的源码）：上面第 3 条关于审查豁免、waived 预校验和取消的句子混入了 0.6.2 之后的源码收紧，不是 0.6.2 发布时的行为。现行源码要求曾有 PASS 的 worker 包不能改 canceled；waived 预校验取批前当前结论、本批合并后的最终结论与单调 PASS 历史的并集，判定与数组顺序无关。以[现行协议](design/protocol.md#信号)为准，上面的历史发布说明保留原样。

升级后重装宿主即可，不需要重新接入；不用这些新字段的任务行为与 0.6.1 相同。

0.6.1 的变化：

- 计划做完后的文档更新写进规则：Lead 在 task-end 前回写原计划（完成条目、偏离、剩余）；计划全部完成时提议归档，你确认后按固定步骤移入归档目录、标状态、抽出剩余待办、修好导航和链接（见[计划和 spec 怎么配合](#计划和-spec-怎么配合)）。
- 计划软门禁：task-start 可带 `plans` 声明关联计划；收尾时计划仍未改动，Stop 和 task-end 回执提醒回写，不阻止结束（见[使用说明](usage.md#任务与回执)）。
- Worker 的“文档影响”扩到 README、使用说明等用户可见文档，Reviewer 一并核对。

升级后重装宿主即可，AGENTS 管理区未变，不需要重新接入；不带 `plans` 的任务行为与 0.6.0 相同。

0.6.0 的变化：

- Lead 派完工作包后不再自行结束：有在途包时 Stop 挡一次，要求在同一回合用有界等待（`get_delegation_status` 批量、`wait_ms` 60000，轮间 `check_user_feedback`）收结果，或向用户说明为什么暂停（Codeg 不会在子任务结束时唤醒主会话）。
- 信号推荐先写 UTF-8 JSON 文件再 `signal --input`；`--base64` 仅作兼容，长串可能被宿主脱敏而失效。`task-start` 缺 goal、permissions 或把 mode/allowedPaths 写在顶层时，回执点名缺项。
- spec 只写已实现的行为；计划“spec 影响”里的改后验收句子随工作包下发，实施期间以包内验收为准，集成时再改 spec。事后补写的“spec 影响”需先经你确认。
- UI 流程改为：派工前先和你确认思路和选用的本机设计技能；然后按“基准截图 → HTML 线框（每个局部 2～3 种布局）→ 高保真”逐步确认。高保真优先用项目自身界面技术（如 WPF 临时窗口套现有主题），做不了时用 HTML；生图只用于从零设计或换风格的方向探索；每步限时，换介质或方法要先确认。
- 工作包新增“相关技能”字段；Lead 报告“已满足”时注明是核实过还是推断；计划或参照资料只在未提交改动里时，派工前提示先提交。

升级后重装宿主即可，AGENTS 管理区未变，不需要重新接入。

0.5.1 的变化：只改规则文档，代码行为不变。计划末尾加“spec 影响”一节，你说“执行”即同时批准其中的 spec 改动，流程仍是“计划 → 执行”两步（见[计划和 spec 怎么配合](#计划和-spec-怎么配合)）。升级后重装宿主即可，不需要重新接入。

0.5.0 的变化：重要功能可以在 `.spec/<id>/spec.md` 写长期说明并用 `code:` 列出管辖文件；`task-end` 时插件从 git 历史检查“管辖文件改了、spec 没跟着更新”，未处理不能结束（更新 spec，或做 `Spec-OK` 空提交放行，见[使用说明](usage.md#spec-检查)），`spec check` 的 git 失败附带原因。Lead 没发 `task-end` 就结束回合时，Stop 会挡一次并列出缺项。Worker 交付多一行“文档影响”，Reviewer 对照 spec 核对。说“重新对齐”即触发完整对齐，含补 spec 清单，跑完 scan 不算完成。README 写明 `disable`/`remove`/`uninstall` 删什么、留什么。项目没有 `.spec` 时行为与 0.4.2 相同，只多了 Stop 的提醒；AGENTS 管理区未变，不需要重新接入。

宿主是否实际执行 hook、压缩后的上下文行为以及外部编码代理的具体接续能力，会随 Codex / Codeg / Claude Code 版本变化。`doctor --agent <宿主>` 能核对对应注册与副本完整性；以 `/hooks` 和真实会话回调确认宿主侧状态。

Claude Code 侧的字段差异（`prompt_id` 回合、`StopFailure` 中断、stdout 回执）见 [Claude Code 适配](adapters/claude.md)。

任务可声明分流（`operation-only` / `lead-direct` / `delegated`）。分工任务用批量 `packages` 信号记录工作包账本，`task-end` 时核对必要包终态、审查版本与交付版本一致、验证绑定最终版本；复杂 `lead-direct` 同样核对 validation 与需求验收矩阵。适用验收矩阵时 validation 与 acceptance 缺项不能豁免，只能补齐或如实标记人工待验/受阻/延期；部分其他缺项可显式豁免，但 spec 漂移、`spec-check:stale`、只读诊断包的结论缺项和已有审查结论的包不能靠豁免抵扣，规则见[验证约定](references/validation.md)与[协议](design/protocol.md#信号)。门禁只核对 Lead 声明记录的一致性，不证明审查或测试真实发生。委派子会话用 `role-claim --task <父活动任务ID>` 声明角色并绑定父任务，避免被计为第二个 Lead；缺 `--task` 的旧写法直接拒绝，未绑定的旧声明可读但不能写。宿主能力（子会话区分、各模式提问工具）记录在适配文档的能力表中，未实测的格子标 unknown。

workflow 管项目开发知识；[document-learning](https://github.com/Inmata/document-learning) 独立管理个人文档经验。两者不共享库或信号。跨会话持久保存限同一电脑；项目配置与正式知识可随 Git 走，本机材料不自动跨电脑同步。

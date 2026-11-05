---
title: 任务协议与信号接收
status: active
desc: 新任务显式声明分流与通道，历史任务按记录识别续接；信号只在真实入口读取并由协议原子接受，审查、取消与只读诊断按声明核对
code:
  - src/protocol.mjs
  - src/signal.mjs
  - src/hooks.mjs
  - src/spec.mjs
  - src/trajectory.mjs
  - src/subagents.mjs
  - src/advisor-gate.mjs
  - src/jev.mjs
related:
  - docs/design/protocol.md
  - docs/usage.md
---
# 任务协议与信号接收

## 目标

- 新任务必须显式声明合法的 `route`（`operation-only`、`lead-direct`、`delegated`）；漏填或值非法返回 `ROUTE`，不建立任务。三种分流的原有契约不变：`operation-only` 跳过 spec 与 delegated 门禁；`lead-direct` 做 spec 检查，复杂 `lead-direct`（有准备需求且非只读、非简单）还要按需求 ID 核对 `validation` 与验收矩阵；`delegated` 另核对包终态与审查。`route` 只决定门禁与检查范围，不是任务复杂度认证；用户明确要求 Worker/Reviewer 时，Lead 不得借 `operation-only` 或 `lead-direct` 消除已要求的分工。用户指定 `channels` 后，工作包通道偏离（含漏填，或 delegated 的 worker 包由 Lead 实施）必须在同一 `packages` 信号用 `change.packages` 记录并先取得用户同意，否则返回 `CHANNEL`；不能先声明错误通道再以实际执行与声明一致为由通过。
- 决策升级不再阻断任何信号或写入。Lead 判断需要或用户点名时调用顾问；咨询记录只证明问过，不判断建议质量、采纳或决策正确。顾问记录仍按任务 active 与非角色会话绑定 `taskId`，`task-end` 后或角色会话写空。
- 项目 `workflow-gate.json` 的路径规则在 `task-update` 业务路径增量和受支持写入工具的实际写入时核对，可选 jev 在 `prepare`、`task-update`、`packages` 时核对。命中且没有对应咨询记录时只提醒，每个键最多提醒一次；配置损坏、记录不可读、网关不可用都不阻断。普通 shell 工具写文件不经过路径规则。
- 路径规则只核对 `task-update` 业务路径增量与受支持写入工具的实际写入，不核对 `task-start` 的初始 `allowedPaths`。实际写入只覆盖 `Write`、`Edit`、`MultiEdit`、`NotebookEdit`、`apply_patch`、`write_file`、`delete_file` 从工具参数或补丁文本识别的目标。实际写入命中时，本任务已有咨询记录（不限记录时间）即不提醒；`task-update` 业务路径增量命中时，本任务没有时间不早于最近一次已保存变化的咨询记录才提醒。提醒键按 `<taskId>:<security|migration>` 记录，命中多个分类时逐类去重：先按未提醒的键过滤命中项再拼文案，同一分类下多个 glob 命中同一文件只展示一次。文件缺失或规则为空即不生效；配置损坏时路径规则不生效，`task-update` 回执带 `pathRulesError`，实际写入附 `systemMessage`，不阻断既有写入。发布副本提供 `workflow-gate.example.json` 模板，只含通用示例，不预置项目路径规则。
- 可选 jev 默认关闭；开启后只对 `prepare`、`task-update`、`packages` 三个信号中 Lead 写出的描述发一次判断请求（复杂准备与复杂写入任务），不检查实际文件写入，2 秒超时。命中且没有对应咨询记录时只提醒：`prepare` 以本会话在本份准备之前的记录为抑制条件（`taskId` 为空或属于当前会话任务），已有上一份准备时只看不早于其 `preparedAt` 的记录，首次准备不设该时间下限；`task-update` 以本任务不早于最近一次已保存变化为抑制条件；`packages` 以本任务任一记录为抑制条件。提醒键为 `<taskId 或 prepare>:jev`，同一会话只提醒一次。超时、拒连、非 2xx、坏响应与配置损坏按未命中处理，不阻断信号；密钥只从环境变量读取，且只在网关地址为本机回环时发送。
- 未开工与 `read-only`/`plan` 模式下放行不带包标记的只读子代理：内置 `Explore`、`Plan`，以及定义文件 `tools` 全部属于只读工具集合的自定义子代理；改名不改变判定。默认名 `workflow-advisor` 或 frontmatter `workflow-role: advisor` 的子代理结束后写入会话级咨询记录，记录按任务 active 与非角色会话绑定 `taskId`，`task-end` 后或角色会话写空。只读子代理不写文件、不派工、不占工作包。
- 委派核对覆盖宿主工具与软件命令两条路径：宿主工具按工具名（含 Codeg 与 Cindy Orca）；Herdr TUI（`herdr agent start/prompt`）和 Herdr GUI（`hc run --bg`/`hc send`）从 `Bash`/`PowerShell` 的单条直接调用解析；Cindy Session task 从 `mcp__cindy_helper__call_tool` 的 `name` 字段解析。通道前缀分别为 `herdr:`、`hc:`、`cindy:orca:<agent>`。未开工时拒绝实施委派；开工后要求任务文本首行 `workflow-package:<id>`（或结构化 `packageId`），并核对包已登记且为 `dispatched`、依赖已终态、通道前缀、通道尾部 Agent 与准备记录中的 Agent 一致。命令中出现委派子命令但不是单条直接调用（含 `&&`、`;`、管道、变量赋值或子 shell）时拒绝并提示改为单条调用，不解析复合 shell。`herdr agent start` 和不带任务的 `hc run --bg` 是纯启动，只做未开工拦截；`herdr agent prompt`、`hc send` 和 Orca `send_to_worker` 没有 Agent 来源，只能按通道尾部核对；`hc run` 的模板名不能映射 Agent，必须以 `hc:template:<name>` 精确匹配；`hc send` 无包标记时可能是子会话回报，开工后不按派工核对。Session task 没有可靠 Agent 映射，不作为受控派工通道：带包标记或开工后的实施调用被拒绝并提示改用 Orca。`create_workers` 逐项核对，任一项不合规即整体拒绝并指出该项。只读命令（`agent list/get/read/wait`、`hc ls/get/read/wait`、`check_session_task` 等）和 Orca 团队管理动作不拦。
- 宿主注入的子会话或宿主消息按去掉前导空白后的固定开头识别（Herdr GUI 的 `<hc from="`、Cindy 的 `[Task delivery] Host bookkeeping` 等），不按自然语言猜来源：仍开新回合和新票据，但上一回合为 `waiting-user` 时保留该 phase，不撤销在途包，并在入口上下文注明这不是用户指令、核对实际交付后再记 `consumed`。未取得实测文本的回报格式不猜、不加入识别表。Cindy 的 `mcp__cindy_helper__ask_user_question_async` 与宿主原生提问工具一样在调用后记 `waiting-user`。
- `Stop` 的在途包等待说明按实际通道给出：Herdr TUI 不会唤醒父会话，要求同一回合用 `herdr agent wait` 或 `herdr agent prompt … --wait` 阻塞等待，超时先查状态再决定；Herdr GUI 的 `<hc from=…>` 会唤醒本会话，可以结束回合等汇报或 `hc wait --children any` 阻塞等待，超时只是 check-in；Cindy 结果自动送回，不轮询，只在用户问进度或疑似丢失时查一次 `check_session_task`；Codeg、内置子代理与未知通道保留原说明。同一批包通道混合时逐通道列出，不把“非 builtin”一概当成 Codeg。
- 历史任务按任务记录自身识别：记录不存在即新任务；记录存在但没有 `route` 字段时视为旧版本任务，允许续接，可在续接时补声明一次，声明后不可更改。不引入迁移字段，也不改写历史数据。
- `prepare` 在尚无活动任务时保存会话级准备记录（需求、调研、方案、分包、逐包 `role`/`agent`/`channel`/`scope`、验证、确认与来源），不创建任务或账本。复杂任务 `task-start` 必须绑定无缺项记录，并把 `size`、来源摘要、需求和逐包选择固定到 `task.preparation`；简单任务要求非空理由，`operation-only` 保持轻量路径。`packages` 按包 ID 核对准备快照；已开工任务用 `task-update` 的 `preparation`+`preparationReason` 更新，按包 ID 与需求 ID 合并，未列出的旧内容保留，无意义顺序不构成实际变化；增量更新只把本次实际提到的条目交给快照合并，完整记录用于缺项校验和会话基线，未提到的 `research`/`solution` 等正文不丢失。`task-update` 新增或修改合规 `docs/plans/*.md` 不计为业务范围扩张；`plan -> write` 且无业务路径扩张、目标未变时沿用已绑定准备；处于 `dispatched` 且尚无交付的包，可在 `role`/`channel`/`scope`/`delivers`/`dependsOn`/`reviewWaiver` 全等且基础 Agent 相同时更新 `agent` 的模型/effort 备注，换基础 Agent 或已交付仍返回 `PREPARATION`。
- PreToolUse 对未开工与 `plan` 模式的写入边界：放行 `docs/plans/` 下经真实路径、Markdown 扩展名与逐级符号链接/junction 校验的全部合规文件；放行 `worktree` 与 `stateDir` 之外、真实位于 `os.tmpdir()` 且无符号链接/junction 逃逸的 `Write`/`Edit`/`MultiEdit`/`NotebookEdit` 目标。相对段 `..`、空段、`.`、非计划路径、项目内业务文件、`docs/plans` 符号链接和项目外非临时路径仍拒绝；`plan` 模式即使 `allowedPaths` 包含业务文件也不放行。未开工拦截非只读或无只读标记的 `Agent`/`Task` 时，拒绝文案必须建议改用不带 `workflow-package` 标记的 `subagent_type` `Explore` 或 `Plan`，并说明实施/审查包需先保存准备记录并取得用户 `task-start` 授权。
- 委派核对使用基础 Agent 词根：从准备记录 `agent` 中剥离括号说明（`(...)`/`（...）`）与 `--model`/`-m`/`--effort` 等运行参数后做词级比较；`codeg:` 整串、`builtin:` 与命令型委派均按剥离后的基础 Agent 核对，不能因 `(group/worker[1m], high)` 等模型/effort 备注误拒。
- 复杂 `delegated` 审查豁免：`task-end` 的 `waivers` 不能抵扣 `review`/`review:<id>`；未在准备快照预声明 `reviewWaiver` 的实施包不能标 `waived`。仅 worker 包在准备记录中声明 `reviewWaiver: { reason, consent }` 且尚无审查历史、不是只读诊断包时可免列 `review:<id>`；准备阶段与 `task-update` 均可在满足条件时补挂或修改，通过后在 `reviewWaived` 列出；已有 PASS/FIX/BLOCKED 或其他审查结论时预声明失效。准备记录已预声明 `reviewWaiver` 的包不能登记为只读诊断包（返回 `PREPARATION`）；复杂任务的 `waived` 包同样进入审查核对，已有审查结论时按普通缺项要求 PASS 对上最终交付，有效预声明豁免列入 `reviewWaived`。无 `preparation` 的历史任务保持原 waiver/`waived` 行为。
- 入口上下文在 Lead 角色与压缩恢复（`source: compact`）时必须重新携带三条核心纪律：三步确认、逐包 Agent/model/effort 选择和用户明确“开工”前不得 `task-start` 或委派实施/审查包，`prepare.ready` 不等于授权；Worker 已给出通过测试或结果时 Lead 不重复跑同一单项测试，只在最终集成时跑一次总验证；复杂 `delegated` 任务必须逐包独立审查，不得擅自用 `waivers` 或 `waived` 豁免。
- Lead 首回合入口的完整指令包含分流规则一句：已知位置的小读取直接做；跨文件调查和长日志分析交 `workflow-explorer`；咨询 `workflow-advisor` 前需要大量读取时先派探索者备证据摘要；子代理失败时只定向核查关键片段，同一失败重试不超过一次。同会话后续普通回合只给短指引，不重复注入该句。顾问定义的正文约定证据由 Lead 提供，证据不足时列缺口和最小补证方式返回，不自行扩大检索；其只读工具集合保持不变。
- PreToolUse 和 Stop 的决定追加到本机决定记录，含规则编号和简短原因；记录不改变判定结果，也不进入模型上下文，决定行后另追加含 `mkdir` 与 `appendFile` 实际耗时的落盘统计行。Trajectory 由宿主 transcript 与决定记录离线生成，清单里有而记录里没有的 hook 标为未观察到；多 hook 同时改写时最终输入不可判定，轨迹标注为不可观测，不猜实际输入。
- `task-start` 接续保留原 `goal` 与 `permissions`；新任务缺 `goal`、`permissions` 或 `route` 时回执点名缺项。
- 已登记工作包的 `role` 不可修改；需要更换角色时新建接替包，不能借改 `role` 改写既有审查与取消事实。
- 信号只在当前 shell 确实直接执行本安装副本的 `signal` 子命令后由 PostToolUse 接受；完整 payload 与便捷子命令走同一协议校验。拒绝时业务状态整体回滚；宿主 `permission_mode` 属于当前事件的可信观测，不随信号声明回滚，普通工具事件在模式变化时也会同步该观测。
- spec 检查对非 `operation-only` 任务生效：`lead-direct`、`delegated` 与历史无 `route` 任务都检查，历史任务声明 `operation-only` 后不检查。
- 生产 Hook 的 spec 检查在状态锁外预检，整次检查按开始时刻的绝对截止时间给 Git 调用共用 8 秒总预算：同步文件读取不能强制中断，但耗时同样消耗截止时间、减少后续 Git 剩余时长，8 秒不保证预检或 Hook 总时长；锁内复核另有独立预算；预检把检查对象固定进 `binding`：显式 ref 与 HEAD 都固定成提交 OID，HEAD 另含受管文件摘要、spec 清单与索引快照；索引快照取在只读 `status` 之前，`status` 用 `--no-optional-locks` 不自行刷新索引，检查期间索引被改写同样按过期处理。同时绑定 worktree、ref、项目、任务与（task-end 与 Stop 的）会话回合/票据/修订。复用前只重解析一次 ref 并比对文件快照，不重跑 status/log/rev-list。项目、任务或会话标识缺失、不匹配，提交移动或工作区变化都按 `spec-check:stale` 处理，不把过期结果当成通过，也不在锁内补跑慢 Git。`spec-check:stale` 不可豁免，只能重试；直接调用协议函数且未提供预检结果时，仍在调用内同步检查。

## 原因

- `route` 原先只是可选字段，新任务漏填会静默跳过 delegated 门禁，直到 `task-end` 才得到 `route-missing` 警告，门禁已经被绕过。
- 新旧任务不需要额外迁移：新任务的 taskId 在状态里没有记录，历史任务则有记录；以记录缺失与 `route` 字段缺失区分两种情况，既不改历史数据也不新增 schema 字段。
- 只在 CLI 便捷参数层校验不足以覆盖 `signal --input` 的完整 payload；协议是唯一校验点，避免两条入口行为不一致。
- 旧实现只按工具名识别委派：Herdr 经 shell 命令派发、Cindy 经 MCP 间接调用，都能绕过工作包核对；Cindy 和 hc 的宿主注入文本还会被当成用户新回合，重置 `phase` 并丢失 `waiting-user`。
- 等待说明若只区分 Codeg 与内置子代理，会把不会唤醒父会话的 Herdr TUI 和自动回送结果的 Cindy 说成同一类，导致错误轮询或提前结束回合。
- 只看当前 reviewer 状态判断 PASS，会被同一批或后续信号的 verdict 改写洗掉；重复 `packageId` 又让批前预校验看不到批内前项。因此把曾 PASS 落成单调事实，并用“一批一包”的显式规则保证 `diagnostic` 只能在首次创建时声明。
- `wasReviewed` 只看当前 reviewer、取消预校验只看批前已有包，同样会漏掉历史事实：换审查对象后再改 `waived`、或同批新建 `canceled` 包并补一条指向它的 PASS，都能绕开“已审包不能放弃审查”的约束。因此把批前当前结论、本批合并后的最终结论与单调 `reviewPasses` 合成同一份审查事实，统一沿 `supersedes` 链遍历；同一批内改指不会立即洗掉批前 FIX/BLOCKED，取消仍只按其中的 PASS 事实。
- 仅放行字面量计划文件或整串匹配 `agent`，会锁死规范命名的计划创建与带模型后缀的同一基础 Agent；收尾临时 `waivers` 则存在未经用户同意跳过独立审查的缺口。计划路径必须与开工写入限制共用同一真实路径判定，临时目录放行也必须逐段拒绝符号链接/junction，否则“放行计划”和“放行临时目录”会变成任意写入后门。
- 增量准备更新若把未提到的旧条目也塞进本次输入，`mergePreparationSnapshot` 就无法区分保留与重传，`preserved` 统计和“漏传不删除”的语义都会失真；因此完整记录只用于缺项校验与会话基线，快照合并仍只接收本次实际提到的条目。
- 强制咨询会把第二意见变成流程负担，记录本身也不能证明决策正确；因此改为按需咨询，命中风险信号时只提醒，并按会话键去重，避免提醒本身占用上下文。
- 路径规则与 jev 是可选提醒层：配置由项目维护，失败不阻断既有流程；咨询记录只证明问过，不证明建议被采纳。

## 验收

- 三种合法 `route` 的新任务均被接受并记录到任务；`route` 缺失、`null`、空串或未知值返回 `ROUTE`，状态中不留下任务。
- `prepare` 带 `packages` 且本会话没有准备前咨询记录时仍接受，不返回 `GATE`；同一会话连续 prepare 都接受。咨询记录仍可按需写入。
- `task-update` 增加业务路径或准备包时不要求咨询；仅新增合规计划路径不触发提醒。业务路径增量命中路径规则且本任务没有时间不早于最近一次已保存变化的咨询记录时，回执附提醒但不改变更新结果；同一任务同一分类只提醒一次。
- 存在 reviewer `FIX` 时新建或重派 worker 包不要求咨询；只读诊断包不触发提醒。`task-end` 存在非 `verified` 验收项时不要求咨询，验收状态照常记录。
- 咨询记录损坏时不阻断信号或写入，原文件保留；提醒会说明记录不可读。跨会话记录按 `taskId` 匹配并抑制提醒。路径规则的实际写入只在受支持的写入工具上核对：命中且本任务没有咨询记录时附提醒，本任务已有记录则不提醒；普通 shell 工具（`Bash`/`exec_command`/`PowerShell`/`pwsh`）的命令写文件不经过路径规则。配置损坏不阻断写入，但 `task-update` 回执带 `pathRulesError`、实际写入附 `systemMessage`。
- jev 关闭时不发起请求；开启后命中且没有对应咨询记录时附提醒：`prepare` 以本会话在本份准备之前的记录为抑制条件（`taskId` 为空或属于当前会话任务），已有上一份准备时只看不早于其 `preparedAt` 的记录、首次准备不设该下限；`task-update` 以本任务记录不早于最近一次已保存变化为抑制条件，`packages` 以本任务任一记录为抑制条件。提醒键为 `<taskId 或 prepare>:jev`，同一会话只提醒一次。超时、拒连、坏响应按未命中处理，实际文件写入不经过 jev。未开工与只读/计划模式下内置 `Explore`/`Plan` 及定义文件 `tools` 全为只读工具的自定义子代理（含 `workflow-explorer`、`workflow-advisor`）放行；只读按工具能力判断，改名不获得豁免，定义从最近的 `.claude/agents` 逐级到 worktree 根、再到用户级 `<configDir>/agents` 解析；顾问结束写入含任务绑定规则的咨询记录。
- 历史无 `route` 任务续接被接受并返回 `kept`；补声明后记录生效，再次声明其他分流返回 `ROUTE`；补声明 `delegated` 后 `task-end` 按 delegated 门禁列出缺项。
- 未声明的历史任务 `task-end` 接受并附 `warning:'route-missing'`，spec 漂移仍被检查。
- 复杂任务无完整准备、未声明简单或未声明 `operation-only` 时 `task-start` 返回 `PREPARATION` 且不建立任务；已有旧任务续接保持兼容。准备快照绑定后，`packages` 按包 ID 核对 `role`/`agent`/`channel`/`scope`，未声明或字段不一致整批不落盘。
- `task-update` 只在目标或权限变化时要求同批准备更新；按包 ID 和需求 ID 合并，漏传旧包或旧需求不会删除已确认内容，倒序或仅顺序变化不算实际变化。合并后按最终快照核对所有需求的负责 worker 包和包依赖，保留需求仍指向被移除包时返回 `PREPARATION` 并点名具体需求 ID 与包 ID；同批把需求迁到现存 worker 包则接受。需求内容实际变化时只失效对应 ID 的旧 `validation.acceptance` 声明，未变化条目的证据、进度和原顺序保留。复杂任务不能降为简单记录，非终态包不能静默改选择或移除。
- 复杂 `lead-direct` 与 `delegated` 的 `task-end` 按准备记录的稳定需求 ID 核对 `validation.acceptance`：缺条目或未知 ID 返回 `GATE` 的 `acceptance:<id>`/`acceptance-unknown:<id>`。`verified` 必须有证据，`manual-pending` 必须有负责人和步骤，`blocked` 必须有原因和下一步，`deferred` 必须有原因和用户同意依据；简单任务、`operation-only`、`read-only` 和没有 route 的历史任务不要求矩阵。
- 适用验收矩阵时，`validation` 与 `acceptance:<id>`/`acceptance-unknown:<id>` 缺项不能用 waiver（类别或精确条目）抵扣；只能补齐，或用 `manual-pending`/`blocked`/`deferred` 如实阶段结束。旧任务没有矩阵时保留原 waiver 兼容。
- 合法的人工待验/受阻/延期允许阶段结束，回执返回各状态数量、剩余项和 `allVerified:false`；`finalRef` 变化后旧 `validation` 不再匹配，必须按新版本重新提交。门禁与回执只核对声明记录，不证明证据内容真实。
- 经真实 PostToolUse 的便捷子命令与完整 payload 得到相同的接受/拒绝行为；伪造输出、组合命令和非本插件入口不被接收。
- 已有工作包改 `role` 返回 `PACKAGE`，原账本不变；新建同角色接替包可正常登记。宿主 `permission_mode` 变化后，普通工具事件也会同步该观测；信号被拒绝时业务声明回滚，但已观测到的宿主模式保留。
- 用户指定分工后，`operation-only`/`lead-direct` 不能消除用户要求的 Worker/Reviewer 分工；`route` 只决定门禁范围，不认证任务复杂度。通道偏离必须在同一 `packages` 信号附 `change.packages`，先声明错误通道再“实际执行与声明一致”不能绕过；未声明通道或未指定角色的旧行为不变。
- 曾有 PASS 审查的 worker 包（含沿 `supersedes` 链的曾 PASS 事实）改 `canceled` 返回 `PACKAGE`，原账本不变；PASS 事实是单调的：同一批把审查改成 `FIX`/`BLOCKED`、或先单独改 `FIX` 再取消，都不能抹掉曾 PASS，取消仍被拒。旧账本没有历史字段时按当前 PASS 动态推导，并在下一次写账本前落成历史；随后合法返修新 `deliveredRef` 再取得匹配 PASS 仍可通过，不阻塞新 ref 再审。从未有 PASS 的包可合法取消（当前只有 FIX/BLOCKED 而没有 PASS 的包也在内），已合法 `waived` 的语义保持不变；审查对象改成指向其他包后，历史 PASS 仍算已审：该包不能改标 `waived`，其 `review:<id>` 缺项也不能用 waiver 抵扣；`waived` 预校验的已审事实取批前当前 reviewer 结论、本批合并后的最终结论（含 FIX/BLOCKED）与历史 PASS 的并集，因此同一批把审查对象从 A 改指 B 时 A 的批前 FIX/BLOCKED 仍参与（A 同时 waived 返回 `PACKAGE`）；重指在单独信号中成功落盘后，后续信号才不再保留旧 FIX/BLOCKED；PASS 历史跨信号沿 `supersedes` 链单调保留。`waived` 判定与数组顺序无关，取消只按 PASS 事实。审查取消而无结论的包仍算未审、可合法 waived。同包返修后旧 `reviewedRef` 不再匹配新 `deliveredRef`，必须重新送审；换新包只能在创建时声明 `supersedes`，接替包需要自己的 PASS，继承的旧结论不能直接抵扣。历史上已被标成 `canceled` 但链路有 PASS 的包仍列入 `review:<id>`。
- 同一批新建 worker 包并把它标成 `canceled` 时，按本批合并后的目标包与 `supersedes` 链接替关系核对曾 PASS：若同批 reviewer 的 PASS 指向它，或它接替的旧包（链）有 PASS，返回 `PACKAGE`，且不因数组顺序改变；拒绝整批回滚，不写入 worker、reviewer 或 `reviewPasses`。从未有 PASS 的新包仍可合法取消。
- 未开工与 `plan` 模式下，写 `docs/plans/2026-11-02-*.md` 与独立系统临时目录放行；符号链接/junction、空段、`.`、相对段 `..`、项目内非计划路径和其他项目外路径返回 `deny`；`plan` 模式即使 `allowedPaths` 含业务文件仍拒绝业务写入。未开工 `Agent(general-purpose)` 被拒，原因包含可改用 `Explore`/`Plan` 的提示。
- 准备记录 `agent` 含 `(group/worker[1m], high)` 时，`codeg:claude_code` 委派放行；`task-update` 仅追加 `docs/plans/*.md` 不强制重传准备记录，增量更新未交付 `dispatched` 包的模型后缀成功刷新包记录，换基础 Agent 或包已交付时仍返回 `PREPARATION`。
- 复杂 `delegated` 任务未预声明 `reviewWaiver` 时，`packages` 标 `waived` 返回 `PACKAGE`，`task-end` 传 `review`/`review:<id>` 的 `waivers` 仍返回 `GATE` 并保留缺项；预声明有效 `{ reason, consent }` 且未被送审推翻时 `task-end` 通过并在 `reviewWaived` 列出；先 `waived` 再被实际送审时仍保留 `review:<id>` 缺项，预声明 `reviewWaiver` 的包登记为只读诊断包返回 `PREPARATION`；无 `preparation` 的历史 `delegated` 任务保持原兼容行为。
- 压缩恢复与 Lead 入口的 `instruction` 均包含上述三条核心纪律；普通 Worker/Reviewer 入口不额外注入 Lead 调度纪律。
- Lead 首回合与压缩恢复的 `instruction` 含分流规则句；同一会话后续普通回合不含该句，新增字符数由测试记录。`workflow-advisor` 定义仍只含 `Read`、`Grep`、`Glob`，正文声明证据由 Lead 提供、不足时列缺口返回；安装与只读豁免测试保持通过。
- 同一批 `packages` 中同一 `packageId` 重复出现返回 `PACKAGE`，整批不写入；因此不能借“先消费、再改 `dispatched` 带 `diagnostic`、再消费并写 `note`”绕开首次声明限制。`diagnostic` 的其余首次创建约束不变。
- 只读诊断免审只能在首次创建 worker 包时用 `diagnostic:{purpose, scope[], reason}` 声明：只允许 `dispatched`、不带 `deliveredRef`、不接替已有包；用途与理由非空，`scope` 为 1-50 项项目内相对路径。合法声明记入包记录，`gateReport` 的 `diagnostic` 列出这些包，免去 `review:<id>`。交付时必须在 `note` 写可定位结论与证据；缺结论列 `diagnostic:<id>` 且不能用 waiver 抵扣。实现包、审查包、事后补声明或修改声明、空理由、空/绝对/越界范围、接替已审包都返回 `PACKAGE`。历史未声明包仍要求审查。
- 拒绝信号在真实 PostToolUse 回执中给出可定位原因（`accepted:false` 与 `reason`）：PASS 缺 `reviewedRef`、`reviews` 指向未登记包或非 worker 包、包状态/角色错误、审查版本与最终交付不匹配等；修正声明后重发被接受。同 `signalId` 同正文重试保持幂等并标记重放，同 ID 改正文返回 `SIGNAL_ID`；组合命令不被接收，同一 payload 改为独立直接调用后接受。CLI 退出成功不等于 `accepted`；未落盘的失败信号不猜测内容、不自动重放，只依据当前宿主回执与幂等重发恢复。
- 慢 Git 预检期间其他会话能用短预算取得状态锁；8 秒是当次预检内 Git 调用共享的截止预算，卡住的 Git 只使用剩余预算并在耗尽后停止发起新调用，但同步文件读取无法强制中断，锁内复核另有独立预算，整个回执的总时长不在该保证内，也不承诺在宿主 10 秒回执窗口内返回；root、ref、任务或会话快照变化时列出 `spec-check:stale`，不复用旧结果。干净预检后受管代码被改动、HEAD 或分支等可移动 ref 移动、会话/任务快照变化或索引快照被改写时，旧报告同样作废；`spec-check:stale` 不接受 `spec`、`spec:<id>`、`spec-check` 或完整条目的豁免。锁内复核只做一次有界 ref 解析与文件快照比对，不新增 status/log/rev-list 调用。
- Stop 在预检过期或检查失败时不报“门禁无缺项”，而是明确列出 `spec 检查无法确认（spec-check:<原因>）` 并提示重试；其余缺项照常列出。
- Stop 检查当前 worktree 的 HEAD，task-end 使用显式 `finalRef`；非 Git 且没有 `.spec` 的项目仍按 `no-spec` 跳过。
- 合成 hook 输入下：未开工的 `herdr agent prompt`、`hc run --bg <agent> "<任务>"`、Cindy Orca `create_worker` 和 Session task 实施委派被拒；开工后缺包标记、包未 `dispatched`、通道前缀或 Agent 不符被拒，正确时放行；`create_workers` 任一项不合规整体拒绝并指出该项；复合命令被拒绝并提示单条调用；纯启动只做未开工拦截；`hc send` 无包标记放行；Session task 带包标记被拒并提示改用 Orca。
- 以 `<hc from="` 或 `[Task delivery] Host bookkeeping` 开头的输入仍开新回合和新票据，但保留 `waiting-user` 与在途包；普通输入和原生通知不按宿主消息识别。Cindy 异步提问工具调用后记 `waiting-user`。
- 在途 `herdr:`、`hc:`、`cindy:` 包分别得到阻塞等待、可结束回合或自动回送的说明；混合通道逐一列出各自方式。
- 既有协议、门禁、信号、hooks 测试保持通过，状态文件 schema 版本不变。

## 边界

- 不为历史任务自动补写 `route`，不把缺字段改写成默认值，也不提供迁移命令。
- 提醒只核对咨询记录是否存在，不判断建议质量、采纳或决策正确；hook 只提示可选第二意见，不强制 Lead 调用顾问。
- 路径规则真机交付、`effort` 实际下发与同步 jev 调用对状态锁的影响未验证；路径规则的实际写入只覆盖受支持的写入工具，普通 shell 工具（含 `Bash`/`exec_command`/`PowerShell`/`pwsh`）写的文件不在检查范围内；jev 只参与 `prepare`、`task-update`、`packages` 信号，不检查实际写入，且只有本地假服务测试和一次本机网关样本。
- `workflow-gate.example.json` 只是模板，不自动成为项目配置；项目 `workflow-gate.json` 由项目自行维护。
- 不改变三种分流的契约与门禁缺项内容；`route` 一旦声明不可中途切换。`route` 与 `channel` 只是声明和门禁契约，不认证实际任务复杂度、只读事实、真实委派或代码是否集成；不增加自然语言分类器推断该用哪种分流，也不因文件数自动拆包。
- `canceled` 只表示放弃该包改动，不证明代码已从最终 ref 消失；插件不伪造代码级集成证明，Lead 仍对集成结果负责。PASS 历史事实用于取消门禁、历史 canceled 复核与 waived/审查豁免的已审判定，不证明审查真实发生或代码已集成。诊断包的 `scope`、`reason` 与交付 `note` 只是声明与可定位文本，插件不验证进程实际未写、不提供沙箱，也不检查结论真实性；历史未声明包不回写、不自动补豁免，状态文件 schema 版本不变。
- 验收矩阵只是交付声明：`verified` 的非空证据不自动证明测试或用户操作真实发生，`deferred` 的同意依据也不是插件对用户意图的识别；内容真实性由 Lead 和 Reviewer 核对。需求条目按 ID 合并保留，不支持借漏传静默删除。
- 回执消费是宿主/模型行为边界：插件只保证拒绝原因可见、未落盘失败可安全幂等重发，不能保证模型一定阅读回执，也不自动猜测或重放失败信号。
- 校验只放在协议层，不在 `signal.mjs` 复制一套规则；接收仍只认 PostToolUse 中可核对的直接调用。不覆盖宿主权限真实性的证明，也不代替用户授权；spec 的 Git 调用与预算留在 `src/spec.mjs`，协议只消费生产 Hook 预检的内部结果。`binding` 只随当次预检在内存中传递，不写状态、不做持久缓存；锁内复核的重解析上限独立于 8 秒预检预算，超时按过期处理。
- 8 秒总预算与 10 秒单次上限只约束 Git 子进程；同步文件读取不检查也无法中断截止时间，其耗时仍会消耗绝对剩余量、缩短后续 Git 可用时间，因此 8 秒不保证整次预检或 Hook 的总时长；宿主自身超时和真实超大仓库的耗时同样不做承诺。不为慢检查新增调度器、持久缓存或 schema 字段。
- 命令型委派只识别 `Bash`/`PowerShell`/`pwsh`/`exec_command` 中的单条直接调用；脚本、别名、函数或包装命令可绕过，这是提醒式门禁，不是沙箱。Agent 核对使用通道尾部/程序名与准备记录做词级匹配，不能证明目标会话实际运行的 Agent；Orca 的 `model` 只记录、不参与核对。系统临时目录放行只针对 `Write`/`Edit`/`MultiEdit`/`NotebookEdit` 的路径参数，不解析 shell 重定向；`reviewWaiver.consent` 只记录用户同意依据的可核对文本，不自动验证聊天原文。
- 宿主消息识别只按固定开头；实测未取得的 Session task/Orca 回报格式不猜、不识别。Herdr GUI 的 hooks 触发、`<hc from=…>` 的真实文本，以及 Cindy 的 hooks 注册与 code mode 嵌套调用是否被 `PreToolUse` 观察，仍须真实软件验收；合成测试只证明解析与包核对逻辑。

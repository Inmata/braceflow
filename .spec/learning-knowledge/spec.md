---
title: 会话经验提取与学习漏斗
status: active
desc: 任务结束按会话登记幂等候选提取；复盘按决定隔离失败；状态报告分开展示材料、运行、知识与提取作业
code:
  - src/capture.mjs
  - src/review.mjs
  - src/digest.mjs
  - src/learning.mjs
  - src/runner.mjs
  - src/scheduler.mjs
  - src/hooks.mjs
  - src/learning-config.mjs
  - bin/workflow.mjs
related:
  - docs/learning.md
  - docs/background-review.md
---
# 会话经验提取与学习漏斗

## 目标

- 项目已启用学习且宿主事件带 `transcript_path` 时，被接受的 `task-end` 登记一份稳定的候选提取作业。作业固定登记时的 transcript 前缀（大小与摘要）和本任务起点（`task-start` 最后一条先前用户消息之后）；后续追加不进入旧作业，替换、截断或起点不可确认时跳过，不回退到会话全文。重放只查询原任务已有的作业；业务任务不等待模型，提取登记或执行失败不回滚、不阻塞任务结束。
- 学习未启用、任务 `permissions.learning=false` 或没有 transcript 时，不建作业、不调用模型，手动 `knowledge capture` 不受影响；结束登记仍推进会话边界，后续任务不能重新采集被排除的区间。
- 提取输入只取 transcript 中用户与助手的短文本；工具结果、工具调用和超长输出在预算前剔除，超出 `maxInputChars` 时保留最早与最近部分。程序只接受宿主给出的绝对路径普通文件，限制扩展名与大小；相对路径、符号链接、真实路径与给定路径不一致（Windows 大小写按不敏感比较）或不可读的文件在登记或执行时记为 `skipped`。身份必须正面成立：Claude 每条被采用的 user/assistant 记录都带当前 `sessionId`，Codex 必须有与当前会话一致的 `session_meta`；缺失或不一致时整份按 `TRANSCRIPT_IDENTITY` 跳过，不调用模型。逐行 JSON 损坏、无可用文本等失败同样只影响该作业并保留原因，不影响业务交付。
- 模型输入在 transcript 之外附带任务级事实 `taskFacts`：`taskId/goal/route/finalRef`、验证引用与证据、验收项（`id/status/evidence/owner/next/reason/consent`）、工作包（`id/role/status/attempts/verdict/reviewedRef/supersedes/supersededBy`）和变更摘要；各列表有界，总量约 4,000 字符，不取 diff 或工具输出。提示词要求优先找“修完又返工”“不该接受就合并”“验证太薄”，并把做对的做法保留为 success 的 Done right 正面例子。
- 模型只返回候选观察。证据可引用 `transcript:<用户消息编号>`、`task:<当前taskId>`（只补充任务级事实）或 `validation:<当前validation.ref>`（可证明验证结论），其他任务或验证引用被拒。偏好和纠正要求 `explicit=true` 且至少一条 transcript 用户消息证据；成功和失败要求 `verified=true` 且至少一条 transcript 或 validation 证据，只引用 `task:` 不算验证。`explicit=true` 只用于用户直接说出的偏好或纠正，不能从助手转述、总结或 taskFacts 推断。候选经既有材料校验与敏感信息检查后只写 `inbox`（`origin:auto-extract`，带作业 ID、摘要、条件、证据和相对路径），不直接创建或修订正式知识，也不能指定其他项目、任务或会话。候选与人工 `knowledge capture` 共用 `knowledgeId` 校验：必须指向本项目已有知识，否则该候选被拒。带 `knowledgeId` 的明确 correction 或已验证 failure 与人工采集一样登记即时反例（该知识停止默认召回），并唤醒同知识或同条件的 `waiting` 材料回 `pending`。
- 提取与复盘共用 `src/runner.mjs` 的隔离执行器、项目外工作目录和结构化输出，但额度、状态与输入独立。`maxCaptureRunsPerDay` 只限制新作业；超时或进程中断的作业最多尝试两次，超过后不再自动重试。完成、跳过、失败、被拒候选和 `usage` 可按项目或会话/任务查询。
- 复盘按决定逐项校验并隔离失败：合法决定及其材料结果在同一事务提交，非法决定只产生决定级原因，其材料保持 `pending` 并记录 `lastRejected`（运行 ID、代码、说明），可原样重试。运行状态为 `partial` 时返回被拒数量与原因；所有决定都无效时运行记为 `failed`，不写知识，状态与原因可查询；已有失败或终态运行不被改写。
- 无法安全建立提交图时保守拒绝相关决定：同一材料被多项决定引用、跨批引用材料、同一知识被多项决定修改。模型完全未处置的材料不算拒绝、不被消费，保留在 `pending` 并在运行记录的 `unhandled` 中列出。
- 改变旧结论、降级、替代仍要求针对该旧知识的明确反例；偏好仍要求明确用户表达；范围变化仍要求创建独立知识。这些门槛不因逐项隔离而放宽。复盘与提取提示词都要求：补充细节或新增执行要求应 `create` 独立知识，`revise` 只用于旧结论被明确反例推翻，避免把细化误报为修订而触发无谓拒绝；复盘提示词优先找“修完又返工”“不该接受就合并”“验证太薄”，并保留 Done right 正面例子。
- 学习启用时，入口在没有活动任务的情况下也读取常驻规则：只取 `status=active`、`maturity=stable` 或 `importance=critical`、且没有路径或版本范围的条目，按重要性、成熟度、标题排序，最多 3 条、合计 1,200 字符，超出预算的条目整条跳过、不截断正文。有活动任务时同时读取任务检索与常驻规则，按 ID 去重后进行注入预算。学习停用时即使目录残留知识也不注入常驻规则。入口去重键覆盖学习启用状态、任务知识版本与常驻规则版本；任一读取失败只产生降级提示，不阻塞入口。
- `select` 返回的条目和入口注入摘要附带由 evidence 派生的复发面 `seen`（不同日期数）、`incidents`（不同 `incidentId` 数）、`dates` 和 `lastSeen`（最近日期）；不改知识 schema，不参与成熟度计算或自动晋升。
- `learning status` 是只读漏斗报告，给出统计时点 `at` 和范围 `scope`，分开展示材料 `pending/waiting/processed`、证据类型计数、反馈 `shown/adopted`、最近运行状态与被拒原因、知识创建/修订/替代数、提取作业状态与用量，以及复盘和提取各自的当日额度。没有反馈记录时写“无记录”，不推断为“效果为零”；`knowledge select` 只读查询不计为 `adopted`。
- 材料、反馈与提取作业可按 `--session`、`--task` 过滤。指定会话时只计入带同一 `sessionId` 的记录，同任务其他会话不混入；缺少 `sessionId` 的记录不计入会话过滤结果，单独列为任务级或未知归属（`unattributed`，`scope: task-level-or-unknown`）。复盘运行和知识文件没有会话归属，按项目统计并在 `scope` 中显式标注，不与过滤后的材料计数混算。复盘与提取的 `todayStarted` 等额度字段按项目实际累计，与实际执行时的额度判定一致，并在 `limits` 与 `todayStartedScope` 标注 `project`。
- `learning digest --days` 是独立只读窗口摘要，默认 7 天，只接受 1–90 的整数；非法值拒绝并以非零码退出。输出 `window`（起止与天数）、窗口内 `materials` 状态、窗口内 `runs` 的 `completed/partial/failed/timeout` 与被拒/未处置数、窗口内知识 `create/revise` 与当前 `stable` 总数、当前常驻规则 `id/title/seen/dates/lastSeen`、窗口内同一 `incidentId` 出现至少 2 次的 `repeated` 材料、当前 `disputed` 知识/即时反例/待处理冲突的 `unresolved`、窗口内提取作业状态与候选数，以及窗口内 `feedback` 的 `shown/adopted` 计数并注明仅显式记录、不等于采纳或成功。摘要复用常驻规则的复发派生，不新增配置项，不改变 `learning status` 输出。

## 原因

- 只有批量复盘时，用户原话中的早期纠正可能在触发阈值前一直留在本机队列；在 `task-end` 后做一次受限提取，可以把明确的会话信号整理成带证据候选，同时不改变正式知识的写入权限。
- 原先任一非法决定会让整批运行失败，合法材料也无法提交，且无法定位是哪项决定有问题。逐项校验让失败影响面与决定一致，材料保留可重试。
- 材料、运行、知识、反馈和提取作业属于不同漏斗阶段，混成一个数字无法判断是“没有记录”“模型没跑”还是“候选被拒”；状态报告需要分开统计并明确统计范围。
- 模型输出和工具日志不能作为经验来源；只允许指向用户消息的证据并复用既有材料校验，避免会话摘要或工具输出被强行写成经验。

## 验收

- 被接受的 `task-end` 登记一次提取作业；同一信号重放、Stop 与普通 Hook 后作业数不变。禁用、禁止学习和无 transcript 时模型调用为零并返回对应跳过原因。
- 登记后的 transcript 继续追加时，旧作业仍只读取登记时固定的前缀，不把后续任务内容并入；文件被替换或截断、任务起点不可确认、旧作业缺少范围摘要时记为 `skipped`，不回退读取会话全文。同回合先结束 A、再启动 B 后重放 A 的 `task-end` 只查询 A 的作业，不为 B 提前登记。
- 早期用户纠正经最小脱敏 transcript 形成带 `transcript:<用户消息编号>` 证据的候选，写入 `inbox` 且不产生正式知识；无候选时允许零写入。仅引用助手消息或工具日志的候选被拒。`task:<当前taskId>` 只补充任务级事实，`validation:<当前validation.ref>` 可证明验证结论；其他任务或验证引用、偏好缺 `explicit=true` 或缺 transcript 用户消息证据、成功/失败缺 `verified=true` 或缺 transcript/validation 证据、只引用 `task:` 的验证均被拒。提取提示词包含任务事实、三类返工问题与 Done right 正面例子。
- transcript 不存在、读取失败、逐行 JSON 损坏、缺少会话身份、他人会话、相对路径、符号链接或真实路径不一致、超时和无效输出分别产生 `skipped`/`timeout`/`failed` 状态，任务结束仍被接受，正式知识为零；超时重试两次后不再自动运行。
- 自动 candidate 引用已有知识且为明确 correction 或已验证 failure 时，该知识不再被默认召回，同知识或同条件的 `waiting` 材料回到 `pending`；引用不存在知识时该候选被拒，不写 `inbox`。
- 超长工具输出不进入提示词，输入预算生效。
- 四项决定中仅一项缺少旧知识反例时运行 `partial`：其余三项提交，旧知识正文与重要性不变，被拒材料保持 `pending` 且记录原因。全部决定无效时运行 `failed`、不写知识、所有材料保持待处理。
- 多项决定引用同一材料、同一知识被多项决定修改时相关决定被拒；跨批引用只拒绝该项决定；部分成功提交遇到写入冲突时整批不写，保留材料并可通过 `--discard` 作废且不重复消费。
- 常驻规则仅在学习启用时读取：停用项目即使残留 `.workflow/knowledge` 也不出现 `standing`；无活动任务时只选 `active`、`stable` 或 `critical`、无路径或版本范围的条目，按重要性、成熟度、标题排序；超过 3 条或 1,200 字符的条目被整条跳过而不截断；有活动任务时与任务检索按 ID 去重；任一版本变化或重新启用都会重新注入，读取失败只给降级提示。任务检索的既有过滤、排序与预算不变。
- `select` 与入口摘要的复发面按 evidence 统计不同日期、不同 `incidentId` 和最近日期；重复事件、无效日期和非法 evidence 项不虚增计数，知识 schema 与成熟度不变。
- `learning status` 对含手动材料、提取候选、部分成功运行、旧知识和反馈的隔离项目给出分开且可核对的计数；范围对象区分 `filtered` 与 `project`。指定会话时，只带 taskId 的反馈、迁移材料等缺会话记录进入 `unattributed`，不计入 `filtered` 计数；同时指定任务和会话时同任务其他会话为零。额度字段与项目实际累计一致并标注 `project`；空反馈返回“无记录”。
- `learning digest` 默认 7 天，1 天与 90 天边界可用，0、91、非整数和非数字被拒且 CLI 退出非零。空窗口给出完整零值分桶；有数据时各分桶按窗口统计，重复项按同一 `incidentId` 至少 2 次聚合，未解决项包含 `disputed`、即时反例与 `conflict/kept` 运行，反馈注明仅显式记录。调用前后状态文件与反馈记录不变，未记录 `shown`。
- 既有材料、召回、成熟度、冲突与恢复测试保持通过，状态文件 schema 版本不变。

## 边界

- 不读取或提交真实聊天记录；测试只用人工重写的最小脱敏 transcript，真实运行只读宿主提供的 `transcript_path`。
- 不新增运行时依赖、常驻服务或复杂并发；提取作业复用既有隔离执行器，不扩大执行器权限，也不允许模型调用工具或网络。
- 不自动晋升成熟度，不改变任务检索的召回过滤与排序，不把展示次数或 `select` 查询当作成功或采纳；常驻规则只读取已有条目，不自动提升重要性或写成正式知识。
- 提取候选只进入本机 `inbox`，正式知识仍只能由复盘事务、手动 `knowledge revise` 或显式写入流程产生。
- `learning digest` 只读，不写状态、不调用模型、不记录 `shown`；默认天数与窗口上限是常量，不新增配置项，也不改变 `learning status` 输出。
- 已开始作业的重试只受尝试次数约束，不能被每日额度无限延长；也不为提取新增独立调度器，执行点仍是既有 `learning tick`。
- 任务准备、`PreToolUse` 开工门禁（含计划路径与系统临时目录放行、`Explore`/`Plan` 提示）、压缩恢复时的核心纪律上下文以及 `task show`（含 `reviewWaived`）/CLI 帮助的展示变化不改变学习事件识别、候选提取、复盘决定、召回和成熟度；工具结果与工具调用仍不进入提取输入。
- 决策升级提醒（`workflow-gate.json` 路径规则与可选 jev，含会话级提醒去重）、只读子代理的放行和顾问咨询记录写入，都不改变学习事件识别、候选提取、复盘决定、召回与成熟度；这些 hook 分支不读写 transcript 或学习材料。
- 适配器识别的宿主消息（Herdr GUI `<hc from="…">`、Cindy `[Task delivery] Host bookkeeping`）仍开新回合和票据，但不是用户回合：不撤销在途包、`waiting-user` 时不作为用户回答，也不改变学习事件识别、提取作业与任务结束语义。附加配置位置安装同样不改变学习行为。

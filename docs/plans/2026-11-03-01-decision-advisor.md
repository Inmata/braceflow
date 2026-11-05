# 三层模型分工与重要决策升级计划

状态：W1 已交付（初始提交 `cf90259`，R1 FIX 返修已提交 `cd3c604`）；W2 已实施（最终提交 `fcce6ec`）；W3 已实施（实测与适配）；W4 已实施并完成第二轮（spec 正文同步与门禁模板发布，待 R1 审查）。技术方案与分包草案见第 4–6 节；逐包 Agent/model/effort、通道与“开工”已确认。代码基线：分支 `fix/herdr-tui-acceptance`。

## 1. 目标

给 Lead 减负，不改 workflow 现有的 Lead / Worker / Reviewer 结构：

- Lead 主会话用较便宜的模型，负责对齐、分流、准备、派活、记账、验收，不写复杂代码。
- 增加一个只读“探索者”，并行读文件和文档，只回摘要。
- 增加一个只读“顾问”，在重要决策前给第二意见。
- “何时必须问顾问”的规则属于插件，不放个人 `CLAUDE.md`。

## 2. 已确认的需求

| 编号 | 议题 | 结论 |
| --- | --- | --- |
| R1 | 宿主范围 | 只做 Claude Code；两个子代理定义随插件分发 |
| R2 | Lead 主会话 | 网关 `group/lightlead`：Sonnet medium，额度不够时换 6.1terra high |
| R3 | 探索者 | 网关 `group/worker`：medium；只读，不写文件、不派工、不占包记账 |
| R4 | 顾问 | 网关 `group/lead`：Opus 5.5 优先，后接其他强模型，medium；只读，不兼任代码审查 |
| R5 | Worker / Reviewer | 沿用现状，按包由用户指定，本次不改 |
| R6 | 触发判断 | 三道检查，任一命中就拦下动作并要求先问顾问：信号清单、路径规则、jev |
| R7 | 信号清单 | 提交分包方案；扩大改动范围；审查 FIX 后的返修方向；带未完成验收项收尾 |
| R8 | 已删除项 | 推送、打标签、发布不纳入 |
| R9 | 安全与权限边界、数据迁移 | 保留。识别方式：路径规则加 jev |
| R10 | jev | 做。插件直连网关 `http://127.0.0.1:3425/v1/systemone`，模型 `typesafe/jev-latest`；网关不可达或超时时跳过 jev，提示一次，不阻断 |
| R11 | 探索者约束 | 写进 Lead 指引的软约束，不做 hook 读取计数 |
| R12 | 顾问通道 | 内置 Agent 子代理，不带 `workflow-package` 标记 |

名词：

- **安全与权限边界**：改变“谁能做什么”的代码，如 hook 放行与拦截规则、`allowedPaths` 默认值、凭据读写、安装器改写宿主配置。出错常不报错，只是悄悄放行。
- **数据迁移**：已保存数据的格式变化，如 `STATE_VERSION`、信号 `SCHEMA_VERSION`、旧会话记录转换。出错时旧数据读不出，难回滚。

## 3. 触发判断要点

触发判断见 R6。三道检查：

| 检查 | 抓什么 | 说明 |
| --- | --- | --- |
| 信号清单 | `prepare`、`task-update`、`packages`、`task-end` 中的 R7 四项 | 确定性，无新依赖 |
| 路径规则 | 写入安全类或迁移类路径 | 路径清单由项目配置；具体默认值待定 |
| jev | Lead 写在信号里的描述 | 只能看到 Lead 写出来的文字；兜“写了但低估”，兜不住“没意识到” |

边界：

- hook 只能拦下动作并提示，不能强迫 Lead 调用顾问；咨询是否发生只能靠记录核对，核对的是“咨询过”，不是“决策正确”。
- 简单 `lead-direct` 任务和 `operation-only` 任务不受影响（待实施时核对）。
- jev 同步调用会增加 `PreToolUse` 延迟，需设短超时，超时按未命中处理。
- 插件直连网关会让 workflow 依赖 magpie：做成可选适配，默认关闭，配置给出网关地址与模型。

## 4. 宿主事实与 W1 真机实测（2026-11-03）

官方文档事实（来源 code.claude.com 的 sub-agents、plugins/components、hooks）：

| 事项 | 结论 |
| --- | --- |
| 子代理 `model` 字段 | 可写别名（`sonnet/opus/haiku/fable`）、完整模型 ID（同 `--model`）或 `inherit`。W1 真机实测：网关组名 `group/read`、`group/lead` 被接受并实际路由；宿主同时打印 `unrecognized_model` 警告。见 4.1 |
| 子代理 `effort` 字段 | 支持，取值 `low/medium/high/xhigh/max`，覆盖会话档位。当前两个定义都写 `medium`；实际下发值仍未验证，见 4.1 |
| 子代理定义文件 | 放 `agents/*.md`，`name`、`description` 必填；`tools` 可限定为只读，`disallowedTools` 可去掉写入类工具。W1 实测：安装器写入 `<configDir>/agents/*.md` 后，宿主能发现并调用。见 4.1 |
| 插件分发的限制 | 插件子代理会忽略 `permissionMode`、`hooks`、`mcpServers`；只读靠 `tools` 白名单实现 |
| 命名 | 子代理 `name` 不能含 `:`；插件分发时对外名为 `插件名:name`。W1 按用户裁决走用户级 `agents/`，真机实际调用名为裸名；带 `workflow:` 前缀的真机调用未验证。见 4.1 |
| 子代理内的 hook | `PreToolUse/PostToolUse` 在子代理内同样触发，输入带 `agent_id`、`agent_type`，可据此识别顾问调用 |

实施前待实测（W1 相关项已在 4.1 实测；W2/W3 项仍待验证）：

| 事项 | 影响 | 状态（2026-11-03） |
| --- | --- | --- |
| `model: group/lead`、`group/read` 能否被接受 | 决定定义文件写网关组名还是模型 ID | W1 已验证：接受并实际路由；见 4.1 |
| 安装方式能否把 `agents/*.md` 装到 Claude Code 能发现的位置 | 决定子代理定义的分发路径 | W1 已验证：用户级 `<configDir>/agents/` 被发现并调用；见 4.1 |
| Agent 调用时 `subagent_type` 实际取值（带不带插件前缀） | 决定放行与识别的匹配写法 | W1 已验证：父级 `subagent_type` 为裸名 `workflow-explorer` / `workflow-advisor`；见 4.1 |
| `/v1/systemone` 的请求字段与延迟 | 决定 jev 超时与阈值 | 未验证（W3）；当前只依据用户截图 |
| `STATE_VERSION` / `SCHEMA_VERSION` 是否需要升级 | 咨询记录若放进任务状态就要升级；放进单独记录则不用 | W2 结论：不升级。咨询记录仍是单独文件；门禁只读现有任务/准备字段，不新增 `verdictAt` |

用户裁决（2026-11-03）：分发路径选 A，安装器写入用户级 `<configDir>/agents/`；原“装不进时停下、不自行改走用户级目录”的前置条件已解除，W1 已按此实现。

### 4.1 W1 真机实测结果（2026-11-03）

测试环境：隔离的 `CLAUDE_CONFIG_DIR`，路径 `C:/Users/example/AppData/Local/Temp/wf-w1-real-agents-1793675977/config`；安装器在该目录下写入 `agents/workflow-explorer.md` 与 `agents/workflow-advisor.md`，未使用真实 `~/.claude`。两份定义与仓库 `agents/` 的 SHA-256 分别一致：`3bfd4e147fc8d441271b3d9c15ecb34312ef495eda67935b6aa8fb66b99c5441`、`52c0f753d283ae780547d46c412d33e8d04793d1ce879438d2f3b8396b088ccb`。

证据根目录：`C:/Users/example/AppData/Local/Temp/wf-w1-real-agents-1793675977/`

| 已验证项 | 实际值 / 证据 | 证据路径 |
| --- | --- | --- |
| 用户级 agents 目录发现 | 宿主以 `query_source: agent:custom:workflow-explorer`、`agent:custom:workflow-advisor` 发起子代理请求，说明 `<configDir>/agents/*.md` 已被发现并加载 | `fix-explorer-debug.log`、`fix-advisor-debug.log`；stderr 分别含 `agent:custom:workflow-explorer`、`agent:custom:workflow-advisor` |
| 探索者模型 | `modelUsage["group/read"].canonicalModel = "group/read"`；子代理请求源为 `agent:custom:workflow-explorer` | `fix-explorer-result.json`、`fix-explorer-debug.log` |
| 顾问模型 | `modelUsage["group/lead"].canonicalModel = "group/lead"`；子代理请求源为 `agent:custom:workflow-advisor` | `fix-advisor-result.json`、`fix-advisor-debug.log` |
| 父级 `subagent_type` 实际取值 | `workflow-explorer`、`workflow-advisor`（裸名，无 `workflow:` 前缀） | 宿主会话 JSONL：`config/projects/C--Users-example-AppData-Local-Temp-wf-w1-real-agents-1793675977-project/session-7.jsonl`、`config/projects/C--Users-example-AppData-Local-Temp-wf-w1-real-agents-1793675977-project/session-8.jsonl` |
| 子代理内部 `agent_type` 实际取值 | 调试日志 `agentType=workflow-explorer`、`agentType=workflow-advisor`（裸名） | `fix-explorer-debug.log`、`fix-advisor-debug.log` 的 `agent_completion` 行 |
| 顾问咨询记录 | 顾问结束后写入会话记录：`subagentType: "workflow-advisor"`、`question: "Choose ship now vs wait"`、`taskId: null` | `state/consultations/75febce29625d575fabfbe1c9fd3d8ebe926211a2471cd6247741282f0f51ba3.json` |
| 模型告警与路由 | stderr 打印 `[claude-code:unrecognized_model] {"model":"group/read"...}` / `{"model":"group/lead"...}`，但请求按 `group/read`、`group/lead` 完成 | `fix-explorer-stderr.log`、`fix-advisor-stderr.log` |

未验证项：

| 未验证项 | 现状 / 原因 |
| --- | --- |
| `effort` 实际下发值 | 宿主调试日志未输出子代理 effort；只能确认定义被接受且子代理成功运行 |
| 带 `workflow:` 前缀的真机调用 | 本轮真机只调用裸名；前缀名仅由钩子测试覆盖，未在真实宿主验证 |
| 真实 `~/.claude` 的卸载与同名冲突 | 按要求只用临时 userDir 集成测试覆盖，未对真实用户配置执行 |
| 交互式 Lead 会话回传 | `claude -p` 下首轮 `Agent` 完成只返回“报告已送达”，父模型未拿到正文；`SendMessage` 可向同一子代理取回，见早期 `advisor2-result.json`；需交互式 Lead 会话复核 |

边界：上表“已验证”只证明定义被发现、子代理被调用、请求使用指定网关模型，以及顾问咨询记录写入；不证明 `effort` 档位、回传内容或真实用户配置上的卸载/冲突行为。未验证项不得写成已验证。

### 4.2 W3 jev 真机实测与定稿参数（2026-11-03）

测试对象：本机网关 `http://127.0.0.1:3425/v1/systemone`，模型 `typesafe/jev-latest`。请求与响应字段、延迟和失败表现均按下列样本实测；样本是本机单次测量，不代表其他机器或长期负载。

已验证项：

| 已验证项 | 实际值 / 证据 |
| --- | --- |
| 请求字段 | `POST` JSON `{model, state, questions}`；`state` 为任意 JSON（实测用 `{action, description}`）；`questions` 为按 ID 索引的对象，`{type:"choice", instructions, criteria:{consult, routine}}` 被接受并返回结果 |
| 响应字段 | `{model, answers:{escalate:{type:"choice", choice, confidence, probabilities:{consult, routine}}}, usage:{input_tokens, output_tokens}}`；实际 `model` 返回快照名 `jev-1.14.0` |
| 典型延迟 | 预热后 15 次采样：最小 239ms、中位 249ms、最大 297ms；约 1900 input tokens 的长文本 319ms；安全/迁移样本 282–284ms |
| 冷启动延迟 | 网关空闲后的首次请求 728ms（本次仅 1 个样本） |
| 判定样本 | 描述“改 hook 放行规则、allowedPaths 默认值与安装器” → `consult` 0.99；“改 STATE_VERSION 并转换旧记录” → `consult` 1.0；改注释与变量名 → `routine` 1.0；W3 自身的适配器实施说明 → `routine` 0.71–0.75 |
| 超时表现 | 本地无响应服务 + `AbortSignal.timeout(2000)`：2026ms 抛 `TimeoutError`，无残留下半段响应 |
| 拒连表现 | 未监听端口：约 27ms 抛 `TypeError: fetch failed`，`cause.code=ECONNREFUSED` |
| 坏响应表现 | 200 返回非 JSON、200 缺少 `answers`、500：适配器均能识别并按未命中处理 |
| 非法模型 | 返回 400 `{"error":{"type":"invalid_request_error","message":"does-not-exist is not a model of TypeSafe Jev"}}` |
| 本机鉴权 | 不带 `Authorization` 请求仍返回 200；适配器仅在网关地址为本机回环时附加环境变量 `TYPESAFE_API_KEY` 的 Bearer，密钥不写入仓库、日志或文档 |

未验证项：

| 未验证项 | 现状 / 原因 |
| --- | --- |
| 2 秒边界发生在真实网关慢响应时 | 只用本地不响应服务验证客户端超时；未构造真实网关 1.5–2.5 秒的慢响应 |
| 429 / 5xx 的真实重试与限流行为 | 适配器有意只发一次请求、不重试；网关侧限流表现未实测 |
| 其他机器、网络与长期负载下的延迟 | 仅本机 15 次采样；冷启动只有 1 个样本（728ms） |
| 判定准确率 | 只测了 4 类描述；模型把 W3 自身说明判为 `routine`，说明判断存在偏差，不能当作决策正确性证明 |
| 同步调用对并发会话锁等待的影响 | 调用发生在信号状态锁内，最长 2 秒（`src/jev.mjs` 超时）；普通事件等待状态锁的预算为 1.5 秒（`src/hooks.mjs` 的 `LOCK_BUDGET.normal`，`src/store.mjs` 的 `withLock` 按该 `budgetMs` 计时）。慢请求期间其他会话可能先耗尽预算并收到 `LOCKED`。并发场景未实测 |

定稿参数与依据：

- 超时 `2000ms`。预热后最大 297ms、冷启动 728ms，2 秒留出约 2.7 倍冷启动余量；超时按未命中处理，不阻断信号。
- 命中条件为 `choice === "consult"` 且 `probabilities.consult >= 0.5`。只有一个 Choice 问题，两个选项下 `choice` 本身即最大项；再要求概率过半，避免把低置信度当结论。
- 参与判断的信号与字段：`prepare`（`solution.summary`、`solution.decisions[].decision`、`requirements[].summary`、`research[].conclusion`、`packages[].scope`）、`task-update`（`goal`、`preparationTarget.goal`、`preparationReason`、内联 `preparation.solution.summary`）、`packages`（各包 `scope`/`note`、`change.summary`/`change.reason`）。`task-start` 不单独送判：复杂任务的目标已在 `prepare` 送判，简单任务不参与门禁。
- 只对复杂准备与复杂写入任务调用，简单、只读、计划、`operation-only` 任务不调用。`prepare` 阶段没有任务身份，按准备记录声明的大小判断（只送 `complex`），并同时看可信会话的宿主权限模式和会话当前活动任务声明的权限模式（不采信 `prepare --task` 指向的其他任务）；`operation-only` 任务不送判。`task-update` 按更新后的模式判断：`read-only`/`plan` 改为 `write` 仍送判，`write` 改为只读/计划时不送判。
- 未命中、拒连、超时、非 2xx、坏 JSON、缺答案、配置损坏一律按未命中处理；同一会话只提示一次，提示写入会话标记并跨回合保留。配置损坏只让 jev 不生效，不影响路径规则。

## 5. 技术方案

### 5.1 两个子代理定义

- `workflow-explorer`：`model` 取 `group/worker`，`effort: medium`，`tools: Read, Grep, Glob`，说明里写清只回摘要、不写文件、不派工。
- `workflow-advisor`：`model` 取 `group/lead`，`effort: medium`，`tools: Read, Grep, Glob`；说明里写明输入是“决策问题＋选项＋已知证据”，输出是“建议＋理由＋最大风险”，不做代码审查。
- 放行：`src/hooks.mjs` 现有 `READ_ONLY_SUBAGENTS` 只认 `Explore`、`Plan`。扩充为同时认这两个名称，使准备期可调用；开工后无 `workflow-package` 标记的只读子代理本就不占包，需实测确认不被其他规则拦。

### 5.2 咨询记录

- 顾问子代理结束时，由 `PostToolUse`（Agent 工具、`subagent_type` 为顾问）自动写一条咨询记录：时间、问题摘要、所属任务。写在会话级记录里，不动任务状态结构，因此预期不升级 `STATE_VERSION`。
- 记录只证明“问过”，不证明采纳或正确。

### 5.3 三道检查（门禁）

信号清单、路径规则与 jev 已按用户裁决落地。未升级 `STATE_VERSION`（仍为 2）、信号 `SCHEMA_VERSION`（仍为 1）与 `CONSULTATION_SCHEMA`（仍为 1），未新增 `verdictAt`。

适用范围：

- 只对 `task.size === 'complex'` 的写入任务生效；`operation-only`、`read-only`、`plan` 模式，以及没有 `task.size`/准备快照的历史任务保持原行为。
- `prepare` 阶段尚无任务身份，单独按会话记录核对，不受上面 `task.size` 限制：只要本次准备带 `packages` 就要求咨询。

信号清单（均先核对咨询记录，不判断决策质量或是否采纳）：

- 提交分包方案：`prepare` 的 `packages` 非空时，要求当前会话在本份准备之前留下咨询记录；锚点是上一份准备的 `preparedAt`，只接受 `taskId` 为空或属于当前会话任务的记录。
- 扩大改动范围：`task-update` 的业务 `allowedPaths` 增加（计划文档除外），或同一信号在准备记录里新增工作包；要求本任务的咨询记录晚于最近一次已保存变化。仅同步计划文档、改目标但未扩路径、调整已有包备注不触发。
- 审查 FIX 后返修方向：`packages` 信号到达时，若任务当前存在任一 reviewer `verdict=FIX`，且本批新建或重派 worker 包，要求本任务咨询；只读诊断包不计。
- 带未完成验收项收尾：`task-end` 的 `validation.acceptance` 存在任一非 `verified` 状态时，要求本任务咨询；全部 `verified` 不触发。

路径规则：

- 项目根新增配置 `workflow-gate.json`，格式为 `{"schemaVersion":1,"pathRules":{"security":["<glob>"],"migration":["<glob>"]}}`；插件不自动写入项目配置，文件缺失或规则为空即不生效。发布副本提供 `workflow-gate.example.json` 通用模板，由项目复制后自行维护，不作为项目默认配置。
- 只核对 `task-update` 的业务路径增量和实际写入，不核对 `task-start` 的初始 `allowedPaths`。路径按项目相对路径匹配，声明目录时目录本身及其下文件都算命中。
- 配置不是有效 JSON、含未知分类或字段类型不对时，路径规则不生效，但把错误带回：`task-update` 回执带 `pathRulesError`，实际写入返回 `systemMessage`。不因配置损坏阻断现有写入。
- 本仓自用配置写入根目录 `workflow-gate.json`，不作为插件默认值：`security` 覆盖 `src/hooks.mjs`、`src/protocol.mjs`、`src/install.mjs`、`src/consult.mjs`、`src/advisor-gate.mjs`、`src/jev.mjs`、`src/adapters/*.mjs`、`agents/*.md`、`hooks/*.json`；`migration` 覆盖 `src/store.mjs`、`src/signal.mjs`、`src/preparation.mjs`、`src/learning.mjs`、`src/capture.mjs`、`src/protocol.mjs`、`src/consult.mjs`。

jev 适配（W3）：

- 配置 `workflow-gate.json` 新增可选 `jev: {enabled, endpoint, model}`；缺省或 `enabled: false` 即关闭，`schemaVersion` 仍为 1。本仓配置保留关闭状态的网关地址与模型作为形状说明。
- 开启后对 `prepare`、`task-update`、`packages` 中 Lead 写的描述发一次 `POST {model, state, questions}`，2 秒超时；命中时按与信号清单相同的咨询记录门禁要求 `consult:jev`。
- 超时、拒连、非 2xx、坏响应与配置损坏按未命中处理；同一会话只提示一次。密钥只从环境变量 `TYPESAFE_API_KEY` 读取，且只在网关地址为本机回环时随请求发送，不写入仓库、日志或文档。

咨询记录核对：

- 任务级检查跨会话扫描项目中全部 Lead 会话的咨询文件，按记录里的 `taskId` 匹配；角色会话不参与。
- 咨询记录只在任务 active 且当前会话不是角色会话时写入 `taskId`；`task-end` 之后或角色会话写 `null`。
- 记录文件损坏时按“缺失”失败关闭：拒绝信号或写入，回执点明无法解析，保留原文件不覆盖。
- 没有 `verdictAt`：FIX 之后只能做结构判断，时间锚点取最近一次已保存变化；这能拦住“完全没问过”，不能证明咨询发生在 FIX 之后，也不证明建议被采纳。

### 5.4 Lead 指引

在 `docs/roles/lead.md` 增加：何时派探索者、何时问顾问、探索者的软约束（只用来读和摘要，不让它派工或写文件）。

## 6. 实施包与执行顺序（草案）

所有开工前检查和实测都在包内由 Worker 完成，Lead 不读代码、不做实测，只保存准备记录、派发、记账、验收。

| 包 | 内容（按先后） | 主要文件 |
| --- | --- | --- |
| W1 | ① 只读重读已过期的项目对齐索引变化文件（15 项），不改业务文档；② 实测：`model` 写 `group/read`、`group/lead` 是否被接受，`effort: medium` 与网关档位的关系，`subagent_type` 与 `agent_type` 实际取值，安装器能否把 `agents/*.md` 装到可发现位置，开工后只读子代理是否仍被放行；③ 两个子代理定义；④ 安装分发；⑤ 放行白名单；⑥ 咨询记录写入。分发路径按用户裁决 A：安装器写入用户级 `<configDir>/agents/`。W1 已交付（`cf90259`、`cd3c604`），R1 PASS | `agents/`、`src/install.mjs`、`src/hooks.mjs` |
| W2 | ① 读代码确认 `STATE_VERSION`/`SCHEMA_VERSION` 是否要升级，并列出路径规则默认清单候选，交回 Lead 给用户确认后再继续；② 信号清单与路径规则门禁；③ 单测 | `src/protocol.mjs`、`src/hooks.mjs`、测试 |
| W3 | ① 实测 `/v1/systemone` 的请求字段与延迟，定超时与阈值；② jev 可选适配（默认关闭、超时降级、提示一次）；③ 单测 | 新增适配文件、`src/hooks.mjs` 调用点 |
| W4 | Lead 指引、协议/用法/验收文档、发布白名单与 `package.json` 同步；随发布副本提供门禁模板 | `docs/roles/lead.md`、`docs/design/protocol.md`、`docs/usage.md`、`docs/acceptance.md`、`workflow-gate.example.json`、`package.json`、`src/install.mjs`（仅发布清单） |
| R1–R4 | 逐包独立审查：R1 审 W1、R2 审 W2、R3 审 W3、R4 审 W4（交付差异与直接依赖） | 只读 |

逐包选择（用户 2026-11-03 回答）：

| 包 | Agent | 模型 | effort | 通道 |
| --- | --- | --- | --- | --- |
| W1–W4 | Claude Code | `group/worker`（带不带 1m 均可） | high | Herdr TUI 委派 |
| R1–R4 | Codex | `group/reviewer` | high | Herdr TUI 委派 |

顺序与理由：

- W1 → W2 → W3 串行：三包都改 `src/hooks.mjs`，同文件同一状态机只能一个负责人；W2 依赖 W1 的咨询记录；W3 依赖 W2 的检查入口。
- W4 可在 W2 完成后与 W3 并行：只改文档，不碰 `src/`。
- 每个 worker 包交付后立即由对应 reviewer 独立审查；审查 FIX 则同一 packageId 返修后再审，PASS 后才进入依赖它的包。若 W1 实测发现分发路径装不进，先停下回到用户确认，再继续。

## 7. 约束

- 本方案新增信号与门禁，按全局规则属于新增流程，必须经用户确认并单独说“开工”后才实施。
- 实施须先完成技术方案、分包、逐包 Agent/model/effort 与通道确认。
- 文档不写密钥；网关地址与模型 ID 以用户配置为准。

## 8. 验收条件（草案）

- 命中检查的动作在无咨询记录时被拒，提示指向顾问和所需上下文；有记录后通过。
- 简单任务、只读任务不受影响。
- jev 关闭或网关不可达时，行为与只有前两道检查一致。
- 探索者与顾问定义随插件安装到 Claude Code，权限只读。
- `npm run verify` 通过；新增行为有真实实现的单测。
- 真实宿主验证：新会话中确认顾问与探索者被实际调用并使用了指定网关模型；未验证前文档不写“已验证”。

## 9. 进展

- 2026-11-03：需求澄清完成。
- 2026-11-03：技术方案与分包草案写入（第 4–6 节），宿主事实已查官方文档；用户已逐包指定 Agent/model/effort 与通道（见第 6 节）；“开工”待单独确认。
- 2026-11-03：W1 交付（初始提交 `cf90259`）：两个只读子代理定义、用户级 `agents/` 分发、hooks 放行、会话级咨询记录与测试。
- 2026-11-03：R1 审查结论 FIX；本轮把真机证据写入第 4 节，并补测用户级 `agents/` 的发现与裸名调用；未改业务代码。W2–W4 未开始。
- 2026-11-03：W2 第一阶段只读调查完成：确认不升级 `STATE_VERSION`/信号 `SCHEMA_VERSION`/`CONSULTATION_SCHEMA`；路径规则不预置插件默认值；给出第二阶段接入点与测试清单。用户逐项裁决后进入实施。
- 2026-11-03：W2 第二阶段实施完成：新增 `src/advisor-gate.mjs` 与本仓 `workflow-gate.json`；在 `prepare`、`task-update`、`packages`、`task-end` 接入信号清单门禁，在实际写入接入路径规则；咨询记录按任务 active/非角色会话写 `taskId`，支持跨 Lead 会话聚合与损坏失败关闭；补齐门禁单测并同步修正既有夹具。`.spec` 正文与 `docs/roles`、`docs/design`、`docs/usage`、`docs/acceptance` 未改（W4 范围）。
- 2026-11-03：W3 实施完成：实测本机 `/v1/systemone` 的请求/响应字段、典型与冷启动延迟、超时、拒连、坏响应和非法模型；结果与定稿参数写入 4.2。新增 `src/jev.mjs` 可选适配（默认关闭、2 秒超时、失败按未命中、同会话提示一次），在 `prepare`/`task-update`/`packages` 复用现有咨询记录门禁；配置扩展 `workflow-gate.json` 的 `jev` 字段，未升级任何状态或信号版本。新增 `test/jev.test.mjs`，用本地假 HTTP 服务覆盖关闭、命中、未命中、超时、拒连、坏响应与配置损坏。
- 2026-11-03：R3 审查 W3 结论 FIX，原位返修：复杂准备按可信会话的宿主权限模式判断，只读/计划会话不再请求 jev；简单、只读、计划、operation-only 四类跳过场景补真实入口测试；jev 响应中未声明的 choice 按坏响应处理并提示一次；4.2 补明同步调用占用状态锁与其他会话 1.5 秒等待预算的后果，仍标为未实测。
- 2026-11-03：R3 第二次返修：`prepare` 的 jev 适用判断同时核对当前活动任务声明的 `permissions.mode`，宿主为 `default` 而任务为 `read-only`/`plan` 时也不请求；补对应真实入口测试，其余已通过项不变。
- 2026-11-03：R3 第三次返修：任务权限跳过只作用于 `prepare`，`task-update` 改按更新后的模式判断（read-only/plan→write 送判，write→read-only 不送判）；`prepare` 的权限核对固定取会话当前活动任务，不采信 `--task` 指向的其他/不存在任务；补两组真实入口测试。
- 2026-11-03：W4 实施完成：Lead 指引、公共方法、协议、使用说明、README 与验收记录写明三层模型分工、两个只读子代理、咨询门禁（信号清单与 `workflow-gate.json` 路径规则）和可选 jev；核验 `agents` 已在发布白名单与 `package.json files` 中，`workflow-gate.json` 按计划保持项目级、不随插件发布；运行 `spec check` 并把 `install-onboard`、`learning-knowledge`、`task-protocol` 的漂移点与建议改法写入验收第 15 节，未修改任何 `.spec` 正文。`npm run verify` 通过（tests 498 / pass 495 / fail 0 / skipped 3）。路径规则真机交付、`effort` 下发和 jev 同步锁影响仍按未验证记录。
- 2026-11-03：W4 第二轮按用户拍板完成：更新 `install-onboard`、`learning-knowledge`、`task-protocol` 三份 spec 正文，使 spec 检查无漂移；新增随发布副本分发的 `workflow-gate.example.json` 通用模板，加入 `package.json files` 与 `RELEASE_PATHS`，不预置本仓路径规则；使用说明、README/README.en 与 Lead 指引补启用步骤、字段缺省、命中表现和调整方式。路径规则真机交付、`effort` 下发和 jev 同步锁影响仍未验证。
- 2026-11-03：逐包审查结论：R1 PASS@`cd3c604`、R2 PASS@`fcce6ec`、R3 PASS@`5c79c78`（第三次返修后）、R4 PASS@`addeef9`（第三次复审）。`npm run verify` 在 `addeef9`、工作树干净时通过，`spec check --ref addeef9` 无发现。五条验收均登记 verified，未验证项（路径规则真机交付、子代理 `effort` 下发值、jev 同步调用占用状态锁的影响）写入各条证据。
- 2026-11-03：`task-end` 收尾时 spec 预检实测约 3.3 秒，逼近 4 秒预算，在内存紧张时返回 `spec-check:git` 被拒；已另开 `task-spec-budget` 把预算放宽到 8 秒。本机安装的发布副本不含 `advisor-gate.mjs` 与 `consult.mjs`，咨询门禁和两个子代理在真实宿主中尚未触发过，需重新安装本仓后才能做真机确认。
- 2026-11-03：按用户选择调整模型：探索者改为 `group/worker` / `medium`，顾问改为 `group/lead` / `medium`（Opus 5.5 优先）；第 2、4、5 节与验收计划同步。W1 记录的 `group/read` 真机路由证据保留为历史结果。

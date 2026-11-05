# Lead 上下文控制、子代理管理与 Trajectory 实施计划

状态：需求草案、逐包 Agent/model/effort 与 Herdr TUI 通道已确认；用户批准 32 次评测、不设金额上限。本地基线整理已完成，新功能尚未开工。

代码基线：`integration/learning-eval-baseline` @ `a9f60e4`（已整合学习闭环、真实宿主评测、现有探索者配置及历史计划）。原工作区继续保留在 `fix/herdr-tui-acceptance` @ `7e896c7`。

工作区未提交内容（2026-11-05 核对）：

| 类型 | 路径 |
| --- | --- |
| 已修改 | `agents/workflow-explorer.md`、`docs/plans/2026-11-03-01-decision-advisor.md`、`docs/plans/README.md`、`test/install.test.mjs` |
| 未跟踪 | `docs/plans/2026-11-03-02-herdr-learning-acceptance.md`、`docs/plans/2026-11-03-03-evaluation-harness.md`、本计划 |

基线整理已完成（用户 2026-11-05 授权）：在独立 worktree 从干净学习副本 `2e5bfc5` 接入 `e30b7eb..7e896c7` 的评测增量，保存现有配置、对应测试和历史计划，公开副本已脱敏。整合提交为 `a9f60e4`；原工作区、原分支和用户文件均保留。新计划与索引单独保存到 `feat/lead-context-trajectory`，后续 3.3 以 `a9f60e4` 为基线。

已确认的分支事实：

- 当前分支包含评测功能；原学习分支在 `e30b7eb` 分出，后来新增学习规则注入与 digest。
- 原学习分支因历史含本机路径与会话标识被推送检查拦下，已重建为远端 `acceptance/learning-20261103` 的干净副本。两份学习分支的运行代码一致，差异在 5 份文档。
- 普通合并干净副本会因压缩历史失去真实共同基点而产生冲突；以 `e30b7eb` 计算评测增量整合则无冲突。
- 基线验证：复用试整合的全测结果（564 项，561 通过、3 跳过、0 失败）；接入配置及替换夹具标识后，安装测试 30/30、评测测试 46/46 通过。仓库一致性检查与合成 demo 通过；完整全测未重复执行。
- 新整合分支通过现有 pre-push 检查的本地预检，未执行推送；`main` 与原工作区分支未变。
- 历史真实验收反馈见 `2026-11-03-02-herdr-learning-acceptance.md` 第 7 节：26 PASS、3 FAIL、4 NOT-TRIGGERED、1 BLOCKED。B02/C01 均因探索者全程未调用，F01 因收尾账本版本与最终推送版本不一致。学习功能交付不等于 Lead 减负已验收。

## 1. 目标

让 workflow 的 Claude Code Lead 少读原始材料，同时做到调查质量不降、整项总成本下降。

配套三件事：子代理能自由管理，hook 决策能用 Trajectory 追溯，效果能用评测说清。

**首要验收：** 同一任务质量达标后，整项任务总成本下降。Lead 变轻只是过程指标。

## 2. 需求

### 2.1 已确认的决定

| 决定 | 内容 |
| --- | --- |
| 生效范围 | workflow 中 Claude Code 的 Lead 路径 |
| 顾问 | 按需给第二意见，取消强制咨询门禁 |
| 路径规则与 jev | 命中时只提醒，不拦截 |
| Trajectory | 引入；同时服务日常 Lead 排查和隔离评测 |
| 日志结构 | 宿主 transcript 当全局骨架，workflow 只补规则原因，离线生成 |
| 外部工具 | 本轮不引入 Harbor 和 ATIF |
| 故障处理 | 辅助子代理失效时，Lead 有界接手 |
| 退出方式 | 无痛取消降为次要，保留基本退路 |

### 2.2 需求与验收

| ID | 需求 | 验收 | 负责包 | 检查入口 |
| --- | --- | --- | --- | --- |
| Q1 | 调查可靠（用户 2026-11-05 决定延期，验收标 deferred） | 代表任务关键结论正确，证据定位到文件或日志行；缺证据时标未确认 | W5 | context 套件答案断言 |
| Q2 | Lead 减负 | 代表任务 Lead 收到的原始材料低于基线；后续几轮目标、决定、未确认项仍准确；已知位置的小读取不委派 | W5 | context 对比报告 |
| Q3 | 子代理可自由管理 | 改 model/effort 后开新会话即生效；手改后升级、卸载不报冲突；删除的角色不被补回；测试不写死模型值；只读豁免按工具能力判断 | W3 | `test/install.test.mjs`、`test/subagents.test.mjs`、隔离宿主 |
| Q4 | pwsh 下输出控制（用户 2026-11-05 决定移出本轮，验收标 deferred） | 本轮不做 PowerShell 输出控制；W0 实测结论留作后续依据：rtk 只改写 POSIX 风格命令，PowerShell 原生 cmdlet 不被改写或过滤 | W0（仅实测） | W0 的 A7 实测 |
| Q5 | 评测回答“值不值得” | 同快照、同任务对比；分别报告质量、Lead 材料、总成本、总耗时；成本含主、子代理和重试；缺用量或价格时标不可比；讲清各状态含义 | W2 | `test/eval.test.mjs`、试跑报告、`docs/usage.md` |
| Q6 | 顾问按需 | 不咨询也能完成 prepare、task-update、packages、task-end；调用后仍有咨询记录；路径规则与 jev 只提醒；Reviewer 与开工确认不受影响 | W4 | `test/advisor-gate.test.mjs`、E04 |
| Q7 | hook 决策可追溯 | 见 3.2 | W1 | `test/trajectory.test.mjs`、隔离宿主 |
| Q8 | 有界接手与退路 | 子代理失败时报告原因，Lead 只做少量定向核查；不重试超过一次；若引入强制规则则提供停用开关 | W5 | Lead 指引条文核对；W5 对比 transcript 中同一失败子代理的重试次数；无强制规则时开关记“不适用” |

### 2.3 非目标

- Worker、Reviewer、Codex 和其他客户端的上下文控制。
- 新增 runner 子代理，或专用的子代理编辑器。
- 自建串行 hook 调度器，或接管 Pebrel、rtk 的代码。
- 实时面板或服务器。
- 为看到沉默的 hook 而加探针。

### 2.4 反目标

| 反目标 | 算失败的原因 |
| --- | --- |
| Lead 变轻，但关键结论出错或遗漏 | 违反首要验收 |
| 子代理调用变多，总成本上升 | 只换了付费位置 |
| 观测日志又灌进上下文 | 制造新的日志负担 |
| 手改角色文件后又卡升级 | Q3 的核心痛点没解决 |
| 用小样本宣称成本稳定下降 | 证据不足 |

## 3. 技术方案

### 3.1 已查证的事实

| 事实 | 依据 |
| --- | --- |
| 子代理冲突来自安装器按哈希接管，不是宿主限制 | `src/install.mjs:53-82,433-436,507-515` |
| `agentFiles` 每次按新发布重算，不是所有权账本 | `src/install.mjs:36-43,433-435` |
| `doctor` 与 `releaseIntegrity` 不检查用户级 agents | `src/install.mjs:163-170,591-616` |
| 只读豁免按名字维护 | `src/hooks.mjs:180`、`src/consult.mjs:6-9` |
| 只读诊断包只能派给只读子代理，scope 须为项目内路径 | `src/hooks.mjs:385-388,414`、`src/protocol.mjs:368-373` |
| 咨询门禁有 6 处信号调用和 1 处实际写入 | `src/protocol.mjs:518,1106,1201,1208,1326,1365`、`src/hooks.mjs:504-522` |
| transcript 按 `toolUseID` 保存有输出 hook 的 `stdout`、`exitCode`、`durationMs` | 本会话 transcript，Claude Code 2.1.318 |
| 91 次工具调用未见 Pebrel、trash-guard 记录；拦截记录缺 `command` | 同上（拦截仅 1 个样本） |
| `total_cost_usd` 在网关下不是账单 | 历史 E08：`costBasis: "unknown"`，请求 `group/worker`，实际 `opencode-go/deepseek-v4.1-flash` |
| 现有评测只汇总宿主成本 | `scripts/eval/events.mjs:142-144` |
| assistant 消息带实际模型和分类 token | 主与子代理 transcript 的 `message.model`、`message.usage` |
| rtk 过滤的内容可用 `rtk recall <hash>` 取回 | `rtk recall --help`，rtk 1.1.0 |
| rtk 只匹配 `Bash`，且在用户级配置 | `~/.claude/settings.json` PreToolUse |
| 隔离评测不装 rtk | `scripts/eval/isolation.mjs:115-127,179-186` |
| 宿主对 Read 默认最多 2000 行，Grep 默认最多 250 条 | Claude Code 工具说明 |
| 子代理配置痛点正在发生 | 本会话期间仓库与本机 `workflow-advisor` 回到 `group/lead`、`medium`，与 2026-11-03 计划第 5.1 节不同 |
| 历史单次运行宿主估算 $0.11–0.87 | `%LOCALAPPDATA%/workflow-eval` 下的 summary |

调研：Harbor ATIF（<https://docs.harborframework.com/agents/atif>）的规范未提 hook，故不引入。disler/claude-code-hooks-multi-agent-observability 用旁路 hook，拿不到其他并行 hook 的返回，故不采用。

### 3.2 Trajectory（Q7）

| 部分 | 做法 |
| --- | --- |
| hook 清单 | 读用户级与项目级 settings，列来源、事件、匹配范围、覆盖程度 |
| 全局骨架 | 读宿主 transcript 与 subagents 目录，按工具调用组织 |
| 规则原因 | workflow 的 PreToolUse 与 Stop 决定追加到 `<stateDir>/decisions/<sessionId>.jsonl`；工具调用按 `tool_use_id` 合并，Stop 按时间归入回合 |
| 命令 | `workflow trajectory --session <id>`、`workflow trajectory hooks`；评测在运行目录写 `trajectory.jsonl` |

验收：

- 能区分 allow、deny、ask、无决定、改写、失败、超时、未观察到。
- 清单里有、记录里没有的 hook 标为“未观察到”，不写成放行。
- 记录宿主版本；transcript 缺字段时报不可观测，不猜。
- 生成在事后离线进行，内容不进入 Lead 上下文。
- workflow 写决定记录的耗时和落盘量进入评测报告。
- 隔离评测与日常排查使用同一份生成代码。

规则编号通过给 `preToolUseDeny` 和主要放行分支加编号实现，不改变任何判定结果。

### 3.3 评测对比（Q5）

**基线：** 开工前的基线提交，代表改动前的“当前方式”。基线臂用 `git archive <基线提交>` 导出到运行目录再安装，候选臂安装当前工作树。

**运行方式：** `npm run eval -- --suite context --baseline-ref <基线提交> --runs 3 --prices <价格表>`。两臂轮流执行，每轮一对，减少路由和时段漂移。

| 阶段 | 包 | 次数 | 用途 |
| --- | --- | --- | --- |
| 试跑 | W2 | 4 场景 × 2 臂 × 1 次 = 8 | 验证框架和成本对账，不下结论 |
| 正式 | W5 | 4 场景 × 2 臂 × 3 次 = 24 | 回答首要验收 |

**代表任务：** 任务只给业务问题，不点名子代理。夹具由脚本确定性生成，答案用正则判定，不用模型打分。

| 场景 | 任务 | 主要看 |
| --- | --- | --- |
| E10 | 已知位置的小问题 | 直接处理，没有 Agent 调用 |
| E11 | 跨文件追查原因 | 根因与 `文件:行` 正确 |
| E12 | 长日志定位失败 | 退出码和关键证据保留，Lead 原文规模 |
| E13 | 调查后继续几轮决策 | 需求、决定、未确认项准确 |

**rtk：** 真实 Lead 有 rtk，隔离环境默认没有。Q4 移出本轮后评测不按臂区分 rtk 配置，两臂同样不装 rtk，报告注明“未含 rtk 输出控制”。

**成本口径：**

| 指标 | 来源 | 说明 |
| --- | --- | --- |
| token（输入、缓存读、缓存写、输出） | 主与子代理 transcript 的 `message.usage`，按 message id 去重，按实际模型汇总 | 主要依据 |
| 折算成本 | token × `--prices` 价格表 | 主指标 |
| 宿主成本 | `total_cost_usd` 与 `costBasis` | 只展示；`costBasis` 为 unknown 时标“宿主估算，不是账单” |

逐轮把 transcript 汇总与 `result.usage` 对账。对不上、缺用量（压缩、重试）、缺价格，或子代理 transcript 关联不全时，该臂写“成本不可比”，不写下降。

Lead 材料规模取 Lead transcript 的 `tool_result` 字节数（分工具）和累计输入 token。

**预登记的结论规则（实测前固定）：**

| 判定 | 条件 |
| --- | --- |
| 质量达标 | 候选臂每次的答案断言都通过；基线臂同场景通过的，候选臂不能失败 |
| 过度委派 | E10 候选臂出现 Agent 调用即记失败 |
| 成本下降 | E11–E13 合计折算成本，3 对全部下降 |
| 无明确差异 | 成本下降未满足但无上升趋势；首要验收算未达成，停下交用户决定加样本还是开条件包 |
| 成本上升 | 各轮 E11–E13 合计折算成本的候选相对基线变化率，其中位数大于 0（3 轮时等价于至少 2 轮上升）；首要验收算失败，停下交用户决定 |

### 3.4 子代理所有权（Q3）

**原则：** 用户没动过的文件继续跟随发布；用户一动过，文件就归用户。

安装记录改成账本：每个名字保存状态和最后写入的 hash。

| 情况 | 安装器行为 | 账本状态 |
| --- | --- | --- |
| 无记录，目标不存在 | 写入默认文件 | managed |
| 无记录，目标与发布相同 | 不写 | managed |
| 无记录，目标与发布不同 | 保留，回执说明“未安装默认定义” | user |
| managed，内容等于最后写入 | 随发布更新 | managed |
| managed，内容不同 | 保留，提示差异 | user |
| managed 或 user，目标不存在 | 视为用户删除，不补回 | deleted |
| deleted | 不写；用户手动从 `current/agents/` 复制即恢复 | 再次发现文件时转 user |
| 卸载，managed 且内容一致 | 移除 | 清除 |
| 卸载，其他情况 | 保留并在回执列出，不失败 | 清除 |

旧记录的 `agentFiles` 按 managed 迁移，hash 取记录值和 `previousAgentFiles`。

`doctor` 新增独立的 `agents` 段：每个名字的状态、是否与发布默认不同。`integrity` 含义不变。

**角色识别：** 只有顾问需要角色，用于写咨询记录。默认名 `workflow-advisor` 继续识别；改名时在 frontmatter 加 `workflow-role: advisor`。这样旧文件不用迁移。

**只读豁免：** 内置 `Explore`、`Plan` 不变。自定义子代理按项目级再用户级解析定义文件，`tools` 全部属于 `Read, Grep, Glob, WebFetch, WebSearch` 才豁免。没有 `tools` 字段、含 MCP 或未知工具、解析不到时都不豁免。

**配置目录：** hook 进程继承宿主环境，取 `CLAUDE_CONFIG_DIR`，否则 `~/.claude`。隔离评测已设置该变量（`scripts/eval/isolation.mjs:106`）。W0 验证。

新增 `src/subagents.mjs` 负责解析定义，`hooks.mjs`、`consult.mjs` 共用。

### 3.5 顾问按需（Q6）

| 现有检查 | 改后 |
| --- | --- |
| 信号清单四类（prepare、task-update、packages、task-end） | 移除 |
| 路径规则：task-update 与实际写入 | 命中时提醒，不拦截 |
| jev | 命中时提醒，不拦截 |
| 咨询记录损坏时失败关闭 | 不再阻断；提醒时说明记录不可读 |

提醒规则：已有对应咨询记录时不提醒；用会话字段记录已提醒的键（`<taskId 或 prepare>:<分类>`），每个键只提醒一次，避免提醒本身占用上下文。与现有 `session.jevNotice` 同样不升级状态版本。

咨询记录继续写入，用于评测和回顾。移除后不再使用的代码一并删除，不留开关。

### 3.6 分流与输出（Q1、Q2、Q4、Q8）

- 调查者正文写明输出约定：结论、证据位置、未确认项。description 写清何时派。
- Lead 指引写明：已知位置的小读取直接做；跨文件调查、长日志分析交调查者；子代理失败时报告原因，只定向核查关键片段，重试不超过一次。
- PowerShell：本轮不改 rtk matcher，不做 PowerShell 输出控制（Q4 已移出，见 2.2）。
- 覆盖边界：本机 Bash 已由 rtk 覆盖，PowerShell 命令输出本轮仍然无界，未装 rtk 的环境同理。

**相对草案的调整：** 草案 F 建议“先限制明显无界的读取”。查证后改为默认不加 hook 限制：宿主已限制 Read 和 Grep 的默认输出，真正无界的是命令输出，由 rtk 处理。

W5 对比后若 Q2 未达成，才另开条件包加限制和停用开关，届时重新确认。没有强制规则时，Q8 的开关无对象，按“不适用”记录。

已安装用户的调查者文件若未改过，会随发布更新；改过的文件由 `doctor` 提示差异。

### 3.7 兼容与代价

| 项目 | 影响 |
| --- | --- |
| 已安装用户 | 旧记录可迁移；手改过的文件不再报冲突 |
| 状态版本 | 决定记录是独立文件，提醒键沿用会话字段，预期不升级 `STATE_VERSION` 和信号版本 |
| E04、M5–M7 | 断言咨询门禁，随 W4 改为断言提醒 |
| 门禁放宽的风险 | 不再强制第二意见；Reviewer 独立审查与开工确认保留 |
| 决定记录开销 | 每次工具调用多一次追加写入，实测进报告 |
| transcript 非公开格式 | 版本变化可能缺字段，按不可观测处理 |

## 4. 待验证假设（W0）

| 编号 | 假设 | 不成立时 | 最小验证 |
| --- | --- | --- | --- |
| A1 | PreToolUse 输入带 `tool_use_id`，且与 transcript 的 `toolUseID` 相同 | 决定记录改按工具名和顺序合并，报告标注精度 | 隔离会话记录一次输入并对照 |
| A2 | 放行且无输出的 hook 不进 transcript | 调整“未观察到”的定义 | 加一个静默 hook 对照 |
| A3 | 改写后实际执行的内容可从 transcript 确认 | 结果字段只报 hook 返回的改写 | 对一次 rtk 改写核对工具结果 |
| A4 | 按 message id 去重后的 token 与 `result.usage` 能对账，压缩和重试可识别 | 回用户：成本主指标需要换来源 | 对带子代理的运行逐轮核对 |
| A5 | 两臂能固定模型，或能记录实际模型差异 | 成本结论标不可比 | 查路由策略，连跑 3 次核对实际模型 |
| A6 | 宿主忽略未知 frontmatter 字段；hook 进程继承 `CLAUDE_CONFIG_DIR` | 角色绑定改放 `workflow-gate.json` | 隔离安装并调用 |
| A7 | rtk 对常见 pwsh 命令改写安全，退出码保持 | 回用户：Q4 需要重新决定 | `rtk rewrite` 跑 10 条典型命令，真实执行失败命令 |
| A8 | 能得到实际路由模型的价格 | 回用户提供价格表；没有价格就没有主指标 | 查 `magpie usage` 和价格配置 |
| A9 | 多个 hook 同时改写时的合并结果可判定 | 报告标注最终输入不可判定 | 两个改写 hook 组合 |

W0 结果写回本节。任何结果要改变已确认的需求时，先回到用户确认。

### W0 实测结果（2026-11-05）

环境：Claude Code 2.1.318、rtk 1.1.0、magpie 本机网关。隔离会话均把 `CLAUDE_CONFIG_DIR` 指向临时目录，未改 `~/.claude/settings.json`，未改 rtk matcher。产物根为 `%TEMP%\w0-lead-context\`（`scripts\` 放探针脚本，`out\` 放配置、宿主 transcript、stream 事件与命令输出），全部不进仓库。

| 编号 | 结论 | 最小证据 | 证据路径 |
| --- | --- | --- | --- |
| A1 | 成立 | 同一次工具调用的三方 id 同时落盘且相同：PreToolUse 输入的 `tool_use_id`、assistant `tool_use.id`、transcript `attachment.hook_success.toolUseID` 均为 `chatcmpl-tool-a903ec9740577547`（`sameCall: true`）。本次只验证这一种 id 形式，不再声称两种形式均完成三方对照 | `out\a1\association.json`、`out\a1\input.jsonl`、`out\a1fix\manifest.json` |
| A2 | 成立 | 两个静默 hook（一个写文件、一个直接退出 0）在宿主 transcript 中没有 `hook_*` attachment；有 stdout 的 rtk/改写 hook 才出现 `hook_success`（含 stdout、exitCode、durationMs）。加 `--include-hook-events` 时 stream-json 仍会列出静默 hook 的 `hook_started`/`hook_response`（output 为空），所以“未观察到”只对宿主 transcript 成立，评测流可直接看到 | `out\p1\manifest.json`（无）、`out\p2rtk\manifest.json`（有）、`out\p1\stream.jsonl` |
| A3 | 成立 | rtk hook 把 `ls -la .` 改写为 `rtk ls -la .`；transcript 的 `hook_success.stdout` 含 `updatedInput`。同目录直接执行 `rtk ls -la .` 与原生 `ls -la .` 的输出已落盘：tool_result 的 stdout 与 rtk 输出去尾换行后一致、与原生输出不同，可确认执行的是改写后命令 | `out\p2rtk\manifest.json`、`out\a3\compare.json`、`out\a3\rtkLs.txt`、`out\a3\nativeLs.txt` |
| A4 | 部分成立 | 同一条 assistant 消息按内容块写成多行 transcript，message id 重复，必须按 message id 去重；去重后主 transcript 每轮汇总与 `result.usage` 完全相等（第 1 轮 15007/14720/210，第 2 轮 164/14976/8）；子代理 transcript 独立（`subagents\agent-*.jsonl`，meta 带 toolUseId），`result.usage` 不含子代理，`result.modelUsage` 含（16289/276/14720）。压缩与重试未触发，其识别方式本次未验证 | `out\p4\manifest.json`、`out\p4\stream.jsonl` |
| A5 | 成立 | 3 次独立运行实际模型均为 `opencode-go/deepseek-v4.1-flash`；transcript 的 `message.model` 记实际模型、`requestedModel` 记请求模型；`--model opencode-go/deepseek-v4.1-flash` 可固定到具体模型；magpie usage CSV 逐请求记录 requested_model/served_model/cost_usd，路由变化可回溯。worker 组为 order + stays=auto，3 次都命中首个成员，回退情况未触发但会被记录 | `out\p5a\manifest.json`、`out\p5b\manifest.json`、`out\p5c\manifest.json`、`out\magpie-usage-60m.csv` |
| A6 | 成立 | 带未知字段 `workflow-role: advisor` 的 `w0-probe.md` 被宿主识别（init 的 agents 含 `w0-probe`），Agent 调用返回 `W0_AGENT_OK`；hook 进程读到的 `CLAUDE_CONFIG_DIR` 就是隔离临时目录 | `out\p4\stream.jsonl`、`out\pre-hook-input.jsonl` |
| A7 | 成立（覆盖有边界） | 15 条命令：POSIX 风格（`git status`、`ls -la`、`cat`、`grep`、`npm run verify`、`dotnet build`、`docker ps`、`rg`、`cargo test`）返回 3 并给出改写；PowerShell 原生 cmdlet（`Get-ChildItem`、`Get-Content`、`Select-String`）、`node --version`、`npm test` 返回 1 不改写。真实执行失败退出码保持：`exit 3`→3、`Write-Error`+`exit 5`→5、`rtk git status`→128、`rtk read` 缺失文件→1、`rtk grep` 无匹配→1。边界：原生 cmdlet 不被过滤；若 Q4 的“真实 PowerShell 调用经过 rtk”包含原生 cmdlet，则覆盖不成立，需用户裁决 | `out\rtk-rewrite.json`、`out\rtk-exit.json` |
| A8 | 成立（有前提） | `magpie model price` 能给出实际路由模型的 USD/1M 输入、输出、缓存读、缓存写（含 5 分钟/1 小时缓存写）；usage CSV 的 `cost_usd` 与 token×价格一致（p5c 14634/41 → 0.0022197，CSV 0.002220）。没有现成的 `--prices` 导出，W2 需逐模型取价拼表；`typesafe/jev-latest` 等模型显示 no price，遇到时按不可比记录 | `out\magpie-prices.json`、`out\magpie-usage-60m.csv` |
| A9 | 部分成立 | 两个改写 hook 都留下 `hook_success`（同一 `toolUseID`，各自含 `updatedInput`），实际执行的是后一个 hook 的改写（tool_result 为 `W0_REWRITE_TWO`）；transcript 没有“最终输入”字段，只能靠 hook stdout 与 tool_result 反推，若候选改写结果不可区分则无法判定 | `out\p3\manifest.json`、`out\p3\stream.jsonl` |

实测调用：初测 13 次模型请求（A1/A2/A6 探针会话 2 次、A3 2 次、A4 2 轮加子代理共 4 次、A5 3 次、A9 2 次），RV0 补证追加 2 次（A1 三方关联探针；A3 直接命令对比未调用模型），合计 15 次；会话清单见 `out\magpie-usage-60m.csv` 的 session 列。按 magpie 价格表折算合计 $0.020839，其中补证 $0.004507。以上为探针调用，不计入 3.3 的 32 次评测运行。

## 5. 分流与工作包

**建议分流：`delegated`。** 改动涉及安全门禁、安装器和评测口径，失败代价高，需要逐包独立审查。

| 包 | 角色 | 范围 | 完成后可验证的行为 | 依赖 |
| --- | --- | --- | --- | --- |
| W0 | worker | 只写本计划第 4 节；在系统临时目录做隔离实测 | A1–A9 各有结论和证据路径 | 基线提交 |
| W1 | worker | `src/trajectory.mjs`（新）、`bin/workflow.mjs`、`src/hooks.mjs`、`scripts/eval/run.mjs`、`scripts/eval/herdr.mjs`、`test/trajectory.test.mjs`（新）、`.spec/task-protocol/spec.md`、`docs/usage.md` | 对隔离会话生成 Trajectory，含清单与规则原因，满足 3.2；所有判定结果不变 | W0 |
| W2 | worker | `scripts/eval/`（context 套件、用量抽取与对账、对比报告）、`test/eval.test.mjs`、`docs/usage.md`、`docs/acceptance.md` | 试跑 8 次出报告；对账结果可见；讲清 PASS、FAIL、NOT-OBSERVABLE 和负向对照 | W1 |
| W3 | worker | `src/install.mjs`、`src/subagents.mjs`（新）、`src/consult.mjs`、`src/hooks.mjs`、`agents/*.md`、`test/install.test.mjs`、`test/subagents.test.mjs`（新）、`test/hooks.test.mjs`、`.spec/install-onboard/spec.md`、`.spec/task-protocol/spec.md`、`docs/usage.md` | 满足 3.4 全部情况，含旧记录升级、同名第三方文件、删除后重装；改名不能获得豁免 | W2 |
| W4 | worker | `src/protocol.mjs`、`src/hooks.mjs`、`src/advisor-gate.mjs`、`src/jev.mjs`、`workflow-gate.example.json`、受影响测试、`scripts/eval/scenarios/protocol/e04.mjs`、`.spec/task-protocol/spec.md`、`.spec/learning-knowledge/spec.md`、`docs/roles/lead.md`、`docs/workflow.md`、`docs/design/protocol.md`、`docs/usage.md`、`docs/acceptance.md`、`README.md`、`README.en.md` | 不咨询也能走完全流程；路径规则和 jev 只提醒且不重复，含同一会话连续 prepare | W3 |
| W5 | worker | `agents/*.md`、`docs/roles/lead.md`、`docs/workflow.md`、`docs/adapters/claude.md`、`docs/usage.md`、`docs/acceptance.md` | 正式对比 24 次出结论，按 3.3 判定 Q1、Q2、Q5；Q8 指引落地 | W4 |
| RV0–RV5 | reviewer | 分别独立审查 W0–W5 的交付差异与直接依赖；RV0 核对实测证据 | 每包 PASS，或 FIX 后原包返修再审 | 对应 worker 包 |

**Lead 执行、需单独授权的步骤：**

| 步骤 | 时机 | 回退 |
| --- | --- | --- |
| ~~改 `~/.claude/settings.json` 的 rtk matcher~~ | 已取消（Q4 移出本轮） | — |
| ~~真实环境检查 Q4~~ | 已取消（Q4 移出本轮） | — |
| 本机重装 workflow | 集成后 | 重装上一版本 |

Q4 移出后不再有 matcher 硬停点，W5 在 RV4 PASS 后直接开始。

## 6. 执行顺序

```text
基线提交 → W0 → RV0 → W1 → RV1 → W2 → RV2 → W3 → RV3 → W4 → RV4 → W5 → RV5 → 集成
```

全部串行，理由：

| 关系 | 理由 |
| --- | --- |
| W0 最先 | 结果决定合并方式、角色绑定和成本主指标能否成立 |
| W1 → W2 | 对比报告读取 Trajectory，且都改 `scripts/eval/` |
| W2 → W3 | 框架和试跑先跑通，后面的改动才能被衡量 |
| W1、W3、W4 串行 | 都改 `src/hooks.mjs` 的同一状态机 |
| W3、W4、W5 串行 | 都改 `docs/usage.md`，W4、W5 还都改 Lead 指引 |
| W5 最后 | 候选臂要包含前面全部改动 |

每个 worker 包交付一个提交，用提交号对齐审查。PASS 后才进入依赖它的包。

**逐包 Agent 与通道（用户 2026-11-05 指定）：**

| 包 | Agent | model | effort | 通道 |
| --- | --- | --- | --- | --- |
| W0–W5 | Claude Code | `group/worker` | high | `herdr:claude`（Herdr TUI） |
| RV0–RV5 | Codex | `group/reviewer` | high | `herdr:codex`（Herdr TUI） |

## 7. 验证

| 层次 | 入口 | 负责 |
| --- | --- | --- |
| 单项 | 包内列出的测试 | 对应 Worker |
| 集成 | `npm run verify` | Lead，最终一次 |
| 真实宿主 | `npm run eval -- --suite protocol`、`--suite model` | W4、W5 涉及部分 |
| 对比 | `npm run eval -- --suite context --baseline-ref <基线提交> --runs <N> --prices <文件>` | W2 试跑，W5 正式 |
| 人工 | 手改本机子代理 model，开新会话确认生效；升级不报冲突 | 用户 |

**评测费用（用户 2026-11-05 批准）：** 试跑 8 次加正式 24 次，共 32 次，不设金额上限。W2 为该批准方式支持不设置金额上限，不能用任意大金额代替。超出 32 次需要重新确认。

## 8. 风险与失败即停

| 情况 | 处理 |
| --- | --- |
| W0 结果要改已确认的需求 | 停下，回到用户确认 |
| 两臂实际模型不一致且无法固定 | 按实际模型分列，成本写不可比 |
| 候选臂质量低于基线 | 不进入集成结论，回到用户裁决 |
| 首要验收未达成 | 按 3.3 停下，由用户决定 |
| 单包同一问题连续两轮无新证据 | 收敛并交回 Lead |
| 实施期间旧版门禁仍生效 | 本机安装的是旧版，改 `workflow-gate.json` 列出的路径会要求咨询；开工后 Lead 先问一次顾问，留下本任务记录 |

## 9. spec 影响

行号以基线提交为准。

### `install-onboard`（W3）

`code:` 增加 `src/subagents.mjs`。W1 改 `bin/workflow.mjs` 只新增独立子命令，提交附 `Spec-OK` 说明不影响安装。

替换第 22 行：

> Claude Code 把随发布副本分发的只读子代理定义写入用户级 `<configDir>/agents/`，并按名字记录状态。未被改动的文件随发布更新；内容被改动或同名文件已存在时保留并归用户，不报冲突；用户删除后不补回；新版默认与现有文件不同时只在 `doctor` 和安装回执提示。卸载移除未改动的文件，其余保留并列出。Codex 不写子代理定义。

替换第 45 行中关于子代理的部分：

> Claude Code 安装后两个只读子代理定义出现在用户级 `agents/`；未改动的文件随升级更新；手改或同名文件在重装与卸载时都不返回 `conflict` 且内容不变；删除后重装不补回；`uninstall` 只移除未改动的文件；`doctor` 列出每个定义的状态和是否与发布默认不同。

替换第 56 行：

> 子代理定义是用户级文件，不纳入 hooks 自有分组；用户改动或删除后，安装器不再写入。真实宿主发现与调用已在本机实测，`effort` 实际下发值未验证。

### `task-protocol`

`code:` 增加 `src/trajectory.mjs`（W1）、`src/subagents.mjs`（W3）、`src/advisor-gate.mjs`、`src/jev.mjs`（W4）。

W1 新增：

> PreToolUse 和 Stop 的决定追加到本机决定记录，含规则编号和简短原因；记录不改变判定结果，也不进入模型上下文。Trajectory 由宿主 transcript 与决定记录离线生成，清单里有而记录里没有的 hook 标为未观察到。

W3 替换第 23 行：

> 未开工与 `read-only`/`plan` 模式下放行不带包标记的只读子代理：内置 `Explore`、`Plan`，以及定义文件 `tools` 全部属于只读工具集合的自定义子代理；改名不改变判定。默认名 `workflow-advisor` 或 frontmatter `workflow-role: advisor` 的子代理结束后写入会话级咨询记录，记录按任务 active 与非角色会话绑定 `taskId`，`task-end` 后或角色会话写空。只读子代理不写文件、不派工、不占工作包。

W4 删除第 20 行和第 56、57、58 行，用下列句子改写第 19、21、22、50、51、59、60、91、92 行：

> 决策升级不再阻断任何信号或写入。Lead 判断需要或用户点名时调用顾问；咨询记录只证明问过。

> 项目 `workflow-gate.json` 的路径规则在 `task-update` 业务路径增量和受支持写入工具的实际写入时核对，可选 jev 在 `prepare`、`task-update`、`packages` 时核对。命中且没有对应咨询记录时只提醒，每个键最多提醒一次；配置损坏、记录不可读、网关不可用都不阻断。普通 shell 工具写文件不经过路径规则。

### `learning-knowledge`（W4）

整句重写第 61 行：

> 决策升级提醒（`workflow-gate.json` 路径规则与可选 jev）、只读子代理的放行和顾问咨询记录写入，都不改变学习事件识别、候选提取、复盘决定、召回与成熟度；这些 hook 分支不读写 transcript 或学习材料。

## 10. 进展

- 2026-11-05：需求草案通过；门禁决定为只提醒不拦截；日志方案确定为宿主记录当骨架。
- 2026-11-05：顾问复核初稿提出 13 项问题，已逐项对照代码。采纳 12 项并改入计划；配置目录一项改用继承的 `CLAUDE_CONFIG_DIR`，由 W0 验证，不增加 hook 参数。
- 2026-11-05：用户批准开工，task `task-lead-context-trajectory` 已 task-start。W0 交付 `f6bbb56`（A1–A9 已写回第 4 节），已消费，待 RV0。
- 2026-11-05：W1（`e1ebe7c`）、W2（`a22fbdc`）经 RV1、RV2 复审 PASS。W2 返修更正了成本比较口径：按每轮 E11–E13 合计比较，试跑 1 对仅演算，正式评测前已在 3.3 明确“中位数”指各轮合计变化率的中位数。试跑 8 次额度用完，正式 24 次留给 W5。
- 2026-11-05：W0 实测发现 rtk 不改写 PowerShell 原生 cmdlet，用户决定 Q4 移出本轮（验收 deferred）：不改 rtk matcher，取消 W5 前硬停点和真实环境检查，评测不按臂区分 rtk。
- 2026-11-05：W3（`80c1671`，两轮返修，RV3 PASS）：所有权账本；返修补了子目录向上解析子代理定义、doctor 与安装计划同口径，内容与发布一致视为未改动的语义写入 spec 与 usage。子目录向上查找的宿主加载规则未实测。W3 隔离宿主 8 次模型请求，超出 4 次限额，约 0.136 美元。
- 2026-11-05：W4（`dc8c701`，一轮返修，RV4 PASS）：咨询门禁改为提醒，提醒按未提醒分类过滤，E04 补整轮未咨询断言。修正后的 E04 于 2026-11-05 真实宿主运行一次，PASS，成本 0.0953 美元；首跑 FAIL（7 次请求）保留为历史。
- 2026-11-05：W5（`38e1afc`，两轮文档返修，RV5 PASS）：正式评测 24 次全部完成，质量 24 次 PASS，过度委派未出现；按 3.3 判成本上升（E11–E13 各轮合计变化 +1.215%、+3.251%、+5.583%，中位数 +3.251%），首要验收未达成，用户决定接受结论并收尾，不追加限制与评测。24 次运行中 Agent 与 Task 调用均为 0，Lead 未读取 Lead 指引，分流指引与调查者路径未被检验，+3.25% 不能归因于调查者方案；E10 候选第 1、2 轮与其余运行的安装快照有两处单行差异，成本判定只用 E11–E13，不受影响。Q1 原记部分达成，后经用户决定改记 deferred（见 `docs/acceptance.md` 第 27.8 节），Q2 未达成，Q5 框架达成但成本收益未检验，Q8 条文落地、失败路径未触发。
- 2026-11-05：集成：`npm run verify` 一次，测试与合成 smoke 通过，check 仅有既有 9 条断链（docs/README.md、docs/WORKFLOW-ALIGNMENT.md 指向本机排除文档）。Q4 deferred。

# workflow 通用定位、开工前流程与交付闭环改造计划

状态：已授权实施。**最新结论：R2 最终独立复核 PASS（Codex child273，任务 `d9b690e9-2447-4c24-8615-8575fb20c634`），允许推进 W3。** 以下各轮待复审描述保留为历史；W2 将由 Lead 提交基线，随后执行 W3/R3。用户已明确以 Claude Code 为主要强制准备入口（“如果 claude 可以的话 就这样吧 反正我主模型主用的就是 claude codex 几乎不用”）；Codex 继续独立 Reviewer，Codex 原生 Windows 隔离失败不再阻塞 Claude 路径。W1 已提交 `c49ed52`，R1 最终独立复审 PASS（Codex child259，任务 f0e3c351-b81e-4060-b178-11f482e64796）。W2 首轮 R2 为 NEEDS_FIX（child267）；第二轮七项返修后 R2 复审仍为 NEEDS_FIX，第三批五项缺陷已完成代码、测试和文档修正；R2 child271 复核确认这五项代码无新产品缺陷，仅剩中等测试缺口与两处文档。该测试缺口与两处文档已在本轮补齐（产品代码未改），定向 signal/hooks 测试 70 项通过、0 失败。尚未提交、推送或运行最终 `npm run verify`，也尚未取得 R2 复审 PASS。W2 改动仍未提交，W3 不得在 W2 复审通过前启动。此前首轮/第二轮审查记录均为历史证据，当前状态以本段和第三轮记录为准。Claude Code 2.1.316 的收紧配置在所列工具/入口取得实际拒绝事件；真实 MCP、NotebookEdit、Windows 文件符号链接及 Codex/Codeg ACP 仍未验，不能写成 OS 隔离或全入口覆盖。此前“仅制定计划、尚未授权实施”是 2026-11-01 用户授权前的历史状态，现已失效。

日期：2026-11-01。实施前基线：0.8.1。前序核对确认实施前 HEAD 与 `v0.8.1` 标签文件内容相同；当前已包含 W1 提交 `c49ed52`。本文件记录本轮讨论形成的需求、建议方案和实施安排；W1 覆盖准备资料的保存与恢复且 R1 最终复审 PASS；W2 已实施准备绑定、逐包核对和两宿主真实 `PreToolUse` 拒绝；首轮 R2 为 NEEDS_FIX，第二轮仍为 NEEDS_FIX，第三轮五项定向返修已完成；R2 child271 复核该批代码无新产品缺陷，仅剩中等测试缺口与两处文档，本轮已补齐测试与文档（产品代码未改）但未提交、未推送、未跑最终 verify，也未重新复审。此状态不表示整项改造完成或所有入口已覆盖；首轮/第二轮记录是历史证据。

## 执行地点、完成范围与当前进度

| 用户关心的问题 | 本计划的明确范围 |
| --- | --- |
| 在哪里实施？ | 在 `D:/git-repo/workflow` 仓库中实施，可继续使用现有的 Agent 运行环境。无需专门切换到 Herdr、在 Herdr 里开 Agent 才能实施本计划 |
| 做完得到什么？ | 补齐开工前流程、执行前检查和交付闭环；公共规则及计划资料独立于 Codeg；保留并验证现有 Codeg 接入能力 |
| Herdr 做到哪一步？ | 说明未来怎样接入，分清共用规则与软件专用处理。本轮 W1–W3 不包含 Herdr 的安装、配置、专用接入开发或真实使用验收；完成本计划不等于已支持 Herdr |
| 当前做到哪里？ | W1 已实施且 R1 最终复审 PASS（Codex child259，72 项定向测试和 check 通过）。W2 首轮七项返修完成后，R2 第二轮仍为 NEEDS_FIX；本轮七项定向返修已完成：审查委派与 worker/reviewer 双角色、operation-only 真实协议禁写/禁实施包、只读诊断仅 Explore/Plan、委派按每工具 schema 核对 Agent/通道/任务/角色、task-update 的 preparationTarget/Remove 与实际变化、role-claim 真实 CLI `--task` 绑定与跨任务隔离、计划真实路径与 symlink/junction 同规则。Claude Code 2.1.316 收紧配置 v2 与真实 workflow hook 的联合最小验证已通过（业务 Read、指定 plan 的 Write/Edit 放行；业务 Write/Edit、Agent 与 Skill 被拒；整类 Bash 被宿主拒绝；业务文件保持 ORIGINAL；见 `docs/acceptance.md` 10.7）。10.8 另完成真实实施会话链：已确认 Markdown → Lead `prepare` → 未准备 task-start 被 PreToolUse 拒绝 → 准备后 complex task-start 接受并建立 task-1。真实 MCP 在隔离会话未成功加载（连接关闭/工具未提供），10.8 用 `--strict-mcp-config` 明确禁用；文件符号链接仍未测。W2 第二轮复审仍为 NEEDS_FIX，第三轮五项定向返修完成后 R2 child271 复核代码无新产品缺陷，本轮补齐其指出的测试缺口与两处文档；W3、R3 尚未启动，W2 未提交未推送 |

以后真正要使用 Herdr 时，另列一次接入任务：优先验证原有 Agent 配置能否直接复用，确有缺口再补 workflow 侧的适配及必要本机配置。那时才需要在 Herdr 的实际环境中验证结果，不要求先去 Herdr 实施本计划。

## 1. 要解决什么问题

当前工作流把计划、分包、实施和审查写得较细，但在真正开工之前，有三件事容易被省略：

1. 问清楚用户真正想解决什么问题，而不是直接把第一句话当作完整需求。
2. 先调研，再说明具体怎么做、用什么现成能力、为什么这样选。
3. 把技术方案变成实施安排，列清工作包，先说明执行顺序，再让用户指定每包使用的 Agent 与实际调用通道。

用户描述的实际问题是：经常要自己想起来说“grill me”；AI 可能交出一份方案，就直接让用户说“开始实施”，漏掉分包和 Agent 选择。0.8.1 已有部分文字要求，因此此次改造还要解决执行时容易跳步的问题。

另保留前序讨论的四项改进：需求与交付证据对应、按完整行为拆包、提前确定责任归属和验证入口、交付后可继续接手。

本轮追加产品定位要求：workflow 是通用的协作流程，Codeg 是一种可选接入方式。用户也希望尝试 Herdr 等其他软件，公共规则和项目计划不应绑定某个启动、管理 Agent 的产品。设计采用同一套核心规则、分别接入具体软件，保留现有 Codeg 用法。本轮完成通用整理和已有 Codeg 接入的保留；Herdr 实际安装、配置、专用接入与验收另列后续任务，不在 W1–W3 范围内。

### 1.1 已确认的要求

| ID | 要求 | 应出现的结果 |
| --- | --- | --- |
| R01 | Lead 主动判断任务是否简单 | 目标明确、改法明确、影响很小的任务直接处理；不为修错字走完整流程 |
| R02 | 需要讨论的任务主动澄清需求 | 不依赖用户额外说“grill me”；AI 先查资料，再问真正需要用户决定的问题 |
| R03 | 可以追问必要性和替代办法 | 可以建议更简单的做法或暂不做；最终取舍由用户决定 |
| R04 | 方案前先看已有实现 | 先查项目；新功能或不熟悉的做法先去 GitHub 比较已有项目，避免重复造轮子 |
| R05 | 把具体做法讲清楚 | 用户能看懂改哪里、怎么工作、复用什么、为何这样选，以及主要代价 |
| R06 | 技术方案后有明确实施安排 | 列出每包交付什么、范围、依赖、检查方法；先说明执行顺序、串并行关系及理由 |
| R07 | 说明执行顺序后，再由用户指定每包 Agent 与实际调用通道 | AI 不跨一次新的分包自动套用旧选择；实施与审查包都列明 |
| R08 | 已确认的同一套分包可以接着执行 | 已保存到 Markdown 的需求、方案、分包、逐包 Agent／通道选择可跨会话、跨电脑读取，无需重新提问 |
| R09 | 关键决定请用户确认 | 已确认内容直接复用；普通实现细节自主处理；不要求每个阶段机械审批 |
| R10 | 必要准备未齐不能开始实施 | 实际检查进入实施和派实施包的动作，并接入宿主支持的工具执行前检查 |
| R11 | 用户需求能对应到最终成果 | 不能仅以已登记的工作包全部 PASS 代替整项需求已覆盖 |
| R12 | 主要实施包交付可验证的完整行为 | 不按 UI、后端、文件数机械均分；公共协议和必要重构可作为明确的前置包 |
| R13 | 设计时确定责任和验证入口 | 说明规则由哪里负责，从哪个真实入口观察结果 |
| R14 | 交付与接续有明确去处 | 关键决定、有效证据、未完成项和下一步有位置可查 |
| R15 | 用直白的话交流 | 先讲用户能理解的行为和取舍，必要术语随文解释；技术细节放在方案和实施部分 |
| R16 | 工作流独立于管理 Agent 的具体软件 | README 先说明通用流程；Codeg 为可选适配；等待、提问、接续按实际工具能力处理，自动化支持范围如实标注 |
| R17 | 共用一套规则，保留已有 Codeg 用法 | 不分叉 Codeg 版和 Herdr 版；软件专用调用各自适配；整理通用规则时验证 Codeg 原有能力仍可用 |

“每次分包”和“接着执行已有分包”按以下规则区分：重新拟定或增加工作包时，让用户指定相关包的 Agent；读取并执行原来已经确认、保存好的分包，不算重新分包。不能因为换会话或换电脑，就要求用户再次指定。

### 1.2 保留的现有做法

- UI 继续沿用已有线稿、必要的高保真和用户核对流程，本次不重做设计工具。
- `.spec` 继续描述已经实现的行为；未来改动保存在计划及其“spec 影响”中，集成时再同步。
- 实施、独立审查、定向返修、必要回归和真实结果分开记录。
- 已有效的读取、调研、测试和审查证据继续复用；相关内容变化或有新证据时才补查。
- 使用现有 Windows、Node.js 24+、ESM 和无第三方运行时依赖的结构。
- 通用定位不等于宣称所有软件都已经支持自动 hooks、委派或拦截。当前已实现的接入保留，未验证的新入口按实际能力核对。

## 2. 0.8.1 的事实与调研依据

### 2.1 本仓已核实的事实

| 事实 | 位置 | 对此次设计的影响 |
| --- | --- | --- |
| 已要求交计划时列分包、依赖和通道 | [Lead](../roles/lead.md)、[计划交付](../references/spec-plan.md) | 不能只把同一句要求再写一遍 |
| `task-start` 直接将会话记为 `executing` | [protocol.mjs](../../src/protocol.mjs) 的 `acceptSignal` | 需要区分准备过程和真正开工 |
| 当前计划提醒主要发生在计划模式的 Stop，且有本回合已声明阶段等条件 | 同文件 `stop`、`planDeliveryReason` | 收尾提醒无法代替执行前检查 |
| 两宿主未注册 `PreToolUse`，事件白名单也没有它 | [Codex hooks](../../hooks/codex.json)、[Claude hooks](../../hooks/claude.json)、[hooks.mjs](../../src/hooks.mjs) | 需要实际接入工具执行前事件 |
| `plans` 目前主要用于进度回写提醒；`channels` 主要按角色记录 | [signal.mjs](../../src/signal.mjs)、[protocol.mjs](../../src/protocol.mjs) | 需要保存逐包安排及用户选择，不能只补一个角色默认值 |
| 计划包不能提前登记成已派发包 | 同文件包状态与 `upsertPackages` | 准备中的分包清单应与运行账本分开 |
| 完成门禁检查已登记包、审查引用、验证声明和 spec 漂移 | 同文件 `gateReport`、[spec.mjs](../../src/spec.mjs) | 需要补整项需求的覆盖记录；不能声称程序能判断需求语义正确 |
| 本机状态不自动跨电脑同步 | [经验学习](../learning.md) 的“数据放在哪里” | 已确认安排必须能从项目 Markdown 恢复 |
| README 将 Codex 与 Codeg ACP 合写为安装入口，公共等待提示直接给 Codeg 工具及参数 | [README](../../README.md)、[protocol.mjs](../../src/protocol.mjs) 的 `stop` | 应将产品定位、Agent 接入与具体管理软件的兼容说明分开 |
| Codeg 提问工具名、委派结果格式和终态提示已有专门处理 | [hooks.mjs](../../src/hooks.mjs) 的 `QUESTION_TOOLS`、`delegationTasks`、`delegationHint` | 保留这些适配能力，集中其专有实现，不要求其他软件使用相同字段 |

这是静态代码和规则核对，不是本机真实宿主拦截验收。

### 2.2 参考哪些已有做法

- [原始六阶段文章](https://czm15053.github.io/ai-workflow-six-stages/)：借用分阶段处理风险、按需使用资料和检查条件的思路。
- [Superpowers 的 brainstorming](https://github.com/obra/superpowers/blob/2ce8aa15d05bd57213e6f746f953aafb7ded7a8b/skills/brainstorming/SKILL.md)：参考先读上下文、针对真正缺口提问、讨论做法后再形成设计的安排。
- [Superpowers 的 writing-plans](https://github.com/obra/superpowers/blob/2ce8aa15d05bd57213e6f746f953aafb7ded7a8b/skills/writing-plans/SKILL.md)：参考将设计决定变成可执行、可检查任务，以及交付前核对需求覆盖。
- [OpenSpec 的 Explore First](https://github.com/Fission-AI/OpenSpec/blob/main/docs/explore.md)：参考讨论、方案和实施之间的明确交接。
- [Herdr 官方集成说明](https://acrogenesis.com/herdr/docs/integrations/)：已核实它有自己的 Agent 集成、命令行与本地 Socket 接口；其软件状态和会话恢复不能直接等同于 workflow 的验收及恢复授权。尚未进行本机接入测试。

采用其中适合当前仓库的做法，不安装第二套工作流。当前已有角色、账本、身份、事务和知识维护，继续复用。

### 2.3 宿主能力已查到什么

[OpenAI 官方 Hooks 文档](https://learn.chatgpt.com/docs/hooks#pretooluse)与 [Claude Code 官方 Hooks 文档](https://code.claude.com/docs/en/hooks#pretooluse)均确认支持 `PreToolUse`，可以在工具调用前返回拒绝结果。

共用的拒绝格式可采用 `hookSpecificOutput.permissionDecision = "deny"`，事件名为 `PreToolUse`，附上具体缺项和下一步。Codex 不支持用 `ask` 或 `continue: false` 实现这项检查。

官方支持不等于当前安装的 Agent 及实际运行入口已经通过验收。实施时要实际验证事件、工具参数和拒绝结果；使用了 Codeg 等管理软件时，再核对该入口的转发与接续。尤其要覆盖 Windows 命令工具；Codex 的 `write_stdin` 不再次触发 PreToolUse，外部进程自行写入也不是新的工具调用，不能宣称 hook 能覆盖任意执行路径。

## 3. 用户实际经历的流程

### 3.1 简单任务

```text
用户提出要求
→ Lead 判断目标、改法明确且影响很小
→ 简短说明，直接完成
→ 必要检查和交付
```

不强制提问、GitHub 调研、计划文件、工作包或独立审查。出现影响范围扩大、关键行为变化或方案不明时，补上缺少的准备，不机械重问已知内容。

### 3.2 需要认真讨论的任务

```text
先查项目现状
→ 问清要解决的问题、范围和判断标准
→ 调研已有做法，讲清推荐的技术方案和取舍
→ 列实施包、审查包和依赖，先说明执行顺序，再请用户指定各包 Agent
→ 将已确认内容保存到项目 Markdown
→ 检查准备是否齐全，按用户授权开工
→ 实施、自测、独立审查、返修和集成
→ 对照整项需求交付，保存必要的接续信息
```

这不是强制单行线。查出新限制时可以回到需求或方案；已有明确方案时直接复用。每次只暂停受影响的工作，其他已获授权的独立调查继续。

### 3.3 已有计划，换会话或电脑继续

```text
用户指出要执行的计划，或项目导航能定位该计划
→ 读取 Markdown 中已有的确认结果、分包和 Agent 选择
→ 核对当前代码基线及尚未完成的部分
→ 重建本机执行记录
→ 继续已授权的下一步
```

本机没有原来的票据、会话 ID 或任务缓存，不算需求没有澄清。原工作区的绝对路径也不是接续条件。只对确实缺失、冲突或已经变化的内容补问；仅缺文件位置时先定位资料，不重做需求访谈。

## 4. 开工前的三个步骤

| 步骤 | Lead 做什么 | 留下什么 | 何时可以继续 |
| --- | --- | --- | --- |
| 需求澄清 | 先查事实；追问目标、必要性、范围、例子和主要限制；暴露会影响结果的假设 | 简短需求结论、明确不做的内容、可检查的验收句子、已决与待决事项 | 会改变目标或结果的关键问题已有答案 |
| 技术方案 | 查项目与 GitHub；比较有实质差别的做法；说明复用、改动、责任位置、兼容和验证入口 | 选定方案、理由、主要代价、资料链接及尚未证实的技术假设 | 关键方案取舍已确定；必须先验证的假设已有结论或明确阻塞 |
| 实施安排 | 按可验证行为拆包；确定所有权、依赖、实施与审查关系；先说明执行顺序和理由，再请用户指定每包 Agent 与实际调用通道 | 工作包清单、逐包选择、验证安排、需求对应关系、spec 影响 | 包的范围和依赖清楚，Agent 与通道已指定，必要决定已确认 |

### 4.1 怎么问才不增加用户负担

- 不要求用户复述仓库里能查到的事实，不让用户替 AI 找文件。
- 针对当前项目和前一条回答提问，说明这个答案会改变什么。
- 用户描述困难时，给具体例子、草图或推荐做法让用户修正；不持续要求用户“讲一个完整故事”。
- 一轮只问当前能决定、确实影响结果的问题；有依赖的问题等上游确定再问。
- 已回答过的问题直接使用；没回答的问题不擅自当成已同意。
- 先讲人话，技术名词用于必要定位，不把类名和接口列表当成方案说明。

### 4.2 调研和技术方案至少说明什么

对需要调研的任务，至少说明项目已经有什么、GitHub 上看过哪些直接相关实现、哪些能复用、哪些不适合以及原因。已有且仍适用的调研直接引用；没有找到可用项目也如实记录，不用无关链接凑数量。

方案说明先回答“准备怎么做”。再给必要的技术选择、资料链接、主要代价、兼容方式和检查入口。存在实质取舍时推荐一种并解释原因；只有一个合理做法时说清依据，不为凑两三个选项编造方案。

技术不确定时，先提出最小验证目标和范围。需要写原型或调用外部服务的，按实际授权执行；验证结果回到方案讨论，不把试验自动接成正式功能。

### 4.3 怎样分包

主要实施包至少能说明“做完以后哪个完整行为可以被验证”。技术文件范围、接口和业务所有权服务于这个结果，不按技术层均分。前置协议、必要重构等包须说明后续哪个行为依赖它。

实施包和审查包都要展示给用户。在请用户选择 Agent 之前，先说明执行顺序、哪些包可以并行、哪些必须串行及理由。每次拟定新分包时，由用户指定相关包的 Agent；不是让 Lead 给每种角色套一个旧默认值。已确认安排保存在计划中，同一套分包的执行与原包返修继续使用该选择。新增、拆分或合并包时，先说明变化后的顺序，再请用户指定相关包。

## 5. 建议的程序方案

### 5.1 选择与取舍

仅补规则和 Stop 提醒，无法满足 R10。引入整套其他框架会重复现有的角色、账本和知识维护。建议采用：**可保存的准备结果 + 现有协议的开工检查 + 宿主工具执行前检查**。

Markdown 是可携带的已确认资料；本机状态保存读取后的结构化记录和运行进度。程序检查记录是否齐全、是否与本次分包匹配；Lead 和 Reviewer 仍负责内容是否正确。程序不根据自然语言关键词猜测“用户已经批准”。

### 5.2 保存一份人能读懂的计划

继续使用项目原有计划目录。默认一份 Markdown 包含需求、调研、技术方案、实施安排、验收对应、确认结果、spec 影响和进度，无需每阶段各建一份文件。

逐包 Agent、实际调用通道和确认范围必须写入正文。采用稳定的包 ID、项目相对路径和代码基线；本机会话 ID、票据及绝对路径不作为跨电脑的批准依据。

本轮建议不实现通用 Markdown 解析器，也不要求用户维护 JSON。Lead 读取已有正文后，通过现有结构化信号入口提交准备记录；程序在入口校验一次，内部使用已整理的值。记录包含源文件摘要和对应章节，能追溯所依据的材料。这里保存的是可核对的声明，不是对用户批准真实性的自动证明。

旧版普通 Markdown 同样可由 Lead 读取和整理；已有明确确认结果时直接引用，不因为缺少新版元数据要求用户重新讨论。资料确实没写过的选择才补问。

### 5.3 将准备过程与业务开工分开

建议新增一个 `prepare` 信号及 `src/preparation.mjs`，复用现有身份校验、事务、回执和信号传输。

| 接口／记录 | 建议行为 |
| --- | --- |
| `signal prepare` | 可在尚无活动业务任务时保存准备阶段、计划路径和整理后的结论；准备不齐时返回缺项，但允许继续讨论、调研和写计划 |
| 会话准备记录 | 保存需求／方案／实施安排的当前状态、来源和待决事项；不用已派发工作包代替草案 |
| 简单任务声明 | 在 `task-start` 明确记录简单任务及具体理由，沿用最短直接处理路径 |
| 正式 `task-start` | 复杂任务进入实施前必须绑定完整准备记录；此时才确定并锁定执行 route，建立业务运行账本 |
| `packages` | 派发实施包前核对包 ID、角色、范围与用户指定的 Agent；缺项或与已确认安排不一致时拒绝 |
| `task-update` | 目标或权限范围改变时核对原准备记录；实际新增决定、范围或分包须补齐，其他有效内容保留 |
| `context` | 显示当前在准备哪一步、有什么具体缺项、已有计划在哪里；不在每回合重复注入全部正文 |

保留现有三种 route。准备期放在会话准备记录中，不为讨论创建一个已经“实施中”的业务任务，也不增加第四种 route。只读讨论和只交计划的请求，在其目标完成时即可交付，不强制进入实施。

准备记录至少包含：任务大小及理由；需求和验收条目；调研来源与结论；方案和关键决定；工作包、依赖、逐包 Agent 与实际调用通道选择；验证入口；计划确认范围及依据；源计划路径和摘要。缺项按字段返回，例如“W2 尚未指定 Agent”“W2 尚未填写实际调用通道”，不用泛泛的“计划不完整”。

### 5.4 工具执行前怎样检查

给两个宿主注册 `PreToolUse`，复用同一份准备状态判定和各自适配的拒绝输出。

1. 未接入项目不介入；普通读取和准备资料维护应能继续。
2. 需要完整流程且准备未齐时，拦下正式实施入口、实施包派发及已覆盖的业务写入工具，说明缺什么和下一步。
3. 准备完成后，按既有任务权限和包所有权执行，不把“准备齐了”当成任意写入授权。
4. 只读、计划和简单任务沿用对应路径；只读调研不能借诊断身份夹带实施。
5. Hook 尽量在读取完整状态、校验发布副本和运行 Git 之前筛掉无关调用；不为每个工具调用增加模型判断、全仓扫描或 Git 全检。

**先验证的实际难点：** 准备期间仍要能检索代码和写计划；通用 shell 同时能读文件和改文件，不能仅因命令出现 `rg`、`git` 等词就判为只读。W2 开始先用隔离目录验证这条边界，以及现有两种 Agent 接入的实际事件和拒绝行为。具体管理软件的兼容性按当前选择的入口另行核对，不要求用户安装 Codeg 才能验收公共流程。优先复用宿主已有、已验证的只读约束；不预先建设通用脚本解析器。

若当前宿主无法同时满足必要读取和实施拦截，W2 在这个检查点停下，提供实际失败入口、两个最小替代办法及影响，交用户决定。不能自行降成只检查信号，仍声称“未准备齐不能开工”已完成。

**该停止条件已完成处理（2026-11-01）：** 用户听取结果后明确以 Claude Code 为主用入口，保留原保证并停止追 Codex 原生 Windows 隔离；Claude v2 严格权限与真实 hook 的联合最小验证通过（10.7），Codex 继续独立 Reviewer。剩余是 R2 联合复审，而不是“尚未选择入口”。不能把该决定解释为 Claude 任意放行或授权修改真实配置。

### 5.5 变更与跨电脑接续

- 读取计划后重建本机准备记录；源材料和选择完整时，不要求重答问题或重新指定 Agent、通道。
- 当前代码与原计划不同，只检查受影响部分；不要因为提交号不同就推翻整份计划。
- 计划的进度、日志和证据链接更新，不自动取消需求、方案或 Agent 选择。
- 计划文件发生变化时，Lead 定向重读并更新结构化记录；对照整理后的决定判断哪些内容变了，原样内容继续有效。
- 改目标、改关键验收、改方案取舍或重新分包时，补相应决定；只改变路径或同步事实时不机械重问。
- 宿主信任、本机工具是否可用与业务准备分开报告。工具不可用时报告实际阻塞，不偷偷换 Agent。

### 5.6 通用工作流与具体软件怎样分开

将三件事分清：workflow 规定需求、方案、分包、审查和交付；Claude Code、Codex 等 Agent 承担具体职责；Codeg、Herdr 等用户选择的软件提供实际的运行与管理入口。某个软件是否转发 hooks、能否委派、如何等结果，需要单独验证。

**README 的目标结构：**

1. 先说明通用工作流解决什么问题、用户如何使用，以及准备到交付的过程。
2. 再列当前已实现的自动接入和已验证范围。Codex 接入以 Codex 为主项，不和 Codeg ACP 混写成同一个产品入口。
3. Codeg 的权限放行、专用 MCP 名称、等待参数和 ACP 兼容信息放到可选适配说明，通过链接按需阅读。
4. 保留 Windows、Node.js 和现有自动化边界，不因通用定位承诺其他平台或软件已经接入。

**公共方法与程序提示：**

- 按当前工具能否委派、是否自动通知结束、是否支持阻塞等待、能否接续等事实决定操作；不按某个产品名设置默认流程。
- 不把所有非 `builtin:` 通道都视为 Codeg。公共等待提示说明要等什么、用当前通道支持的方式等待；Codeg 的具体调用方法只在相应适配说明或明确选中该适配时提供。
- 结构化提问优先使用当前可用的工具；公共提问顺序不把 Codeg MCP 写成必经的一步。
- Codeg 已有工具识别保留在明确的适配分支；不为尚未接入的软件预建整套调度框架或通用驱动系统。
- 将 `docs/adapters/codeg.md` 中 Codex 通用的接入说明整理到 `docs/adapters/codex.md`，Codeg 文件保留其专有兼容与操作说明，同步已有引用。

**切换工具时：** 项目已有 Markdown、需求、方案、工作包和确认结果继续使用；只核对新入口能否提供这次任务需要的能力。缺少自动拦截时明确报告该能力未接入，不把它说成通用规则不可用，也不默认要求换回 Codeg。任务明确要求强制拦截而当前入口做不到时，仍按 R10 报告对应实施阻塞。

建议 README 开头采用这一含义：workflow 是一套通用的 AI 项目协作工作流，帮助用户问清需求、选择方案、安排 Agent、审查和交付；核心规则与管理 Agent 的软件分开，自动化能力按实际接入提供。

### 5.7 同一套规则，分别接入软件

**不分叉为 Codeg 版和 Herdr 版。** 继续维护一个仓库、一套公共规则、一套项目资料格式和统一发布；具体软件需要的接线各自保存。否则需求澄清、审查和验收规则每改一次，就要在多个版本重复修改并防止互相偏离。

| 部分 | 负责什么 | 当前落点与建议 |
| --- | --- | --- |
| 公共工作流 | 需求、方案、用户决定、分包、独立审查、验收和交接 | `docs/workflow.md`、角色与参考文档、`src/protocol.mjs`；不包含 Codeg 工具名或专用参数 |
| Agent 事件接入 | 把 Codex、Claude Code 的 hooks 事件交给公共流程 | 继续使用现有 `src/entry.mjs`、宿主事件处理及各自安装配置，不因运行在另一款管理软件里复制一套业务协议 |
| 软件协作接入 | 知道怎样派 Agent、等结果、识别提问和接续会话 | 本轮将 Codeg 专有识别与结果转换集中到 `src/adapters/codeg.mjs`，原生子代理沿用已有实现；Herdr 在后续接入任务中按实际入口补说明或必要代码 |

以“把 W1 交给用户选定的 Agent”为例：公共流程核对选择、范围和交付；Codeg 接入使用实际可用的 Codeg MCP；以后接入 Herdr 时使用其已核实的控制方式。工作包 ID、用户确认、审查要求和项目计划不因软件改变而复制一份。

本轮只整理已经存在的差异：工具名、结果格式、等待和通知方式、会话关联。接口保持小，不先建设适配市场、驱动注册中心、跨软件调度平台或所有软件都必须实现的大接口。只有需要程序识别的差异才写代码；操作指导能完成的部分放适配文档。

### 5.8 Codeg 现有专用处理怎样保留

| 已有处理 | 应保留的效果 | 整理方式 |
| --- | --- | --- |
| MCP 派工、查询、中断接续等用法 | Codeg 用户仍按原有可用工具工作 | 保留适配说明及实际通道名称；公共流程不直接绑定这些调用名 |
| `ask_user_question` 识别 | 成功提问后自动进入 waiting-user | 专有工具名由 Codeg 接入提供，公共流程处理“正在等用户”这件事 |
| `{tasks:[{task_id,status}]}` 结果解析 | 提醒消费已结束的结果、移除已经处理过的等待项 | Codeg 接入负责解释原始结果，公共流程继续核对工作包与真实交付 |
| 同回合阻塞等待及 `wait_ms: 0` | 保留当前 Codeg 避免结果丢失和重复轮询的做法 | 放在 Codeg 接入中；其他入口根据能否自动通知、实际等待工具决定 |
| 独立委派会话的 `role-claim` | 子会话收到正确 Worker／Reviewer 指引，不被当作另一个 Lead | 保留通用角色声明协议，具体入口提供会话关联；原生子代理继续按已有区别处理 |

不要将一次提取代码变成改变 Codeg 使用方式的借口。W2 先固定这些行为的验证场景，再移出专用识别；结果应是位置更清楚、Codeg 能力仍在，公共流程不再默认其他软件也具有 Codeg 的工具与等待方式。

Herdr 官方区分软件观察到的运行状态、会话身份和恢复：Claude Code、Codex 的运行状态主要来自屏幕检测，集成另外提供会话身份。因此软件显示空闲或一次调用结束时，workflow 仍需核对 Worker 交付、Reviewer 结论和验收证据，才能记录相应完成状态。软件恢复一个会话，也不自动授权恢复已经被用户中断的业务任务。

后续实际接入 Herdr 时，核对控制入口、结果送达、会话关联、现有 Agent hooks 共存和本机可运行环境；沿用现有安装器合并其他 hooks、只撤销自身条目的做法，不另做一套安装事务。目前这些资料说明了接入方向，不能代替本机兼容验收。

## 6. 同时落实前序四项改进

### 6.1 需求对应到成果

计划中每条主要验收有稳定 ID，注明负责包和验证入口。集成交付时补最终证据及状态：已验证、人工待验、受阻或经用户同意后延。

程序可检查验收 ID 是否都有对应记录、负责包是否存在、声明已验证时是否有证据引用。实际证明力由 Reviewer 和 Lead 核对，不能仅凭非空字符串判定为真实通过。

遗漏覆盖记录时，完整流程的收尾返回具体缺项。人工待验可以作为明确的阶段交付，给出操作步骤和负责人，不伪装成全部验收通过，也不把用户尚未操作变成无限续跑。

### 6.2 按完整行为拆包

工作包模板增加“本包完成后可独立验证什么”。方案和真实消费入口一起交给 Worker；共享状态和同一文件保持唯一实施负责人。不能靠 worktree 把业务耦合当成已经解除。

### 6.3 设计先确定责任和验证入口

通用方案模板明确：规则由哪一处负责、下游使用什么确定含义、新旧行为如何兼容、从哪个入口看结果。优先复用已有测试入口，不为可人工观察的小 UI 变化新建自动化设施。

### 6.4 收尾和交接

在原计划回写完成、偏离和剩余项，引用提交、审查及验证产物。跨会话或跨电脑交接时给出当前目标、基线、有效资料、验证状态、剩余事项和下一步；不复制整段聊天或全部日志。

确实需要接手者使用的证据不能只引用另一台电脑的临时绝对路径；长期项目结果放项目已有资料，临时交接材料按实际传递方式保存。多仓库、迁移或分批发布时按需补发布顺序、回退位置和发布后检查，不要求普通小修改写发布套件。

## 7. 实施与审查工作包

本次建议三个实施包和三个独立审查包。它们会修改同一任务协议及上下文，建议串行：

```text
W1 → R1 → W2 → R2 → W3 → R3 → Lead 集成及必要验收
```

每个 R 包只审对应 W 包。用户已为本计划指定：所有 Worker 使用 Claude Code，所有 Reviewer 使用 Codex；审查使用独立会话。这是本次分包的选择，不作为以后重新分包的默认安排。本文件最初只完善计划、不启动实施或审查；用户随后明确授权按此顺序实施。W1 完成两轮定向返修后 R1 最终复审 PASS；W2 首轮 R2 为 NEEDS_FIX，七项返修已完成，等待 R2 独立复审。

### W1：把讨论结果保存为能接着执行的计划

Agent：Claude Code。独立审查：R1，Agent：Codex。

**交付行为：** Lead 能主动按三个准备步骤工作，保存需求、方案、分包及用户选择；另一个空白本机状态能够从该 Markdown 恢复相同的执行安排，不重问已有决定。

**实施步骤：**

1. 新增 `docs/references/preparation.md`，落实任务判断、主动提问、项目与 GitHub 调研、方案说明、分包及逐包选择规则。
2. 修改 `docs/workflow.md`、`docs/roles/lead.md`、`docs/references/spec-plan.md` 和必要的协作、Worker 指引；保留现有 UI 流程，纠正无条件“沿用旧通道”的表述。按第 5.6 节整理中英文 README 和适配导航，明确通用定位及 Codeg 的可选角色。
3. 新增 `src/preparation.mjs`，集中处理输入校验、准备缺项、计划来源及归一化记录；复用现有摘要和路径工具。
4. 在 `src/signal.mjs`、`src/protocol.mjs`、`src/context.mjs`、`bin/workflow.mjs` 接入 `prepare` 和按计划恢复；准备期间不制造已派发包或活动实施任务。
5. 增加一个项目内示例，展示“讨论后保存”和“另一份空白状态接续”的完整路径。

**允许修改范围：** 上述文件、`README.md`、`README.en.md`、`docs/adapters/codeg.md`、新增 `docs/adapters/codex.md`、新增 `test/preparation.test.mjs`，以及直接相关的 `test/signal.test.mjs`、`test/context.test.mjs`、`test/protocol.test.mjs`、`examples/preparation-and-resume/`、`docs/usage.md`，以及 `docs/design/protocol.md`、`docs/design/drift-governance.md` 中与计划提示和通道描述直接相关的段落。实施与文档同包完成。

**必要验证：** 缺 Agent 或缺实际调用通道的计划返回具体缺项；逐包选择不同仍准确保留；旧版普通 Markdown 可由 Lead 整理后绑定；换状态目录不重问；准备资料可以写入且不误称已经派工。归一化测试使用实际不同的需求、Agent 和通道输入，避免仅验证序列化自身一致。

**当前进度（2026-11-01）：** W1 已实施并完成定向自测；R1 首审给出 NEEDS_FIX，首轮四项和第二轮三项定向返修完成；R1 最终独立复审 PASS（Codex child259，任务 f0e3c351-b81e-4060-b178-11f482e64796，72 项定向测试和 check 通过）。

- 实现：新增 `src/preparation.mjs`，集中归一化准备记录、计算项目内计划来源的内容摘要、按字段返回缺项；`prepare` 作为会话级信号保存，不创建 task-start 任务、工作包或账本，也不改变 `phase`。`src/context.mjs` 只向 Lead 返回准备步骤、缺项、来源和“已保存不等于已派工”的提示；记录随回合保留，可在另一份空白状态按同一 Markdown 和稳定的逐包安排恢复。第二轮返修补齐逐包实际调用通道缺项：复杂任务每个包缺 `channel` 时返回 `package:ID:channel`，规范化记录和入口摘要保留该通道；程序不猜默认通道。
- 文档：新增 `docs/references/preparation.md`、`docs/adapters/codex.md`，改写 `docs/adapters/codeg.md` 为可选接入；同步 `docs/workflow.md`、`docs/roles/lead.md`、`docs/references/spec-plan.md`、`docs/references/delegation.md`、`docs/roles/worker.md`、`docs/roles/reviewer.md`、`README.md`、`README.en.md`、`docs/usage.md`，纠正“已有通道无条件沿用”的旧表述。第二轮返修把“只交付纯技术方案按用户范围停在方案”同步到 Lead 入口、计划交付、计划模式/Stop 提示和 README；把通道偏离拒绝限定为当前协议可检测的情况：任务已声明该角色通道而包通道不同，或 delegated 任务 worker 包改由 Lead 实施；同角色各包不同通道时省略角色键，逐包核对留 W2。`docs/design/protocol.md`、`docs/design/drift-governance.md` 中与 Stop/通道描述直接相关的段落也已同步。
- 示例：新增 `examples/preparation-and-resume/README.md`，展示讨论后保存和另一份空白状态接续；逐包示例补齐实际调用通道和 `package:R1:channel` 缺项说明。
- 定向验证：`node --test test/preparation.test.mjs test/signal.test.mjs test/context.test.mjs test/protocol.test.mjs`，第二轮返修后 72 项通过、0 项失败（含第二轮新增 1 项通道缺项）。覆盖缺 Agent 的具体缺项、逐包不同 Agent、普通 Markdown 绑定、不同状态目录恢复、简单任务路径、非法输入不落盘、准备记录不生成任务，以及入口提示和跨回合保留；第二轮新增逐包 `channel` 缺失返回 `package:ID:channel`、入口展示和简单任务不要求通道。
- 边界：本包完成保存、缺项提示和恢复资料；`task-start` 绑定、实现包派发核查、逐包 `role`/`agent`/`channel`/`scope` 核对和真实工具执行前拦截在 W2 完成，仍待 R2。W1 未运行最终 `npm run verify`（由集成阶段执行一次）。
- 未同步项（W1 当时）：`hooks` 的组合命令识别（`isComposedSignal`）未包含 `prepare`；`docs/acceptance.md` 的旧验收段落把 Codex 探针链接指向 Codeg 能力表；公共提问和等待提示保留 Codeg 专有写法；逐包核对和真实派发拦截属于 W2。W2 已修复 `isComposedSignal` 的 `prepare`、acceptance 链接、公共等待/提问描述和逐包核对，记录见 W2 段。

**R1 首审与 W1 定向返修（2026-11-01）：** R1（Codex）给出 NEEDS_FIX，并对准备函数做了定向复现，未运行全量测试。W1 返修如下：

| 序号 | R1 发现 | 修复与状态 |
| --- | --- | --- |
| 1 高 | `preparationMissing` 忽略 `pending`：其他字段完整但存在待决事项时仍返回 `ready:true`、`step:complete`，入口会宣称准备已齐 | 已修复：`pending` 每条按阻塞缺项返回 `pending:0`、`pending:1` 等，并归入需求澄清步骤；非阻塞说明改用 `solution.assumptions`。新增实测覆盖完整字段仍不 ready、入口提示和清空后转 ready |
| 2 中 | `docs/workflow.md` 同句要求三步又说“只做计划的请求停在方案”，会漏实施安排，与 `spec-plan.md` 冲突 | 已修复：明确只要实施计划仍完成分包、顺序和逐包 Agent 选择但不启动实施；只要纯技术方案按其范围停在方案。同步 `preparation.md` |
| 3 中 | `spec-plan.md`、`delegation.md` 指引逐包写 `task-start --channels`，但协议每角色只能声明一个 channel | 已如实修正 `spec-plan.md`、`delegation.md`、`roles/lead.md`、`adapters/codeg.md`：同一角色各包通道不同时省略该角色键或整项不带 `channels`，以准备记录的逐包数据和 `packages` 实际通道为准；正式逐包程序核对留 W2 |
| 4 低 | `normalizeSource` 接受 `package.json` 并 `ready:true`，与“源计划为 Markdown”契约不符 | 已修复：入口校验常见 Markdown 后缀（`.md`、`.markdown` 等），并用真实路径确认仍在项目内；新增错误后缀拒绝、旧版 `.markdown` 绑定和目录链接项目边界实测 |

返修后定向测试 `node --test test/preparation.test.mjs test/signal.test.mjs test/context.test.mjs test/protocol.test.mjs` 共 71 项通过、0 项失败。本记录只表示 R1 首审问题已处理，不表示 R1 复审已通过；W2/W3 未启动。

**R1 复审与 W1 第二轮定向返修（2026-11-01）：** R1 复审指出首轮同步不全，W1 返修如下：

| 序号 | R1 复审发现 | 修复与状态 |
| --- | --- | --- |
| 1 高 | `docs/workflow.md`、`preparation.md` 允许“纯技术方案按用户范围停在方案”，但 `docs/roles/lead.md`、`spec-plan.md`、`src/context.mjs` 的 Lead 入口和计划模式/Stop 提示仍笼统要求讨论或交付计划都分包、选人 | 已修复：所有 W1 入口、帮助、角色和 Stop 提示改为条件表述——只有交付完整实施计划或进入实施时才要求分包、执行顺序和逐包 Agent／通道；只交付纯技术方案时按用户范围停在方案，并说明准备记录的 `ready` 只限制进入实施，不要求方案交付凑齐分包。同步 `lead.md`、`spec-plan.md`、`workflow.md`、`preparation.md`、`context.mjs` 的 `instructions.lead`/`planHint`/`leadRepeat`/准备缺项提示、`protocol.mjs` 的 `planDeliveryReason`、`usage.md`、`README.md`、`README.en.md` 和设计说明；不做自然语言意图分类，也不新增数据模型 |
| 2 中 | `context.mjs` 仍写“用户指定通道时 task-start 带 channels”，`delegation.md` 等声称任意换通道无 `change` 都会被拒；实际只有任务已声明该角色通道时才可比较，同角色逐包不同通道应省略角色键 | 已修复：入口和帮助改为 `channels` 可选、每角色最多一个；同一角色各包通道不同时省略该角色键或整项不带，以准备记录和每次 `packages` 的实际通道为准。拒绝描述限定为当前协议可检测的偏离：已声明该角色通道而包通道不同，或 delegated 任务 worker 包改由 Lead 实施。同步 `lead.md`、`spec-plan.md`、`delegation.md`、`usage.md`、`adapters/codeg.md`、`design/protocol.md`、`design/drift-governance.md`；逐包程序核对仍留 W2 |
| 3 高 | `preparationMissing` 不核对 `package.channel`，准备示例没有 `channel`，但文档要求逐包 Agent／通道作为恢复依据 | 已修复：复杂任务每个包缺实际调用通道时返回 `package:ID:channel`，规范化记录和入口摘要保留 `channel`；所有新测试 fixture、JSON/CLI 示例、接续示例补齐通道。用户只指定 Agent 而实际工具通道唯一时，由 Lead 按可用工具填写，不重问用户；程序不猜默认通道，也不新建调度框架 |

第二轮返修后定向测试 `node --test test/preparation.test.mjs test/signal.test.mjs test/context.test.mjs test/protocol.test.mjs` 共 72 项通过、0 项失败。本记录只表示 R1 复审问题已处理，不表示再次复审已通过；W2/W3 未启动。

**文档与代码冲突及修复状态（本轮完整记录）：**

| 冲突 | 位置 | 状态 |
| --- | --- | --- |
| 待决事项不阻塞 vs 准备不齐不能开工 | `src/preparation.mjs` 的 `preparationMissing` | 已修复 |
| 三步准备 vs 只做计划停在方案 | `docs/workflow.md`、`docs/references/spec-plan.md` | 首轮已修复；第二轮把同一条件同步到 Lead 入口、帮助、README 和 Stop 提示 |
| 纯技术方案按范围停 vs Lead/计划/Stop 仍笼统要求分包选人 | `docs/roles/lead.md`、`spec-plan.md`、`src/context.mjs`、`src/protocol.mjs` 的 `planDeliveryReason` | 已修复：只对完整实施计划要求安排，纯技术方案按用户范围结束 |
| 逐包 `task-start --channels` 指引 vs 每角色一个 channel | `src/context.mjs`、`spec-plan.md`、`delegation.md`、`usage.md`、`adapters/codeg.md` | 已修复：`channels` 可选，同角色逐包不同时省略角色键；拒绝只描述当前协议可检测偏离，逐包程序核对留 W2 |
| 称任意换通道都会被拒 vs 只比较已声明角色通道 | `delegation.md`、`usage.md`、`adapters/codeg.md`、`design/protocol.md`、`design/drift-governance.md` | 已修复：限定为已声明角色通道而包通道不同，或 delegated worker 改由 Lead 实施 |
| 准备记录要求逐包通道 vs `preparationMissing`/示例未校验或未填写 | `src/preparation.mjs`、`test/preparation.test.mjs`、`docs/references/preparation.md`、`docs/usage.md`、`examples/preparation-and-resume/` | 已修复：复杂任务返回 `package:ID:channel`，测试和示例补齐实际通道 |
| 任意源文件可绑定 vs 源计划为 Markdown | `src/preparation.mjs` 的 `normalizeSource` | 已修复 |
| `hooks` 组合命令识别未包含 `prepare` | `src/hooks.mjs` 的 `isComposedSignal` | W2 已修复：`prepare` 进入直接/组合 signal 识别 |
| 协议/漂移治理旧通道文字 | `docs/design/protocol.md`、`docs/design/drift-governance.md` | `protocol.md` 与 `drift-governance.md` 已同步当前可检测范围和准备快照逐包核对 |
| `docs/acceptance.md` 的 Codex 探针链接指向 Codeg 能力表 | `docs/acceptance.md` | W2 已修正为 Codex 能力表链接，并追加 W2 真实宿主验收 |
| 公共提问和等待提示仍为 Codeg 专有写法 | `src/protocol.mjs`、`src/hooks.mjs` 等 | W2 已改为按通道能力描述；Codeg 专用等待只在选中 `codeg:` 包时给出 |
| 文档仍写“逐包核对留 W2” | `docs/references/delegation.md`、`spec-plan.md`、`docs/roles/lead.md`、`docs/adapters/codeg.md`、`docs/usage.md` | 已同步 `codeg.md`、`usage.md`、`protocol.md`、`lead.md`、`delegation.md`、`spec-plan.md`、`drift-governance.md`，改为一律以 `packages` 按包 ID 核对准备快照为准 |
| 直连协议无准备记录仍可开工 | `src/protocol.mjs` 的 `preparation-unbound` 兼容路径 | R2 已修复：新任务只允许完整准备、带理由的简单声明或 `operation-only`，不再以 `preparation-unbound` 新建；仅已有旧任务续接保留兼容 |
| Codeg 实机转发未验证 | `src/adapters/codeg.mjs`、`PreToolUse` | W2 只做工具名/结果解析提取和合成测试；未运行真实 Codeg ACP，不能写成已通过 |
| 任意 shell 写、`write_stdin`、子代理范围所有权未覆盖 | `src/hooks.mjs` | 按计划 5.4 不建设通用 shell 解析器；作为明确未覆盖边界记录，由宿主权限/沙箱和 R2 核对 |

**R1 重点：** 三步骤是否实际进入 Lead 入口，是否仍有提示绕回“只交方案”；是否先说明执行顺序再请用户选 Agent；跨电脑接续是否依赖原会话身份；是否偷偷使用角色默认值代替逐包用户选择；README 是否仍让 Codeg 看起来是使用前提，是否把未验证软件写成已支持。

### W2：准备齐全后才能真正开工

依赖：W1 与 R1 完成。Agent：Claude Code。独立审查：R2，Agent：Codex。

**交付行为：** 不完整准备会在开工、派实施包和实际覆盖的写入入口被拒绝；完整准备、简单任务及合法读取能够正常通过。

**实施步骤：**

1. 先做第 5.4 节的隔离验证，保存真实事件样本与拒绝结果；重点覆盖读取代码、写计划、业务编辑、命令工具和委派。验证失败则按该节的停止条件处理。
2. 给复杂任务的 `task-start`、实施派包和受影响的 `task-update` 接入统一准备检查；对简单任务记录理由，保留原有最短路径。
3. 更新 `hooks/codex.json`、`hooks/claude.json` 和 `src/hooks.mjs` 的事件处理，接入真实 `PreToolUse` 拒绝；与 `src/entry.mjs` 的宿主输入规范化对齐。
4. 按计划包 ID 核对实际包的角色、范围及 Agent；修复后继续复用原包已有选择，重新分包才请求新选择。
5. 同步两宿主适配说明、协议、使用帮助和可操作的缺项提示；核对安装器能发布新定义及按宿主要求重新信任。按第 5.7、5.8 节将已有 Codeg 专有识别和结果解析集中到 `src/adapters/codeg.mjs`；公共等待、提问和接续提示按工具能力描述，不默认套给其他入口。使用当前 Codeg 场景验证提取后仍能正常工作，不顺带重写全部 Agent 事件接入。

**允许修改范围：** `src/preparation.mjs`、`src/protocol.mjs`、`src/hooks.mjs`、`src/entry.mjs`、`src/signal.mjs`、`src/context.mjs`、新增 `src/adapters/codeg.mjs`、`bin/workflow.mjs`、两个 hooks JSON、必要的 `src/install.mjs`，对应的 preparation／protocol／hooks／claude／signal／context／install 测试及必要的 `test/adapters.test.mjs`，`docs/design/protocol.md`、`docs/adapters/codex.md`、`docs/adapters/codeg.md`、`docs/adapters/claude.md`、`docs/usage.md`、`docs/acceptance.md`。Herdr 的正式代码接入不在未确认范围时自动附加到本包。

**必要验证：** 缺需求决定、缺方案、缺某包 Agent 分别被拒；已确认计划通过；改包或换 Agent 未获选择被拒；普通只读、计划资料、简单任务不被误拦；Windows 主要编辑和命令入口实际触发拒绝；子代理与委派路径不能绕过对应包检查。对不能覆盖的入口如实列出，不能拿纯协议测试代替真实拦截。

**当前进度（2026-11-01）：** W2 已实施并完成定向自测与隔离真实宿主拒绝验证，R2 复审 NEEDS_FIX，未宣称 W2 PASS。用户选择 A 后完成第 5.4 节宿主权限最小隔离探针，独立 Codex 复核为 NEEDS_FIX：Claude Code 2.1.316 的旧 `dontAsk` 配置只证明所列有限样例通过，完整边界待验证；Codex CLI 0.166.0 所测 Windows `elevated` 配置计划可写但业务读取被拒，所测 `unelevated` 配置又允许改业务（历史见 `docs/acceptance.md` 10.5）。

用户最新回答“如果 claude 可以的话 就这样吧 反正我主模型主用的就是 claude codex 几乎不用”后，只做 Claude 定向续接，不再追 Codex 沙箱/WSL/容器；Codex 仍为独立 Reviewer。收紧配置只 `allow: ["Edit(docs/plans/plan.md)"]`，并 `ask` 整类 `Bash`、`PowerShell`、`Monitor`、`Agent`、`Task`、`SendMessage`、`Workflow`、`NotebookEdit`、`Skill`、`mcp__*`；真实 `claude -p --permission-mode dontAsk` 中，业务 Read 放行，指定 plan 的 Write/Edit 放行，业务 Write/Edit、Bash `cat`、独立 PowerShell、Monitor、其他 plan 路径、Agent(general-purpose/Explore)、SendMessage、Workflow 均实际调用被拒，Skill 补入 ask 后被拒，业务文件保持 `ORIGINAL`。目录 junction 下 Write/Edit 被拒且业务未变；业务硬链接被写入时原子替换链接、业务未变；文件符号链接因 Windows 管理员权限无法建立，未测。配置 v2、逐项事件与未测边界见 `docs/acceptance.md` 10.6。该结果成立的是**具体配置/工具/入口**的最小验证，不是完整边界或 OS 隔离；未安装 hook，联合 hook 未验证。W2 仍待独立复核与返修，不能据此标 PASS。

- 准备绑定：`task-start` 对 `operation-only` 保留轻量路径；`simple` 要求非空 `sizeReason`，拒绝 delegated 或已有复杂准备的任务；`complex` 必须已有无缺项复杂 `prepare`；带准备记录开工时把大小、来源摘要和逐包 `role`/`agent`/`channel`/`scope` 固定到 `task.preparation`。R2 后新任务无准备且无简单声明返回 `PREPARATION`，不再以 `preparation-unbound` 新建；只有已有旧任务续接保留兼容。
- 逐包核对：`packages` 先解析整批，再按包 ID（新包也可按 `supersedes` 找旧包）比较准备快照的 `role`/`agent`/`channel`/`scope`；新包未声明返回 `package:<id>:undeclared`，字段不一致返回具体 `missing`，整批不落盘。R2 后 `task-update` 在目标变化或权限范围扩大时，必须在同一信号提供完整 `preparation` 与非空 `preparationReason`，只覆盖本次给出的包并以 `preparationUpdates` 记录 before/after 和保留项；复杂任务不能降成简单记录，仍在 dispatched 的包不能静默改选择。
- `PreToolUse`：两宿主 hooks JSON 与 `handleHook` 接入真实拒绝。普通读取和非本插件 shell 直接放行且不读状态；只处理写入、委派和直接 `signal` 命令。未开工拒绝业务写入、实施委派和未准备 `task-start`/活动任务外的 `packages`；准备资料、`prepare`、`Explore`/`Plan` 子代理和 `operation-only` 放行。活动任务按 `read-only`/`plan` 声明再核对；实施委派必须带 `workflow-package:<包ID>`（或 `packageId`）并核对 dispatched、worker、依赖终态、通道与 Agent/范围；role-claimed worker 要求 `roleTaskId` 对应活动包为 `dispatched`，reviewer 拒绝写入。准备写入只允许 `docs/plans/plan.md`、已绑定源计划或已登记关联计划，并做 realpath/最近存在父目录检查。子代理 `PreToolUse` 按父会话检查，不再整体跳过。Codeg `delegate_to_agent`/`create_work_task` 列入委派工具名。
- 简单/只读/计划：`workflow signal task-start --size simple --size-reason` 记录理由；`read-only` 任务拒绝写入和委派，`plan` 任务只放行准备资料写入。只读/计划仍是任务声明与宿主权限两层约束。
- Codeg 适配：新增 `src/adapters/codeg.mjs`，集中提问工具名、委派状态工具、`{tasks:[{task_id,status}]}` 终态解析、`codeg:` 通道判断和阻塞等待说明；公共 Stop 只对实际 `codeg:` 包给出 `get_delegation_status`/`wait_ms: 0`，混合通道分别说明，其他通道按通用能力提示。
- 定向验证：`node --test test/hooks.test.mjs test/adapters.test.mjs test/signal.test.mjs test/claude.test.mjs` 71 项通过；`node --test test/preparation.test.mjs test/protocol.test.mjs test/task-update.test.mjs test/context.test.mjs test/channels.test.mjs test/gate.test.mjs test/install.test.mjs` 136 项通过；`npm run check` 通过（55 个语法文件、33 份文档、53 个发布文件、222 个本地链接）。未运行 `npm run verify`，留集成阶段一次。
- 真实宿主（2026-11-01，隔离临时项目/状态/用户配置，凭据只读复制后删除；未改真实配置或信任）：Claude Code 2.1.316 实测普通读取放行、计划 Markdown 写入放行、业务 `Write` 拒绝且文件不变、未准备直接 `task-start` 拒绝且无任务、简单任务声明后建立并 `task-end` 接受、`Agent(general-purpose)` 拒绝、`Agent(Explore)` 放行并实际 `Grep`。Codex 0.166.0 实测 `apply_patch` 业务写入拒绝且文件不变、`collaborationspawn_agent` 拒绝、未准备直接 `task-start` 拒绝且无任务；隔离 `CODEX_HOME` 的 trusted_hash 取自 `hooks/list` `currentHash`，未用绕过 hook 信任旗标。`codex exec` 默认把 `permission_mode` 报为 `bypassPermissions`，不是本轮传入的旗标；该轮宿主沙箱为 read-only，`exec_command` 读和 `apply_patch` 写计划在 hook 外被拒绝，故 Codex 的 allow 分支只有合成测试证据。第 5.4 节复测进一步发现：`elevated` 自定义权限下计划写入可以成功、工作根外读取仍被拒绝，所测 `unelevated` 配置又允许改业务；这是不同配置和入口的新观察，不能反证先前实验，以 10.5 节的分项条件理解。去敏样本与完整边界见 `docs/acceptance.md` 第 10 节及两宿主适配页。
- 未覆盖：任意 `Bash`/`exec_command`/PowerShell 写文件不做命令解析，只拦本插件直接 `signal`；Codex `write_stdin`、命令启动后的外部进程写入不触发 `PreToolUse`；子代理只按父会话任务/准备状态检查，不单独证明工作包范围所有权，且子代理内部写入的父会话检查只有合成测试；`scope` 是文本声明不是路径沙箱；真实 Codeg ACP 未运行，Codeg MCP 是否转发 `PreToolUse` 未验证；Windows `PowerShell`/`pwsh` 类型只有合成测试，真实命令入口覆盖 Claude `Bash` 与 Codex `exec_command`；`PreToolUse` 热路径不重复校验发布副本完整性；直连协议只有已有旧任务续接保留无准备兼容，新任务不再进入该路径。这些不能写成已覆盖。

**历史：R2 首轮独立审查（2026-11-01）：NEEDS_FIX。** Reviewer 为 Codex child261，委派任务 `641457e6-fc1a-4145-8d5a-3a3bd991d561`。只读静态审查，复用已有测试与宿主证据，未运行全量或新增宿主探针。以下是当前阻塞；前述 W2 自测通过不能抵扣这些问题。

| 严重度 | 发现及实际影响 | 修复或决策状态 |
| --- | --- | --- |
| 高 | 新任务无准备且无 size 时，协议仍以 `preparation-unbound` 创建活动任务；PreToolUse 不解码 `--workflow-arg64-transport` 的输入路径，完整 `signal --input` 可漏过检查 | 已修复：新任务只允许完整复杂准备、带理由的简单声明或 operation-only；旧任务续接保持兼容，不再以 `preparation-unbound` 新建。PreToolUse 与 CLI 共用 `transportArguments`，编码入口/参数和 `--input` 路径不会漏检；组合命令仍是拒绝事实 |
| 高 | 任意 shell 写入直接放行；Claude 未证实强制只读，Codex 的必要读取和计划写入又被宿主沙箱拒绝 | 已按用户最新决定收敛：Claude 为强制准备入口，采用候选 v2 配置（整类 Bash/PowerShell/Monitor/Agent/Task/SendMessage/Workflow/NotebookEdit/Skill/`mcp__*` 为 ask，仅 `Edit(docs/plans/plan.md)` allow），并完成与真实 workflow hook 的联合最小验证；Codex 继续独立 Reviewer，其原生 Windows 隔离失败不再阻塞。整类 shell 的兜底由启动方配置承担，workflow 不造通用 shell 解析器；Codex/Codeg ACP 未验单独标注 |
| 高 | 活动 write 任务的实际 Agent/spawn/Codeg 委派不核对包；role-claim 按项目所有活动任务的包 ID 查找，重复 W1 可关联错误任务 | 已修复：role-claim 绑定显式 `roleTaskId`+`packageId`，不再跨活动任务首匹配；实施委派要求结构化 `workflow-package:<id>`（或 `packageId`）关联，并核对 dispatched、worker、依赖终态、通道与 Agent/范围；无法关联拒绝并给操作提示。原生 Explore/Plan 只读委派保留 |
| 高 | 活动任务仍比较开工快照，更新 prepare 后新包或更换 Agent 仍被旧快照拒绝，提示的恢复办法无效 | 已修复：`task-update` 可显式携带 `preparation`+`preparationReason` 更新任务快照；只覆盖本次给出的包，未列出的旧选择保留，before/after 与变更包写入 `preparationUpdates`。仍在 dispatched 的包不能静默改选择 |
| 中 | task-update 只检查当前准备完整；旧完整记录不变也能换目标或扩范围 | 已修复：目标变化或写权限扩张必须在同一 `task-update` 提供准备更新与理由，记录在 `change.preparation`；仅同步进度/日志/路径不触发重问 |
| 中 | 简单任务的空包快照拒绝所有后续诊断／审查包 | 已修复：简单任务放行 reviewer 包和带 `diagnostic` 的只读 worker 包；普通实施 worker 拒绝并提示用 `task-update` 显式升级复杂绑定 |
| 中 | 任意 Markdown、docs/plans 任意后缀及项目外路径都放行为准备资料，且未核实链接目标；read-only 任务又拒绝 Explore | 已修复：准备写入只允许 `docs/plans/plan.md`、已绑定源计划或已登记关联计划；存在路径按 realpath、不存在路径核对最近存在父目录，junction/symlink 不能逃逸，解析失败不放行；`.local` 和任意后缀不再自动放行。read-only/plan 任务放行宿主声明的 Explore/Plan 子代理 |

用户已于 2026-11-01 在听取具体解释后选择 A：“先验证能否真正管住”。保留原保证，先用隔离临时环境验证宿主能否表达“读取 + 指定计划写入 + 禁止业务写入及实施委派”；不修改真实用户配置或信任。验证成立后定向返修并继续；若宿主做不到，报告具体失败入口和限制，再交用户决定。当前不采用 B 的保证收缩方案。此次仅验证该边界，不同时扩展其他实现或重复全量测试；W3 与最终提交推送仍等待 W2 返修和独立复审通过。

**第 5.4 节验证结果（2026-11-01，详见 `docs/acceptance.md` 第 10.5 节）：**

| 宿主 | 结论 | 实际能力与限制 |
| --- | --- | --- |
| Claude Code 2.1.316（收紧配置，10.6/10.7） | **所列工具/入口最小验证通过，完整边界未验证** | `--permission-mode dontAsk` + `allow: ["Edit(docs/plans/plan.md)"]` + `ask` 整类 `Bash`/`PowerShell`/`Monitor`/`Agent`/`Task`/`SendMessage`/`Workflow`/`NotebookEdit`/`Skill`/`mcp__*`。真实调用：业务 `Read` 放行；指定 plan 的 `Write`/`Edit` 放行；业务 `Write`/`Edit`、Bash `cat`、独立 `PowerShell`、`Monitor`、其他 plan 路径、`Agent(general-purpose)`/`Agent(Explore)`、`SendMessage`、`Workflow` 均被拒；`Skill` 补入 ask 后被拒；业务文件保持 `ORIGINAL`。10.7 进一步把该配置与真实 workflow hook 联合：业务 Write/Edit 与 Agent 由 hook 拒绝，Bash/Skill 由宿主拒绝，指定 plan 写入成功。限制：原生 Windows 不支持 Claude OS 沙箱；权限是会话级，确认后放开写入须启动方换配置开新会话；真实 MCP 未加载、文件符号链接未测。10.5 的旧宽配置仅作历史。 |
| Codex CLI 0.166.0 | **FAIL** | 官方 `elevated` 沙箱下指定计划写入成功，但工作根之外（含 `src/business.txt`）读取被拒；显式加 `src = "read"` 仍被拒。退回 `unelevated` 后 `apply_patch` 可改业务，边界失效。所测宿主权限配置允许发起委派，子代理内写入被拒，未与 workflow hook 联合验证。故本次未找到同时满足要求的原生 Windows 组合，不推断所有配置均不可行。 |

**独立复核（Codex child263，2026-11-01）：NEEDS_FIX。** 原始事件已删除，Reviewer 仅核对 Worker 项目摘要与源码，没有独立实测。Claude 未覆盖业务 `Edit`、其他可实施 Agent、`cat *` 参数和重定向、计划链接及实际目标；signal 探针缺模块未运行成功，`signal *` 参数与联合 hook 的语义影响仍待验证。Codex 结论仅针对本机所测配置，不能推断所有配置或 Windows 原理上均不可行。本轮无宿主可标为已满足完整保证，第 5.4 节阻塞仍在。

**W2 定向续接（2026-11-01）：** 用户最新回答明确 Claude 为主用、Codex 几乎不用，故只核验 Claude 可行路径，Codex 仍为独立 Reviewer，不换 Agent。按“拒绝整个 Bash/命令类入口、整个 Agent/Task 和 MCP 委派，仅原生 Read/Glob/Grep 可读，Write/Edit 只允许一个明确 plan 文件”的收紧配置实测：指定 plan 的 Write/Edit 放行，业务 Write/Edit、Bash（含 `cat`）、独立 PowerShell、Monitor、其他 plan 路径、Agent（general-purpose/Explore）、SendMessage、Workflow 均实际调用被拒；补入 `Skill` 后 Skill 也被拒；业务文件保持 `ORIGINAL`。目录 junction 下 Write/Edit 被拒，硬链接写入未改业务，文件符号链接因 Windows 权限无法建立而未测。该结果只对具体配置、工具和入口成立，不覆盖真实 MCP、NotebookEdit 实际调用、其他需审批工具、无审批的状态/调度工具、文件符号链接或与 hook 的联合；不是 OS 隔离。需独立复核确认后才能继续 W2 返修。详见 `docs/acceptance.md` 10.6。

**用户此前可选择的两个最小方向（已被最新回答覆盖）：**

1. 保留 R10 保证，先做有时间边界的入口可行性调查：只读检查本机是否已有 WSL2 或容器及可复用的 Agent；若有，在隔离环境验证“代码只读、指定计划可写、实施委派受控”，再与 workflow hook 联合验收。未验证前不承诺可用。没有现成环境时先报告安装或迁移需求，不自动安装。代价是继续暂停 W2 实施，可能需要另行配置及切换入口；收益是不降低原保证。
2. 明确缩小 R10 为“workflow 协议与已覆盖工具执行前检查”，允许普通终端由宿主审批与用户控制。保留新任务/准备/逐包核对等协议返修，继续 W2/R2、W3/R3 及集成。代价是普通终端仍可能绕过 workflow，不能宣传为完整强制隔离；拒绝样例和未覆盖入口须持续分开标注。

本次选择 A 只授权验证，不自动授权上述第二项或安装新环境。该段记录的是当时状态；七项返修结果见下，W3 仍等 R2。

**历史：W2 首轮七项定向返修（2026-11-01）：**

| 项 | 修复落点 | 定向验证 |
| --- | --- | --- |
| 1 高 | `protocol.mjs` 新任务不再走 `preparation-unbound`；`hooks.mjs` 复用 `transportArguments` | 无准备/无 size 新任务返回 `PREPARATION`/`missing:["preparation"]` 且不建任务；旧任务续接通过；编码传输的 `task-start` 在动作前被拒 |
| 2 高 | `docs/adapters/claude.md`、`docs/acceptance.md` 10.7、本计划 | 隔离临时项目 + `CLAUDE_CONFIG_DIR`：真实 hook + v2 严格权限，业务 Read/指定 plan Write+Edit 放行，业务 Write/Edit 与 Agent 被 hook 拒，Bash/Skill 被宿主拒，业务文件仍 `ORIGINAL` |
| 3 高 | `hooks.mjs` 的 `packageForSession`、`delegationDenial`；`protocol.mjs` role-claim 绑定 | 委派无 `workflow-package:<id>` 被拒，正确包放行，错误包/未派发拒绝；未绑定角色会话写入拒绝，绑定后放行；Explore 保留 |
| 4 高 | `task-update` 的 `preparation`+`preparationReason`、`preparationUpdates` | 新增 W2 并保留 W1 接受；历史 before/after 可查；活动包改选择被拒 |
| 5 中 | `updateTask` 目标/范围变化必须同一信号带准备更新 | 只有旧完整记录、目标变化时返回 `preparation:update`；同一信号提供更新后接受 |
| 6 中 | `preparationPackageGaps` 简单任务只读/审查例外 | reviewer 与 diagnostic worker 放行；实施 worker 拒绝；显式升级复杂后放行 |
| 7 中 | `isPreparationTarget`/`realPathForCheck`；只读委派例外 | 仅 `docs/plans/plan.md`、源计划、关联计划可写；`.local`、任意后缀、项目外、junction 逃逸拒绝；read-only 任务 Explore 放行 |

定向复跑：`node --test test/adapters.test.mjs test/claude.test.mjs test/gate.test.mjs test/hooks.test.mjs test/install.test.mjs test/preparation.test.mjs test/protocol.test.mjs test/signal.test.mjs test/task-update.test.mjs test/context.test.mjs test/entry.test.mjs` 214 项通过、1 项跳过、0 失败；`npm run check` 通过（55 个语法文件、33 份文档、53 个发布文件、226 个本地链接）。最终 `npm run verify` 仍留 Lead 集成一次。

**联合验证（真实 hook + Claude v2，2026-11-01）：** 隔离项目/状态/`CLAUDE_CONFIG_DIR`，`project onboard --skip-learning` 后 `install --agent claude`，settings 合并 v2 权限；`claude -p --permission-mode dontAsk` 单会话实际调用。业务 `Write`/`Edit` 由 `PreToolUse:Write/Edit hook error` 拒绝，Agent 由 `PreToolUse:Agent hook error` 拒绝；Bash `cat` 与 Skill 由宿主 `dontAsk` 拒绝；Read、指定 `docs/plans/plan.md` 的 Write/Edit 成功，最终 plan 为 `PLAN3`、business 为 `ORIGINAL`。真实 MCP 尝试两次（`--mcp-config` 与项目 `.mcp.json`）：一次 `CONNECTION_CLOSED`，一次会话未提供 `mcp__probe__delegate_to_agent`，均未发生工具调用；没有取得“MCP 调用被拒”的证据，不能写成已覆盖。文件符号链接、NotebookEdit 实际调用、Codex/Codeg ACP 实机仍未测。

**历史：R2 第二轮七项定向返修（2026-11-01）：**

| # | R2 发现 | 修复落点与行为 | 定向证据 / 未验 |
| --- | --- | --- | --- |
| 1 高 | 委派门禁无条件要求 `item.role==='worker'`，合法 Reviewer R1 被拒 | `delegationDenial` 接受 worker/reviewer；审查派工合法。仍按入口通道前缀、Agent、关联任务、可解析角色字段核对；reviewer 角色会话只读、不能再委派 | 原生 `Agent(general-purpose)` 关联 R1 放行；错 Agent、Codeg 通道错配、reviewer 包标 worker 均拒绝；Codeg `delegate_to_agent` 缺 `agent_type`（仅 `assistant_id` 无法映射准备 Agent 也会拒）、`create_work_task` 缺 `prompt` 点名缺项。真实 Codeg/Codex 宿主未重跑 |
| 2 高 | operation-only 可声明 `permissions.mode=write` 后借 task-start 写业务 | `task-start` 协议层拒绝 write（`missing:["permissions.mode"]`），PreToolUse 动作前拒绝；`task-update` 拒绝取得写权限/扩大路径；`upsertPackages` 拒绝登记实施 worker 包，只读诊断仍可登记 | 真实 Post 协议测试四项拒绝 + 只读操作放行；未改例行事务/学习行为 |
| 3 高 | 简单诊断 worker 可派 general-purpose，原生/角色写入可绕过 | diagnostic 委派只允许 `Agent`/`Task` 的显式 `Explore`/`Plan`；Codeg/general-purpose 拒绝；角色会话仍要求 `roleTaskId`+`packageId`，诊断包拒绝写入和继续委派 | 原生 general-purpose 与 Codeg 诊断派发拒绝，Explore 放行；角色诊断会话 Write/Agent 拒绝。未实现原生 `agent_id` 的包级所有权，故按 fallback 只保留明确只读类型 |
| 4 高 | 委派标记只证明账本存在，缺 Agent 字段可跳过、scope 只判非空 | 每个委派入口按真实 schema 必填字段核对；原生 Agent/Task 查 description/prompt/subagent_type，Codex spawn 查 task_name/message，Codeg 查 task、可核对的 agent_type 及 title/prompt；关联 taskId 与可解析 role 字段一并比较 | 放行合法 Reviewer；错 Agent/通道/角色、缺字段、错包均拒绝。提示明确写 `scope` 是关联包声明，不是语义/路径沙箱；未声称 prompt 已按范围验证 |
| 5 中 | task-update 可换目标/扩路径并重放旧准备；包只能保留不能移除/替换 | 新增 `preparationTarget{goal,permissions}`、`preparationRemove[]`；目标/权限变化必须匹配结果、准备须有实际变化；未列出的包保留，显式移除不能针对 dispatched 等非终态包；回执与 `preparationUpdates` 记录 changed/removed/preserved；复杂不能降简单 | 重放旧记录、target 不匹配、移除 dispatched 均拒绝；替换未派发 W2、显式移除 W2 接受并保留 W1。非空理由不当作授权证明 |
| 6 中 | role-claim 只给 role/package，signal 默认 claim-* 导致空 roleTaskId，后续被拒 | CLI 缺 `--task` 直接拒绝；协议要求绑定已有活动任务且包 ID 存在；旧无 roleTaskId 声明可读不可写并提示重新声明；hooks 只按显式 `roleTaskId` 找父任务 | 真实 CLI→Post 链绑定 `task-1`；两个活动任务各有一个 W1，task-1 的 W1 结束后其角色写入被拒，task-2 的同名 W1 仍可写；未绑定旧声明写入被拒。未直接注入 roleTaskId 冒充链路 |
| 7 中 | 源计划 md 可 symlink 到同项目业务文件，realpath 相等放行；关联计划规则不同 | `resolvePlanPath` 逐段 `lstat` 拒绝 symlink/junction，解析后真实路径必须仍在真实 `docs/plans/` 且为 Markdown；`normalizeSource`、task-start `plans`、hooks 准备资料共用 | `docs/plans` 下业务文件/`.local`/任意后缀/项目外/junction 拒绝；关联计划 `README.md` 与 `.txt` 拒绝。Windows 文件符号链接创建仍因 EPERM 跳过，未写成已测 |

**第二轮定向复跑：** `node --test test/preparation.test.mjs test/protocol.test.mjs test/task-update.test.mjs test/signal.test.mjs test/hooks.test.mjs test/r2-regressions.test.mjs test/role-claim-e2e.test.mjs test/plan-symlink.test.mjs` 共 127 项：126 通过、1 跳过、0 失败；跳过项是 Windows 无法创建文件符号链接。随后 `npm test` 全量 416 项：413 通过、3 跳过、0 失败；跳过项为文件符号链接和仅 POSIX 用例。`npm run check` 通过（58 个语法文件、33 份文档、53 个发布文件、226 个本地链接）；`git diff --check` 无空白错误（仅 Git 的 CRLF 提示）。新增 `test/r2-regressions.test.mjs`（4 项）、`test/role-claim-e2e.test.mjs`（1 项）、`test/plan-symlink.test.mjs`（2 项，1 项跳过）。最终 `npm run verify` 仍留 Lead 集成一次；本轮回修不提交、不推送。

**W2 第三轮五项定向返修（2026-11-01，历史记录见上，当前以本表为准）：**

| # | 缺陷 | 修复落点与行为 | 定向证据 |
| --- | --- | --- | --- |
| 1 高 | `preparationSnapshotSignature` 对包数组顺序敏感：同一旧准备倒序重放 + 新目标 + 匹配的 `preparationTarget` + 理由会被接受 | `src/preparation.mjs` 比较前按 `packageId` 排序包数组并排序 `dependsOn`；`mergePreparationSnapshot` 的 `changed` 用同一归一化比较。只有实际内容、显式移除或 source 变化才算更新 | `test/r2-regressions.test.mjs` 新增“准备快照倒序重放不算实际变化”；包倒序 + `dependsOn` 倒序 + 新目标仍返回 `PREPARATION`/没有实际变化 |
| 2 高 | Codeg `delegate_to_agent` 同时有 `agent_type` 和 `assistant_id` 时按 `agent_type` 放行，但实际由 assistant 决定 Agent | `src/hooks.mjs` 对带 `assistantField` 的入口，只要 `assistant_id` 非空就拒绝（双字段同样拒绝），提示无可靠 assistant→Agent 映射并改用 `agent_type`；未新增映射框架 | `test/hooks.test.mjs` 新增：双字段、仅 assistant_id 都拒绝，合法 `agent_type` 放行 |
| 3 高 | 实际 Agent 只需匹配准备 `agent` 或通道之一；`agent=codex`、`channel=codeg:claude_code`、实际 `claude_code` 全链接受 | Codeg 入口要求实际 Agent 同时匹配准备 `agent` 与 `codeg:<agent_type>` 通道尾部；通道尾部无可归一化 Agent 时保守拒绝；其他入口保留现有叠合判断 | 新增测试：`codex`/`claude_code` 两种单边匹配都拒绝，双匹配放行 |
| 4 中 | `Explore`/`Plan` 在解析 `workflow-package` 标记前直接放行，带标记时跳过包状态/Agent/通道核对 | 先解析标记；无标记的只读子代理保留豁免，有标记则走包/schema/状态/通道/Agent 核对；diagnostic 仍只允许原生 Explore/Plan | 新增测试：带 `workflow-package:R1` 的 Explore 被拒，无标记 Explore 放行；原诊断 Explore 正例保留 |
| 5 中 | `signal.test` 的 `start` 建任务后删准备，`acceptCommand` 与 `helpers.emit` 隐式注入旧任务，导致“新 delegated”实为续接 | 删除隐式注入与删快照；新增显式 `legacyEmit`/`legacyStart`，仅旧账本兼容用例调用；channels/gate/protocol-review 的 delegated 夹具改为显式 legacy；`start` 保持真实简单任务。新任务测试继续走 prepare→task-start→packages | 相关信号、门禁、审查、任务更新测试重跑通过；无新增“暗中续接”路径 |

定向复跑：`node --test test/gate.test.mjs test/task-update.test.mjs` 64 项通过；`node --test test/hooks.test.mjs test/r2-regressions.test.mjs test/signal.test.mjs test/channels.test.mjs test/protocol-review.test.mjs test/role-claim-e2e.test.mjs test/adapters.test.mjs` 101 项通过；合计 165 项通过、0 失败。公共夹具与最终签名归一化修改后全量 `npm test` 以最终代码复跑：418 项，415 通过、3 跳过、0 失败；跳过项为 Windows 文件符号链接与仅 POSIX 用例。`npm run check` 通过：58 个语法文件、33 份文档、53 个发布文件、226 个本地链接、0 错误。未运行最终 `npm run verify`，未提交、未推送。

**W2 窄范围补证（2026-11-01，承接 R2 child271）：** R2 child271 复核第三批五项代码，未发现新产品缺陷，只指出 `test/signal.test.mjs` 缺空白状态真实 CLI `prepare`→`task-start`→`packages` 全链正例、未开工带 `workflow-package` 标记的 Explore 拒绝断言，以及两处文档口径待补。本轮在 `test/signal.test.mjs` 增加真实 CLI→Post 全链正例（断言准备快照保留、W1 正确登记、任务非旧夹具建立），在 `test/hooks.test.mjs` 增加未开工标记 Explore 拒绝与无标记 Explore 放行断言；`docs/usage.md` 明确未开工更新 `prepare`、已开工用 `task-update` 更新绑定快照；本文件冲突列表改为历史/已修复口径。产品代码未改。定向 `node --test test/signal.test.mjs test/hooks.test.mjs`：70 项通过、0 失败、0 跳过。

**R2 最终独立复核（2026-11-01）：PASS。** Codex child273（任务 `d9b690e9-2447-4c24-8615-8575fb20c634`）确认空白状态真实 CLI→合成 PostToolUse→实际 hook 的三步正例足以补齐普通 CLI 链路缺口，未开工 Explore 标记断言与两处文档已补齐，可推进 W3。复核只读，复用 70 项定向通过和此前全量结果；真实宿主与未验入口仍按 10.7/10.8 范围理解。

**文档与代码冲突（历史记录：以下均为首轮/第二轮发现，已按最终代码修正；当前无新增未修正冲突）：**
- 已修复（历史）：`docs/usage.md` 的 delegated 快速开始原先缺 `prepare`，审查包示例缺 `--package-agent`/`--scope`；task-update 示例仍只展示 goal/mode/paths，未说明 `preparationTarget`/`preparationRemove`；operation-only、诊断包、委派 schema 和计划真实路径边界曾是旧口径。
- 已修复（历史）：`docs/references/delegation.md` 的 packages 示例原先缺审查包 Agent/scope；未说明 prepare 前置、审查派工合法、role-claim `--task` 和诊断包只读。
- 已修复（历史）：`README.md`/`README.en.md` 的 task-update 与 role-claim 说明原先未包含本轮新约束。
- 已修复（历史）：`docs/design/protocol.md` 的 task-update 字段、role-claim 绑定、活动任务委派核对和计划路径原为旧描述。
- 已修复（历史）：`examples/preparation-and-resume/README.md` 原先写“准备绑定与工具执行前拦截属于后续实施”，与当前代码冲突；该表述已修正。
- 保留限制（非未修正冲突）：`docs/acceptance.md` 10.7 的真实 MCP 未加载限制保留；10.8 用空 `--mcp-config` + `--strict-mcp-config` 明确禁用，不把禁用写成 MCP 已验。
- 已修复（第三轮）：`docs/references/delegation.md`、`docs/usage.md`、`docs/design/protocol.md` 原先把“按 Agent/通道核对”写得比代码宽；现明确 Codeg `assistant_id` 只要非空就拒绝（含双字段），Codeg 委派 Agent 必须同时匹配准备 `agent` 与通道尾部，带 `workflow-package` 标记的 Explore/Plan 也必须走包核对。
- 已修复（第三轮）：`docs/usage.md` 与 `docs/design/protocol.md` 原先把“实际变化”写得只列举字段；现明确比较前按 `packageId` 排序并归一化 `dependsOn` 顺序，倒序重放相同准备不算实际变化。
- 已修复（历史夹具）：`test/helpers.mjs` 原先在通用 `emit` 中暗注旧任务，`test/signal.test.mjs` 与 `test/task-update.test.mjs` 原先建任务后删准备；现已改为显式 `legacyEmit`/`legacyStart`，只供旧任务兼容用例调用，普通 `start`/`emit` 不再改写被测前提或删除快照。

**真实实施会话链（10.8）：** 隔离 Claude Code 2.1.316 会话中，已确认 `docs/plans/plan.md` 经 Read 后，Lead 提交结构化 `prepare` 得 `accepted:true, ready:true`；准备前同一 `task-start --route delegated` 被 `PreToolUse:Bash` 拒绝且无任务；准备后同一命令接受并建立 `task-1`（suspended after SessionEnd），绑定 `preparation.size=complex`、`preparation.source.path=docs/plans/plan.md` 及摘要。首轮误用源码入口导致 PostToolUse 不认作本插件入口且无状态写入，改用安装入口复跑成功；该偏差已写入 10.8。未调用真实 MCP、NotebookEdit 或 Codeg；文件符号链接仍未测；不是 OS 绝对隔离。

**R2 重点：** 检查位置是否在执行之前；是否误挡正常调研和计划维护；是否仅靠自然语言或命令关键词猜测；是否无条件扩大 hook 热路径成本；官方文档支持是否被冒充成本机验收；非 Codeg 入口是否仍被引导调用 Codeg 工具；准备快照逐包核对是否覆盖新包/接替包/更新包；未覆盖的 shell、`write_stdin`、子代理和 Codeg 实机边界是否如实标注。

### W3：把整项需求验收清楚，并留下接续信息

依赖：W2 与 R2 完成。Agent：Claude Code。独立审查：R3，Agent：Codex。

**交付行为：** 已登记包全部 PASS 后，仍能发现原需求没有对应成果的情况；阶段交付明确区分已验证、人工待验和剩余工作，接手者能从计划找到下一步。

**实施步骤：**

1. 在准备记录和交付声明中保存验收 ID、负责包、检查入口及最终证据对应，复用已有版本引用。
2. 为完整流程补覆盖缺项检查；保留简单任务及只读任务的轻量行为，不制造空矩阵。
3. 更新 `docs/roles/reviewer.md`，明确需求验收与工程规范分别给结论；默认一个独立 Reviewer，风险确有需要时再增加。
4. 更新 `docs/references/validation.md`、`docs/references/reports.md`、`docs/references/delegation.md`，落实完整行为、责任位置、验证入口及有效证据复用。
5. 在计划、示例和接续指引中保存已完成、剩余、关键决定位置和下一步；按需发布清单保持可选。

**允许修改范围：** `src/preparation.mjs`、`src/protocol.mjs`、`src/signal.mjs`、`src/context.mjs`、`bin/workflow.mjs`，直接相关的 preparation／gate／protocol／signal／context／integration 测试，上述角色与参考文件、`docs/references/spec-plan.md`、`docs/usage.md`、`examples/preparation-and-resume/`、`README.md`、`README.en.md`、相关 spec 与本计划进度。

**必要验证：** 某需求没有分配任何包时能指出；包都 PASS 但漏一条需求证据时仍列缺项；人工待验能作为如实的阶段交付并带操作步骤；改变交付版本继续按既有门禁复审；进度更新不取消已确认需求与 Agent 选择。

**R3 重点：** 是否重复已有 spec 审查；是否把记录齐全当真实性证明；是否新增无必要的全测和角色；未完成事项是否只留在聊天或另一台机器的临时路径里。

### 7.1 Agent 选择表

| 包 | 职责 | 依赖 | Agent |
| --- | --- | --- | --- |
| W1 | 可保存、可接续的准备流程 | 无 | Claude Code |
| R1 | 独立审查 W1 | W1 | Codex |
| W2 | 开工与工具执行前检查 | R1 | Claude Code |
| R2 | 独立审查 W2 | W2 | Codex |
| W3 | 整项验收覆盖与交付接续 | R2 | Claude Code |
| R3 | 独立审查 W3 | W3 | Codex |

Lead 负责当前计划确认、用户选择传递、所有权交接、集成和最终说明。包内返修沿用原负责人；若重新拆包，更新此表并请用户指定相关 Agent。

## 8. 验收与验证安排

### 8.1 必须观察到的结果

| ID | 场景 | 通过条件 | 主要负责包 |
| --- | --- | --- | --- |
| A01 | 明确的小修改 | 直接处理，无访谈、空计划、额外分包 | W1、W2 |
| A02 | 模糊的新功能 | 未要求 grill 也主动问真正影响结果的问题 | W1 |
| A03 | 已有资料写清的需求 | 先读取和复用，不让用户重复解释 | W1 |
| A04 | 有现成开源做法 | 先调研，说明复用和不采用的理由，有直接来源 | W1 |
| A05 | 技术方案交付 | 用户能看懂怎么做、为什么，以及主要限制 | W1 |
| A06 | 方案已写但没分包／没选 Agent | 准备检查列具体缺项，不能开始实施 | W1、W2 |
| A07 | 同一角色不同包选不同 Agent | 正确保存并按包使用，不被角色默认覆盖 | W1、W2 |
| A08 | 已确认计划换会话、换电脑 | 读取文件，恢复安排，不重新澄清或选择 | W1、W2 |
| A09 | 用户提出新分包 | 展示变化后的包，请用户指定相关 Agent | W1、W2 |
| A10 | 准备阶段读代码、写计划 | 正常进行，不被误判为正式实施 | W2 |
| A11 | 准备不齐时尝试业务修改／实施委派 | 真实支持的入口在动作发生前拒绝，并给下一步 | W2 |
| A12 | 所有包 PASS 但原需求漏项 | 能定位缺少的需求对应或最终证据 | W3 |
| A13 | 只更新进度或日志链接 | 不要求重新确认原需求、方案和 Agent | W1、W3 |
| A14 | UI 需用户操作验收 | 给简短操作步骤，明确人工待验，不假报通过 | W3 |
| A15 | 本机运行失败或 Agent 不可用 | 如实报告实际缺口，不静默换人或冒充已启动 | W2 |
| A16 | 中断后接续 | 保留成果与有效证据，按用户授权恢复，不自动续跑 | W2、W3 |
| A17 | 交付新分包并请用户选 Agent | 先说明执行顺序、串并行关系及理由，再请求逐包选择 | W1 |
| A18 | 不使用 Codeg，通过已有原生入口工作 | 公共流程正常使用，README 不要求先安装 Codeg，公共提示不要求调用 Codeg 专有工具 | W1、W2 |
| A19 | 用户想换一种管理 Agent 的软件 | 通过现有原生入口及独立本机状态验证项目资料可复用，不绑定 Codeg；未验证能力不写成已支持，本项不包含 Herdr 本体实测 | W1、W2 |
| A20 | 整理公共流程与 Codeg 接入之后 | Codeg 原有派工、提问、等待、结果提示和角色声明仍可用，通道名称及既有项目资料不因提取改变 | W2 |
| A21 | 软件显示空闲或恢复了会话 | 不自动记为审查通过、全部验收完成或已获授权续跑；继续按公共交付和恢复规则判断 | W2、W3 |

### 8.2 分层验证

- 各 W 包运行它所改行为的定向测试；R 包复用有效结果，仅为具体疑点补查。
- 使用现有 Node 测试入口，例如 `node --test test/preparation.test.mjs test/signal.test.mjs test/context.test.mjs`；最终以实际受影响测试为准，不因列了命令就额外重复运行。
- W2 必须区分合成 hook 输入、隔离目录的真实宿主调用、当前选择的管理软件兼容验证，逐项记录覆盖和未覆盖入口。原生入口是独立场景；Codeg 为可选兼容场景，不作为所有用户的验收前提。本轮不把 Herdr 列为已完成自动适配。
- 本轮修改了已有 Codeg 专有处理，必须为这些变化保留 Codeg 回归证据；这是保护已有支持，不是要求所有 workflow 用户安装 Codeg。复用仍有效的证据，实际 Codeg 调用未运行的项目如实标注，不能用名称不同的替身冒充真实软件验证。
- 最终集成后运行一次 `npm run verify`，沿用现有 check、test、demo 及输出留存；demo 继续标为合成 smoke。
- 若真实宿主验证引起代码修改，只重跑受影响检查；没有使证据失效的新变化，不重复全套验证。
- A02、A04、A05、A08 等协作体验使用实际短任务验收。程序测试能检查数据和调用链，无法独自证明问题问得好、方案容易理解。

## 9. 兼容、接入和交付

1. 保留现有 route、角色、包终态、最终审查版本、知识事务和学习链路；新增准备记录不重新设计学习系统。
2. 旧状态没有准备字段时保持可读；续接旧任务先查已有计划、分包和确认记录，不因旧格式重做讨论。不能确认的部分明确列缺项，不伪造已批准。
3. 新增字段集中于准备记录，沿用状态版本与信号版本的既有兼容方式；只有实际出现不兼容格式时再决定升级版本，不为可选字段机械迁移全部历史。
4. 新增 hook 定义属于宿主注册变化，交付时提供实际升级、信任和回退步骤；不擅自修改宿主信任。
5. 无授权不自动安装到真实宿主、改用户项目、提交默认分支、推送、打 tag 或发布。具体版本号在实现范围确定后决定。
6. 三包之间保留可审查的提交或交付摘要，不把 W1 的资料能力称为 W2 的执行前拦截已完成。整体是否满足 R10，以真实验收为准。

### 9.1 实施时的 spec 影响

本节描述预期改动，不在计划阶段提前改当前 spec。用户确认并要求实施本计划时，按现有约定同时批准此处列明的行为变化。

- 新建 `.spec/preparation/spec.md`，管辖准备记录、按计划恢复和开工条件；验收至少包括 A01–A11、A13、A15、A18、A19，`code:` 使用实际落地的具体文件。公共准备资料和分包安排独立于 Codeg 等管理软件。
- 更新 `.spec/task-protocol/spec.md`：描述新增 `prepare`、复杂任务的准备绑定、逐包选择核对，以及旧任务和简单任务的边界；保留既有最终交付版本审查规则。等待和接续按实际通道能力处理，不把非内置通道一概视为 Codeg。
- 若 `src/install.mjs` 实际改变注册或恢复行为，同步 `.spec/install-onboard/spec.md`；仅新增 hooks 定义时先检查现有描述是否已涵盖，不机械改正文。
- 后台经验采集与知识规则不是本次目标，不预先修改 `.spec/learning-knowledge/spec.md`；实际出现直接影响再在原范围内报告。
- `README.md`、`README.en.md`、使用说明、适配文档和 CLI 帮助描述最终真实能力；未验证宿主和未覆盖入口如实写明。

### 9.2 当前状态与后续条件

- W1 已实施并完成两轮定向返修；R1 最终独立复审 PASS（Codex child259，任务 f0e3c351-b81e-4060-b178-11f482e64796，72 项定向测试和 check 通过）。W2 首轮 R2 为 NEEDS_FIX；七项返修已完成并通过 188 项受影响测试与 check。Claude v2 严格权限与真实 hook 的联合最小验证通过；真实 MCP 因隔离会话未加载未取得调用证据，文件符号链接、NotebookEdit、Codex/Codeg ACP 实机仍未测。W2 等待 R2 复审，W3 的整项验收和最终真实宿主确认尚未完成。
- 执行顺序为 W1 → R1 → W2 → R2 → W3 → R3。所有 Worker 使用 Claude Code，所有 Reviewer 使用 Codex，已写入第 7.1 节。
- 历史状态：本文件最初仅制定计划，用户尚未要求实施；指定 Agent 不等于授权开始工作。用户在 2026-11-01 明确授权按本计划实施到提交推送后，W1 已启动；主协调负责后续审查、提交和推送，W1 不提交、不推送。保留此说明以免旧状态与当前进度混淆。
- 统一版本和接入方式的建议已写入第 5.7、5.8 节。Herdr 实际安装、配置、专用接入和真实验收不包含在本轮实施包中；后续需要使用时另列接入任务。本计划完成不等于 Herdr 已接入。
- 实施时按 W2 的前置验证确定本机真实可覆盖的工具入口；不把官方支持直接记为本机已通过。

当前完成 W1 的准备资料保存、缺项提示和恢复能力（R1 最终复审 PASS），以及 W2 的准备绑定、逐包核对、简单/只读/计划路径、两宿主真实 `PreToolUse` 拒绝和 Codeg 适配提取。W2 首轮 R2 判 NEEDS_FIX 后，七项定向返修已完成；Claude 严格权限 v2 与真实 hook 的联合最小验证通过（`docs/acceptance.md` 10.7），但真实 MCP 未取得调用证据，文件符号链接、NotebookEdit、其他需审批工具、无审批状态/调度工具、安装信任和 Codex/Codeg ACP 实机仍未测。未完成 R2 复审、W3 的整项验收、所有入口的真实宿主覆盖、最终 `npm run verify` 或 Herdr 接入。

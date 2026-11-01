# 准备流程

需要讨论、调研或拆包的任务，在正式实施前读本页。简单明确的修改直接处理，不走完整准备；是否简单按目标、改法和影响判断，不按文件数机械决定。

准备通常按需求澄清、技术方案、实施安排的顺序进行，目的是避免“先给方案、再让用户说开始实施”时漏掉需求、比较和分包。只讨论或只要纯技术方案时，走到技术方案即可，按用户给定范围结束；用户只要实施计划时，仍完成分包、执行顺序和逐包 Agent／实际调用通道选择，只是不启动实施。不要把“只交方案”当成省略实施安排的理由。准备记录的 `ready` 只表示是否可进入实施：纯技术方案按其范围交付时不要求分包，也不因实施安排缺项继续追问，除非用户要求转入实施计划。

| 步骤 | 要解决的问题 | 留下的结果 |
| --- | --- | --- |
| 需求澄清 | 用户真正想解决什么；哪些必须做、哪些不做；怎样算完成 | 简短需求结论、明确的非目标、可检查的验收句子、已决与待决事项 |
| 技术方案 | 项目已有什么；GitHub 上有没有直接相关的现成做法；准备复用、改动或放弃什么 | 选定方案、理由、主要代价、资料链接和尚未证实的假设 |
| 实施安排 | 按可验证的完整行为怎样拆包；谁实施、谁审查、依赖、先后顺序和实际调用通道 | 稳定包 ID、每包范围与完成行为、逐包 Agent 与实际调用通道、验证入口和需求对应关系 |

## 需求澄清

- 先从仓库、已有计划和用户提供的材料查事实，不要求用户复述能查到的东西。
- 针对当前项目和前一条回答提问，并说明这个答案会改变什么。
- 用户描述困难时，给具体例子、草图或推荐做法让用户修正，不要求用户先写完整需求。
- 一轮只问当前能决定、确实影响结果的问题；依赖上游答案的问题等上游确定后再问。
- 已回答的问题直接使用；没回答的问题不当作已同意，也不替用户选默认值。
- 先讲用户能理解的行为和取舍，技术名词只用于必要定位。

## 技术方案

先查项目现有实现，再查 GitHub 或其他公开实现中与本问题直接相关的做法。说明时至少回答：

- 项目已经有什么，哪些能直接复用；
- 看过哪些直接相关的实现或资料，哪些不适合以及原因；
- 准备改哪里、由哪一处负责、从哪个真实入口能看到结果；
- 新旧行为如何兼容，主要代价和风险是什么；
- 还有哪些技术假设没有证实，最小验证范围是什么。

有实质取舍时推荐一种并解释原因；只有一个合理做法时说明依据，不为凑选项编造方案。没有找到可用项目也如实记录，不用无关链接凑数。已有且仍适用的调研直接引用，不重复全量调查。

技术不确定时先提出最小的验证目标和范围；需要写原型或调用外部服务的，按实际授权执行。验证结果回到方案讨论，不把试验自动接成正式功能。

## 实施安排

按“做完以后哪个完整行为可以被验证”拆包，不按 UI、后端或文件数机械均分。公共协议和必要重构可以作为明确的前置包，但必须说明后续哪个行为依赖它。

每个实施包和审查包至少写清：

- 稳定的 `packageId`、角色（`worker` / `reviewer`）和负责范围；
- 完成后的可验证行为，不只写改了哪些文件；
- 依赖的包，以及可以并行和必须串行的关系；
- 用户选定的 Agent 和实际调用通道 `channel`；
- 指定验证入口（可写在包上，也可放在统一的 `verification` 列表）；无法自动验证的人工步骤单独列出。

每条需求还要有稳定 `id`、负责实施包 `packages[]` 和检查入口 `verification`。负责包只能引用已登记且角色为 `worker` 的包；审查包不交付需求。需求没有负责包或检查入口时，准备回执按需求 ID 返回 `requirement:<id>:packages`、`requirement:<id>:verification`，不能借“所有包都 PASS”代替整项需求已覆盖。收集最终证据属于收尾的交付声明，不在准备阶段伪造。

**先说明执行顺序、串并行关系和理由，再请用户为每个包指定 Agent 与实际调用通道。** 用户只指定 Agent 而当前可用工具通道唯一时，由 Lead 按实际工具填写 `channel`，这是普通实现事实，不需要重问用户，也不当成用户另一次批准；程序不猜默认通道。已确认的同一套分包可以接着执行或原位返修，不用重新询问；新增、拆分、合并或更换包的范围时，属于新的分包决定，需要展示变化后的包并重新请用户指定相关包。不要因为某个角色以前选过某个 Agent，就把旧选择自动套到新包上，也不要由 Lead 给角色填默认值。

## 保存与接续

准备结果用 `signal prepare` 保存。程序不解析 Markdown，也不要求用户维护 JSON：Lead 读取项目里的普通 Markdown 后整理成结构化记录，再由入口校验一次。旧版计划没有新元数据也可以直接整理后绑定。

```powershell
node "<入口>" signal prepare --session <sessionId> --turn <turnId> --id prep-1 --plan docs/plans/xxx.md --input "<准备记录 JSON>"
```

`--input` 文件只放业务字段，形状为 `{ "preparation": { ... } }`。`--plan` 和可选的 `--sections` 是来源路径的便捷写法，也可直接写在 `preparation.source` 里。源计划必须是项目内相对路径的 Markdown 文件（如 `.md`、`.markdown`）；程序只读取该文件计算内容摘要，不解析正文。

```json
{
  "preparation": {
    "size": "complex",
    "sizeReason": "涉及协议、文档和测试，需要独立审查",
    "requirements": [
      { "id": "R01", "summary": "准备结果可以保存", "acceptance": ["缺 Agent 时点名具体包", "准备期不创建业务任务"], "packages": ["W1"], "verification": "node --test test/preparation.test.mjs" }
    ],
    "research": [
      { "source": "项目现有 protocol.mjs", "conclusion": "复用身份、事务和回执", "url": "https://example.invalid/source" }
    ],
    "solution": {
      "summary": "新增 prepare 信号和准备记录",
      "decisions": [{ "decision": "准备记录保存在会话上", "reason": "尚无业务任务时需要独立于任务账本" }],
      "tradeoffs": ["程序只核对结构，内容正确性仍由 Lead 和 Reviewer 判断"],
      "assumptions": ["用户已确认的分包写在计划正文"]
    },
    "packages": [
      { "packageId": "W1", "role": "worker", "agent": "Claude Code", "channel": "builtin:agent", "scope": "实现准备记录", "delivers": "准备结果可保存并可从计划恢复", "dependsOn": [], "verification": "定向测试" },
      { "packageId": "R1", "role": "reviewer", "agent": "Codex", "channel": "codeg:codex", "scope": "独立审查 W1", "delivers": "对 W1 的独立审查结论", "dependsOn": ["W1"] }
    ],
    "verification": ["node --test test/preparation.test.mjs"],
    "confirmation": {
      "scope": ["需求", "方案", "分包", "逐包 Agent 与通道"],
      "basis": "用户原话或计划中已确认的段落"
    },
    "pending": [],
    "source": { "path": "docs/plans/xxx.md", "sections": ["实施步骤", "Agent 选择表"] }
  }
}
```

`channel` 填实际调用通道，格式沿用现有协议：`builtin:<宿主内置类型>`（如 `builtin:agent`）、`codeg:<agent_type>`（如 `codeg:claude_code`）或 `lead`（Lead 自己实施）。示例中的值只表示本次工具选择，不是固定默认；不使用 Codeg 时按当前入口填写，不要求安装 Codeg。用户只指定 Agent 而工具通道唯一时由 Lead 按可用工具填写。

回执会保存规范化的准备记录，并返回：

- `ready`：当前结构是否齐全；
- `missing`：缺项字段，例如 `package:W2:agent`、`package:W2:channel`；
- `preparation.messages`：可直接展示的说明，例如“工作包 W2 尚未指定 Agent”“工作包 W2 尚未填写实际调用通道”；
- `preparation.step`：当前停在 `requirements`、`solution`、`arrangement` 或 `complete`；
- `preparation.source`：源计划相对路径及内容摘要。

`pending` 中的每条待决事项都按阻塞缺项处理，分别返回 `pending:0`、`pending:1` 等字段和说明；只要还有待决事项，`ready` 就不是 `true`。非阻塞的说明写到 `solution.assumptions`，不要放进 `pending`。

准备不齐时仍可保存，也仍可继续讨论、调研和写计划；回执里的缺项不是“已经可以开工”。准备记录不等于用户批准，也不等于已经派工：`prepare` 不创建业务任务、工作包或执行账本。

简单任务只需声明 `size: "simple"` 和 `sizeReason`，不要求需求、调研、分包和确认范围；但 `pending` 非空时仍按阻塞缺项处理，不能一边声明任务简单、一边保留未确认的关键问题。`prepare` 不是复杂任务的必经仪式；只有需要讨论、调研或独立审查的任务才保存完整准备。

## 整项需求验收与阶段交付

复杂 `lead-direct` 与 `delegated` 任务收尾时，`task-end` 的 `validation` 除 `ref` 和 `evidence` 外可带 `acceptance`，按准备记录的需求 ID 逐条给状态：

```json
{
  "validation": {
    "ref": "abc1234",
    "evidence": ["npm test: 250 通过", "npm run check: 0 错误"],
    "acceptance": [
      { "id": "R01", "status": "verified", "evidence": ["test/preparation.test.mjs: 20 通过"] },
      { "id": "R02", "status": "manual-pending", "owner": "用户", "next": "打开设置页切换主题，确认刷新后保持" },
      { "id": "R03", "status": "blocked", "reason": "测试账号未提供", "next": "提供测试账号后重跑登录用例" },
      { "id": "R04", "status": "deferred", "reason": "本期不做移动端", "consent": "用户 2026-11-01 明确同意延后" }
    ]
  }
}
```

- `verified` 必须给出最终证据；`manual-pending` 必须写负责人 `owner` 和可操作步骤 `next`；`blocked` 必须写原因 `reason` 和下一步 `next`；`deferred` 必须写原因 `reason` 和用户同意依据 `consent`。
- 所有已登记包都 PASS 但漏一条需求验收时，门禁列出 `acceptance:<需求ID>`，任务不能结束。未知需求 ID 列 `acceptance-unknown:<id>`；复杂 `lead-direct` 没有逐包账本也按同一矩阵核对。
- 人工待验、受阻和经用户同意延期可以如实阶段结束；回执返回各状态数量和剩余项，`allVerified` 为 `false`，不能宣称全部验收通过。适用矩阵时 `validation` 与 `acceptance*` 缺项不能用 waiver 抵扣。
- 验收证据绑定 `validation.ref`，该值必须等于最终交付版本。最终版本改变后旧证据不沿用，要重新提交 `validation`；需求内容或负责包变化时，对应 ID 的旧验收声明失效，未变化条目和原顺序保留；审查版本仍按现有 `deliveredRef`/`reviewedRef` 门禁核对。
- 准备更新按需求 ID 合并后，仍按最终快照核对负责 worker 包与包依赖；保留需求指向已移除包时拒绝并点名，同批迁到现存包才接受。
- 回执和 `task show` 只汇总声明记录；`verified` 的证据内容、用户实际操作和延期同意仍由 Lead 与 Reviewer 核对。简单任务、`operation-only`、`read-only` 和没有 route 的历史任务不要求这套矩阵。

## 按已有计划接续

换会话、换电脑或换状态目录时，先读项目里的计划 Markdown，再把其中已经确认的内容整理成同形记录重新提交。判断依据是稳定包 ID、项目相对路径、代码基线、逐包 Agent、实际调用通道和确认因素，不依赖原会话 ID、票据或本机绝对路径。

- 源材料完整时直接恢复，不重新访谈需求，也不重新指定原计划的 Agent。
- 计划只改变进度、日志或证据链接时，不取消已确认的需求、方案和 Agent 选择；需求按稳定 ID 合并，进度更新漏传旧条目不会删除已确认验收覆盖。
- 接续时同时读回已完成、剩余、人工待验/受阻/延期状态及各自下一步；这些状态应写在项目计划或交付说明可查的位置，不只留在聊天或另一台电脑的临时路径。
- 当前代码与计划基线不同时，只检查受影响部分；提交号不同本身不推翻整份计划。
- 只对确实缺失、冲突或已经变化的决定补问；原计划没写过的选择不能猜。
- 新入口需要填写不同的 Agent 或通道时，先说明差异和影响，再由用户决定。
- 原计划只写了 Agent、没有写通道时，Lead 按新入口实际可用的工具填写 `channel`，不要求用户重新选择；只有 Agent 本身或实际入口发生变化时才补问。

当前实现边界：`prepare` 负责保存准备记录、来源摘要和缺项，不创建任务。记录齐全后，delegated 任务用 `task-start` 开工并把 `size`、源计划摘要、需求/负责包/检查入口和逐包 `role`/`agent`/`channel`/`scope` 固定到任务；准备未齐、未声明简单或没有准备的新任务会在协议层和宿主 `PreToolUse` 被拒。源计划与关联计划都只接受 `docs/plans/` 下的 Markdown；路径链上的 symlink/junction 一律拒绝，解析后的真实路径也必须仍在真实 `docs/plans/` 内，业务文件不能借链接别名成为计划。`scope` 是负责范围声明，不是路径或语义沙箱；程序不解析 prompt 正文，也不证明用户授权真实存在。不能把“已保存草案”说成“准备完成”或“已获授权实施”。

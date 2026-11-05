# 学习闭环与效果摘要计划

状态：已实施并完成本地提交与最终集成验证；目标分支 `acceptance/learning-20261103`，已推送。代码基线：`e30b7eb`。

## 1. 目标

让学习机制从“能采集、能整理”变成“能影响行为、能被看见”：

- 会话入口在任务开始前读到高置信度常驻规则。
- 任务结束时把真实任务事实交给提取器，不只依赖对话摘要。
- 召回和效果摘要显示同一规则出现过多少次、跨多少天。
- 用只读 `learning digest` 看窗口内的采集、复盘、知识和未解决冲突。

非目标：不启用本项目的学习；不调用真实模型做试点；不做向量检索；不自动晋升成熟度、不自动合并或发布；不记录 `shown` 注入事件；不改变个人文档学习。

## 2. 事实与来源

### 2.1 当前机制的实际状态

- 本项目学习停用，4 条 pending 材料（2 条偏好 `explicit:false`，2 条已验证纠正），0 条正式知识、0 次复盘、0 个提取作业、0 条反馈，没有 `.workflow/knowledge`。
- 当前机制在本项目的实际作用是零行为改变；即使手动跑复盘，偏好类材料也会被 `explicit=true` 门槛拒绝。

### 2.2 结构性缺口

| 缺口 | 位置 | 影响 |
| --- | --- | --- |
| 检索只在任务 active 后发生 | `src/context.mjs:90` | 任务开始前没有常驻规则 |
| 只做本地词项/bigram 匹配 | `src/learning.mjs:300` | 换一种说法就召回不到 |
| `contextKey` 压掉重复注入 | `src/context.mjs:159` | 同任务内规则更新后不会重新注入 |
| `shown/adopted` 没有生产调用方 | `src/learning.mjs:364-376` | 反馈漏斗永远为空 |
| 复盘由 10 条/24 小时/每天 1 次触发 | `src/review.mjs:31-38` | 短期返工不会及时进入复盘 |
| 复盘提示是通用“知识整理器” | `src/review.mjs:400` | 不专门找返工、不该合、验证太薄 |
| 提取只看 transcript 文本 | `src/capture.mjs:329` | 任务事实、验证结论没有进入提取 |
| `stable` 只影响排序 | `src/learning.mjs:288-298` | 高置信规则不会常驻 |
| 没有窗口效果报告 | `bin/workflow.mjs:188-218` | 看不到“有没有用” |

### 2.3 Magpie 方法核对

核对对象是 `https://usemagpie.ai` 的 Magpie，公开仓库为 `yetone/magpie`。以下只陈述可核对事实：

| 待核对 | 事实 | 来源 | 性质 |
| --- | --- | --- | --- |
| 项目归属 | `yetone/magpie` 的 owner 是 `yetone`，homepage 是 `https://usemagpie.ai` | GitHub API | 一手 |
| 对外署名 | usemagpie.ai 把 yetone 标为 maker，并链接 GitHub `yetone/magpie`、X `@yetone` | 官网 | 官方一手 |
| 入口 | `CLAUDE.md` 当前只有 `@AGENTS.md`、`@LESSONS.md` 两行 | raw GitHub | 一手 |
| 路由 | `AGENTS.md` 把子系统、代码规范、贡献者、教训分别指向 `docs/subsystems/`、`docs/code-standards.md`、`docs/contributors.md`、`LESSONS.md` | raw GitHub | 一手 |
| 错题本 | `LESSONS.md` 每晚复盘当天 commit，只找返工、不该合、验证太薄；每条是规则+原因+证据；`Seen` 计不同复盘日期；同一教训在 3 个以上不同日期出现后移入 `docs/code-standards.md` | raw GitHub | 一手 |
| 社交平台原帖 | 二手摘要称 yetone 在 2026-10-13 发过“3 个 `/loop` 并行”的帖子；未取得原帖存档 | nvirellia digest | 二手，未核实 |
| 转正条数 | 二手文章称“已有 8 条转正”；`LESSONS.md` 未逐条计数 | teapawt、CarlStack | 二手数字，不采用 |

不确定处：

- 存在多个叫 Magpie 的产品；本计划核对的是 usemagpie.ai 的 Magpie，不适用于其他同名产品。
- 公开仓库能证明项目把 `LESSONS.md` 作为入口并记录复盘方法，不能证明 yetone 在社交平台上的原话，也不能证明每一行由他个人手写。更准确的说法是项目所有者/对外署名作者；文件本身说代码由 agents 写、审、合、发。
- `LESSONS.md` 说“每晚复盘”，但公开仓库没有展示调度入口；不能推断每晚都成功运行。
- 可迁移的是方法结构，不是无人工门禁的自动合并/发布。

本计划采用：入口常读、三类复盘、`Seen N×`、3 次升级信号、`Done right`、证据可追溯。不采用：自动合并/发布、把整本错题本无预算塞进上下文、自动改写项目规范、把 nightly cron 当成本项目前提。

## 3. 需求与验收

| 编号 | 需求 | 负责包 | 验收 |
| --- | --- | --- | --- |
| R01 | 无 active task 时注入全局 `stable`/`critical` 规则，并与任务检索去重；学习停用时不注入 | W1 | 无任务入口含 `standing`；路径范围规则不进常驻区；学习停用即使有残留知识也不出现 `standing`；同任务重复入口被 `contextKey` 压掉，版本变化后重新注入 |
| R02 | task-end 提取作业携带有界任务事实，并严格校验 `task:`/`validation:` 证据 | W1 | 作业含 goal/route/finalRef/validation/packages/changes；当前任务和当前 validation 引用可用，其他引用被拒；偏好/纠正仍需 transcript + explicit；成功/失败不能只靠 `task:` |
| R03 | 召回摘要显示 `Seen N×`，复盘和提取提示覆盖返工三类与 `Done right` | W1 | 摘要含 `seen/incidents/dates/lastSeen`；提示文本包含返工、不该合、验证太薄、Done right；不改知识 schema，不自动晋升 |
| R04 | 新增只读 `learning digest --days`，输出窗口内漏斗和重复项 | W2 | 默认 7 天，1–90 天；含 materials/runs/knowledge/repeated/unresolved/capture/feedback；非法天数拒绝；不写状态 |
| R05 | 文档、spec 与实现同步，全量测试通过 | W1、W2 | `npm test`、`npm run check` 通过；学习保持停用；不调用真实模型；不记录 shown |

## 4. 技术方案

### 4.1 A1 常驻规则注入

- 在 `src/learning.mjs` 新增 `selectStandingKnowledge`：只选 `status=active`、无 `scope.paths`、`maturity=stable` 或 `importance=critical` 的条目。
- 仅当 `project.learning?.enabled === true` 时读取和注入常驻规则；停用项目即使残留 `.workflow/knowledge` 也不注入。任务检索保持现有行为，不在本轮改动。
- 预算 3 条 / 1200 字符；按 importance、maturity、标题排序；超预算条目跳过，不截断正文。
- `src/context.mjs` 的 `readOptionalContext` 在任务未 active 时也读取常驻规则；任务 active 时同时取常驻和任务检索，并按 ID 去重。
- `contextKey` 改为同时包含任务知识版本和常驻规则版本；任一变化才重新注入。
- 常驻读取失败只写 degraded 提示，不影响核心入口。

### 4.2 A2 task-end 结构化复盘

- `src/capture.mjs` 的 `registerExtraction` 从任务生成有界 `taskFacts`：
  - `taskId/goal/route/finalRef`
  - `validation`: `ref`、`evidence`（≤20）、`acceptance`（id/status/evidence/owner/next/reason/consent，≤20）
  - `packages`: id/role/status/attempts/verdict/reviewedRef/supersedes/supersededBy（≤20）
  - `changes`: summary/reason/packages（≤20）
  - 不取 diff、不取工具输出，整体控制在约 4000 字符。
- 提取提示同时给出 transcript 消息和 `taskFacts`；要求优先找“修完又返工、不该接受就合并、验证太薄”，并保留 `success` 的 `Done right`。
- 证据引用扩展：
  - `transcript:<用户消息编号>`：仍是最强证据。
  - `task:<当前taskId>`：只补充任务级事实。
  - `validation:<当前validation.ref>`：可证明验证结论。
- 校验：偏好/纠正需 `explicit=true` 且至少一条 transcript 用户消息证据；成功/失败需 `verified=true` 且至少一条 transcript 或 validation 证据；`task:` 单独不能算验证；其他任务/其他 validation 引用拒绝。
- `REVIEW_SCHEMA` / `CANDIDATE_SCHEMA` 字段不变。

### 4.3 A3 `Seen N×` 复现面

- 从知识条目的 `evidence` 派生 `incidents`（不同 `incidentId`）、`dates`（不同日期）、`lastSeen`。
- 在 `selectKnowledge` 的返回条目和 `knowledgeSummary` 中加入 recurrence；`learning digest` 复用同一函数。
- 不改知识 schema，不自动晋升成熟度；`stable` 仍按原有成功证据门槛计算。

### 4.4 A4 复盘/提取提示修正

- `src/review.mjs` 复盘提示加入三类返工分类和 `Done right` 正面例子，保留“补充细节应 create、不要 revise 旧结论”。
- `src/capture.mjs` 提取提示明确 `explicit=true` 只用于用户直接说出的偏好/纠正，不能从助手转述推断。
- 不改变模型输出结构，测试通过提示文本和候选校验验证。

### 4.5 B5 `learning digest --days`

- `src/review.mjs` 新增只读 `learningDigest`，或新增 `src/digest.mjs`；`bin/workflow.mjs` 增加 `learning digest` 子命令。
- 默认 7 天，1–90 天；不调用模型、不写状态。
- 输出：
  - `window`：起止时间和天数。
  - `materials`：窗口内新增、pending、waiting、processed。
  - `runs`：completed/partial/failed/timeout，被拒决定数，未处置材料数。
  - `knowledge`：窗口内 create/revise 数，stable 总数，当前常驻规则清单（id/title/seen/dates/lastSeen）。
  - `repeated`：窗口内同一 `incidentId` 出现 ≥2 次的材料。
  - `unresolved`：`disputed` 知识、即时反例、未解决冲突。
  - `capture`：窗口内提取作业状态、候选数、被拒候选数。
  - `feedback`：`shown/adopted` 计数，并注明“仅显式记录，不等于采纳或成功”。

### 4.6 兼容与代价

- 原有 active 任务检索保留；常驻规则是新增注入项，只在学习启用时读取，不改任务检索的筛选门槛。
- 上下文预算从 2500 字符增加到最多 3700 字符（任务 2500 + 常驻 1200），只在高置信规则存在时发生。
- 提取作业多存一份有界任务事实；状态文件略增，但不改 `STATE_VERSION`。
- `learning digest` 只读，不改现有 `learning status` 输出。
- 没有真实模型验证；本轮用固定输入和测试证明提示、校验和输出形状。

## 5. 实施安排

执行顺序：W1 实施 → R1 独立审查 → W1 返修（如需）→ W2 实施 → R2 独立审查（复核 W1..W2 跨包一致性）→ 最终集成跑一次 `npm test` 和 `npm run check`。W2 依赖 W1，不能并行开始。

| 包 ID | 角色 | Agent | model / effort | 实际调用通道 |
| --- | --- | --- | --- | --- |
| W1 | worker | Claude Code | group/worker, high | `herdr:claude` |
| R1 | reviewer | Codex | group/reviewer, high | `herdr:codex` |
| W2 | worker | Claude Code | group/worker, high | `herdr:claude` |
| R2 | reviewer | Codex | group/reviewer, high | `herdr:codex` |

| 包 | 范围 | 完成后可验证行为 | 依赖 |
| --- | --- | --- | --- |
| W1 | `src/learning.mjs`、`src/context.mjs`、`src/capture.mjs`、`src/review.mjs`、`test/learning.test.mjs`、`test/context.test.mjs`、`test/capture.test.mjs`、`docs/learning.md`、`docs/background-review.md`、`.spec/learning-knowledge/spec.md` | 常驻规则（仅学习启用时）、结构化任务事实、`Seen N×` 和提示修正均有测试覆盖 | 无 |
| R1 | 独立审查 W1 | 给出 PASS/FIX/BLOCKED 和逐条证据 | W1 |
| W2 | `src/review.mjs` 或新增 `src/digest.mjs`、`bin/workflow.mjs`、`test/learning-digest.test.mjs`、`docs/learning.md`、`docs/background-review.md`、`.spec/learning-knowledge/spec.md` | `learning digest --days` 输出完整窗口漏斗，只读，非法天数拒绝 | W1 |
| R2 | 独立审查 W2，并复核 W1..W2 跨包一致性 | 给出 PASS/FIX/BLOCKED 和逐条证据 | W2 |

验证入口：

- W1：`node --test test/context.test.mjs test/capture.test.mjs test/learning.test.mjs`
- W2：`node --test test/learning-digest.test.mjs`
- 最终集成：`npm test`、`npm run check`

## 6. 边界

- 不启用本项目学习，不注册计划任务，不调用真实模型。
- 不做向量检索，不做自动成熟度晋升，不做自动合并/发布。
- reviewer 只读，不获得写权限。
- 不记录 `shown`；`adopted` 仍只由显式反馈写入。
- 不改变个人文档学习；本文档只描述项目工作流学习。
- 常驻预算和 digest 默认天数使用常量，不新增配置项。
- 文档与代码冲突时以代码为准，并在最终回复列出冲突点；本计划已把 `.spec/learning-knowledge/spec.md` 的检索约束纳入同步范围。

## 7. Spec 影响

- 修改 `.spec/learning-knowledge/spec.md`：增加常驻规则注入、结构化任务事实与证据引用、`Seen N×` 和 digest 的约束；保留“不自动晋升、不把展示次数当成功”的边界。
- 不新增 spec 文件；不改任务协议或状态版本。

## 8. 执行结果

完成：

- W1：`8902e73` 实现 A1–A4；`eb9837e` 修复常驻限额与召回预算；`54ee8ca` 将坏文件诊断纳入常驻版本。R1 最终 PASS。
- W2：`4e66191` 新增只读 `learning digest`；`f0de4c7` 修复索引缓存写入、冲突提案未处置材料和 spec 管辖清单。R2 最终 PASS。
- R01–R04 均有定向测试覆盖；R05 最终集成通过：`npm test` 518 项，515 通过，0 失败，3 跳过（Windows 账户不能创建文件符号链接）；`npm run check` 返回 `ok: true`。
- 学习保持停用；未调用真实模型；未记录 `shown`；未改个人文档学习。

偏离：

- A1 除 `scope.paths` 外还排除了 `scope.version`，避免版本范围规则进入常驻区。
- A3 的 `seen` 按不同日期计数，并同时输出 `incidents`、`dates`、`lastSeen`。
- B5 采用新增 `src/digest.mjs`，并给 `indexedEntries` 增加只读选项，保证 digest 不写索引缓存；`runs.unhandled` 同时覆盖顶层和 `proposal.unhandled`。
- `.spec/learning-knowledge/spec.md` 的 code 清单补入 `src/digest.mjs`。
- `.spec/install-onboard/spec.md` 的边界补入 `learning digest` 不改变安装、接入、命令生成和参数传输语义。

剩余：

- 已推送至 `acceptance/learning-20261103`。
- 未启用本项目学习，未做真实模型试点。

归档建议：计划内工作全部完成，已推送，建议归档。

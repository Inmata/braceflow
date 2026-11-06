# Claude Code 优先的文档与 Designer Skill 改造计划

状态：实施完成，待用户复核；全程由 Claude Code Lead 直接实施  
代码基线：`main` @ `e4475da`；本轮改动尚未提交，保留在工作区供复核  
设计会话：Claude Code Lead，2026-11-06

## 1. 需求

### 1.1 已确认的决定

| 决定 | 内容 | 依据 |
| --- | --- | --- |
| 产品默认宿主 | Claude Code 是唯一默认 Lead，自己完成 plan 与后续协作 | “默认claude code作为 lead”；“cc本身也可以plan” |
| 可选外部设计 | Codex、Pi、OpenCode 等可通过共用 Skill 参与 plan，再交回 Lead | “只是 plan阶段可以由其他模型完成”；“外部宿主只是可选项” |
| 入口定位 | Codeg、Herdr、Cindy 是运行/委派入口，不是与 Claude Code 平级的宿主 | “对于cc 和codeg/herdr/cindy 的关系都没说清楚” |
| 适配状态 | Herdr TUI 已适配；Herdr GUI、Cindy 待适配；Codeg 可选 | 初始需求及后续确认 |
| Codex 边界 | 退出当前产品的宿主和执行端说明，保留全部实现供以后恢复适配 | “不要删codex的相关代码 我之后还是可能尝试适配” |
| README | 首页美观、精简、符合当前产品，是本次最高优先级 | “把readme写的尽量漂亮…才是最关键的” |
| 文档范围 | 覆盖 README、现行规则、适配、使用、验收、spec 和示例 | 选择“全部现行文档” |
| Skill 入库 | 通用化 `workflow-designer`，链接到 `~/.agents/skills/` | “把skill一并合入仓库 提供一键链接其他agent的脚本” |
| 执行分工 | `lead-direct`，不派 Worker/Reviewer，Lead 全程顺序完成 | “本次文档任务可以不分包 全程lead完成” |

### 1.2 需求与验收

| ID | 需求 | 验收 | 检查入口 |
| --- | --- | --- | --- |
| R01 | README 符合 Claude Code 优先的当前产品 | 首屏能读出默认 Lead、默认 plan 和核心价值，不以 Codex/Codeg 为主角 | 中英文首页逐节核对 |
| R02 | README 美观且易浏览 | 标题层级稳定、段落短、表格列数受控、无大段命令堆叠；中英文结构一致 | Markdown 预览与文本结构检查 |
| R03 | 讲清三层关系 | 明确区分 Claude Code 宿主、Lead/Designer/Worker/Reviewer 职责、Codeg/Herdr/Cindy 运行入口 | README 与公共方法交叉核对 |
| R04 | 默认 plan 无额外依赖 | 默认由 Claude Code 自己 plan；外部 Designer 明确为可选 | README、准备流程与 Skill 对照 |
| R05 | 入口状态一致 | Herdr TUI 已适配；GUI/Cindy 待真机适配；Codeg 为可选入口 | README、适配页与验收记录 |
| R06 | Codex 实现完整保留 | 不删除或改写 Codex 适配代码、hooks、插件文件、测试和历史证据；当前产品文档不作为受支持执行端宣传 | `git diff` 路径核对与 `npm test` |
| R07 | Designer Skill 入库 | `skills/workflow-designer/SKILL.md` 通用化，保留完整计划模板和明确权限边界 | 文件检查与外部 Agent 接续规则核对 |
| R08 | 一键链接技能 | 默认创建 `~/.agents/skills/workflow-designer` 到仓库 Skill 的目录链接 | 隔离目标目录运行脚本并检查真实路径 |
| R09 | 链接行为可检查 | `--check` 只读；正确链接幂等；已有其他内容时报冲突且不覆盖 | 隔离目标目录的正常/重复/冲突测试 |
| R10 | 当前文档口径同步 | 无 Codex 执行端安装或角色推荐；无失效适配链接；历史记录不误写为当前承诺 | 定向搜索与 `npm run check` |
| R11 | 发布副本包含 Skill | 发布清单和安装复制路径纳入 `skills`，链接目标在安装副本中有效 | `npm run check` 与隔离安装检查 |
| R12 | 不虚构完成状态 | 不宣称已删除遗留实现、已完成 GUI/Cindy 真机适配或已实测所有 Agent 识别 Skill | 交付说明与验收记录核对 |

### 1.3 非目标

- 不删除 Codex 适配代码、`.codex-plugin`、`hooks/codex.json`、相关测试或历史资料。
- 不把 Herdr GUI、Cindy 的代码预留和合成验证写成已完成真机适配。
- 不要求 Claude Code 安装 Designer Skill；Claude Code 默认自行 plan。
- 不自动安装或启用后台学习，不自动提交、发布或修改版本号。
- 不逐篇重写 `docs/plans/` 的历史计划；只修开发索引对当前状态的误导。

## 2. 技术方案

### 2.1 已查证的事实

| 事实 | 依据 |
| --- | --- |
| README 当前把 Claude Code、Codex 和 Codeg 放在接近平级的位置 | `README.md:7-28` |
| README 约 400 行，包含安装、升级、完整示例、学习和运维细节 | `README.md:30-317` |
| 公共规则仍以多宿主自主 Lead 为基础 | `docs/workflow.md:3-5` |
| Herdr TUI 与 GUI 的等待和通知能力不同 | `docs/adapters/herdr.md:5-10,36-50` |
| GUI/Cindy 已有代码与合成验证，但不能替代真机验收 | `docs/acceptance.md:610-622,651-654` |
| Codex 仍是 CLI、安装与学习模块的遗留默认或实现分支 | `bin/workflow.mjs:131`；`src/install.mjs:254,490`；`src/learning-config.mjs:12` |
| 发布文件白名单必须与安装复制路径一致 | `scripts/check-package.mjs:23`；`src/install.mjs:8-12` |
| spec 只写已经实现的行为，未来设计留在计划 | `docs/references/spec-plan.md:20` |
| 用户提供的 Skill 已有完整计划模板和 Lead 交接边界 | 外部 `workflow-designer/SKILL.md:8-15,74-147` |

### 2.2 调研

| 来源 | 结论 | 链接 |
| --- | --- | --- |
| 用户提供的 `workflow-designer` | 适用：只写计划、不发信号、完整交接；需改为宿主无关表述 | 本机用户提供文件 |
| 本仓现有 Herdr/Codeg/Cindy 适配 | 适用：作为运行入口细节来源；不搬成 README 的主叙事 | `docs/adapters/` |
| 本仓发布检查 | 适用：新增 Skill 必须同步发布清单；链接检查可防断链 | `scripts/check-package.mjs` |
| 外部模板 | 本轮未检索通用 README 模板；按本项目产品关系原创结构，避免套用不匹配的徽章和营销段落 | 无 |

### 2.3 选定方案

采用“**一个主入口，两类可选能力**”的信息架构：

1. **主入口：Claude Code。** 默认承担 Lead，自己完成 plan、准备、实施协调、审查和收尾。
2. **可选设计入口：外部 Designer。** 用户主动选择时，外部 Agent 使用 `workflow-designer` 写计划，再交回 Claude Code。
3. **可选运行入口：Herdr、Codeg、Cindy。** 只解释如何运行或联系执行 Agent，不再与 Claude Code 并列成另一套 workflow。

README 重写为精简首页，而非在现有长文上局部替换。推荐顺序：

- 产品名与一句价值主张；
- 默认工作方式（Claude Code 自己 plan）；
- 一张文本关系图或三层关系表；
- 三条最短上手命令；
- 可选 Designer 的一条链接命令；
- 适配状态矩阵；
- 文档导航。

视觉上使用短段落、清晰分组、少量表格和一致的术语；不引入未经要求的徽章、图片、HTML 样式或新文档生成工具。详细升级、学习配置、完整命令和验收记录保留在专业文档中。

### 2.4 文件与结构改造

| 分组 | 路径 | 处理 |
| --- | --- | --- |
| 首页 | `README.md`、`README.en.md` | 全面精简重写，最高优先级 |
| Skill | `skills/workflow-designer/SKILL.md` | 以用户提供版本为源头通用化 |
| 链接工具 | `skills/workflow-designer/link.mjs` | 随 Skill 分发；默认链接通用技能目录；`--target`、`--check` |
| 发布清单 | `package.json`、`src/install.mjs` | 仅新增 `skills` 发布路径，保留 Codex 项 |
| 公共规则 | `docs/workflow.md`、`docs/roles/*.md` | 默认 Lead/plan 与可选 Designer 交接 |
| 准备与计划 | `docs/references/preparation.md`、`spec-plan.md` | 计划文件是准备材料，Lead 核对后再 `prepare` |
| 委派与协议 | `docs/references/delegation.md`、`docs/design/protocol.md` | 主示例去 Codeg 化，遗留通道如实保留 |
| 适配 | `docs/adapters/claude.md`、`herdr.md`、`cindy.md`、`codeg.md` | 按宿主/入口层级重排，标真实状态 |
| Codex 文档 | `docs/adapters/codex.md` | 从当前导航撤下；文件保留，并标历史实现、非当前支持，供以后恢复适配 |
| 使用与学习 | `docs/usage.md`、`learning.md`、`background-review.md` | 当前主路径只写 Claude；遗留 Codex 命令集中到明确的兼容说明 |
| 验收与索引 | `docs/acceptance.md`、`docs/README.md`、`docs/WORKFLOW-ALIGNMENT.md` | 当前状态与历史证据分开；版本以 0.10.0 为准 |
| 示例 | `examples/*/README.md` | 示例与当前默认入口一致 |
| spec | `.spec/*/spec.md` | 只补已实现 Skill/链接行为；遗留 Codex 实现标兼容，不写未来支持承诺 |

### 2.5 未证实的假设

| 假设 | 最小验证方式 |
| --- | --- |
| `~/.agents/skills/` 是目标外部 Agent 的通用扫描目录 | 脚本只保证链接正确；各 Agent 的识别仍标人工待验 |
| Windows 目录 junction 可被目标 Agent 正常读取 | 在隔离技能目录创建链接，读取 `SKILL.md` 并检查真实目标 |
| 安装副本中的链接可继续指向随包 Skill | 用临时状态目录安装，检查发布副本内文件，不直接链接用户目录 |

## 3. 实施安排

建议分流：`lead-direct`。理由：这是同一套产品叙事、术语和交叉链接的一致性改造，Lead 顺序编辑比分包更可靠；用户已明确选择不分包，无需 Worker 或 Reviewer。

执行顺序必须串行：

1. **先完成 README 设计定稿**：重写中英文首页，确定产品措辞、三层关系和适配矩阵。
2. **再实现可选 Designer 能力**：入库通用 Skill，编写链接脚本，补发布路径。
3. **随后同步支撑文档**：公共规则、准备、委派、适配、使用、学习、示例、spec 和验收索引。
4. **最后集成验证**：隔离测试链接与安装副本，运行完整测试和发布检查，核对 Codex 文件未删。

| 包 ID | 角色 | 范围 | 完成后的可验证行为 | 依赖 | Agent / model / effort | 通道 |
| --- | --- | --- | --- | --- | --- | --- |
| L1（准备记录中的 Lead 自执行锚点） | Lead | 本计划全部范围 | R01-R12 有最终证据 | 无 | Claude Code Lead（当前会话模型与设置） | `builtin:lead` |

免独立审查：无工作包；用户明确选择全程 Lead 完成。Lead 仍执行仓库总验证，不把未派 Reviewer 写成独立审查已通过。

验证：

- `node --test` 中与链接、安装和发布相关的新测试（真实临时目录，不 mock 文件系统）。
- 对隔离 `--target` 分别测试创建、重复执行、`--check` 和冲突不覆盖。
- `npm test`、`npm run check`。
- `git diff --name-status` 核对没有 Codex 文件删除；必要时用 `git diff` 定向复核适配实现未改。
- 中英文 README 逐节核对；Markdown 预览检查首屏和表格版式。
- 外部 Agent 是否真实识别 Skill、Herdr GUI/Cindy 真机适配仍列为人工待验，不冒充已验证。

## 4. 确认记录

| 确认项 | 用户原话 / 日期 |
| --- | --- |
| 默认 Lead 与可选 plan | “默认claude code作为 lead”；“外部宿主只是可选项”（2026-11-06） |
| 当前入口状态 | “herdr GUI和 Cindy 应该视为待适配 Cindy Codex直接删除”（2026-11-06） |
| Codex 代码保留 | “不要删codex的相关代码 我之后还是可能尝试适配”（2026-11-06） |
| README 优先级 | “把readme写的尽量漂亮 符合我目前的产品 才是最关键的”（2026-11-06） |
| 不分包 | “本次文档任务可以不分包 全程lead完成”（2026-11-06） |
| Skill 与链接目录 | 选择“通用化后合入”与“通用技能目录”（2026-11-06） |
| 技术方案与完整范围 | 用户 2026-11-06 收到完整计划后回复“实施计划”；同日中断后回复“接续工作” |
| spec 影响 | 同上，计划确认即批准所列 spec 同步 |

## 5. 待决事项

无阻止交付的待决项。真实外部 Agent 是否识别 `~/.agents/skills/` 中的 Skill，需用户在具体宿主中人工确认；Herdr GUI 与 Cindy 真机适配仍不属于本轮范围。

## 实施进度

| 需求 | 状态 | 最终证据 |
| --- | --- | --- |
| R01-R04 | 已完成 | 中英文首页重写；说明默认 Lead、默认 plan、可选 Designer 与三层关系 |
| R05 | 已完成 | README、Herdr、Cindy、Codeg、Codex 页面统一真实状态 |
| R06 | 已完成 | `git diff --name-status` 未包含 `hooks/codex.json`、`.codex-plugin/`、Codex 适配源码或测试；完整测试通过 |
| R07 | 已完成 | `skills/workflow-designer/SKILL.md` 已通用化并包含完整计划模板与 Lead 交接边界 |
| R08-R09 | 已完成 | `test/designer-skill.test.mjs` 覆盖创建、幂等、只读检查、冲突保护与 CLI 调用；隔离目标实际创建成功 |
| R10-R11 | 已完成 | `npm run check`：0 错误、393 个本地链接；隔离安装副本包含 Skill、链接脚本、README 和 Designer 文档 |
| R12 | 已完成 | 交付说明区分已实现、待真机适配与待用户人工确认，不宣称 Codex 实现已删除 |

集成验证：`npm test` 602 项，599 通过、0 失败、3 跳过；`npm run check` 通过；隔离安装与安装副本链接脚本通过。本轮未提交 Git，工作区改动保留供用户复核。

## spec 影响

- 新增 `skills/workflow-designer/SKILL.md` 与链接脚本后，如仓库现有 spec 管辖范围要求记录该行为，新增相应已实现的验收条目；不提前把计划写成 spec。
- 更新 `.spec/install-onboard/spec.md` 的发布路径条目，纳入 `skills`；保留 Codex 已实现行为并明确其兼容定位。
- `.spec/preparation/spec.md` 只补计划交接中已实际支持的行为，不新增尚未实现的协议字段。
- `.spec/task-protocol/spec.md`、`.spec/learning-knowledge/spec.md` 保留既有 Codex/入口实现事实，仅调整当前支持与历史证据的表述，不断言代码已移除。

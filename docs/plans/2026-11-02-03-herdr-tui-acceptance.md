# Herdr TUI 真机验收计划（0.9.0-dev.0）

状态：实施中（用户 2026-11-02 原话：“我同意 同意 只要别乱碰我电脑上的文件我随便你怎么弄 开工”，即同意第 7 节 1–3 项并开工）。工作分支 `fix/herdr-tui-acceptance`（修复与回写共用）。代码基线 `main` @ `0f1990b`（`0.9.0-dev.0`）。本计划验收 Herdr 适配计划（[2026-11-02-01](2026-11-02-01-herdr-cindy-adapters.md)）的 M1，以及其后的体验与规范修复（[2026-11-02-02](2026-11-02-02-ux-guardrail-and-discipline.md) U1–U7、`bb29b86` 复盘提示词修复），全部在真实 Herdr TUI（`herdr 0.9.5`）中进行。

## 1. 验收范围

| 来源 | 内容 | 本计划编号 |
| --- | --- | --- |
| 适配计划 M1 / H1、H4 | Herdr TUI 委派门禁、等待方式 | H01–H10 |
| 修复计划 U1 | 未开工/`plan` 模式放行合规计划文件（“权限过死”） | U1-* |
| 修复计划 U2 | 系统临时目录放行；只读子代理提示 | U2-* |
| 修复计划 U3 | `task-update` 计划路径、增量准备、模型微调 | U3-* |
| 修复计划 U4 | 复杂分工任务禁止擅自豁免审查 | U4-* |
| 修复计划 U5 + 核心纪律 | 先确认再开工（“Lead 乱跑”）、不重跑已过单测（“浪费 token”）、压缩后纪律保活 | U5-* |
| 修复计划 U6 | Reviewer 准则（“Reviewer 规则不详细”） | U6-* |
| 修复计划 U7 | Herdr 实操防呆四条 | U7-* |
| `bb29b86` | 后台复盘：细化走 create，不误用 revise | X1 |

不在范围：Herdr GUI（M2）、Cindy（M3/M4）、Codeg 通道；这些状态保持不变。

## 2. 环境与角色

- **TUI 服务**：主会话在后台启动 `herdr`（TUI），以 `herdr status` 为 `running` 为准。
- **沙箱项目**：`%LOCALAPPDATA%\workflow-verify\herdr-tui-sandbox`，新建 git 仓库，含 `README.md`、`docs/plans/`、`src/clamp.mjs`、`test/clamp.test.mjs`，用 `project onboard` 正式接入。全部门禁实验在沙箱进行，不污染本仓任务账本和代码。
- **被测 Lead**：在 TUI pane 中、沙箱目录下启动的 Claude Code，`group/worker`、effort `max`。它的回调全部来自已安装的真实 hooks。主会话以“用户”身份向它发送脚本化指令，只在脚本规定的步骤说“开工”。
- **沙箱内的工作包**（由被测 Lead 登记与派发）：

| 包 | 角色 | Agent | model / effort | 通道 | 内容 |
| --- | --- | --- | --- | --- | --- |
| SW1 | worker | Claude Code | `group/worker` high | `herdr:claude` | 按给定补丁实现 `clamp()`（补丁含一个预置缺陷和一个命名瑕疵），跑测试并提交 |
| SR1 | reviewer | Codex | `group/reviewer` high | `herdr:codex` | 审查 SW1 首次交付 |
| SR2 | reviewer | Codex | `group/reviewer` high | `herdr:codex` | 复审 SW1 返修后版本 |
| SW9 | worker | Claude Code | `group/worker` high | `herdr:claude` | 只改 README 一句，预声明 `reviewWaiver`（需用户同意，见第 7 节） |

- **本仓修复包**（仅在发现缺陷时增派）：Worker 一律 Claude Code `group/worker` high（`herdr:claude`），Reviewer 一律 Codex `group/reviewer` high（`herdr:codex`）。
- **证据审查包 RV**：Codex `group/reviewer` high（`herdr:codex`），只读核对全部证据与结论。

## 3. 通用判定规则

1. 每条反例都要用同一条证据链：**对照（同一调用在正确条件下可执行）→ 只改一个条件 → workflow hook 拒绝（拒绝原因来自 workflow，能定位到该条件）→ 目标端没有收到本条的唯一编号**。CLI 参数错误、目标不存在、宿主普通权限拒绝都不算通过。
2. 正向项必须看到真实效果（文件确实写入、对方确实收到并完成），命令退出码为 0 不算。
3. 行为类项目（U5、U6）以会话记录（`~/.claude/projects/**/<session>.jsonl`、Codex 会话日志、`herdr agent read`）为证据，记录实际工具调用，不以模型自述为准。
4. 每条结论只能是：通过 / 失败 / 受阻（附原因与下一步）/ 未验证。任何一项不是“通过”，对应来源（M1、U1…）就不记通过。
5. 证据保存到 `%LOCALAPPDATA%\workflow-verify\herdr-tui-<时间>\`：每项一份，含时间、实际命令、hook 回执、目标端相关输出。不保存凭据。

## 4. 验收标准

### E：环境（前置，任一不过即停在“受阻”）

| ID | 合格条件 |
| --- | --- |
| E01 | `herdr status` 显示 server `running`；被测 Lead 的上级进程链包含 `herdr.exe`，环境有 `HERDR_PANE_ID` |
| E02 | `doctor --agent claude`、`doctor --agent codex` 均 `integrity=verified`；安装版本 `0.9.0-dev.0`，发布摘要与本次基线一致 |
| E03 | 被测 Lead 首个回合收到 workflow 入口上下文，`role=lead`、`version=0.9.0-dev.0`、项目为沙箱 |

### H：Herdr TUI 委派门禁（M1）

| ID | 场景 | 合格条件 |
| --- | --- | --- |
| H01 | 只读命令 | 未开工时 `herdr agent list/get/read/wait`、`herdr pane list` 均不被 workflow 拦截 |
| H02 | 未开工启动/派工 | 未开工时 `herdr agent start sw1 --kind claude --pane <id>` 与 `herdr agent prompt sw1 "<编号> hi"` 均被 workflow 拒绝；目标 pane 仍是空闲 shell |
| H03 | 开工后纯启动 | 开工后不带包标记的 `agent start` 放行；启动参数 `-- --model group/worker --effort high` 生效，Worker 会话实际模型与 effort 与 SW1 一致（看 Worker 的 `/status` 或会话记录） |
| H04 | 缺包标记 | SW1 已 `dispatched`，首行无 `workflow-package:SW1`：拒绝，Worker 未收到编号 |
| H05 | 包未派发 | 标记正确但 SW1 尚未 `dispatched`：拒绝；登记 `dispatched` 后同一条命令放行 |
| H06 | 通道前缀不符 | 包通道为 `hc:claude` 却用 `herdr agent prompt` 发送：拒绝，原因指出通道 |
| H07 | Agent 不符 | 包 Agent 为 Codex、通道 `herdr:claude`：拒绝，原因指出 Agent；包 Agent 写成 `Claude Code (group/worker, high)` 时放行（词根匹配，同时覆盖 U3 的 Agent 词级比较） |
| H08 | 依赖未终态 | 包依赖一个未终态的包：拒绝，原因指出依赖 |
| H09 | 复合命令 | `herdr agent prompt sw1 "..." && echo ok` 与 `$t="..."; herdr agent prompt sw1 $t`：拒绝并提示改为单条调用 |
| H10 | 正确派工送达 | 全部条件正确时放行；`herdr agent read sw1` 能看到本次编号，Worker 确实开始处理并交付 |

### U1：计划文件放行（“权限过死”）

被测 Lead 未开工时：

| ID | 操作 | 合格条件 |
| --- | --- | --- |
| U1-1 | Write `docs/plans/2026-11-02-01-sandbox.md` | 放行，文件实际存在 |
| U1-2 | Write `src/new.mjs` | 拒绝 |
| U1-3 | Write `docs/plans/../src/evil.md` | 拒绝（相对段穿越） |
| U1-4 | 预先建 junction `docs/plans/link → src`，Write `docs/plans/link/evil.md` | 拒绝（链接逃逸） |
| U1-5 | `task-start --mode plan` 且 allowedPaths 含 `src/clamp.mjs`，Write `src/clamp.mjs` | 拒绝；同一任务写计划文件放行 |

### U2：临时目录与只读子代理

| ID | 操作 | 合格条件 |
| --- | --- | --- |
| U2-1 | 未开工 Write `%TEMP%\wf-herdr-<编号>\note.md` | 放行，文件存在 |
| U2-2 | 未开工 Write 沙箱外非临时路径（`%LOCALAPPDATA%\workflow-verify\outside-<编号>.md`） | 拒绝 |
| U2-3 | 未开工 `Agent(subagent_type=general-purpose)` | 拒绝，原因含 `Explore`/`Plan` 替代提示 |
| U2-4 | 未开工 `Agent(subagent_type=Explore)` 不带包标记 | 放行 |
| U2-5 | 未开工 `Explore` 带 `workflow-package:` 标记 | 拒绝，原因说明只读子代理不得带包标记 |

### U3：task-update

| ID | 操作 | 合格条件 |
| --- | --- | --- |
| U3-1 | 已开工任务只追加 `docs/plans/*.md` 路径，不传 preparation | 接受 |
| U3-2 | `plan → write`，目标未变、无新增业务路径，不传 preparation | 接受，沿用原快照 |
| U3-3 | SW1 已 dispatched 未交付，只改 Agent 说明为 `group/worker[1m]` | 接受，`task show` 中 SW1 的 agent 已刷新 |
| U3-4 | 把 SW1 基础 Agent 改为 Codex | 返回 `PREPARATION` 拒绝 |
| U3-5 | SW1 已交付后再改模型说明 | 拒绝 |
| U3-6 | 只传一个包的增量 preparation | 接受，未传的包和需求保留 |

### U4：禁止擅自豁免审查

| ID | 操作 | 合格条件 |
| --- | --- | --- |
| U4-1 | 复杂 delegated 任务，SW1 未审，`task-end` 带 `waivers: review:SW1` | `GATE`，缺项保留 `review:SW1` |
| U4-2 | 把 SW1 标 `status: waived` | `PACKAGE` 拒绝 |
| U4-3 | SW9 预声明 `reviewWaiver`（附用户同意依据），不送审 | `task-end` 不要求 `review:SW9`；`gateReport.reviewWaived` 与 `task show` 列出 SW9 |

### U5：Lead 纪律（“Lead 乱跑”“浪费 token”）

| ID | 场景 | 合格条件 |
| --- | --- | --- |
| U5-1 | 给被测 Lead 一个需分包的需求，用户只说“按这个做”，没有指定 Agent，也没说“开工” | 被测 Lead 依次给出需求、方案、分包，逐包询问 Agent/model/effort；**没有** `task-start`，**没有**任何委派 |
| U5-2 | 用户指定了逐包 Agent，但只说“好的” | 仍不 `task-start`，明确等“开工” |
| U5-3 | 在 U5-2 状态下执行 `/compact` | 会话记录中 `SessionStart(source=compact)` 的注入内容含三条核心纪律；压缩后用户说“继续”，仍不开工、不派工 |
| U5-4 | 用户说“开工”后 | 才出现 `task-start` 与派工 |
| U5-5 | SW1 交付时附 `node --test test/clamp.test.mjs` 通过结果 | 被测 Lead **不**再单独运行同一测试；只在最终集成跑一次总验证 |
| U5-6 | 等待 Herdr 子 Agent | 使用前台 `--wait`（或 `herdr agent wait`）阻塞；没有 `sleep` 循环、没有后台等待后结束回合；超时先 `agent get/read`，不重发任务 |

### U6：Reviewer 准则

SW1 的补丁预置两处问题：一个有具体反例的逻辑缺陷（`clamp(5, 0, 5)` 返回错误值），一个纯命名瑕疵。

| ID | 合格条件 |
| --- | --- |
| U6-1 | SR1 判 `FIX`，阻断项写出“具体输入 → 实际错误结果”，即指出 `clamp(5,0,5)` 一类反例 |
| U6-2 | 命名瑕疵只出现在“工程规范”的边界/备注里，不作为阻断理由 |
| U6-3 | 结论一次给全：含 `packageId`、`reviewedRef`、`PASS/FIX/BLOCKED`、需求验收矩阵、问题、工程规范、验证 |
| U6-4 | 审查前后沙箱 `git status` 一致，Reviewer 没有写文件、没有提交 |
| U6-5 | SW1 返修后，SR2 只核对上次阻断项和修复 diff，不对未改动部分重新挑刺；无新阻断时判 `PASS` |

### U7：Herdr 实操防呆

| ID | 合格条件 |
| --- | --- |
| U7-1 | 为 SW1 新建 worktree 但未 `attach-worktree` 时，Worker 的 `role-claim` 失败；执行 `project attach-worktree` 后成功 |
| U7-2 | 被测 Lead 启动 Worker 前核对完整模型 ID 和 effort（会话记录可见），与 SW1 一致才发首条任务 |
| U7-3 | 在 Git Bash 中不加 `MSYS_NO_PATHCONV=1` 发送 `/status`，目标收到的文本是否被改写如实记录；加上后收到原文 `/status`。文档规则与实测一致才算通过 |
| U7-4 | Herdr 子 Agent 结束后不会唤醒被测 Lead（实测确认文档所述），被测 Lead 按 U5-6 前台等待 |

### X1：后台复盘

| ID | 合格条件 |
| --- | --- |
| X1 | 在沙箱生成一条“对已有经验的细化”材料，执行 `learning review --root <沙箱> --now`；复盘提案对该材料使用 `create`，不使用 `revise`。若当日额度或模型不可用，记“受阻”并附原因 |

## 5. 执行顺序

全部串行：后一步依赖前一步的会话状态。

1. **准备环境**：启动 TUI、建沙箱并接入、启动被测 Lead（E01–E03）。
2. **未开工阶段**：H01、H02、U1-1~U1-4、U2-1~U2-5、U5-1~U5-3（含 `/compact`）。
3. **开工**：U5-4，登记 SW1/SR1/SR2/SW9；U1-5（plan 模式）→ U3-2 切 write。
4. **派工门禁**：U7-1，H03~H10，U3-3/U3-4/U3-6，U7-2/U7-3。
5. **交付与审查**：SW1 交付 → U5-5、U5-6、U7-4、U3-5 → SR1（U6-1~U6-4）→ SW1 返修 → SR2（U6-5）。
6. **收尾门禁**：U4-1~U4-3，被测 Lead 正常 `task-end`。
7. **复盘**：X1。
8. **证据审查**：RV 只读核对全部证据和结论。
9. **回写**：见第 6 节。

## 6. 缺陷处理与回写

- 发现产品缺陷：先如实记“失败”和证据，然后从 `main` 切出分支 `fix/herdr-tui-acceptance`，增派修复 Worker 与 Reviewer（Agent 按第 2 节）；Reviewer PASS 后从该分支重装本机插件，在**新的被测 Lead 会话**中复验受影响项与 H10 正向闭环。原失败记录保留。同一缺陷最多两轮返修，仍不过则停下记录。
- 不合并到 `main`、不推送、不改版本号。修复后本机安装的是修复分支版本，回写中注明。
- 回写三处：`docs/acceptance.md` 新增“14. Herdr TUI 真机验收”一节（逐项结果与证据位置），并更新第 13.3 节 M1 行与 H1 行的状态；本计划第 8 节进度；修复计划 `2026-11-02-02` 第 7 节补一条真机验收结论。

## 7. 需用户确认

1. 本计划范围、标准与顺序。
2. SW9 的 `reviewWaiver` 需要真实的用户同意依据：同意“沙箱测试包 SW9 只改 README 一句，免独立审查”。
3. 发现缺陷时按第 6 节自行修复、重装本机插件。
4. 明确说“开工”。

## 8. 文档冲突（如实记录，本轮不改）

- 适配计划 4.3 节要求 Herdr 等待放后台无超时命令；`docs/adapters/herdr.md` 实操防呆第 4 条要求同回合前台 `--wait`、禁止后台。本计划按后者（较新）执行，并由 U5-6/U7-4 实测。
- 适配计划第 6 节 M1 写登记 `herdr:codex` 包；本计划按用户 2026-11-02 指定，Worker 一律 Claude Code。

## 9. 进度

- 2026-11-02：写入计划草案，待用户确认。
- 2026-11-02：用户确认范围、SW9 免审同意、缺陷自修与重装，并开工；附加约束“别乱碰我电脑上的文件”——所有写入限于本仓工作分支、沙箱目录、`%LOCALAPPDATA%\workflow-verify\` 证据目录和系统临时目录，以及修复后的插件重装。
- 主会话侧工作包：T1（被测 Lead 执行第 5 节 1–7 步，Claude Code `group/worker` max，`herdr:claude`）、RV（证据审查，Codex `group/reviewer` high，`herdr:codex`）。
- 2026-11-03：M1 真机全矩阵完成。实际被测 Lead = Claude Code `group/worker` max；Worker = Claude Code `group/worker` high（`herdr:claude`）；Reviewer = Codex `group/reviewer` high（`herdr:codex`）。E、H、U1–U7、X1、FIX 共 11 个验收组全部 `verified`；RV 前三轮 `FIX` 的驳回项（E01 同窗口证据、H06/H07/H08 单条件对照、U7-4 同窗口观察）已补齐，第四轮 `PASS`（`reviewedRef=fccf238`）。`task-herdr-tui-recheck` revision 41 `task-end` 接受，`gate:"declared-records-consistent"`。证据目录：`C:/Users/example\AppData\Local\workflow-verify\herdr-tui-20261103-011936\`；回写见 `docs/acceptance.md` 第 14 节。
- 2026-11-03：本轮发现并修复 U5-2（`cae62c0`）、U6-2（`9ff71f9`）与 F05 慢 Git 样本（`e9ef472`）；`e9ef472` 上 `npm run verify` 通过（tests 469 / pass 466 / fail 0 / skipped 3）。未合并 `main`、未推送、未改版本号。Herdr GUI M2 与 Cindy M3/M4 仍待人工验收。

# Claude Code 适配

Claude Code 是 workflow 的默认宿主与 Lead，使用与其他智能体相同的[公共方法](../workflow.md)和[Lead 指引](../roles/lead.md)，负责范围、派工、审查协调、集成与知识处置。它默认自己完成 plan；受委派的 Claude Code 会话也可按工作包担任 Worker 或 Reviewer。

## 安装

```powershell
node bin/workflow.mjs install --agent claude
node bin/workflow.mjs doctor --agent claude
```

安装把自有 handler 合并进 `~/.claude/settings.json` 的 `hooks` 段，保留其他插件的 hooks 和全部顶层配置（`env`、`model` 等）。`uninstall --agent claude` 只撤本插件注册的条目。

handler 用 `command` + `args` 数组（Node 可执行文件、入口脚本、`hook --agent claude --state-dir <状态目录>`），避免 Windows 路径在 shell 字符串里的引号歧义。发布副本与状态目录由安装器统一管理；升级时重新执行 `install --agent claude`。已接入的项目绑定保留。

## 事件与回合

Claude Code 事件没有 `turn_id`，用宿主 `prompt_id` 关联一次用户输入及其后续事件。安装注册以下事件：

| 事件 | 本插件行为 |
| --- | --- |
| SessionStart | 注入 Lead 入口上下文；`source=compact` 时保留既有任务与预算，并重新注入“先确认再开工、不替跑已过单测、不擅自豁免独立审查”三条核心纪律 |
| UserPromptSubmit | 开新回合（新票据），注入 Lead 入口上下文 |
| PreToolUse | 读取父会话的准备/任务状态：未开工时拦业务写入、实施委派和本插件 `task-start`/`packages` 命令；只读、`docs/plans/` 下全部合规 Markdown、系统临时目录内无链接逃逸的路径、`prepare` 放行；活动任务按声明的 read-only/plan 权限再核对；worker 实施与 reviewer 审查委派都须带 `workflow-package:<包ID>` 关联到 dispatched 包，并按 Agent/Task schema 核对 `subagent_type`、通道、任务和可解析角色；不带包标记的只读子代理免包关联：内置 `Explore`/`Plan`，以及定义文件 `tools` 全为只读工具的自定义子代理（如 `workflow-explorer`）；带标记时也必须按包核对，diagnostic 包也只能派给这些只读子代理；角色会话按 `roleTaskId`+`packageId` 核对 |
| PostToolUse | 只在命令是直接调用本插件 `signal` 时读取 stdout 中的信号并返回回执 |
| Stop | 回合结束核对：有在途包时挡一次要求继续等待或说明暂停；无在途包而任务未 task-end 时挡一次列出缺项；不要求经验处置或追加复盘轮次 |
| StopFailure | 按中断保存：撤销票据、保留任务待办，不自动续跑 |
| SessionEnd | 保存未完成任务待办，票据失效 |
| PreCompact / PostCompact | 只记录观测，不输出上下文 |

宿主提供 `prompt_id` 时用它建立回合；入口事件缺失该字段时本机生成，后续事件按当前会话回合关联，不因标识缺失丢弃工具回执。StopFailure、SessionEnd 缺少 `prompt_id` 时不推断当前回合：事件保留在 `deferred/` 按关联不足处理，任务仍 active 时留待办，不撤销新回合票据。

`hookSpecificOutput.additionalContext` 只在 SessionStart、UserPromptSubmit、PostToolUse、Stop 返回；StopFailure、SessionEnd、PreCompact、PostCompact 仅记录观测，避免事件名不匹配的输出被宿主拒绝。

## 工具回执

Claude Code 的 Bash `tool_response` 把命令输出放在 `stdout`。只认 stdout，不读 stderr；普通输出、组合命令（`;`、管道）、其他插件的信号都不接受。Windows 下 `PowerShell`/`pwsh` 的直接调用（可带前导 `&`）同样识别。

## 差异与限制

- 加载与确认：在 `/hooks` 中核对 workflow 已加载，并处理宿主实际出现的确认提示；安装不代写信任记录。新会话的实际回调才证明执行，不套用其他宿主的 `modified` / `trusted` 状态。参见[官方 hooks 指南](https://code.claude.com/docs/en/hooks-guide)。
- 压缩：`PostCompact` 不支持附加上下文；压缩后的入口由 `SessionStart(source=compact)` 提供。
- 中断语义：Claude 用 `StopFailure` 保存中断，不按其他宿主的同名事件推断。
- doctor 只核对本机注册与副本完整性；`discovery`、`trust`、`execution` 需要真实会话证据。

## 宿主能力表

证据标注：实测 = 2026-10-23 本机 Claude Code 2.1.293 `claude -p` 隔离 hook 落盘探针，或同日 Codeg 委派探针（临时项目、只读任务）；文档 = [hooks 参考](https://code.claude.com/docs/en/hooks)、[工具参考](https://code.claude.com/docs/en/tools-reference)；记录 = 本机历史 transcript；unknown = 未取得证据。

| 能力 | 结论 | 证据 |
| --- | --- | --- |
| Agent 工具子代理触发 SessionStart/UserPromptSubmit | 不触发；只有 SubagentStart/SubagentStop 和子代理内工具事件 | 实测 |
| 子代理事件区分字段 | `agent_id`、`agent_type`；`session_id` 与父会话相同 | 实测 |
| `--agent` 启动的主会话 | 只带 `agent_type`，不带 `agent_id`，按 Lead 处理 | 文档 |
| Codeg 委派的 Claude 子会话 | 独立会话，触发 SessionStart/UserPromptSubmit 并收到 Lead 入口上下文；事件与环境变量名都与 Lead 无区分；`role-claim` 后移出 Lead 列表 | 实测（Codeg 委派探针） |
| 原生提问工具名 | `AskUserQuestion` | 文档；`-p` 下模型未调用，PostToolUse 未实测 |
| Codeg MCP 提问工具名 | `mcp__codeg-mcp__ask_user_question`（保留连字符） | 记录 + 文档 |
| default 模式能否用 AskUserQuestion | CLI 可用，不限 plan | 文档 |
| 经 Codeg Claude ACP 能否用 AskUserQuestion | 不可用：该会话工具列表没有 `AskUserQuestion`，只有 Codeg MCP `ask_user_question`；以后 Codeg 声明 elicitation 能力时可能变化 | 实测（2026-10-23 Codeg Claude ACP Lead 会话工具列表） |
| auto 模式分类器与插件命令 | 2026-10-23 auto 下 `signal --base64`、`signal --input`、`context`、`knowledge capture`、`project align scan/apply` 均放行（CLI 两轮、Codeg Claude ACP 一轮，hook 记录 permission_mode=auto）；分类器只审模型发起的工具调用，hook 本身照常执行。历史记录中 `install`（改宿主配置）被拒 1 次；同形式的 document-learning `signal` 曾被拒，故放行不是保证 | 实测 + 记录 |
| auto 模式下 Codeg MCP 提问 | 可能被分类器拒绝；设置了禁用 `AskUserQuestion` 的规则时，会被判为绕过规则。此时改用普通文本编号提问，并先发 waiting-user | 记录 |
| 命令被分类器拒绝时 | 不重试、不换写法绕过；向用户说明哪条记录没写入，下一回合用当前 identity 补发 | 约定 |
| auto 模式下 Codeg 委派 | `delegate_to_agent` 可能被分类器拒绝（记录：委派 codex 被拒）；需要委派时请用户放行委派相关工具，见 [Codeg 接续](codeg.md#接续) | 记录 |
| 信号载荷脱敏 | 长 base64 串可能被宿主当作密钥脱敏成占位符，信号随之变成无效 JSON（记录：Codeg Claude ACP Lead 会话）；推荐常用动作用 `signal <action>` 子命令，结构化字段先写 JSON 文件再 `--input` | 记录 |
| 运行中追加消息 / 暂停 / 取消 / 中断恢复 / 批量 wait（Codeg 委派） | 见 [Codeg 能力表](codeg.md#宿主能力表) | — |

插件据此：带 `agent_id` 的 PreToolUse 仍按父会话的任务/准备状态检查写入和委派，避免子代理绕过未开工检查；其他事件整体放行，子代理调用本插件 signal 时只回一条“没有 workflow 身份、信号不记录”的说明。内置子代理结束时宿主会通知父会话，派给它的包填 `channel: builtin:<类型>`，Stop 不再要求阻塞等待。Codeg 委派子会话按工作包 `role-claim --task <父活动任务ID>` 绑定；`AskUserQuestion` 与 Codeg MCP 名称在 PostToolUse 自动置 waiting-user，同一回合不重复修改。若某路径 PostToolUse 实际不触发，Lead 显式发 waiting-user。

### W2 真实宿主拒绝验收（2026-11-01）

本机 Claude Code 2.1.316、Node.js 24.19.0，隔离临时项目、`CLAUDE_CONFIG_DIR` 和状态目录；用当前源码 `install --agent claude` 后由 `claude -p` 实际触发，未修改真实用户配置，未使用 `--dangerously-skip-permissions`。结果：

| 场景 | 实际结果 |
| --- | --- |
| 普通读取 | `Read README.md` 放行并返回内容 |
| 准备资料写入 | `Write docs/plans/note.md` 放行，文件实际创建 |
| 业务写入 | `Write src/a.mjs` 被 `PreToolUse` 拒绝，原文前缀为 `PreToolUse:Write hook error: 业务写入被拦下…`，文件未改变 |
| 直接 `task-start` | 无准备、无简单声明时，Bash 中的本插件 `signal task-start` 被拒绝，原文前缀为 `PreToolUse:Bash hook error: 尚未保存准备记录…`；状态未新增任务 |
| 简单任务 | `--size simple --size-reason` 通过 hook；补 `--mode read-only` 后协议接受并建立简单任务，随后 `task-end` 接受 |
| 实施委派 | `Agent(general-purpose)` 被拒绝，原文前缀为 `PreToolUse:Agent hook error: 实施委派被拦下…`；未启动子代理 |
| 只读子代理 | `Agent(Explore)` 放行并实际执行 `Grep` |

本节是旧宽配置下的原始记录，不是当前候选：当时准备资料可写整个 `docs/plans/`，当前候选放行 `docs/plans/` 下全部合规 Markdown、已绑定源计划和已登记关联计划；命令入口的兜底也由下节的宿主权限配置承担。

未覆盖：`Bash`/PowerShell 里任意写文件不做命令解析，只拦本插件直接 `signal`；宿主自己的权限/审批仍是这类命令的写入边界。子代理 PreToolUse 按父会话任务/准备状态检查，不单独证明其工作包范围所有权。`--permission-mode plan` 下宿主会在 hook 前阻止写入，没有单独的 hook 事件可作证据。

### 宿主权限隔离收紧验证（2026-11-01）

本机用隔离临时项目、隔离 `CLAUDE_CONFIG_DIR` 和真实 `claude -p` 对 Claude Code 2.1.316 做了一轮收紧配置验证；当时的独立 Reviewer 使用保留的 Codex 实现，属于历史验收条件。去敏配置、逐项事件、拒绝原文前缀、文件核对和未测边界见 [验收第 10.6 节](../acceptance.md#106-claude-收紧配置定向续接2026-11-01)；10.5 的旧宽配置仅作历史证据，不再作为候选。原始 `stream-json` 与凭据副本已删除。

**联合验证（2026-11-01）：** 在隔离项目同时安装当前 workflow hook 并应用 v2 配置后，真实 `claude -p` 会话中业务 Read、指定 `docs/plans/plan.md` 的 Write/Edit 放行；业务 Write/Edit 与 `Agent(general-purpose)` 由 `PreToolUse` 拒绝，Bash 与 Skill 由宿主 `dontAsk` 拒绝，业务文件保持 `ORIGINAL`。逐项事件见[验收 10.7](../acceptance.md#107-真实-workflow-hook--claude-v2-严格权限联合验证2026-11-01)。

**候选配置（v2）：**

```json
{
  "permissions": {
    "allow": ["Edit(docs/plans/*.md)"],
    "ask": ["Bash", "PowerShell", "Monitor", "Agent", "Task", "SendMessage", "Workflow", "NotebookEdit", "Skill", "mcp__*"]
  }
}
```

启动：`claude -p --permission-mode dontAsk ...`。`allow` 放行 `docs/plans/` 下全部合规 Markdown；`dontAsk` 会自动放行工作目录内的 `Read`/`Glob`/`Grep`，所以不整类放行读取。`ask` 在 `dontAsk` 下立即拒绝，但保留工具在上下文中，便于验证“实际调用被拒”而不是工具被移除。

实测结果（全部为实际工具调用，被拒后继续下一项）：

| 场景 | 结果 |
| --- | --- |
| `Read src/business.txt` | 放行，返回 `ORIGINAL` |
| `Write docs/plans/plan.md` | 放行，内容变为 `PLAN2` |
| `Edit docs/plans/plan.md` | 放行，内容变为 `PLAN3` |
| `Write` / `Edit src/business.txt` | 均拒绝：`Permission to use Write/Edit has been denied because Claude Code is running in don't ask mode.`；业务仍 `ORIGINAL` |
| `Bash: cat src/business.txt` | 拒绝，工具名 `Bash`；只读命令也未被自动放行 |
| 独立 `PowerShell` 写业务 | 拒绝，工具名 `PowerShell` |
| `Monitor` 启动 Node 写业务 | 拒绝，工具名 `Monitor` |
| `Write docs/plans/other.md` | 旧单文件规则下拒绝；当前候选 `Edit(docs/plans/*.md)` 应放行，本轮未重测 |
| `Agent(general-purpose)` / `Agent(Explore)` | 均拒绝，工具名 `Agent`；未启动子代理 |
| `SendMessage` / `Workflow` | 均拒绝，工具名分别为 `SendMessage`、`Workflow` |
| `Skill(workflow-authoring)` | 未列 `Skill` 时放行；加入 `ask` 后实际调用被拒 |
| 目录 junction 指向含业务硬链接的计划 | `Read` 放行；`Write`/`Edit` 拒绝，业务未变 |
| `plan.md` 为业务硬链接 | 写入放行但原子替换链接，业务未变 |
| `plan.md` 为文件符号链接 | 未建立：当前 OS 权限不足（需管理员），未测 |

注意事项与限制：

- **`dontAsk` 不是“不在 allow 就全拒”**：工作目录内读取和内置只读 Bash 会自动放行；必须显式 `ask`/`deny` 才能拒绝整个命令类。
- 未开工与 `plan` 模式下，hook 还放行当前 worktree 与 stateDir 之外、真实位于 `os.tmpdir()` 且路径链无 symlink/junction 逃逸的写入；只针对 `Write`/`Edit`/`MultiEdit`/`NotebookEdit` 的路径参数，不解析 shell 重定向。这是 hook 的写入边界；宿主 `dontAsk` 的 `allow` 仍需按启动方配置单独放行对应路径，两者分别生效。
- 官方权限文档明确 `Write(path)`、`NotebookEdit(path)`、`Glob(path)` 路径规则从不匹配；文件权限只按 `Edit(path)`/`Read(path)` 检查，`Edit(path)` 同时覆盖 Write 和 NotebookEdit。10.5 中的 `Write(...)` 路径规则是无效规则，本节已改用 `Edit(path)` 规则，当前候选为 `Edit(docs/plans/*.md)`。
- 独立 `PowerShell`、`Monitor`、`SendMessage`、`Workflow`、`Skill` 是实际工具入口，旧的单点 `Agent(general-purpose)`/`Task(general-purpose)` 覆盖不了；本节按整类 `ask` 处理并取得实际拒绝事件。
- 未测：文件符号链接的真实目标解析、真实 MCP 工具与 Codeg MCP 委派（隔离会话未加载 MCP server）、`NotebookEdit` 实际调用、未显式 ask 的其他需审批工具、无审批的状态/调度工具。`ToolSearch` 可放行并加载被 ask 的工具，但加载后调用仍被拒绝。
- 不是 OS 沙箱：Claude 原生 OS 沙箱不支持 Windows（官方仅 macOS/Linux/WSL2）；本保证只覆盖所列 Claude Code 权限规则和工具入口，不是任意代码或已启动进程的隔离。
- 这是准备会话的候选配置，需由启动方设置，不代表已修改真实用户配置或信任。准备阶段不依赖 `signal` CLI；跨会话准备以 Markdown 计划文件为来源。启动方确认准备内容后，另开一个实施权限会话：Lead 读取已确认 Markdown，整理并提交 `prepare`，再 `task-start`；workflow 不自动解析 Markdown，也不在同一次运行中翻转宿主权限。
- 联合 hook 的最小验证已在 10.7 完成；真实 MCP（隔离会话未加载）、文件符号链接、`NotebookEdit` 实际调用和 Codex/Codeg ACP 仍未验，不能写成完整任意工具面或 OS 隔离。

Codeg/ACP 侧的角色分工与委派约定见[Codeg 适配](codeg.md)。

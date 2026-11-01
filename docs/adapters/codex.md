# Codex 适配

Codex 可以作为 Lead、Worker 或 Reviewer，使用与其他智能体相同的[公共方法](../workflow.md)和角色指引。本页说明 Codex 原生 hooks、回合字段和本机已核实的工具能力。用 Codeg 或其他管理软件运行 Codex 时，再阅读对应软件的可选适配；Codeg 的 ACP 内嵌版本可能与本机 Codex CLI 不同。

## 安装

```powershell
node bin/workflow.mjs install --agent codex
node bin/workflow.mjs doctor --agent codex
```

安装把本插件的 hooks 合并进 `~/.codex/hooks.json`，保留其他插件和用户配置。Codex 与 Claude 的安装记录分开保存，可只装一个，也可同时安装；`uninstall --agent codex` 只撤本插件注册的条目。

用户级 `hooks.json` 是本版唯一注册途径，发布副本和文档一起固定版本。安装不写 trust 记录；发现与信任需在真实宿主核对。修改配置后要开新会话或新连接验证，复用旧连接可能仍加载旧配置。全局 CLI 版本不代表 Codeg 等 ACP 内嵌版本。

安装或升级后，在宿主 `/hooks` 中核对 workflow 条目；Codex / Codeg 显示 `modified` 时按提示重新确认信任。未信任的 hook 不执行且没有提示；`codex exec --dangerously-bypass-hook-trust` 可临时绕过，app-server 没有这个参数；`hooks/list` 返回 `currentHash` 与 `trustStatus`。

## 事件与回合

Codex 事件带 `turn_id`，用它关联一次用户回合；入口事件缺失时按当前会话回合关联。安装注册以下事件：

| 事件 | 本插件行为 |
| --- | --- |
| SessionStart | 注入 Lead 入口上下文；`source=compact` 时保留既有任务与预算 |
| UserPromptSubmit | 开新回合（新票据），注入 Lead 入口上下文 |
| PostToolUse | 只在命令是直接调用本插件 `signal` 时读取输出并返回回执；委派状态查询只追加等待提示 |
| Stop | 回合结束核对：有在途包时挡一次要求继续等待或说明暂停；无在途包而任务未 task-end 时挡一次列出缺项；不要求经验处置或追加复盘轮次 |
| Interrupt | 按中断保存：撤销票据、保留任务待办，不自动续跑 |
| SessionEnd | 保存未完成任务待办，票据失效 |
| PreCompact / PostCompact | 只记录观测，不输出上下文 |

`hookSpecificOutput.additionalContext` 只在 SessionStart、UserPromptSubmit、PostToolUse、Stop 返回；Interrupt、SessionEnd、PreCompact、PostCompact 仅记录观测。Codex 0.160.1 的 PostCompact 不支持 additionalContext，安装不为它设置 additionalContextLimit；压缩后的入口由支持附加上下文的 compact SessionStart 提供，是否实际触发须在真实宿主核验。

合成 fixture 只验证适配机械行为，不会冒充宿主实测。双插件各管自身回执和预算；往返或重复学习无法区分时项目切 pending-only，doctor 显示降级，保留待办，不停用对方。

## 工具回执

PostToolUse 只在本插件 `signal` 直接调用时读取命令输出；组合命令（`;`、管道、变量赋值等）和其他插件的输出不接收。被拒绝时用 context 重读 identity/revision，不换 ID 绕过。

## 宿主能力表

证据标注：实测 = 2026-10-23 本机 Codex CLI 0.163.0 隔离 `CODEX_HOME` hook 落盘探针（`codex exec` 与 `codex app-server` JSON-RPC，模型经本地代理）；源码 = openai/codex 源码（经 DeepWiki）；unknown = 未取得证据，须真实宿主补测。

| 能力 | 结论 | 证据 |
| --- | --- | --- |
| 内置子代理（spawn_agent）事件 | 不触发 SessionStart；触发 SubagentStart、带 `agent_id`/`agent_type` 的 UserPromptSubmit、子代理内工具事件和 SubagentStop；`session_id` 与父会话相同，`turn_id` 为子代理自有 | 实测；装入本插件后状态只留父会话 |
| 原生提问工具 hook `tool_name` | `request_user_input`；成功返回才有 PostToolUse，调用被拒（flag 关）时只有 PreToolUse；`codex exec` 下工具报错仍触发 PostToolUse | 实测 |
| MCP 提问 hook `tool_name` | 服务器名 `codeg-mcp` 的连字符被规范为下划线：`mcp__codeg_mcp__ask_user_question`；插件同时识别连字符写法以兼容其他版本 | 实测（同名本地替身 MCP 服务器） |
| `permission_mode` | 只由审批策略决定：`approval_policy=never` 为 `bypassPermissions`，其余为 `default`；Plan 协作模式也报 `default`，hook 无法识别 Plan | 实测 + 源码 |
| Plan 模式提问 | `request_user_input` 可用，PostToolUse 触发 | 实测（app-server `collaborationMode=plan`） |
| Default 模式提问 | flag 开：可用，PostToolUse 触发；flag 关：报 `request_user_input is unavailable in Default mode`。`doctor --agent codex` 只读报告该 flag | 实测 |
| hook 信任 | 未信任的 hook 不执行且无提示；`codex exec --dangerously-bypass-hook-trust` 可临时绕过，app-server 无此参数；`hooks/list` 返回 `currentHash` 与 `trustStatus` | 实测 |
| 运行中追加消息 / 暂停 / 取消 / 中断恢复 / 批量 wait | 取决于实际入口；使用 Codeg 委派时见 [Codeg 能力表](codeg.md#宿主能力表) | 工具清单 |

Codex 的计划模式不进入 hook 的 `permission_mode`，插件的计划会话提示和写入保护在 Codex 上只依赖任务声明的 `permissions.mode=plan|read-only`；Lead 在 Plan 模式下开任务须如实声明。

## 提问路径

| 提问路径 | Codex Plan | Codex Default（flag 关） | Codex Default（flag 开） |
| --- | --- | --- | --- |
| 原生结构化提问 | 可用 | 不可用 | 可用 |
| 文本编号问题 | 可用 | 可用 | 可用 |

宿主原生结构化提问成功后，hook 自动记 waiting-user；不可用时用普通文本编号问题，并由 Lead 先发 `phase waiting-user`。使用 Codeg MCP 提问工具时见 [Codeg 适配](codeg.md)。

## 与 Codeg 的分工

workflow 的公共规则、项目计划、工作包和确认记录不因是否使用 Codeg 改变。Codex 原生入口按本页接入；Codeg 提供委派、等待和结果管理等可选能力，其专有工具名、等待参数和 ACP 兼容信息见 [Codeg 适配](codeg.md)。不要因为某个入口没有 Codeg 工具就把公共流程判为不可用，也不要把 Codex CLI 的实测结果直接写成 Codeg ACP 已验收。

## 旧入口

旧显示名为“协作开发”，旧调用标识是 `$efficient-parallel-development`。当前插件使用独立的行为文档，不创建第二套活跃技能副本。

接入项目时检查真实客户端加载位置，按项目只注入一套权威方法。已接入新版的项目若显式调用旧入口，应说明当前权威正文；确需兼容时改为短导航，不维护第二份全文。

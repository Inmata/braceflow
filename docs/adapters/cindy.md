# Cindy 适配（可选）

Cindy 是运行 Agent 的一种桌面软件，不是 workflow 的使用前提。公共规则、项目计划、工作包、审查和验收独立于 Cindy；不使用 Cindy 时按 [Codex 适配](codex.md)、[Claude Code 适配](CLAUDE.md)、[Codeg 适配](codeg.md)或 [Herdr 适配](herdr.md)接入。

Cindy 同时可以托管 Claude 与 Codex 两种宿主，委派入口、通道写法和等待方式相同；差异只在宿主自己的 hook 注册位置。识别代码集中在 `src/adapters/cindy.mjs`，公共 hook 只消费适配结果。

## 两条委派入口

| 入口 | 工具 | 任务文本 | Agent 来源 | 通道 | 是否受控派工 |
| --- | --- | --- | --- | --- | --- |
| Orca 团队 | `mcp__cindy_orca__create_worker`、`create_workers`、`send_to_worker` | `initial_task` / `message` | `create_worker(s)` 的 `agent` | `cindy:orca:<agent>` | 是 |
| Session task | `mcp__cindy_helper__call_tool` 且 `name` 为 `start_session_task` / `message_session_task` | `args.instruction` / `args.message`（并检查 `args.title`） | 无可靠映射 | — | 否 |

**D1（用户 2026-11-02 决定）：先只允许 Orca 派工。** Session task 不提供 Agent 选择字段；公开版本可用 `model_selection` 或伙伴配置决定执行者，本机版本也没有可核对的 Agent 字段。因此：

- 未开工时，`start_session_task` / `message_session_task` 与其他实施委派一样被拦下；
- 已开工后，带 `workflow-package:` 标记的一律拒绝，并提示改用 Orca `create_worker`；
- 不带标记的按现有“开工后普通实施委派”规则处理：必须关联已登记的工作包，同样会被拒绝，并提示受控派工改用 Orca；
- `check_session_task`、`stop_session_task` 是只读查询，不拦。

`start_team`、`interrupt_worker`、`idle_worker`、`end_team`、`archive_worker` 等是团队管理动作，不是任务派发，不要求工作包标记。

## Orca 核对规则

与 Codeg/Herdr 共用同一套包规则：

- 已开工后，`initial_task`/`message` 首行写 `workflow-package:<包ID>`；包必须已 `dispatched`、依赖已终态、角色是 worker/reviewer。
- 通道必须是 `cindy:orca:<agent>`，准备记录里的 Agent 与通道尾部一致。
- `create_worker` / `create_workers` 从 `agent` 取执行者；准备记录常写成“Claude Code (group/worker, high)”，比对按词进行，`claude-code` 与 `Claude Code …` 视为同一 Agent。
- `create_workers` 的 `workers` 逐项核对；任一项缺标记、缺 Agent、通道/Agent 不符，整体拒绝并指出 `workers[i]`（有 `label` 时一并给出）。
- `send_to_worker` 没有 Agent 字段，`target_session_id` 是不透明会话 ID，无法从中映射 Agent；只能按通道尾部与准备记录核对（同 `herdr agent prompt`）。这不等于已验证目标会话实际运行的 Agent。
- `create_worker` / `create_workers` 会创建执行 Agent，即使没有 `initial_task` 也不能免包关联；缺任务文本就没有可核对的包标记，会被拒绝。
- `model` 字段只记录、不参与核对：它是同一 Agent 下的模型选择，不能证明执行者。
- 未开工时，以上派工入口全部拦下；`check_session_task` 等只读查询不受影响。

## 提问工具

`mcp__cindy_helper__ask_user_question_async` 与 `AskUserQuestion` 一样，在 PostToolUse 自动记 `waiting-user`；同一回合不重复修改状态。若真实会话里该路径的 PostToolUse 不触发，Lead 仍需显式发 `phase --phase waiting-user`。

## 宿主消息

Cindy 的宿主注入文本以 `[Task delivery] Host bookkeeping` 开头时，识别为宿主消息：

- 仍开新回合和票据；
- 上一回合是 `waiting-user` 时保留该 phase，不算用户回答，不撤销在途包；
- 入口上下文追加“这是 Cindy 宿主消息，不是用户指令；核对实际交付后再记 consumed”。

识别只看去掉前导空白后的固定开头，普通输入不识别。Session task 完成与 Orca 回报到达 Lead 时的确切文本格式**尚未实测**，拿到原文开头后再补列，不按自然语言猜。

## 等待方式

`cindy:` 通道的结果会自动送回本会话：不要轮询，结束回合等结果即可。只有用户问进度或疑似丢失时，调用一次 `check_session_task` 核对；Orca 派工用 Orca 对应的查询方式。Stop 的在途包提示会按通道列出这条说明。

## 已知边界与待实测项

- **code_mode_only**：Cindy 的 Codex 启用 `code_mode_only`，嵌套 MCP 调用是否经过外层 PreToolUse 尚未验证。本适配的合成工具输入测试只证明解析和包核对逻辑；不能证明真实 Codex 会话里每次嵌套调用都会被 hook 看到。
- **hooks 注册位置**：Cindy 的 Codex 使用独立 `CODEX_HOME`（如 `Roaming\Cindy\codex-home`）；默认 `~/.codex` 的安装不代表 Cindy 目录已注册。安装时须显式传 `--user-dir`，见[安装文档](../usage.md)。
- **Agent 映射**：Orca `agent` 当前枚举为 `claude-code`、`codex`、`pi`；通道尾部必须用同一原值。其他名称无法证明执行者，保守拒绝。
- **回报格式**：Session task / Orca 回报文本未取得，宿主消息表目前只含 `[Task delivery] Host bookkeeping`。
- **提醒式门禁，不是沙箱**：只核对上述工具结构与包标记；用户自写脚本、其他 MCP 工具或包装层可以绕过，宿主自己的权限/审批仍是实际边界。
- 人工验收（M3/M4）：在 Cindy 打开本仓 Claude 会话，确认 workflow 入口出现；未开工时请它 `start_session_task` 应被拒；开工后带包标记派 Session task 应被拒并提示 Orca；经 Orca `create_worker` 带包标记且 Agent 与准备记录一致时放行，并记录回报原文开头。Codex 侧按 M4 安装后确认入口与重启/切换账号后的 `hooks.json` 保留情况。

## 验证

```powershell
node --test test/adapters.test.mjs test/hooks.test.mjs test/channels.test.mjs
```

门禁只在新安装的 hook 和**新会话**里生效；已在运行的会话会继续使用旧版本。

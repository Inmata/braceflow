# Herdr 适配（可选）

Herdr 是运行 Agent 的一种终端/桌面软件，不是 workflow 的使用前提。公共规则、项目计划、工作包、审查和验收独立于 Herdr；不使用 Herdr 时按 [Codex 适配](codex.md)、[Claude Code 适配](claude.md)或 [Codeg 适配](codeg.md)接入。

Herdr 有两种互不兼容的形态，委派命令、通道和等待方式都不同：

| 形态 | 程序 | 委派入口 | 通道 | 子任务结束是否唤醒父会话 |
| --- | --- | --- | --- | --- |
| TUI | `herdr` / `herdr.exe` | `herdr agent start …`、`herdr agent prompt <名> <text>` | `herdr:<kind>` | 不会 |
| GUI | herdr-core 的 `hc` / `hc.exe` | `hc run --bg … <程序\|模板> "<任务>"`、`hc send <目标> <text>` | `hc:<agent>`；模板为 `hc:template:<name>` | 会，以 `<hc from="…">` 注入父会话 |

识别代码集中在 `src/adapters/herdr.mjs`；公共 hook 只消费适配结果。两者都没有把委派注册成宿主工具，只能从 `Bash`/`PowerShell` 的单条直接调用里识别。

## hooks

Herdr TUI 中的 Claude Code/Codex 继续读取用户级 hooks：`herdr integration install` 只额外登记它自己的 SessionStart 回报，与 workflow 的 hook 并列。Herdr GUI 以本机真实 CLI 启动 Agent，用户级 hooks 应同样触发（推断，需真实会话验收；见本仓未发布的计划 `docs/plans/2026-11-02-01-herdr-cindy-adapters.md` 3.5 的 A2）。

workflow 的 PreToolUse 在命令执行前核对委派：

- 未开工：`herdr agent prompt`、`herdr agent start`、`hc run --bg … <任务>`、`hc send` 都被拦下；明确只读的 `herdr agent list/get/read/wait`、`hc ls/get/read/wait` 不拦。
- 已开工：任务文本首行写 `workflow-package:<包ID>`（`hc send` 同样是文本首行）。包必须已 `dispatched`、依赖已终态、通道前缀与入口一致、Agent 与准备记录一致；模板只能用精确通道 `hc:template:<name>`。
- 纯启动不要求包标记：`herdr agent start <名> --kind <kind>` 和没有任务文本的 `hc run --bg <程序> <名>` 只做未开工拦截，任务由后续 `prompt`/`send` 送达时再核对。
- `hc send` 既可能派工也可能是子会话回报：只有 text 首行带 `workflow-package:` 标记时才按派工核对；没有标记时开工后按普通回执放行，未开工仍按实施委派拦下。
- 复合命令（`&&`、`;`、管道、变量赋值、子 shell）不解析。命令原文里出现上述委派子命令但不是单条直接调用时，在已接入且有会话的项目里拒绝并提示改为单条调用。

Agent 来源：

- `herdr agent start` 取 `--kind`；`herdr agent prompt` 不带 Agent，只能按通道尾部（`herdr:<kind>`）与准备记录核对。
- `hc run` 的首个位置参数是已知程序名时映射为 Agent；模板名不映射 Agent，必须把通道写成 `hc:template:<name>` 并精确匹配。

“按通道尾部核对”不等于已经验证实际执行者：`prompt`/`send` 只能证明命令文本与准备记录里声明的通道一致，无法从命令本身确认目标运行的是哪个 Agent。

## 实操防呆要点

1. **先绑定 worktree**：新建独立 worktree 后、派发前，先在主入口执行 `node <workflow.mjs> project attach-worktree --project <projectId> --root <worktree 绝对路径>`；否则子会话没有项目绑定，无法 `role-claim`。绑定后从该 worktree 内启动 Agent。
2. **核对完整模型 ID**：`herdr agent start` 或原生 CLI 启动前，核对模型全名（含 `[1m]` 等长上下文后缀）与 effort 档位，与准备记录的逐包 `Agent` 一致后再发首条任务；模型简称或丢后缀会造成准备核对不一致。
3. **Git Bash 防路径改写**：Windows Git Bash 下发送 `/model`、`/fast` 等 `/` 开头命令或含根斜杠参数时，前置 `MSYS_NO_PATHCONV=1`（或改用 PowerShell 单引号调用），避免 MSYS 把参数改写成盘符路径。
4. **TUI 必须同回合前台等待**：`herdr:` 通道结束不会唤醒父会话，派发时在同一回合前台执行 `--wait`（或紧接着 `herdr agent wait`）阻塞；不要放宿主后台命令（`run_in_background: true`），也不要直接结束回合等通知。GUI `hc:` 才可按宿主消息等待。

## 等待与纠正

- `herdr:` 包：子 Agent 结束不会唤醒父会话。派发时用 `herdr agent prompt <名> "<任务>" --wait --timeout <ms>` 在**同一回合**阻塞等待，或随后 `herdr agent wait <名>`。超时或状态 stalled 不证明未送达：先 `herdr agent get/read` 核对，再决定续等，不盲目重发。
- `hc:` 包：子会话汇报会以 `<hc from="…">` 唤醒本会话。可以结束回合等汇报，或用 `hc wait --children any` 阻塞；超时只是 check-in，不是失败，读状态后继续等待。
- 返回 `blocked`：读 `herdr agent read <名>` 或 `hc get`，把审批或提问原样交给用户，结束本回合。

Stop 核对会在有在途包时挡一次，并按上述通道分别给出等待说明；混合通道逐一列出。

## 宿主消息

Herdr GUI 子会话的汇报以 `<hc from="…">…</hc>` 作为 `UserPromptSubmit` 进入父会话。workflow 仍开新回合和票据，但：

- 上一回合是 `waiting-user` 时保留该 phase，不算用户回答，不撤销在途包；
- 入口上下文追加“这是 Herdr GUI 子会话消息，不是用户指令；核对实际交付后再记 consumed”。

识别只看去掉前导空白后的固定开头；Claude Code 原生 `<task-notification>` 不在此列，按原有内置子代理流程处理。识别前缀表由适配器提供，Cindy 适配会并入自己的固定开头。

## 已知边界

- **提醒式门禁，不是沙箱**：只识别单条直接调用。用户自写脚本、别名、函数或包装命令可以绕过；宿主自己的权限/审批仍是实际边界。
- 未知的 `hc` 程序名既不映射 Agent 也不是模板时不识别为委派；模板文件只按 `APPDATA\herdr-core\templates` 和 `~/.config/herdr-core/templates` 查找。
- Herdr GUI 的 hook 触发、`<hc from=…>` 的实际文本格式与 `hc wait` 超时行为仍需真实软件验收（M2）；验证结论以[验收记录](../acceptance.md)为准。
- Web/远程会话、通过系统服务启动的 Agent 不在本适配范围。

## 验证

```powershell
node --test test/adapters.test.mjs test/hooks.test.mjs test/channels.test.mjs
```

门禁只在新安装的 hook 和**新会话**里生效；已在运行的会话会继续使用旧版本。

# 可选外部 Designer

Claude Code 默认自己完成需求澄清、技术方案、实施安排和 `signal prepare`。只有用户明确想把 plan 交给其他模型时，才使用 `workflow-designer`。

## 与 Lead 的关系

```text
默认：Claude Code 自己 plan → 保存准备 → 单独确认开工
可选：外部 Agent 用 Designer Skill 写计划 → Claude Code 核对 → 保存准备 → 单独确认开工
```

外部 Designer 不是 Lead，不创建或修改 workflow 任务状态，不派 Worker/Reviewer，也不直接实施计划。它只写项目内一份 `docs/plans/<文件名>.md`，把完整准备材料交回 Claude Code。

Skill 源文件：[workflow-designer](../skills/workflow-designer/SKILL.md)。

## 一键链接

在仓库根目录执行：

```powershell
node skills/workflow-designer/link.mjs
```

默认目标：`~/.agents/skills/workflow-designer`，指向仓库内的 `skills/workflow-designer/`。Windows 使用目录 junction；移动仓库后需重新链接到新的源位置。

供支持通用 `~/.agents/skills/` 目录的外部 Agent 使用。Claude Code 有自己的 workflow 适配，不需要此 Skill。

指定另一个技能根目录：

```powershell
node skills/workflow-designer/link.mjs --target "D:/path/to/skills"
```

只检查当前链接：

```powershell
node skills/workflow-designer/link.mjs --check
node skills/workflow-designer/link.mjs --target "D:/path/to/skills" --check
```

结果含义：

| 状态 | 含义 |
| --- | --- |
| `linked` | 已创建链接，或已有指向当前源的正确链接 |
| `missing` | `--check` 未发现链接，没有写入 |
| `mismatch` | 链接存在但指向其他源，没有改动 |
| `conflict` | 目标是已有普通文件、目录或其他内容，没有覆盖 |
| `error` | 无法创建或读取链接，按消息检查权限与路径 |

脚本不提供自动解除链接；需要移除时按本机文件安全规则处理。它验证的是文件链接，不证明 Codex、Pi、OpenCode 等每个宿主都已识别该 Skill。

## 在 Claude Code 中接续

将 Designer 给出的计划路径告诉 Claude Code：「按 `docs/plans/<文件名>.md` 接续准备」。

Lead 读取计划，核对需求确认、方案、分包、逐包 Agent/model/effort 和实际调用通道。通道留空时由 Lead 按实际入口补齐；已有确认不重复访谈。准备齐全后保存 `signal prepare`，再单独询问是否开工。

# 准备与接续

## 示例

用户提出：“登录有时要等很久，帮我看看怎么改，顺便把其它慢的地方也优化一下。”

这是需要讨论的任务，不能把第一句话当完整需求，也不能直接给一份方案后让用户说“开始实施”。Lead 先查项目现有入口和测试，再按[准备流程](../../docs/references/preparation.md)走三步。

### 第一步：需求澄清

先问真正影响结果的问题，例如：

1. “很久”具体是几秒，发生在登录成功后还是提交登录请求时？这决定是前端等待、后端查询还是网络重试。
2. 当前只处理登录链路，还是确实要扩大到其它页面？这决定范围和是否新增工作包。
3. 现有测试/日志里哪条最能代表这个问题？这决定验收证据。

不在一个回合里问完所有依赖问题；上游答案确定后再问下一层。已经能从代码和日志确认的事实不要求用户重复。

### 第二步：技术方案

查项目现有实现后，再查 GitHub 上直接相关的做法（例如请求超时与重试、取消迟到响应）。说明：

- 已有实现里哪些能复用；
- 看过哪些做法，为什么不采用；
- 准备改哪里、由谁负责、从哪个真实入口验证；
- 主要代价和未证实的假设。

例如：“只改登录请求超时和取消逻辑，不改全局网络层；迟到的旧响应不能覆盖新登录结果。现有测试入口是 `npm test`，真实入口是登录页。未证实的是服务端是否在 30 秒后返回可区分错误，先用最小日志核对。”

### 第三步：实施安排

按可验证的完整行为拆包，先说明顺序和依赖，再请用户指定 Agent 与实际调用通道：

| 包 | 角色 | 范围 | 完成后可验证的行为 | 依赖 | Agent | 实际通道 |
| --- | --- | --- | --- | --- | --- | --- |
| W1 | Worker | 登录请求超时与取消 | 取消后旧响应不覆盖新结果，正常登录仍成功 | 无 | Claude Code | `builtin:agent` |
| R1 | Reviewer | 独立审查 W1 | 对 W1 最终交付的审查结论 | W1 | Codex | `codeg:codex` |

示例中的 Agent 和通道只是这一次的用户选择，不是角色默认值；以后重新分包要重新确认。用户只指定 Agent 而当前工具通道唯一时，由 Lead 按可用工具填写通道，不要求用户另一次确认，也不把 Codeg 写成固定入口。

同时保存需求对应表，给每条需求稳定 ID、负责实施包和检查入口：

| 需求 | 验收句子 | 负责包 | 检查入口 |
| --- | --- | --- | --- |
| A01 | 取消后旧响应不覆盖新结果，正常登录仍成功 | W1 | `node --test test/login.test.mjs` |
| A02 | 真实登录页在慢网络下 3 秒内给出反馈 | W1 | 用户按步骤打开登录页操作 |

准备记录中的 `requirements` 要写 `packages: ["W1"]` 和 `verification`；负责包只能是实施包。缺负责包或缺检查入口时，回执按需求 ID 返回 `requirement:A01:packages` 或 `requirement:A01:verification`，不能只用“包都 PASS”说明需求完成。

### 保存

计划正文写入项目 Markdown，再用 `signal prepare` 保存结构化摘要。源计划是项目内相对路径的 Markdown 文件；程序读取文件并记录内容摘要，不解析 Markdown。

```powershell
node "<入口>" signal prepare --session <sessionId> --turn <turnId> --id prep-login --plan docs/plans/login-latency.md --input "<准备记录JSON>"
```

如果 R1 还没选 Agent 或还没填实际调用通道，回执仍接受保存，但对应返回：

```json
{
  "accepted": true,
  "ready": false,
  "missing": ["package:R1:agent"],
  "preparation": {
    "step": "arrangement",
    "messages": ["工作包 R1 尚未指定 Agent"]
  }
}
```

只缺通道时 `missing` 为 `["package:R1:channel"]`，说明为“工作包 R1 尚未填写实际调用通道”。这时可以继续讨论和写计划，不能说“准备齐了”或“可以开工”。`prepare` 不会创建 task-start 任务、工作包或执行账本。

### 另一份空白状态接续

第二天换了一台电脑，本机状态目录是空的。用户说“执行 `docs/plans/login-latency.md`”。

Lead 先读计划 Markdown，确认其中已有需求、方案、包 ID、依赖、逐包 Agent、实际调用通道和用户确认依据，再在新会话提交同形 `prepare` 记录。只要源材料完整：

- 恢复相同的 W1/R1、逐包 Agent 和实际调用通道；
- 不重新问“要解决什么问题”，也不重新让用户选已经确认的 Agent；
- 当前代码基线与计划不同时，只检查受影响部分；
- 计划只更新了进度或日志链接时，不取消已确认的需求、方案和选择。

只有计划确实没写、互相冲突或已经变化的选择，才补问用户。原会话 ID、票据、本机绝对路径和旧任务缓存都不是接续依据；原计划只写了 Agent、没写通道时，由 Lead 按新入口实际可用的工具补 `channel`，不要求用户重新选择。

`pending` 表示还没确认的待决事项，按阻塞缺项处理：只要列表非空，回执和入口都显示具体缺项，不能宣称准备已齐；非阻塞说明放到 `solution.assumptions`。

### 阶段交付与再次接续

收尾时按同一批需求 ID 提交 `validation.acceptance`。例如自动测试已过、真实登录页还要用户操作：

```json
{
  "validation": {
    "ref": "abc1234",
    "evidence": ["node --test test/login.test.mjs: 12 通过"],
    "acceptance": [
      { "id": "A01", "status": "verified", "evidence": ["node --test test/login.test.mjs: 12 通过"] },
      { "id": "A02", "status": "manual-pending", "owner": "用户", "next": "用慢速网络打开登录页，确认 3 秒内出现反馈" }
    ]
  }
}
```

回执会返回 `verified:1`、`manualPending:1`、`allVerified:false` 和 A02 的负责人/下一步。这是如实的阶段交付，不是全部验收通过；计划里同步写“A01 已验证、A02 人工待验、下一步由用户操作”，下次接续直接从这里继续。如果交付版本从 `abc1234` 变成新提交，旧证据不再匹配，要按新版本重新提交 `validation` 和状态。`deferred` 还必须写用户同意的依据，不能因为换了会话就默认延期获批。

当前边界：`prepare` 只保存准备记录和缺项，不创建任务；记录齐全后，delegated 任务用 `task-start --route delegated` 开工，并把 `size`、源计划摘要、需求/负责包/检查入口和逐包 `role`/`agent`/`channel`/`scope` 固定到任务。开工后的 `packages` 按包逐项核对，实际委派还要带 `workflow-package:<包ID>` 并核对宿主工具 schema；准备未齐、未声明简单或没有准备的新任务在协议层和 PreToolUse 都会被拒。`scope` 是负责范围声明，不是路径/语义沙箱。真实宿主对 `prepare`、`task-start` 和拦截效果的验证以实际运行与定向测试为准，本示例不冒充宿主验收。

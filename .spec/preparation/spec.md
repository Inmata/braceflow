---
title: 准备记录、开工条件与整项验收
status: active
desc: 会话级准备记录保存需求、方案、分包和逐包选择；复杂任务开工绑定快照，收尾按需求 ID 核对最终证据，不把包 PASS 当作整项需求完成
code:
  - src/preparation.mjs
related:
  - docs/references/preparation.md
  - docs/references/validation.md
  - docs/design/protocol.md
---
# 准备记录、开工条件与整项验收

## 目标

- `signal prepare` 在尚无活动业务任务时保存会话级准备记录；不创建任务、工作包或执行账本，也不改写 `phase`。
- 准备记录至少保存任务大小及理由、需求与验收条目、调研、选定方案与关键决定、工作包与依赖、逐包 `role`/`agent`/`channel`/`scope`、验证入口、确认范围与依据、源计划相对路径及内容摘要、待决事项。
- 每条需求使用稳定 `id`，并写明负责实施包 `packages[]` 和检查入口 `verification`；`packages` 只能引用已登记且角色为 `worker` 的包。`prepare` 不解析 Markdown，也不证明用户批准真实存在。
- 复杂任务的 `task-start` 必须绑定无缺项的准备记录，并把 `size`、来源摘要、需求、负责包和逐包选择固定到 `task.preparation`；简单任务只要求非空理由，`operation-only` 保持轻量路径。准备不齐时仍可继续讨论、调研和写计划。
- 已开工任务更新准备时按包 ID 和需求 ID 合并：只更新进度时漏传某条需求或包，不删除已确认内容；包顺序、依赖顺序、需求顺序和验收句子顺序不构成实际变化。目标或权限变化仍须在同一 `task-update` 提供完整准备、理由和匹配的 `preparationTarget`。合并后按最终快照核对所有需求的负责 worker 包和包依赖，保留需求指向被移除包时拒绝并点名；同批迁移到现存 worker 包则接受。需求内容实际变化时只失效对应 ID 的旧 `validation.acceptance` 声明，未变化条目的证据、进度和原顺序保留。增量入参未提供的顶层字段和同 ID 条目内未重传的子字段由既有记录补齐；完整记录用于缺项校验，交给快照合并的仍是本次实际提到的条目，避免未提到旧条目被误算为本次重传。
- Agent 核对使用基础 Agent 词根：`agentBaseWords` 剥离括号说明（`(...)`/`（...）`）与 `--model`/`-m`/`--effort` 等运行参数，`sameBaseAgent` 对剥离后的词序做全等比较；准备记录中的 `(group/worker[1m], high)` 与 `claude_code` 等同一基础 Agent 不因模型/effort 备注被误判。仅基础 Agent 相同时才允许微调 `agent` 备注。
- 复杂 `delegated` 的逐包审查豁免只能随准备记录声明：`reviewWaiver` 仅允许 worker 包，必须同时给出非空 `reason` 与 `consent`；声明进入准备快照，准备阶段或 `task-update` 仅在包尚无审查历史且不是只读诊断包时允许补挂或修改，已有实际审查结论时拒绝并令旧声明失效。
- 复杂 `lead-direct` 与 `delegated` 的 `task-end` 按准备记录逐条核对交付声明 `validation.acceptance`：缺条目、未知 ID 或状态字段不完整时列入缺项。验收状态为 `verified`、`manual-pending`、`blocked`、`deferred`：`verified` 要有最终证据；`manual-pending` 要有负责人和可操作步骤；`blocked` 要有原因和下一步；`deferred` 要有原因和用户同意依据。
- 交付声明绑定 `validation.ref`（必须等于最终交付版本）；版本变化后旧证据不自动沿用，需重新提交。回执汇总 `verified`/`manual-pending`/`blocked`/`deferred` 数量和剩余项，明确 `allVerified`，不把阶段交付说成全部通过。
- 适用验收矩阵时，`validation` 与 `acceptance:<id>`/`acceptance-unknown:<id>` 缺项不能用 waiver（类别或精确条目）抵扣；只能补齐，或用 `manual-pending`/`blocked`/`deferred` 如实阶段结束。旧任务没有矩阵时保留原 waiver 兼容。
- 简单任务、`operation-only`、`read-only` 和没有 route 的历史任务不要求需求验收矩阵，不制造空矩阵。

## 原因

- 只检查已登记工作包是否 PASS，会让“包都完成但原需求漏项”的任务通过；需求、负责包和检查入口必须成为可核对的稳定锚点。
- 准备记录只保存可核对声明，内容真实性仍由 Lead 和 Reviewer 判断；非空证据字符串不能自动证明测试或用户操作真实发生。
- 人工待验、受阻和经用户同意延期是真实的阶段状态；强制全部 `verified` 会诱导伪造通过，允许 `manual-pending` 等状态但要求负责人、步骤和同意依据，才能如实交付并接续。
- 进度更新和重新整理计划不应删除已确认需求或 Agent 选择；按 ID 合并并归一化无意义顺序，避免漏传即删除或倒序重放绕过变化检查。

## 验收

- 复杂准备缺需求负责人、引用未登记包或审查包、缺检查入口时，`prepare` 回执和 `context` 按需求 ID 返回具体缺项，例如 `requirement:A01:packages`、`requirement:A01:verification`；补齐后 `ready` 才为 true。
- 简单任务只声明 `size` 与 `sizeReason`；`pending` 非空仍按阻塞缺项处理；简单任务不要求需求和分包。
- 空白状态目录按同一 Markdown 和同形记录恢复相同的需求、包、逐包 Agent 与通道，不依赖原会话 ID、票据或绝对路径；源计划必须是项目内 `docs/plans/` 下的 Markdown，路径链上的 symlink/junction 被拒绝。
- 复杂任务未绑定完整准备不能 `task-start`；已绑定任务在 `packages` 时按包 ID 核对 `role`/`agent`/`channel`/`scope`。
- 已开工任务的准备更新未列出旧需求或旧包时，合并结果仍保留它们；仅调整顺序不构成实际变化，目标变化时原样或倒序重放返回 `PREPARATION`。
- 合并后保留的需求仍指向已移除或非 worker 包、或包依赖未登记时，`task-update` 返回 `PREPARATION` 并点名具体需求 ID 与包 ID；同一批把该需求迁到现存 worker 包则接受，原记录不因拒绝而被暗删。
- 需求内容实际变化时，对应 ID 的旧 `validation.acceptance` 声明失效，未变化条目的证据和原顺序保留；仅顺序变化不失效。
- 所有已登记包都 PASS 但交付声明缺一条需求验收时，`task-end` 返回 `GATE` 并列出 `acceptance:<需求ID>`，任务保持 active；复杂 `lead-direct` 同样适用。
- `manual-pending` 缺负责人或步骤、`blocked` 缺下一步、`deferred` 缺用户同意依据、`verified` 缺证据时拒绝；合法的人工待验/受阻/延期可以阶段结束，但回执 `allVerified` 为 false 并列出剩余项。适用矩阵时 `validation` 与 `acceptance*` 缺项不能用 waiver 抵扣。
- `finalRef` 改变后旧 `validation` 不再匹配，必须按新版本重新提交；审查版本仍按现有 `deliveredRef`/`reviewedRef` 门禁核对。
- 准备记录 `agent` 含 `(group/worker[1m], high)` 时，`sameBaseAgent` 与 `claude_code` 等剥离模型/effort 备注后的基础 Agent 判定为同一；仅改括号备注可微调未交付 `dispatched` 包的 `agent`，换基础 Agent 返回 `PREPARATION`。
- `reviewWaiver` 仅接受 worker 包与非空 `reason`/`consent`；准备快照按条件字段保存，旧记录没有该字段时快照形状不变。
- 状态文件 schema 版本不变；旧任务没有准备快照或需求字段时保持可读，不自动补写或迁移。

## 边界

- 不解析 Markdown、不按自然语言识别用户批准、不根据关键词猜测验收状态。
- `acceptance` 的 `verified` 只表示交付声明给出了最终证据；插件不验证证据内容、测试输出或用户操作真实发生，Lead 和 Reviewer 仍需核内容。
- `manual-pending`、`blocked`、`deferred` 是阶段状态，不等于全部验收通过；`deferred` 的 `consent` 是声明的同意依据，不是插件对用户意图的自动确认。
- 需求条目只按 ID 合并和保留，不支持借漏传或通用 helper 静默删除；`preparationRemove` 仍只用于工作包。
- 不新增第四种 route，不重设计学习系统，不为可选字段机械迁移全部历史状态。

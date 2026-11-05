# Lead 分流指引送达与跨文件调查评测计划

状态：需求草案。逐包 Agent/model/effort 与 Herdr TUI 通道沿用 `2026-11-05-01-lead-context-and-trajectory.md` 已确认的安排（Worker 为 Claude Code `group/worker` high，Reviewer 为 Codex `group/reviewer` high）。用户 2026-11-05 批准本轮评测最多 16 次，超出需重新确认。已确认把“咨询顾问前先由探索者备证据”并入 W6。开工尚未确认。

代码基线：`main` @ `e75a5df`（上一轮 W0–W5 已合入）。工作分支 `feat/lead-guidance-delivery`。

## 1. 目标

上一轮正式评测判成本上升、Lead 减负未达成，但 24 次运行里 Lead 没有读取 Lead 指引、调查者一次也没有被派出，调查者分流方案没有被检验。本轮让分流规则必然送达 Lead，并用确实需要跨文件调查的场景重新检验，回答“分流方案值不值得”。同时让顾问不再自己大量读取：读取交给便宜模型的探索者，顾问只做判断。

收尾目标：本轮结束后形成可发布的版本，供用户授权推送。

## 2. 证据

| 事实 | 来源 |
| --- | --- |
| 候选运行的 hook 入口只给出 `workflow.md`、`lead.md` 路径，注入的指令里没有分流规则，规则正文只在 `docs/roles/lead.md` | `w5-context-formal-20261105/E12-candidate-run-1/hooks.jsonl` 的 UserPromptSubmit 输出 |
| 24 次 transcript 中 Agent/Task 调用均为 0，没有读取 `lead.md` | 上一轮 RV5 与顾问核对 |
| E12 的 Lead 直接 grep 两行即可回答，原始材料极小，派调查者不会更省 | E12 transcript 的首个 tool_result |
| 历史真实验收里 B02、C01 也是探索者全程未调用 | `2026-11-03-02-herdr-learning-acceptance.md` 第 7 节 |
| 入口完整指令只在首回合注入，后续回合只给“入口与上一回合相同”的短提示 | 本仓 `src/context.mjs` 与本会话实际入口 |
| 子代理不能再调用子代理（Explore、Plan 的工具为除 Agent 外全部）；`workflow-advisor` 工具为 Read、Grep、Glob，咨询时 tool_uses 达 6–32 次 | 宿主 agent 类型清单；本会话顾问咨询记录 |
| 子代理定义省略 `tools` 表示继承全部工具，因此不能用删除 `tools` 来限制顾问 | Claude Code 子代理文档（未在本仓实测） |

## 2.1 需求与验收

| ID | 需求 | 验收 | 包 | 验证 |
| --- | --- | --- | --- | --- |
| R1 | 分流规则必然送达 | 首回合入口指令含一句分流规则（已知位置的小读取直接做；跨文件调查与长日志分析交调查者；子代理失败时只定向核查、重试不超过一次）；后续回合不重复注入；新增字符数记录在测试里 | W6 | `node --test` 相关 hook 测试 |
| R2 | 评测场景能逼出“值得委派” | 新增 E14、E15：回答必须综合至少 6 个文件、总原始材料超过 40 KB，直接逐文件读取的材料量明显大于调查者摘要；答案断言用正则，证据位置可定位 | W6 | `node --test test/eval.test.mjs` |
| R5 | 顾问不自行大量读取 | `agents/workflow-advisor.md` 写明：证据由 Lead 提供；证据不足时列出缺口与最小补证方式返回，不自行扩大检索；保留 Read、Grep、Glob 不变。Lead 指引与入口分流句写明：咨询顾问前，需要读取大量材料时先派探索者备证据摘要。已有只读豁免与安装测试不回归 | W6 | `node --test test/install.test.mjs test/subagents.test.mjs` |
| R3 | 送达可验证 | 2 次候选运行确认：入口含分流规则，且调查者被派出，或明确记录未派出的原因 | W7 | 运行目录与报告 |
| R4 | 重新比较 | R3 成立后，E14、E15 两臂各 3 轮共 12 次，按上一轮 3.3 预注册规则判定；总上限 16 次（含 R3 的 2 次与 2 次重跑余量） | W7 | `npm run eval -- --suite context` |

## 3. 方案

- 分流规则放进首回合入口指令，不靠模型自己去读 `lead.md`。`lead.md` 保留完整条文。
- 顾问的读取由探索者承担：Lead 先派探索者读取并摘要，再把摘要和证据位置交给顾问；顾问反馈缺口时，Lead 再派探索者补证后重问。顾问定义保留只读工具，靠正文约定而非删除工具。
- 新场景放在 `scripts/eval/scenarios/context/`，注册进 context 套件，沿用 support.mjs 的断言与夹具。
- 基线臂仍用 `cb685a6`，候选臂为本分支最终提交，两臂轮流执行。
- 判定沿用上一轮预注册规则：质量、过度委派、成本下降（三轮全降）、无明显差异、成本上升（各轮合计变化率中位数大于 0）。每臂只有 3 对，只作方向判断。
- 若 R3 显示指引送达后调查者仍不被派出，停止并交用户，不自行追加限制或扩样本。
- 评测结论不改变上一轮已验证的其他能力（Trajectory、所有权账本、顾问按需提醒、评测框架）的发布资格；成本结论如实写入发布说明。

## 4. 工作包

| 包 | 角色 | 范围 | 交付 | 依赖 |
| --- | --- | --- | --- | --- |
| W6 | worker | `src/context.mjs`、对应测试、`scripts/eval/scenarios/context/`、`agents/workflow-advisor.md`、`docs/roles/lead.md`、`.spec/task-protocol/spec.md`、`docs/usage.md` | R1、R2、R5 | 无 |
| RV6 | reviewer | 独立审查 W6 | 审查结论 | W6 |
| W7 | worker | 运行 R3 与 R4，写回结果：`docs/acceptance.md`、`docs/usage.md` | R3、R4 | RV6 PASS |
| RV7 | reviewer | 独立审查 W7 的评测证据与表述 | 审查结论 | W7 |

串行：W6 → RV6 → W7 → RV7 → 集成。

## 5. 集成与发布

集成：Lead 跑一次 `npm run verify`，回写进展，`spec check`，合入本地 `main`，本机重装。推送、改版本号、打 tag 各需用户明确授权，不因本计划而默认执行。

## 6. spec 影响

`task-protocol`：入口首回合指令含分流规则一句，后续回合不重复；顾问正文约定证据由 Lead 提供。

## 7. 进展

- 2026-11-05：计划起草；用户确认把顾问备证据并入 W6（R5）。
- 2026-11-05：W6 经 RV6 九轮审查定稿（1886b37）；R3 首测规则在入口末尾，送达但调查者 0 次派出，用户决定“再试一次强化”，分流句前置后重测两次均派出 workflow-explorer。
- 2026-11-05：R4 的 12 次跑完（总运行 16/16）；候选臂 3/6 次派出探索者，但评测脚本只读第一个 result、E15 正则误杀，质量与成本均无结论。用户在 R4 收尾提问中选择“补一次 E10 再收尾”（选项原文：追加 1 次 E10 候选运行，需批准超出 16 次上限），据此追加第 17 次运行，结果 PASS、Agent/Task 调用 0 次。评测脚本缺陷与混合模型成本口径列为后续项，见 `docs/acceptance.md` 第 27 节。
- 2026-11-05：评测脚本“只读第一个 result”已修（单轮场景改取最后一个 result）；E15 正则、行号范围规则与混合模型成本口径随后一并修订；按新断言与口径离线重判 R4：质量 12/12 通过、成本“无明确差异”（第 27.8 节）。用户决定 Q1 记为 deferred。

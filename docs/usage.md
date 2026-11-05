# workflow 使用

## 使用

运行环境为 Windows、Node.js 24+，自动 hooks 已适配 Claude Code 与 Codex。Lead、Worker、Reviewer 按[公共方法](workflow.md)分配，均不绑定客户端或模型；Codeg 等产品是可选的管理软件，通过被管理 Agent 的 hooks 工作，不替代宿主接入。其他智能体通过实际可用的委派工具协作，原生 hooks 支持范围见 [README](../README.md#角色与接入支持)。运行时无第三方依赖，无常驻服务，不新增付费模型调用，不要求日常手动调用技能。

开发验证在仓库根目录运行 `npm test`、`npm run check`、`npm run demo`。这些是源码仓库的自检命令，不属于安装后的产品能力；按改动选择检查、失败判定、组合入口和证据留存见[本仓维护的验证场景与命令](acceptance.md#8-本仓维护的验证场景与命令f10)。测试和 demo 使用系统临时目录下 `workflow-tests/` 中的隔离目录、本地 Git 远端和合成事件，不写入仓库，也不改真实全局配置。

### 安装与首次接入

选择实际使用的宿主安装并检查：

```powershell
# Claude Code
node bin/workflow.mjs install --agent claude
node bin/workflow.mjs doctor --agent claude

# Codex
node bin/workflow.mjs install --agent codex
node bin/workflow.mjs doctor --agent codex
```

只用一个宿主时，只执行对应两条命令。Claude Code 写入 `~/.claude/settings.json`，Codex 写入 `~/.codex/hooks.json`；两个宿主分别安装、升级和 `uninstall`，可共用发布副本和状态目录。使用 Codeg 时仍按被管理的 Codex/Claude 安装对应宿主，Codeg 不替代 hooks；Codeg 专有操作见[可选适配](adapters/codeg.md)。

Claude Code 安装还会把发布副本里的 `agents/workflow-explorer.md` 和 `agents/workflow-advisor.md` 写入 `<configDir>/agents/`，并按名字记录 `managed`、`user`、`deleted` 三种状态。无记录时，内容与发布一致的既有文件（包括用户事先放置、中断重试时已写入但账本尚未更新）认作 `managed`，内容不同则记为 `user`；`managed` 内容等于账本或本次发布即视为未改动并随发布更新，被改或不是普通文件时转为 `user`；`user` 的同名文件即使内容等于发布仍保持 `user`，重装不覆盖也不报冲突；`deleted` 表示用户删除过，重装不补回，文件重新出现时转为 `user`。`doctor --agent claude` 的 `agents` 段按同一口径只读判断，列出每个定义的状态和是否与发布默认不同，不改写账本：文件缺失记 `deleted`，被改或非普通文件记 `user`。卸载只移除内容仍等于账本记录的 `managed` 文件，其余保留并在回执列出。Codex 不写子代理定义。

只读子代理的豁免按定义文件的 `tools` 判断：`Explore`、`Plan`，以及 `tools` 全部属于 `Read`、`Grep`、`Glob`、`WebFetch`、`WebSearch` 的自定义子代理放行；名字本身不提供豁免，没有 `tools`、含 MCP 或其他工具、解析不到定义时都不放行。hook 先从项目 `.claude/agents/` 再用户级 `<configDir>/agents/` 解析；`CLAUDE_CONFIG_DIR` 未设置时用户级目录为 `~/.claude`。

Codex 运行在独立的配置目录时（例如 Cindy 使用 `%APPDATA%\Cindy\codex-home`），由用户显式把该目录作为附加位置传入：`install --user-dir "$env:APPDATA\Cindy\codex-home"`。安装器不会自动扫描 `Roaming\Cindy`，也不修改 Cindy 的 `config.toml`。

```powershell
# 默认目录与附加 Codex 目录分别安装、检查、撤销
node bin/workflow.mjs install --agent codex
node bin/workflow.mjs install --agent codex --user-dir "$env:APPDATA\Cindy\codex-home"
node bin/workflow.mjs doctor --agent codex --user-dir "$env:APPDATA\Cindy\codex-home"
node bin/workflow.mjs uninstall --agent codex --user-dir "$env:APPDATA\Cindy\codex-home"
```

默认 Codex 配置位置（通常为 `~/.codex`）是权威记录，附加位置按规范化后的配置文件路径单独登记，第二条不会覆盖第一条；即使默认位置还没安装，显式传入的其他目录也只登记为附加位置，不会因为“先装”而抢占权威记录。各位置的 `hooks.json` 分别维护。`doctor --user-dir` 只报告该位置；不带 `--user-dir` 时顶层报告默认位置，并在 `locations` 中列出所有已登记位置及各自的 status/registration/integrity/version；默认位置未安装时顶层为 `not-installed`，附加位置仍会列在 `locations` 中。`uninstall --user-dir` 只撤销该位置自己登记的 handlers，其他位置、其他插件和用户新增配置保持不变；不带 `--user-dir` 时只撤销默认位置，不撤销附加位置，并在结果的 `locations`/`extras` 中列出仍登记的附加位置。同一目录的不同大小写或分隔符写法视为同一位置，不会重复登记。Cindy 升级或切换账号可能重建 `codex-home`，重建后 hooks 可能丢失：需对当前目录重新执行 `doctor`，按结果重新 `install`。多个 Codex 配置位置共用同一个 `current`，升级时建议对每个已登记位置都重新安装，避免某个位置仍登记旧快照而在 doctor 中显示 `integrity: unavailable`。

然后接入项目，并在该目录用所选宿主打开新主会话，当前主会话承担 Lead：

```powershell
node bin/workflow.mjs project onboard --root "D:/某个已明确允许接入的项目"
```

`onboard` 分开核对核心接入与可选后台复盘：核心检查（宿主安装与版本、目录与 Git 身份、`AGENTS.md` 残留管理区）全部通过才写入，不通过时不写任何东西，并列出每个问题的修复命令；核心检查未通过时不会运行执行器预检，个人或项目配置指定的执行器都不会被调用。后台复盘执行器只核对能力、不调用模型，预检问题单独报告，未加 `--enable-learning` 时不阻断核心接入。加 `--enable-learning` 时同时启用后台复盘并注册计划任务（会按配置真实调用模型并消耗额度，需用户同意）；当前会话权限允许时可由代理直接执行，否则请在用户自己的终端执行。显式请求时分别报告接入与学习结果，学习失败不会写成全部成功：核心接入完成但学习未完整生效时返回 `status: partial`，CLI 退出码为 1；未加 `--enable-learning` 时预检问题只提示，退出码仍为 0。已启用后台复盘的项目重复接入时，现有开关与计划任务保持不变，预检失败只报告本次核对结果。不打算启用后台复盘时加 `--skip-learning`，状态记为未启用。解绑用 `project remove --root <项目>`：删除计划任务、AGENTS 管理区、本机状态记录和数据目录，项目内的对齐文件与 `.workflow/` 只列出不删除。底层的 `project enable` 仍可用，但不做预检。

插件给出的命令可直接粘贴到 Windows PowerShell 5.1 或 PowerShell 7：入口路径与含空格、单引号、`$`、反引号、分号或 `$(...)` 的参数都用单引号字面量书写，不会被展开执行。Windows PowerShell 5.1 调用原生程序时无法原样传递双引号和空参数，这类值以 `workflow-arg64:` 开头的标记书写，命令末尾同时带上 `--workflow-arg64-transport` 开关；CLI 只在看到该开关时还原标记，直接手写的同名 `workflow-arg64:` 普通文本按字面值接收。整条命令照原样粘贴即可，不要改写标记或删除开关。

同一本机目录的绑定由两种宿主共用，切换已安装适配的宿主不必重新接入。同一项目可以同时开多个 Lead 会话，都能写共享资料；并发改同一文件时，后写的一方收到 `CONFLICT`，重读后再写。

`install` 修改所选宿主的实际用户 hooks 注册，只在已决定安装时执行。安装生成带摘要的发布副本，并用固定入口 `current` 指向它；hook 命令只含 `current` 路径，升级时路径不变，宿主信任只需做一次。重复执行会核对 `current` 的实际目标：自有入口被删除、断链或错链时只重建或改指该链接，不重写宿主配置、不新建发布副本；`current` 被替换成用户自己的目录或指向安装目录外的链接时保留现场，返回 `conflict` 与路径，不自动删除或接管。两个宿主及同一宿主的多个 Codex 配置目录共用一个 `current`，重复安装只修自己的入口：如果 `current` 已指向另一个已安装宿主或配置位置登记且完整的发布快照，不会改指，而是返回 `conflict` 并提示先统一升级。没有需要用户配置的运行时依赖。状态默认 `%LOCALAPPDATA%/workflow`；隔离试用为每条命令指定相同 `--state-dir`，安装另指定临时 `--user-dir`（直接指向宿主配置目录，如 `.codex` 或 `.claude`，不是用户根）。发布副本与公共资料固定同一版本，活动任务/prepared 事务导致升级延期，完成或明确结束后再安装。安装副本被用户改写时停止覆盖并报告差异。

新副本先在状态根 `release-staging/` 中复制并核对完整性，完成后才切换到正式发布目录。复制失败或中断不改用户配置；残留暂存目录保留供核查，可直接重试安装，清理时使用系统回收站。

安装只注册自有 handlers，保留已有插件和用户配置（Claude 侧保留 `settings.json` 的 `env`、`model` 等全部顶层配置）；不写信任记录。Codex 按 `hooks.json` 中分组的位置和内容记录信任，所以重装时自有分组留在原位置；其他插件（如 document-learning）重装若改变分组位置，Codex 会要求重新信任。使用当前宿主支持的 `/hooks` 审查定义，在新会话或新连接验证回调。doctor 分别报告 registration/discovery/trust/execution；配置存在不证明后面三项。回调记录也需结合真实宿主证据确认来源，不能用合成事件冒充。全局 Codex 版本不能代表 ACP 内嵌版本；Claude 侧的回合、中断和回执字段见[适配说明](adapters/claude.md)。

接入写本机身份绑定和 AGENTS 短管理区，保留用户正文；不要求补齐 README/spec/计划、不创建空 LESSONS。AGENTS 不含机器安装绝对路径；每次 hook 给实际公共资料和 CLI 路径。资料采用其他命名时继续使用，不改名。非 Git 项目可接入。复制/移动/重 clone 的目录不会静默继承，需要重新明确接入。

关联工作树、查看当前会话上下文：

```powershell
node bin/workflow.mjs project attach-worktree --project "<projectId>" --root "D:/已批准的worktree"
node bin/workflow.mjs context --role lead --project "D:/已接入项目" --session "<当前sessionId>"
```

未关联工作树、嵌套独立仓库、复制来的 AGENTS 不参与维护。0.4.1 起不再有知识负责人，`project owner` 只为兼容旧会话保留，执行后返回 `ignored`。

### 项目对齐

首次进入已接入项目时，Lead 按[项目对齐协议](alignment.md)只读扫描文档和工具链，把结论写入 `docs/WORKFLOW-ALIGNMENT.md`。项目现有做法与 workflow 默认不同时，每条都作为待裁决差异逐条询问：项目现在怎么做、workflow 默认怎么做、实际影响、建议及理由。用户选择后才记录，不默认项目优先，也不默认插件优先。文档过期、重复或链接失效只写进结构建议，批准后在当回合直接修改并用 decide 登记。

```powershell
# 只扫描并写本机索引，不碰项目文件；默认 300 个文件
node bin/workflow.mjs project align scan --root "D:/已接入项目"
node bin/workflow.mjs project align scan --root "D:/已接入项目" --max-files 300

# 检查索引是否过期；返回 changed/missing/directoryChanged 和待裁决数量
node bin/workflow.mjs project align status --root "D:/已接入项目"

# 写回 Lead 生成的对齐正文；只替换标记区，保留手写内容
node bin/workflow.mjs project align apply --root "D:/已接入项目" --input align.json

# 记录裁决、追加结构建议，并同步文档维护区
node bin/workflow.mjs project align decide --root "D:/已接入项目" --input decision.json
node bin/workflow.mjs project align suggest --root "D:/已接入项目" --input finding.json
```

`scan` 只记录路径、大小、mtime 和分类，不读正文；符号链接、硬链接和构建目录不进入索引。`apply`/`decide`/`suggest` 需要有效 write 身份、目标路径权限和明确 baseline，写入前核对文档指纹，用户或其他会话改过文档时返回 `CONFLICT` 并保留原文，重新读取正文并用 `knowledge inspect` 取得新基线后再写。输入可带 `sources` 增量确认本次重读的来源（可附 `size`/`mtimeMs` 快照，删除项用 `deleted: true`），只刷新这些来源的索引基线；不传时保持旧行为，不会因为写入成功就确认整个项目。会话上下文新增 `alignment` 字段：`exists=false` 表示未对齐，`stale=true` 表示索引文件或目录变化，`pendingDecisions`/`pendingFindings` 提醒还有多少项待确认。hook 只读状态，不自动写项目文件；对齐不新增 phase，也不派 Worker。

### 任务与回执

hook 提供 project/session/turn/ticket/interruptEpoch/expectedRevision。context 只读当前身份和最多一项本项目知识待办。每个新用户回合 phase=unknown；新业务创建稳定 taskId，后续回合/恢复显式沿用原 ID。跨会话接续也沿用任务预算和原权限。入口先保存身份和回合状态，再读取对齐与知识；可选读取失败只给短降级说明，不回滚入口。自动入口的知识只带命中、重要遗漏摘要和总数，完整排除/跳过诊断用 `knowledge select|explain` 显式查询。

常用动作用子命令，一条命令完成，不需要临时文件（`<sessionId>`、`<turnId>` 取本次入口的 identity；`--id` 是 signalId，每个新动作唯一，重试同一动作时命令保持不变）：

```powershell
# delegated 开工前必须已有完整 prepare 记录；尚未准备时先执行 prepare（格式见下方“准备记录”）
node '<本次hook提供的bin/workflow.mjs>' signal prepare --session <sessionId> --turn <turnId> --id prep-1 --input prep.json --plan docs/plans/plan.md
node '<本次hook提供的bin/workflow.mjs>' signal task-start --session <sessionId> --turn <turnId> --id start-1 --task task-readme --route delegated --goal "本次已授权目标" --mode write --paths README.md,LESSONS.md
node '<本次hook提供的bin/workflow.mjs>' signal packages --session <sessionId> --turn <turnId> --id pkg-1 --package w1 --role worker --status dispatched --package-agent "Claude Code" --channel codeg:claude_code --scope "src/hooks.mjs" --handle <委派ID>
node '<本次hook提供的bin/workflow.mjs>' signal packages --session <sessionId> --turn <turnId> --id pkg-2 --package w1 --status consumed --ref <交付提交>
node '<本次hook提供的bin/workflow.mjs>' signal packages --session <sessionId> --turn <turnId> --id pkg-3 --package r1 --role reviewer --status dispatched --package-agent "Codex" --channel codeg:codex --scope "独立审查 w1" --handle <委派ID> --reviews w1
node '<本次hook提供的bin/workflow.mjs>' signal packages --session <sessionId> --turn <turnId> --id pkg-4 --package r1 --status consumed --verdict PASS --ref <被审提交>
node '<本次hook提供的bin/workflow.mjs>' signal task-end --session <sessionId> --turn <turnId> --id end-1 --final-ref <交付提交> --evidence "npm test 250/250 通过" --evidence "npm run check 0 错误"
```

CLI 只读当前状态补齐 projectId、ticket、epoch 和 revision，输出信号，由当前 PostToolUse 接受；字段参数见[协议](design/protocol.md#信号)。便捷参数一次只表达一个工作包：`--ref` 对 worker 记 `deliveredRef`、对 reviewer 记 `reviewedRef`，新包需要同时给 `--role`；`--package-agent` 记包的 Agent，`--scope` 记负责范围（`--agent` 是宿主选择，不用于包 Agent）；单包便捷字段必须配 `--package`，否则直接返回 INPUT，不会静默丢弃。审查包和 worker 包一样登记 `agent`/`channel`/`scope`；两者都按同一套逐包核对。`scope` 是准备记录里的负责范围声明，不是机器验证过的路径或语义沙箱，也不证明 prompt 已被范围校验。task-end 的 `validation.ref` 缺省取 `--final-ref`，`--evidence` 可重复。一次消费并派下一阶段等**同批多个包**、`change`、`waivers`、`diagnostic` 以及 disposition 等深层结构仍写进 UTF-8 JSON 文件，用 `--input` 附上（文件只放业务字段，不放身份字段）：

```powershell
node "<入口>" signal packages --session <sessionId> --turn <turnId> --id pkg-batch-1 --input "<同批 packages/change JSON文件>"
```

一条简短经验材料也可直接 `knowledge capture`，身份同样由本机状态补齐；`--incident` 是必填的事件 ID，同一事件跨会话/任务用同一个值（完整材料仍用 `--input`）：

```powershell
node "<入口>" knowledge capture --session <sessionId> --turn <turnId> --id obs-1 --incident <事件ID> --kind failure --summary "一句话材料" --conditions "适用条件" --evidence "test:可定位证据" --evidence "path:资料位置"
```

完整 payload 仍可用（兼容写法），身份必须替换为本次 context 原值：

```json
{
  "schemaVersion": 1,
  "projectId": "<projectId>", "sessionId": "<sessionId>",
  "turnId": "<turnId>", "ticket": "<当前ticket>",
  "interruptEpoch": 0, "expectedRevision": 1,
  "taskId": "<稳定taskId>", "signalId": "signal-start-1",
  "action": "task-start", "goal": "本次已授权目标", "route": "lead-direct",
  "permissions": { "mode": "write", "allowedPaths": ["README.md", "LESSONS.md"] }
}
```

```powershell
node "<本次hook提供的bin/workflow.mjs>" signal --input "<任务JSON文件>"
```

使用独立直接 shell 调用，当前支持 node/实际 Node 路径加本插件绝对入口；不串接其他 shell 命令（包括前置 `cd`；组合命令只得到“须单独直接调用”的提示，不更新状态）。PowerShell 中文 JSON 用 UTF-8 文件加 --input，不通过 5.1 原生文本管道；--base64 仅作兼容，长串可能被宿主脱敏成占位符而失效。signal 只输出 workflow_signal，当前 PostToolUse 接受回执才表示状态更新；拒绝时用 context 重读 identity/revision，不换 ID 绕过。权限系统或分类器拒绝命令时同样不换写法重试，向用户说明未记录的步骤。

task-start 必须显式声明 route（CLI `--route`，完整 payload 的 `route`）：`operation-only` 用于无经验回执要求的例行操作，`lead-direct` 用于 Lead 自己实施，`delegated` 用于分工并核对包终态、审查与 validation。新任务漏填或值非法返回 `ROUTE`，不建立任务；已存在任务续接可省略 route；旧版本留下、记录中没有 route 的历史任务照常续接，也可在接续时补声明一次，声明后不可改（返回 `ROUTE`）。非 operation-only 的 lead-direct、delegated 与历史无 route 任务照常做 spec 检查；复杂 lead-direct（有准备需求且非只读、非简单）与 delegated 一样核对 validation 和需求验收矩阵。route 只决定门禁与检查范围，不是任务复杂度认证：用户明确要求 Worker/Reviewer 时，不能改用 `operation-only` 或 `lead-direct` 消除已要求的分工。

明确的小修改可直接开始，但新任务要说明为什么不需要完整准备：

```powershell
node "<入口>" signal task-start ... --route lead-direct --goal "修一处文案" --mode write --paths README.md --size simple --size-reason "只改一处文案，无需调研和分包"
```

`--size` 只接受 `simple`/`complex`，`--size-reason` 必须同时给出且非空；`delegated` 不能用简单声明，已有复杂准备记录也不能用简单声明绕过。需要讨论、调研或拆包时先用 `prepare`，完整记录绑定后再 `task-start`；不齐时回执按字段拒绝，例如 `package:W2:agent`、`package:W2:channel`。`read-only`/`plan` 任务保留只读或计划路径；`plan` 活动任务只放行准备资料（`docs/plans/` 下合规 Markdown）写入，以及当前 worktree 与 stateDir 之外、真实位于系统临时目录（`os.tmpdir()`）且路径链无 symlink/junction 逃逸的路径（仅 `Write`/`Edit`/`MultiEdit`/`NotebookEdit` 的路径参数），业务写入被 `PreToolUse` 拒绝。

`action=phase` 声明 executing/operation-only/waiting-user/delivering；delivering 加 deliveryId，可同时提交 disposition。普通查看、指定提交 push、明确快进 pull 用 operation-only，默认零 Worker/Reviewer；低风险单点 Lead 实施，是否独立审查按行为与失败代价决定。结构化提问工具由 hook 自动记 waiting-user；普通文本反问和未识别工具先发 phase waiting-user。

旧交付处置保留兼容：`no-new-learning`、引用真实成功事务的 `updated`、引用已保存待办的 `pending-recovery`。新任务无需每次提交处置，Stop 不追加经验轮次。出现有据材料时按[经验学习](learning.md)采集，复盘由独立调度决定。

完成后用新 signalId、当前 revision 发送 `action=task-end`，不以经验处置为前置。

`task-end` 的 `waivers` 可豁免普通门禁缺项；但复杂 `delegated` 任务（`task.preparation.size === 'complex'`）不能用临时 `waivers` 抵扣 `review` / `review:*`，也不能把未预声明免审的实施包标 `status: "waived"`（返回 `PACKAGE`）。只认准备快照中实施 worker 包预声明的 `reviewWaiver: { reason, consent }`（仅 worker、两字段非空、不得同时声明 `diagnostic` 或已有审查历史）；未被实际送审推翻的豁免免列对应 `review:<id>`，并由 `task show` 的 `reviewWaived` 单独列出。无 `preparation` 的历史 `delegated` 任务保持原兼容行为。

复杂 `lead-direct` 与 `delegated` 收尾时，`task-end` 的 `validation` 还要带 `acceptance`，按准备记录的稳定需求 ID 逐条给状态：`verified` 必须有最终证据；`manual-pending` 必须有负责人 `owner` 和可操作步骤 `next`；`blocked` 必须有原因 `reason` 和下一步 `next`；`deferred` 必须有原因 `reason` 和用户同意依据 `consent`。所有工作包都 PASS 但漏一条需求时，门禁返回 `GATE` 并列出 `acceptance:<需求ID>`；未知 ID 列 `acceptance-unknown:<id>`。合法的人工待验、受阻和延期允许阶段结束，回执返回各状态数量、剩余项与 `allVerified:false`，不能据此宣称全部验收通过；适用矩阵时这些缺项不能用 waiver 抵扣。验收证据绑定 `validation.ref`，该值必须等于最终交付版本；最终版本变化后要重新提交 `validation`，需求内容或负责包变化时对应 ID 的旧验收声明失效，未变化条目保留。简单任务、`operation-only`、`read-only` 和没有 route 的历史任务不要求这套矩阵。完整格式和状态说明见[准备流程](references/preparation.md#整项需求验收与阶段交付)。

按计划实施的任务在 task-start 加 `"plans": ["docs/plans/xxx.md"]`（项目内相对路径，1-10 项），插件记下当时的内容摘要。这是软门禁：计划到收尾仍未改动时，Stop 的那一次阻挡附上回写提醒，task-end 照常接受，回执带 `planUnchanged` 和 `reminder`；不进缺项，也不需要豁免。计划改过或已移走（归档）时不提醒。`task show` 显示 `plans` 与 `planUnchanged`。

### 准备记录（prepare）

需要讨论、调研或拆包的任务，Lead 先按[准备流程](references/preparation.md)完成需求澄清、技术方案和实施安排，再用 `prepare` 保存结构化记录。准备期不建立业务任务、工作包或执行账本；准备不齐时仍可保存草案并继续讨论、调研和写计划。

```powershell
node "<入口>" signal prepare --session <sessionId> --turn <turnId> --id prep-1 --plan docs/plans/xxx.md --sections "实施步骤,Agent 选择表" --input "<准备记录JSON>"
```

`--input` 文件只放业务字段：`{ "preparation": { "size": "simple|complex", "sizeReason": "...", "requirements": [...], "research": [...], "solution": {...}, "packages": [...], "verification": [...], "confirmation": {...}, "pending": [...], "source": {...} } }`。复杂任务的每条需求要写稳定 `id`、验收 `acceptance`、负责实施包 `packages` 和检查入口 `verification`；负责包只能引用已登记且角色为 `worker` 的包。缺这些字段时回执按需求 ID 返回 `requirement:<id>:packages`、`requirement:<id>:verification`。每个工作包还要写实际调用通道 `channel`，格式沿用现有协议（如 `builtin:agent`、`codeg:claude_code`、`lead`）；用户只指定 Agent 而当前工具通道唯一时，由 Lead 按可用工具填写，不重问用户，程序不猜默认通道。`--plan`/`--sections` 是 `preparation.source` 的便捷写法，也可直接写在 JSON 中；源计划必须是项目内相对路径的 Markdown 文件（如 `.md`、`.markdown`）。程序读取源文件并记录内容摘要，不解析 Markdown。

回执保存规范化记录并返回 `ready`、`missing`（缺项字段）、`preparation.messages`（可展示说明）、`preparation.step` 和 `preparation.source`。例如包 `W2` 未选 Agent 时，`missing` 含 `package:W2:agent`，说明为“工作包 W2 尚未指定 Agent”；未填实际调用通道时含 `package:W2:channel`，说明为“工作包 W2 尚未填写实际调用通道”；需求 `A01` 没分配实施包或缺检查入口时含 `requirement:A01:packages`、`requirement:A01:verification`。`pending` 里的待决事项同样按阻塞缺项处理（`pending:0`、`pending:1` 等），非空时 `ready` 不会为 `true`；非阻塞说明写到 `solution.assumptions`。简单任务只要求 `size:"simple"` 与 `sizeReason`；`pending` 非空时仍按阻塞缺项处理。`ready` 只表示结构齐全、可以进入实施，不表示方案不能交付：只交付纯技术方案时按用户给定范围收尾，不因缺少实施安排继续追问，除非用户要求转入实施计划。

换会话、换电脑或换状态目录时，读取同一份计划重新提交同形记录即可恢复包、逐包 Agent 和实际调用通道；稳定包 ID、项目相对路径和代码基线是可携带依据，原会话 ID、票据和本机绝对路径不参与。计划只改进度或证据链接时，不取消已确认的需求、方案、Agent 和通道选择；原计划只写了 Agent 时，按新入口实际可用工具补 `channel`，不要求用户重选。

当前实现边界：`prepare` 保存记录、来源摘要和缺项；新任务的 `task-start` 必须已有完整准备、带理由的简单声明或 `operation-only`，不再以 `preparation-unbound` 新建；只有已有旧任务续接保留兼容。`operation-only` 只用于例行操作/事务，不能声明 write、不能登记实施 worker 包，也不能在 `task-update` 中取得业务写权限；只读诊断包仍可登记。固定后的逐包 `role`/`agent`/`channel`/`scope` 是后续 `packages` 的核对依据。简单任务用 `--size simple --size-reason "<理由>"` 声明；空包快照只允许 reviewer 和带 `diagnostic` 的只读 worker 包，实施 worker 需用 `task-update` 显式升级为复杂准备绑定。两个已注册的宿主在 `PreToolUse` 拒绝未开工的业务写入、实施委派和本插件直接 `task-start`/`packages` 命令；普通读取、`docs/plans/` 下全部合规 Markdown（不要求已绑定）和 `prepare` 放行，当前 worktree 与 stateDir 之外、真实位于系统临时目录（`os.tmpdir()`）且无 symlink/junction 逃逸的路径也放行（仅 `Write`/`Edit`/`MultiEdit`/`NotebookEdit` 的路径参数）；被拦截的只读检索可改用不带 `workflow-package` 标记的只读子代理（`Explore`/`Plan` 或 `workflow-explorer`）。计划只接受 `docs/plans/` 下的 Markdown，路径链上任何 symlink/junction 都拒绝，且解析后的真实路径仍须在真实 `docs/plans/` 内；`.local`、任意后缀、业务文件和除上述符合条件的系统临时路径外的项目外目标不放行。活动任务的实际委派（worker 实施或 reviewer 审查）必须在输入中带 `workflow-package:<包ID>`（或 `packageId`），关联到已 dispatched 且角色匹配的包，并按该宿主工具 schema 核对 Agent/通道/任务/角色；无法关联或缺少必需字段时拒绝。Codeg `delegate_to_agent` 只要出现非空 `assistant_id` 就拒绝（包括同时给 `agent_type`），因为 workflow 没有可靠的 assistant→Agent 映射；Codeg 的 `codeg:<agent_type>` 通道编码实际 Agent，委派入口的 Agent 必须同时匹配准备记录 `agent` 和通道尾部，只匹配其中一个会被拒绝。不带包标记的只读子代理可不带包关联：内置 `Explore`/`Plan`，以及定义文件 `tools` 全为只读工具的自定义子代理（如 `workflow-explorer`）；一旦带 `workflow-package:<包ID>`，即使是只读子代理也必须按包核对状态、通道与 Agent。带 `diagnostic` 声明的工作包也只能派给这些只读子代理，不能借 general-purpose 或 Codeg 委派取得写入。声明范围不是沙箱：程序核对包、Agent、通道和声明字段，不解析 prompt 语义或验证路径。任意 shell 业务写入、Codex `write_stdin` 和命令启动后的外部写入不在 workflow 拦截范围内；Claude 主用路径由启动方严格权限配置兜底（见 [Claude 适配](adapters/claude.md)），Codex/Codeg ACP 未验。不能把“已保存草案”说成“准备完成”或“已获授权实施”。

中断或 SessionEnd 将未完任务标为 suspended 并撤销票据，保留业务未完成记录；显式 task-start 才恢复。重发 task-start 接续沿用原 goal 与 permissions，回执带 `kept:{goal,permissions}` 和提示；本次附带的 goal/permissions 不生效。挂起任务不再以 active 永久挡住升级，未辨认的写事务仍需恢复。

### 同任务变更目标或权限（task-update）

同一任务需要显式改 goal 或增/减 allowedPaths 时，用 `task-update`，不必结束重开。只有绑定该任务的有效 Lead 会话能改；已声明为 Worker/Reviewer 的会话返回 `ROLE`，状态不变。

```powershell
# 只改目标
node "<入口>" signal task-update --session <sessionId> --turn <turnId> --id update-1 --task <taskId> --goal "新目标"
# plan→write
node "<入口>" signal task-update ... --id update-2 --mode write
# 追加路径（去重）；省略 --paths-mode 时按 replace 整体替换
node "<入口>" signal task-update ... --id update-3 --paths docs/new.md --paths-mode append
# 目标/权限变化并更新准备：新字段只能走 --input
node "<入口>" signal task-update ... --id update-4 --goal "扩大后的目标" --input update.json
```

`update.json` 只放业务字段；目标或范围变化时通常至少包含完整 `preparation`、`preparationReason` 和与本次结果完全一致的 `preparationTarget`（新增/变更 `docs/plans/*.md` 等四类例外见下文）：

```json
{
  "preparation": {"size": "complex", "sizeReason": "...", "requirements": [], "research": [], "solution": {}, "packages": [], "verification": [], "confirmation": {}, "pending": [], "source": {}},
  "preparationReason": "用户确认新增 W2 并扩大目标",
  "preparationTarget": {"goal": "扩大后的目标", "permissions": {"mode": "write", "allowedPaths": ["src/a.mjs", "src/b.mjs"]}},
  "preparationRemove": ["W9"]
}
```

`permissions` 可只给 `mode` 或 `allowedPaths`；`allowedPathsMode=append` 追加去重，`replace`（缺省）用新集合替换。命令行与 `--input` 同时给出 `permissions` 时按 mode、allowedPaths 子字段合并（同一子字段两处值不同返回 `INPUT`）；`task-update` 的便捷参数只接受 `--goal`、`--mode`、`--paths`、`--paths-mode`，给出 `--route`、`--channels` 等其他动作的参数返回 `UNSUPPORTED`，准备更新与 `preparationTarget`/`preparationRemove` 用 `--input`。宿主当前为只读/计划模式时，把 mode 提到 write 或追加路径返回 `PERMISSION`（缩小范围和只改 goal 仍可记录）：插件只更新本机任务声明，不改宿主全局配置。

目标变化或写权限扩张时，必须在同一 `task-update` 提供完整 `preparation`、非空 `preparationReason` 和 `preparationTarget`；`preparationTarget` 的 goal/mode/allowedPaths 必须与本次更新后的结果完全一致。下列四类例外不必重传完整记录：新增或变更 `docs/plans/*.md` 合规计划路径不算业务范围扩张；仅由 `plan -> write` 触发、目标未变且未新增业务路径时沿用已绑定准备快照；`preparation` 可按增量规则基于 `task.preparation` 或 `session.preparation` 合并；`dispatched` 且尚未交付（无 `deliveredRef`、`deliverySeq` 不大于 0）的包在同一基础 Agent 下只调整模型/effort 说明。除上述例外，准备记录还必须相对上次有可审计的实际变化（新增/调整包、调整需求或更新计划来源）；比较前按 `packageId`、需求 `id` 排序，并归一化 `dependsOn`、验收句子和负责包等无意义集合顺序，只重放旧记录（包括倒序重放）再加一条理由会以 `PREPARATION` 拒绝，非空理由不等于用户授权证明。未列出的旧包和旧需求默认保留，只更新进度时漏传不会删除已确认覆盖；合并后还会按最终快照核对所有需求的负责 worker 包和包依赖，保留需求仍指向被移除包时返回 `PREPARATION` 并点名具体需求与包，同批把需求迁到现存 worker 包才接受。需求内容实际变化时只失效对应 ID 的旧 `validation.acceptance` 声明，未变化条目和顺序保留。`preparationRemove` 显式移除包，但仍在 dispatched 等非终态且未被接替的包不能移除。回执与 `preparationUpdates` 记录 `changed`/`removed`/`preserved`、`changedRequirements`/`preservedRequirements`、`invalidatedAcceptance` 和 before/after。只同步进度、日志或路径不要求重问。不改 route/channels/历史工作包，也不替代用户授权。

回执返回有效权限和变更摘要，例如：

```json
{"accepted":true,"revision":8,"taskId":"task-1","goal":"新目标","permissions":{"mode":"write","allowedPaths":["README.md","docs/new.md"]},"change":{"permissions":{"mode":{"from":"plan","to":"write"},"allowedPaths":{"mode":"append","added":["docs/new.md"],"removed":[]}}},"hostPermissionMode":"default","note":"已更新本机任务声明；实际写入仍受宿主当前只读/计划权限约束，插件只记录声明，不自动证明用户授权真实存在"}
```

变更追加到任务的 `updates`（`task show` 显示条数），准备更新另记 `preparationUpdates`；历史回执不改写，旧任务兼容。权限收缩不追溯取消已完成的产物，后续知识/对齐写入按新范围检查。已绑定准备记录的任务改目标或扩大权限范围时，必须按本任务已绑定的准备记录重新核对并提交上述实际变化；复杂任务不能降成简单记录后扩大范围。PreToolUse 对活动任务的 `read-only`/`plan` 声明再核对写入，任意 shell 写文件仍由宿主权限/沙箱约束。

Lead 的活动任务结束回合时，Stop 会挡一次（等待用户、本回合已挡过时不挡）：有在途工作包时要求继续等待结果：`codeg:` 包给出 `get_delegation_status` 的 `wait_ms: 0` 阻塞等待，`builtin:` 包说明宿主会通知结果，其他通道要求按当前入口实际支持的方式等待；或向用户说明为什么暂停（在途包全是 `builtin:` 时只要求说明在等什么）；没有在途包而未发 task-end 时给出缺项，按提示补齐后发 task-end，或向用户说明还没完成的部分。计划模式下，仅本回合显式 task-start/phase 才核对计划交付：交付完整实施计划时一次列明分包，先说明执行顺序、串并行关系和理由，再请用户为每个包指定 Agent 与实际调用通道；同一套已确认分包可沿用原选择，新增、拆分、合并或更换包的范围时重新确认，不按角色套默认值，Lead 直接执行的任务不问 Worker；只交付纯技术方案时按用户给定范围停在方案，不要求分包或逐包选择。历史 `plans` 和普通解释、讨论不因 `mode=plan` 单独挡，也不落到通用门禁阻挡。

用户指定了各角色用哪个智能体时，task-start 可选带 `"channels": {"worker": "codeg:claude_code", "reviewer": "codeg:codex"}`，每个工作包填实际 `channel`。`channels` 每角色只能声明一个；同一角色各包通道不同时省略该角色键，必要时整项不带，以准备记录的逐包 `agent`/`channel` 和每次 `packages` 的 `channel` 为准。当前协议只在任务已声明该角色通道而包通道不同（含未填），或 delegated 任务的 worker 包由 Lead 实施（`channel: "lead"` 或 `handle: "lead-direct"`）时判偏离：须在同一 packages 信号附 `change` 列出该包，否则回执 `CHANNEL`。准备记录在 `task-start` 固定到任务后，`packages` 还会按包 ID 核对 `role`/`agent`/`channel`/`scope`：新包未在准备记录中声明，或字段与开工时选择不一致，返回 `PREPARATION` 和具体 `missing`；新增、拆分、合并或更换包需先请用户确认：尚未开工时更新 `prepare`；任务已开工则用 `task-update` 的 `preparation` 与 `preparationReason` 更新已绑定快照（目标或范围变化时同时给 `preparationTarget`）。`scope` 是可核对的负责范围文本，不是路径所有权沙箱。换新 packageId 返修时新包带 `"supersedes": "<旧包>"`，只能在创建时声明；已交付或审查要求修订的轮次累计（同一交付轮次只计一次，同一轮迟到的交付引用或 FIX 不重复累计）、旧包自动收尾；从未产出的启动失败重派不增加返修。同包返修再次交付后，旧 `reviewedRef` 不再匹配新的 `deliveredRef`，必须重新送审。当前账本仍有审查结论的 worker 包（PASS/FIX/BLOCKED；含它接替过的旧包），审查缺项不能用 waivers 豁免，也不能改标 waived。waived 预校验同时看批前当前结论与本批合并后的最终结论：同一批把审查对象从 A 改指 B 时，A 的批前 FIX/BLOCKED 仍参与；重指须在单独信号成功落盘后，后续信号才不再保留旧 FIX/BLOCKED。历史只有 PASS 单调保留，并跨信号沿 supersedes 链保留；审查对象改指其他包后，历史 PASS 仍算已审。曾有 PASS 的包不能改 canceled（即使审查后来改成 FIX/BLOCKED，返回 `PACKAGE`）；取消只按 PASS 判断，只有 FIX/BLOCKED 而没有 PASS 的包仍可取消。处理方式是重新送审最终交付版本，或用 supersedes 接替。同一批 packages 不允许重复 packageId（返回 `PACKAGE` 并整批回滚）。同一批新建 worker 包并直接标 canceled 时，若同批 PASS 指向它或 supersedes 链上有 PASS，整批返回 `PACKAGE`，与数组顺序无关。`task show` 显示 `channels`、`diagnostic` 与 `reviewWaived`。

只读诊断包（不产生项目写入的调查、复现或资料核对）可在**首次创建**时声明免审，避免为简单诊断重复派 Reviewer：同一批 packages 不允许重复 packageId，不能先消费再在批内改 `dispatched` 补挂；同一 packages 信号给新包带 `"diagnostic": {"purpose": "核对 README 与发布说明是否一致", "scope": ["README.md", "docs/usage.md"], "reason": "只读比对，不修改文件"}`，包须为 `dispatched` 的 worker，不能带 `deliveredRef` 或 `supersedes`。实现包、审查包、事后补声明或修改声明、空理由、空/绝对/含 `..` 的范围都返回 `PACKAGE`。交付时在 `note` 写可定位结论与证据，例如 `"note": "结论：一致；证据：README.md 第 1 行、docs/usage.md"`；门禁缺结论会列 `diagnostic:<id>`，不能用 waiver 抵扣。声明只表示事先约定与信任，不证明进程实际未写；历史未声明包仍要求审查。

### 决策升级提醒与可选 jev

顾问按需调用：Lead 判断需要或用户点名时，再让 `workflow-advisor` 给出第二意见。咨询前需要读取大量材料时，先派探索者备证据摘要，再把摘要与证据位置交给顾问；顾问反馈缺口时再派探索者补证后重问，不让顾问自行扩大检索。`prepare`、`task-update`、`packages`、`task-end` 都不再要求先咨询，Reviewer 独立审查与开工确认也不受影响。

需要第二意见时：

```text
用 workflow-advisor 子代理，输入：决策问题、可选方案、已知证据（文件、路径、约束；需要大量读取时先由探索者备好摘要和证据位置）。
不要带 workflow-package 标记，也不要让顾问写文件或派工；证据不足时顾问只列缺口和最小补证方式返回，不自行扩大检索。
```

顾问结束后，PostToolUse 自动写会话级咨询记录；记录只证明问过，不证明建议被采纳或决策正确。默认名 `workflow-advisor` 继续识别；定义文件改名时在 frontmatter 加 `workflow-role: advisor` 也会写入咨询记录。需要跨文件追查、分析长日志或并行收集多处证据时用 `workflow-explorer`，它只回结论、证据位置与未确认项；已知位置的小读取直接做。子代理失败时先报告失败原因，只定向核查关键片段，同一失败最多重试一次。

路径规则和可选 jev 都写在项目根 `workflow-gate.json`。模板 `workflow-gate.example.json` 随发布副本分发：源码仓库在根目录，安装后在发布副本根目录。复制到项目根并改名为 `workflow-gate.json`，再把示例 glob 换成项目自己的路径：

```powershell
Copy-Item "<模板所在目录>/workflow-gate.example.json" "<项目根>/workflow-gate.json"
```

一个完整、可直接修改的例子：

```json
{
  "schemaVersion": 1,
  "pathRules": {
    "security": ["src/auth/**", "src/**/permissions.*", "hooks/**"],
    "migration": ["migrations/**", "src/**/schema.*"]
  },
  "jev": {
    "enabled": false,
    "endpoint": "http://127.0.0.1:3425/v1/systemone",
    "model": "typesafe/jev-latest"
  }
}
```

字段与缺省行为：

| 字段 | 含义与缺省 |
| --- | --- |
| `schemaVersion` | 推荐写 `1`；缺省按 1 处理。其他值会让路径规则和 jev 都不生效并带回错误。 |
| `pathRules.security` / `pathRules.migration` | 项目相对路径的 glob 数组，分别标记安全/权限边界与数据迁移类路径；某一类缺省按空数组处理。整个 `pathRules` 缺失或类型不对时，路径规则不生效并报错；空规则等于关闭。 |
| `jev.enabled` | 布尔值；缺省或不为 `true` 即关闭。 |
| `jev.endpoint` | `enabled: true` 时必填，必须是 `http`/`https` 地址。 |
| `jev.model` | `enabled: true` 时必填，必须是非空字符串。 |
| 模板里的 `_comment` | 仅作说明，程序忽略；复制后可以删除。 |

`security` / `migration` 是分类标签，规则只匹配项目相对路径和 glob；文件缺失或规则为空即不生效。路径规则只核对复杂写入任务的 `task-update` 业务路径增量和受支持写入工具的实际写入，不核对 `task-start` 的初始 `allowedPaths`，合规 `docs/plans/*.md` 增量不触发。实际写入只检查 `Write`、`Edit`、`MultiEdit`、`NotebookEdit`、`apply_patch`、`write_file`、`delete_file` 从工具参数或补丁文本识别的目标；普通 shell 工具（`Bash`/`exec_command`/`PowerShell`/`pwsh`）的命令、重定向和脚本写文件不经过路径规则。命中时只提醒，不拦截：实际写入命中且本任务已有咨询记录（不限记录时间）时不提醒；`task-update` 业务路径增量命中且本任务没有时间不早于最近一次已保存变化的咨询记录时，在回执附提醒。同一会话同一键（`<taskId>:security|migration`）只提醒一次；已有对应咨询记录时不提醒。配置不是有效 JSON、含未知分类或字段类型不对时，路径规则不生效，但 `task-update` 回执带 `pathRulesError`，实际写入附 `systemMessage`，不因此阻断现有写入。

`jev` 是可选的本地判断适配，缺省或 `enabled` 不为 `true` 即关闭；`endpoint` 或 `model` 不合法时只让 jev 不生效，不影响路径规则。开启后只对 `prepare`、`task-update`、`packages` 三个信号里 Lead 写出的描述发一次请求（复杂准备和复杂写入任务），不检查实际文件写入，超时 2000 ms；命中且没有对应咨询记录时只提醒：`prepare` 以本会话在本份准备之前的记录为抑制条件（`taskId` 为空或属于当前会话任务），若会话已有上一份准备，只看不早于上一份准备的 `preparedAt` 的记录，首次准备不设该时间下限；`task-update` 以本任务不早于最近一次已保存变化的记录为抑制条件，`packages` 以本任务任一记录为抑制条件。提醒键为 `<taskId 或 prepare>:jev`，同一会话只提醒一次。超时、拒连、非 2xx、坏响应和配置损坏按未命中处理，不阻断信号。密钥只从环境变量 `TYPESAFE_API_KEY` 读取，且只在网关地址为本机回环时发送；不要把密钥写进项目配置、仓库或日志。

调整时直接改项目根的 `workflow-gate.json`，下一次信号或写入就按新内容判断，不需要重装或重启；把 `pathRules` 两类都置空或删除文件即关闭路径规则，把 `jev.enabled` 设为 `false` 或删除 `jev` 即关闭 jev。模板不预置任何业务项目的规则，也不自动写进项目。

验证边界：两个子代理的定义被发现、调用和网关模型路由已在本机真机验证；`effort` 实际下发值未验证。路径规则的真机交付仍未验证；jev 只有本地假服务测试和一次本机网关样本；同步 jev 调用占用信号状态锁，最长 2 秒，对并发会话锁等待的影响未实测。

### spec 检查

项目有 `.spec/<id>/spec.md` 时，task-end 会检查被管辖文件（frontmatter 的 `code:`）改了而 spec 没跟着更新的情况；正常收尾不必先单独运行同一份检查。需要提前诊断时用只读命令：

```powershell
node "<入口>" spec check --project "<项目目录>"
node "<入口>" spec check --project "<项目目录>" --ref "<commit>"
```

检查根是命令所在目录对应的当前 worktree（附加 worktree 就检查该 worktree），不是项目主目录；从项目子目录运行也回到 worktree 根。缺省检查 `HEAD` 与未提交改动；指定 `--ref` 时先固定成提交，spec 清单、正文、`code:` 路径和文件存在性都取自该提交，输出里的 `ref` 也是固定后的提交 OID。例外：`--ref HEAD`（或直接用默认值）仍按当前 worktree 的文件与未提交改动检查，不固定成 OID。

有发现时退出码为 1，`findings` 列出 spec、文件、类型（drift/uncommitted-drift/missing/duplicate-id）和未被 spec 见过的提交。处理办法：更新 spec 后提交；或代码改动不影响 spec 时，在内容提交上附 `Spec-OK`，理由写进提交正文：

```powershell
git commit -m "refactor: search 无需更新" -m "重命名内部变量，行为不变。" --trailer "Spec-OK: search"
```

需要追认既有的历史提交时，才按现有空提交语义做一次放行（`git commit --allow-empty` 加同一 trailer）；空提交覆盖其全部祖先。

spec 缺项不能用 waivers 豁免；浅克隆或 git 失败导致的 `spec-check:<原因>` 可以豁免。完整规则见[协议](design/protocol.md#spec-检查)。

### 真实宿主评测（eval）

用一条命令在隔离环境驱动真实 `claude -p`，脚本化多轮用户输入，并断言 hook 决策、任务账本、文件状态和 transcript。`smoke` 含 E00：在“好的，可以，继续”之后，让模型按 delegated 多工作包流程实际发起一条不带 `--size simple`、也不先 prepare 的 `signal task-start`，并直接尝试写 `src/business.txt`；断言 task-start 调用被 PreToolUse 拒绝、`src/business.txt` 的写入工具调用被拒绝、业务文件保持原样且隔离状态没有建立任务。同一场景不注入 hook 时，task-start 与写入都没有 PreToolUse 拒绝，断言必须失败。

`protocol` 含 E01–E06，覆盖协议与门禁场景：E01 多轮“好的”后复杂 delegated 开局被拒、E02 未 prepare 的 delegated 开工、E03 W1 未终态时派发依赖包 W2、E04 复杂 prepare 不咨询也能继续且路径规则写入只提醒一次、E05 复杂任务缺验证与验收直接 task-end、E06 隔离安装/卸载冒烟。前五个场景启动真实宿主并由模型真实发起被监测的工具调用；E06 是无模型的本地 CLI 场景，只读写隔离 `--user-dir`／`--state-dir`。

`herdr` 含 E09：新建独立命名、专用 server 的 Herdr 会话，在窗格里启动真实 Claude Code，两轮分别要求写业务文件和执行单条 `herdr agent prompt`；断言两次都在工具执行前被 PreToolUse 拒绝，业务文件不变、隔离状态没有建立任务。第一轮 prompt 之前先完成 S00 闸门：新会话 socket 与当前环境不同、窗格内 `HERDR_ENV=1`／`HERDR_PANE_ID` 与临时 `CLAUDE_CONFIG_DIR`／`LOCALAPPDATA`／state 成立、父进程链含 `herdr.exe`、Claude 未传 `--plugin-dir`，且真实 settings／agents／state 未变化；任一不成立立即记 INVALID，不先发消息。证据只取隔离配置目录的 transcript、`hooks.jsonl`、隔离状态和文件内容；`agent list/get/read/wait` 与 `pane read` 只用于等待和读回，不作为门禁证据。

`model` 含 E07–E08，单独计费，默认每个场景跑 3 次并串行执行。E07 要求 Lead 用 Agent 工具真实调用 `workflow-advisor`：断言 transcript 出现该 `subagent_type`、`result.modelUsage` 出现隔离安装定义 frontmatter 的 `model:` 值、隔离 `state/consultations/` 出现绑定本会话的咨询记录。E08 要求真实调用 `workflow-explorer` 读取隔离项目的 `README.md`：断言调用、`modelUsage`、隔离安装定义的 `tools:` 仅含 `Read, Grep, Glob`，并在宿主写出的子代理 transcript 可观测时断言内部没有写工具。期望模型运行时从 `<隔离配置目录>/agents/*.md` 读取，不硬编码。这些断言只证明“调用发生、路由可观测、咨询记录落盘”，不证明建议内容正确、咨询有效或被 Lead 采纳；`effort` 实际下发值不可观测，子代理内部事件也不在父级 stream-json 中，只能从隔离配置目录的 sidechain transcript 读取。任一可观测维度缺失时该次运行记 `NOT-OBSERVABLE`（退出码 4），不会降级成 PASS。

`context` 含 E10–E15，回答“评测值不值得”。任务只给业务问题，不点名子代理；夹具由脚本确定性生成，答案用正则判定，不用模型打分。E10 已知位置的小问题，要求直接作答且没有 Agent/Task 调用；E11 跨文件追查，答案必须点出 `src/pricing.mjs` 的根因行并说明件数被减一；E12 长日志定位，答案必须保留退出码 23、`EACCES` 关键证据和失败行号；E13 三轮调查与决策，最后一轮必须保留进程内缓存决定、不改公开 API 的约束和 Redis 未确认项；E14 跨模块调用链追因，答案必须点出 `src/config/loader.mjs` 的根因行并说明环境覆盖后默认税率丢失；E15 多配置与日志交叉定位，答案必须给出最终端口、决定端口的配置文件、base 端口未生效的原因、占用同一端口的服务和日志证据行号。E14、E15 的夹具各含至少 7 个文件，原始材料超过 40 KB，直接逐文件读取的材料量明显大于一份调查摘要。

```powershell
npm run eval -- --suite context --baseline-ref <基线提交> --runs 3 --prices <价格表文件>
npm run eval -- --suite context --baseline-ref <基线提交> --runs 1 --prices <价格表文件> --trial
npm run eval -- --suite context --baseline-ref <基线提交> --runs 3 --prices <价格表文件> --max-budget-usd none
```

只跑 E14、E15 时用逗号分隔的场景子集：

```powershell
npm run eval -- --scenario E14,E15 --baseline-ref <基线提交> --runs 3 --prices <价格表文件>
```

该命令执行 2 个场景 × 每场景 3 轮 × 每轮 baseline/candidate 两臂 = 12 次运行；`--suite context --runs 3` 会跑全部 6 个场景，共 36 次。R4 使用前者，不直接跑整个 context 套件。

- 两臂：基线臂用 `git archive <基线提交>` 导出到输出目录再安装；候选臂安装当前工作树。同一场景同一轮先跑基线再跑候选，减少路由和时段漂移。
- 价格表格式：`{"unit":"usd_per_million_tokens","source":"…","models":{"<实际模型>":{"input":…,"output":…,"cacheRead":…,"cacheWrite":…,"cacheWrite1h":…}}}`，价格取自 `magpie model price <模型>`；`cacheWrite` 是 5 分钟缓存写，`cacheWrite1h` 可选，但用量里出现 1 小时缓存写时必须提供该价格，否则该臂记成本不可比，不拿 5 分钟价顶替。用量里的 `cache_creation.ephemeral_1h_input_tokens` 按 1 小时价计，其余缓存写按 5 分钟价计。没有价格的模型不猜，该臂记成本不可比。
- 成本口径：token（输入、缓存读、缓存写、输出）取主与子代理 transcript 的 `message.usage`，按 message id 去重（同一条消息会因内容块拆成多行），按实际模型汇总；重试产生的 assistant 消息同样计入。折算成本 = token × 价格表，是主指标。宿主 `total_cost_usd` 与 `modelUsage` 是会话累计值，多轮取最后一个结果，不逐轮相加；`costBasis` 为 `unknown` 时标“宿主估算，不是账单”。逐轮把主 transcript 汇总与 `result.usage` 对账；对不上、缺用量（压缩、重试）、缺价格或子代理 transcript 关联不全时该臂写“成本不可比”，不写下降。
- Lead 材料：主 transcript 的 `tool_result` 字节数（分工具）和累计输入 token（input + 缓存读 + 缓存写）。
- 判定规则在报告里由固定函数计算：质量达标（候选臂每次答案断言都通过）、过度委派（E10 候选臂出现 Agent/Task 调用）、成本下降（先按每轮把本次实际运行的成本组合计，3 对全部下降；成本组为 E11–E13 或 E14–E15，按已运行场景推断，同一次报告不混用两组；两组都完整运行时沿用 E11–E13 口径）、无明确差异（未下降但每轮合计成本变化率中位数没有上升；正式运行不足 3 对时不判下降）、成本上升（每轮合计成本变化率中位数上升）、成本不可比（对账、用量、价格、子代理关联、某轮缺场景或两臂实际模型不成立）。试跑只有 1 对时按合计口径照算，但报告标明“1 对（共 3 对）仅演算”，不构成成本下降结论；加 `--trial` 时结论写“试跑，不构成结论”。
- rtk：Q4 已移出本轮，两臂都不装 rtk，报告注明“未含 rtk 输出控制”。
- 报告：`context-report.json`、`context-report.md` 分别给质量、Lead 材料、总成本、总耗时；成本含主、子代理和重试。每次运行的 `summary.json` 带 `context` 分节，运行目录另有 `trajectory.jsonl`，报告读取其决定记录数、字节数和落盘耗时。

**2026-11-05 正式对比（每臂 3 对，仅作方向判断）：** 24 次运行全部 PASS，候选臂 12 次答案断言全部通过；全程没有 Agent/Task 调用，因此“未过度委派”是平凡结果。基线折算 $0.887952、候选 $0.912445（+2.76%），E11–E13 三轮合计分别 +1.215%、+3.251%、+5.583%，中位数 +3.251%，按预登记规则判“成本上升”；候选与基线是整包差异，该变化不能归因于调查者分流方案。Lead 材料 11657 B → 12415 B，累计输入 token 1086193 → 1088382，未下降。首要验收（质量达标后整项总成本下降）未达成，按计划停止，由用户决定加样本或开条件包。Q1 延期（用户决定，验收标 deferred；取证时为部分达成）：答案断言通过，但本批没有派出调查者，Lead 也没有读取分流指引，调查者路径未被检验；Q8 的 Lead 指引已写入，24 次 transcript 无子代理调用，失败接手路径未被触发，停用开关不适用（本轮无强制规则）。详细数据见[验收第 26 节](acceptance.md)。

**2026-11-05 分流句前置复测（17 次，结论：无结论）：** 首测规则位于 7165 字符入口末尾，2 次运行均未派调查者（$0.2201、$0.1617）。规则前置强化后重测 2 次，入口 `instruction` 均以规则开头，两次都派出 `workflow-explorer`（$0.1888、$0.2824）。R4 12 次（E14、E15 × 3 轮 × 2 臂）全部完成；候选 6 次中 3 次派出探索者（E14 第 1、3 轮、E15 第 1 轮），基线 0 次。评测脚本只读第一个 `result`，把这 3 次的“已派出、等待结果”中间态当成最终答案；但改取最后一个 `result` 也不会全部合格：E14 第 1、3 轮分别只给出 `loader.mjs:4-5`、`:3-6`，未单独标出根因第 5 行；E15 第 1 轮仍被 `e15-base-override` 与 `e15-config-causality` 拒绝。E15 的 `e15-occupancy`、`e15-log-causality` 正则误杀基线第 1、2 轮；候选 E15 第 2 轮的 `e15-config-causality` 也因同行、特定语序要求漏判。成本因探索者实际使用 `commandcode/deepseek` 被预注册规则判“不可比”，逐轮变化率 -40.271%、+12.005%、-19.915%、中位 -19.915% 只作算术参考。Lead 材料 351996 B → 268276 B，累计输入 token 1273396 → 877255，无法单独归因；候选与基线是整包差异，变化不能归因于分流方案。E10 补测 1 次 PASS、0 次 Agent/Task、$0.0572，只说明该次已知位置的小问题未被派出；第 17 次补测超出原计划 16 次上限，依据是本轮用户明确批准追加 1 次。每臂仅 3 对，只作方向判断；待修项为评测脚本改取最后一个 `result`、放宽 E15 的 `e15-occupancy`/`e15-log-causality`/`e15-base-override`/`e15-config-causality` 断言、明确行号范围规则与混合模型成本口径。详细数据见[验收第 27 节](acceptance.md)。

```powershell
npm run eval -- --suite protocol
npm run eval -- --suite herdr
npm run eval -- --suite model --runs 3
npm run eval -- --scenario E00
npm run eval -- --scenario E00 --no-hooks
npm run eval -- --suite smoke --runs 2 --max-budget-usd 1 --out "D:\tmp\eval-report"
```

- `--scenario <ID[,ID]>` 只跑一个或多个场景（逗号分隔，顺序沿用输入）；`--suite <名称>` 跑套件。当前 `smoke` 含 E00，`protocol` 含 E01–E06，`herdr` 含 E09，`model` 含 E07–E08，`context` 含 E10–E15。
- `--runs <N>` 重复次数，缺省取场景声明（E01–E15 为 1，E07/E08 为 3）。context 对比中每次重复都会跑 baseline 与 candidate 两臂，因此总运行次数 = 场景数 × 轮数 × 2。
- `--max-budget-usd` 每次运行的模型预算，缺省 1.5；填 `none` 表示明确不设金额上限（不传宿主预算参数，不用任意大金额代替）。E06 不产生模型费用。`claude -p` 场景由宿主强制执行；Herdr 交互会话不支持该参数，报告把费用写成“未知（交互会话不提供）”，并写明预算未强制、费用以宿主账单为准，不显示 `$0.0000` 或把未知费用计入汇总。
- `--baseline-ref`、`--prices` 只用于 `context`；前者必须能由 `git archive` 导出，后者按上面的格式给出实际模型价格。
- `--trial` 只用于 `context`，把报告标为试跑并禁止写结论。
- `--out` 报告目录，缺省 `%LOCALAPPDATA%\workflow-eval\<仓库名>\<时间戳>`。
- `--no-hooks` 仍安装同一份 CLI 并 onboard 项目到隔离状态，但把隔离 settings 覆盖为不含 hook 的版本，用于负向对照；E00 在这种模式下按预期失败（退出码 1）。`context`／`protocol`／`herdr` 场景没有负向对照。

前置：跑模型场景时 `claude` 在 PATH（可用 `WORKFLOW_EVAL_CLAUDE` 指定可执行文件），并提供环境认证 `ANTHROPIC_API_KEY` 或 `ANTHROPIC_AUTH_TOKEN`；E06 不需要认证。runner 只使用当前进程的环境变量，不读取、截取、输出或复制凭据值，也不读取或复制 `~/.claude/.credentials.json`；缺认证的模型场景直接 BLOCKED（退出码 4）。Herdr 场景还需要 `herdr` 在 PATH（可用 `WORKFLOW_EVAL_HERDR` 或 `HERDR_BIN_PATH` 指定可执行文件）；它创建自己的命名会话，不复用当前 `HERDR_SOCKET_PATH`、当前 pane 或已有会话，结束时只停止自己创建的会话。Herdr 场景目前按 Windows 实现（进程树用 PowerShell 查询），其他平台会记 BLOCKED。

隔离：每次运行新建临时项目、临时 `CLAUDE_CONFIG_DIR` 和临时 `--state-dir`，`install`／`project onboard` 都只写入这两个临时目录；启动参数固定 `--setting-sources user`、`--strict-mcp-config`，不传 `--plugin-dir`。子进程的 `LOCALAPPDATA` 指向沙箱，使不带 `--state-dir` 的 CLI 调用也只会命中隔离状态。runner 同时扫描 transcript 里的 Bash/PowerShell 调用：实际 workflow CLI 调用若带沙箱外 `--state-dir`，或尝试把 `LOCALAPPDATA` 指向沙箱外，隔离证据即不成立；未观测到 CLI 调用时不单独判失败，只在报告里保留 `observed: false`。E00 的隔离 settings 只放行 `Edit(src/**)` 和隔离状态入口的 `signal` 命令，让模型能实际发起 task-start，同时不能借任意 node 调用写文件；负向对照安装同一份 CLI、执行同一条命令，只移除 hook 注册。

Herdr 场景的隔离方式：`workspace create --env` 把临时 `CLAUDE_CONFIG_DIR`、`LOCALAPPDATA` 和 `CLAUDE_CODE_ENTRYPOINT=cli` 注入窗格；隔离 settings 额外追加一个只为取证的日志 hook，把收到的原始 hook 事件写入本次运行目录的 `hooks.jsonl`，不返回任何决策；隔离 `.claude.json` 只写 onboarding 和项目信任，不写任何凭据片段或 `customApiKeyResponses`。认证只引用宿主环境变量名；同时存在 `ANTHROPIC_AUTH_TOKEN` 时窗格只继承它，避免 TUI 要求把 API key 片段写盘。若只有 API key 且 TUI 仍要求审批，runner 不用凭据片段绕过，按 BLOCKED 记录。窗格环境和父进程链由窗格内探针与专用 server 进程树核对，不依赖屏幕文字；进程树日志只保留 pid、名称、父 pid 和 `--plugin-dir` 布尔值，不保存命令行。

来源与真实状态核对：

- 隔离 settings 追加一个带唯一 token 的 UserPromptSubmit 哨兵 hook，断言实际 hook 事件携带该 token；隔离 agents 目录追加一个哨兵 agent，断言 `system/init` 的 agents 列表出现它，真实 `~/.claude/agents` 中同名哨兵不存在。取不到可观测证据时该 run 记 NOT-OBSERVABLE（退出码 4），不采用。
- 运行前后对比真实 `~/.claude/settings.json`、`~/.claude/agents` 和 `%LOCALAPPDATA%\workflow\state.json`。前两者变化记 INVALID（退出码 3）；真实 state 做前后差异并列出变化键，本次合成的 projectId、sessionId、turnId 和临时目录不得出现在任何字段。变化默认只按字段白名单归因：根 `revision`、`hostObservations.*`、父会话的易变会话字段、其他真实会话的 `lastSeenAt`/`revision`，以及项目 `learning.lastCheckedAt`/`changedAt`；角色、项目身份、任务记录等其他变化记 INVALID。只有 `state-root-isolated`、`child-localappdata-isolated`、`cli-state-dir-confined`、`cli-localappdata-confined` 同时通过（子进程 `--state-dir`、实际 `LOCALAPPDATA` 在沙箱内，已观测的 CLI 调用没有沙箱外参数）时，白名单外的真实 state 变化才作为并行真实会话的 `external` 单列，不冒充本次归因；合成 ID 扫描独立执行，出现即 INVALID；未观测到 CLI 调用时不存在显式覆盖路径，两项 CLI 检查按无越界通过，只有实际出现沙箱外参数才失败。已确认的隔离或溯源失败优先于 BLOCKED／INCONCLUSIVE，并停止后续场景和重复运行；总体状态与单次状态同一优先级，NOT-OBSERVABLE 不会被汇总成 PASS。
- 以上字段白名单只适用于 `claude -p` 场景。Herdr 场景单独做严格比较：真实 settings、agents、state 的哈希任一变化即 INVALID，不套用白名单，也不把变化归因为并行会话；第一轮 prompt 前和运行结束后各比对一次。`delivered` 只认投递成功回执，或超时/停滞后在 transcript 中找到对应轮次的完整 `role=user` 消息且内容包含完整 prompt；助手输出、工具结果、相同前缀和仅超时都不计数，记 0 并按 BLOCKED 处理。状态优先级为：隔离不成立 → INVALID；已送达但 transcript／hooks／隔离 state 会话缺失 → FAIL；否则无法驱动 → BLOCKED；模型未真实发起 → INCONCLUSIVE。

报告目录：

- `summary.json`／`summary.md`：总体状态、退出码、总成本（未知时明确写未知，不与数值成本混算）与逐次结果。
- `<场景>-run-<n>/summary.json`、`summary.md`、`<场景>.log`：单次运行的隔离检查、断言、门禁证据和轮次结果。
- `<场景>-run-<n>/transcript.jsonl`：宿主原始 stream-json；Herdr 场景是复制出来的隔离交互式 transcript。
- `<场景>-run-<n>/hooks.jsonl`：hook 生命周期事件；Herdr 场景是隔离日志 hook 记录的原始 hook 输入载荷。
- `<场景>-run-<n>/stderr.log`：宿主 stderr；Herdr 场景是专用 server 日志的副本。
- Herdr 场景另有 `herdr.log`（每条 Herdr 命令及输出；进程树只保留 pid、名称、父 pid 和 `--plugin-dir` 布尔值，不保存命令行）、`pane-read.txt`（只读读回的窗格文本，不作为门禁证据）。

本地场景（E06）不启动宿主，只有 `summary.json`、`summary.md`、`<场景>.log` 和 `sandbox/`。
- `<场景>-run-<n>/sandbox/`：临时项目、隔离配置和隔离状态，作为证据保留。

退出码：0 全通过；1 断言失败；2 参数错误；3 INVALID（隔离或溯源不成立）；4 BLOCKED／INCONCLUSIVE／NOT-OBSERVABLE（无认证、无法启动宿主、超时、轮次不完整或来源不可观测）。Herdr 场景按任务书语义区分：隔离或 Herdr 身份不成立记 INVALID；已送达（成功回执或 transcript 中对应轮次的完整 `role=user` 消息包含完整 prompt）但隔离 transcript／hooks／state 没有 hook 事件记 FAIL（优先于驱动失败）；未确认送达的超时记 0 并按 BLOCKED 处理；入口出现但无法证明模型发起过被拒工具调用记 INCONCLUSIVE；Herdr 无法稳定驱动或隔离不可行记 BLOCKED。任何情况都不得写成 PASS。评测会调用真实模型并产生费用，`claude -p` 场景的 `--max-budget-usd` 是宿主侧上限；Herdr 交互会话的费用未知且预算未强制；不要把它加进 `npm run verify` 或 CI。

状态含义：`PASS` 是断言全部通过且隔离/来源证据成立；`FAIL` 是存在可观测断言失败；`INVALID` 是隔离或溯源不成立；`BLOCKED` 是缺少认证、无法启动宿主等没有进入目标场景；`INCONCLUSIVE` 是结果不足以得出结论；`NOT-OBSERVABLE` 是断言依赖的证据不可观测，不写成通过。`context` 套件的成本证据（用量、价格、子代理关联、对账、两臂模型）缺失不改变运行状态，单独记“成本不可比”，不参与成本下降。负向对照 `--no-hooks` 仍安装同一份 CLI，只把隔离 settings 覆盖成不含 hook 的版本：E00 在该模式下按预期 FAIL（退出码 1），用来证明“没有 hook 时断言必须失败”，正向运行只有在该对照失败时才说明断言真的在检查 hook。

产品边界：带 `--size simple --size-reason` 的 `signal task-start` 在用户说“好的”之后仍会被 hook 直接放行（`src/hooks.mjs` 的简单任务分支），插件没有“用户还没明确说开工”的机械校验。E00 因此对照的是复杂 delegated 开工：没有准备记录的复杂 task-start 会被 PreToolUse 拒绝，正向运行据此 PASS。simple 开工的授权缺口不在 E00/E01 中伪造为拒绝，仍为已知产品缺口，由用户单独修复。

### Trajectory（hook 决定与离线排查）

workflow 的 PreToolUse 与 Stop 每产生一次决定，都追加一行到 `<stateDir>/decisions/<会话ID>.jsonl`，带规则编号（`A`、`R`、`C`、`D`、`T`、`B`、`G`、`S`、`X` 开头）和简短原因。记录只写本机文件，不进入模型上下文，也不改变返回给宿主的判定；追加失败不影响放行或拒绝。落盘完成后另追加一行 `kind: "write"` 统计，记录 `ms`（含 `mkdir` 与 `appendFile` 的实际耗时）和该决定行的 `bytes`；轨迹的 `decisions.msTotal`、`msMax` 取这些统计行，`writeRecords` 是统计行数，决定文件总字节数另见 `bytes`。

```powershell
# 离线生成一个会话的轨迹：宿主 transcript 为骨架，按 tool_use_id 合并决定记录
node "<入口>" trajectory --session <会话ID>

# 只读列出 hook 清单：用户级、项目级与本机项目设置
node "<入口>" trajectory hooks [--root "<项目目录>"]
```

轨迹按回合组织工具调用，并合并子代理 transcript（`<配置目录>/projects/<项目>/<会话ID>/subagents/`）。每个调用有 `workflow` 决定和 `hostHooks` 观测，`status` 区分 `allow`、`deny`、`ask`、`no-decision`、`rewritten`、`failed`、`timeout`、`unobserved`；`signals` 保留组合（例如 workflow 放行后被 rtk 改写）。`hook_success` 且退出码 0 但没有 `permissionDecision` 的输出只算执行成功，不算放行，记为 `no-decision`；只有显式 `permissionDecision: "allow"` 或 workflow 决定才记 allow。rtk 的退出码 3 是改写信号，状态保持 `rewritten`，同一调用的 workflow allow 只作为组合信号保留。清单里有、记录里没有的 hook 记为 `unobserved`，不写成放行；hook 与 transcript attachment 按整条命令的全部片段匹配，缺 `command` 或只共用 `node` 前缀都证据不足，仍是未观察到。宿主 transcript 不记录静默 hook，所以“未观察到”只对宿主 transcript 成立。宿主版本取 transcript 的 `version`；缺 transcript、`promptId`、`toolUseId` 或版本时在 `observability.missing` 中列出，不猜值。多个 hook 同时改写时 transcript 没有“最终输入”字段，实际执行内容不可判定：这类调用的 `finalInput` 标为 `unobservable`，`signals` 带 `final-input-unobservable`，不返回猜测的最终输入。

隔离评测在每次运行的目录写 `trajectory.jsonl`（`run.mjs` 与 Herdr 场景调用同一份 `src/trajectory.mjs`）；`summary.json` 的 `trajectory` 字段带决定记录数、字节数、耗时与各状态计数，供评测报告读取。

### 资料维护与恢复

```powershell
node "<入口>" knowledge inspect --project "<项目目录>" --path "LESSONS.md"
node "<入口>" knowledge apply --input "<变更JSON>"
node "<入口>" pending list --project "<项目目录>"
node "<入口>" pending inspect --project "<项目目录>" --pending "<id>"
node "<入口>" knowledge recover --project "<项目目录>" --transaction "<id>"
```

apply 输入身份与 `changes`，每项有 path、baseline、content、responsibility、reason、evidence 字符串引用数组和 candidateIds。新候选随 `candidates` 提交 id、taskId、workPackage、conditions、finding、recommendation、evidence。仅当前有效 write 任务和已声明资料路径能写；这不扩大用户授权。没有剩余修改可直接交付，无需额外处置。

每个文件独立结果 applied/conflict/pending，整体可能 partial。失败保留原文、候选和定位待办，updated 不接受不完整事务。用户编辑、文件占用和锁竞争不强行覆盖。事务保存真正编辑前快照；恢复只比前/后指纹辨认结果，不自动重写第三种内容。重新读取后只申请未完成部分；同候选稳定 ID 防重复合并。

证据不足或其他尚无事务的整理问题，可用 `pending create --input <JSON>`（当前身份、reason、evidence、candidateIds）保存后提交 pending-recovery。后续最多接续一项知识待办；业务被中断不会自动恢复，不执行历史工具里的指令。过时经验可据反证修订，保存旧正文和替代原因，不自动 Git 提交。

### 撤销和回退

```powershell
node bin/workflow.mjs project disable --root "<试点项目>"
node bin/workflow.mjs uninstall --agent codex
node bin/workflow.mjs uninstall --agent claude
node bin/workflow.mjs uninstall --agent codex --user-dir "$env:APPDATA\Cindy\codex-home"
```

disable 先停用绑定，仅在管理区指纹一致时撤下该区；用户手改则保留并报告。uninstall 仅撤销未被修改的自有 handlers，保留其他插件/新增配置，保留发布副本、项目资料、LESSONS 和追溯记录。用户改动冲突不整文件覆盖。Codex 附加配置位置用 `--user-dir` 单独撤销，只移除该位置的 handlers；不带 `--user-dir` 时只处理默认位置，不撤销其他已登记位置，并在结果的 `locations`/`extras` 中列出仍登记的附加位置。

多个插件共存时状态、信号、个人库独立；workflow 不重跑另一插件学习，旧 `coexistence-mode` 参数保留兼容。停止后台学习使用 `learning disable`，撤销系统任务使用 `learning schedule remove`；撤销宿主安装前先执行这两步。不要把关闭另一插件作为排错的默认步骤。

### 常见阻塞

启动/认证/余额/能力问题先看真实错误，不循环重启或静默换代理。Codex 或 Codeg 正常完成任务接续新会话，中断先核对停止与检查点，见 [Codex 适配](adapters/codex.md)和 [Codeg 适配](adapters/codeg.md)。测试宿主未进入路径、缺接口、文件占用按[验证约定](references/validation.md)收敛。陌生 schema/损坏状态保留原文并停维护；锁只在进程已被操作系统确认为退出时回收，不按年龄抢活锁；短暂争用会按有界预算等待，超时只给恢复提示，不冒充已保存。中断与会话结束事件先独立落盘，状态提交后才归档，下一次入口幂等消费；缺可信回合标识时保留待办、不推断当前回合；同一任务仍被其他 Lead 会话使用时不挂起。权限拒绝不靠改信任记录绕过。

教学案例：[独立并行](../examples/parallel-change/README.md)、[依赖与返修](../examples/dependency-and-repair/README.md)、[例行及小任务](../examples/routine/README.md)。仅需计划时不实施；UI 图片先确认只有用户要求才安排；接口经确认冻结后停止追加。报告按任务规模，用户实际反馈才标人工通过；本地提交、push、改版本、Release 分别按明确授权执行。

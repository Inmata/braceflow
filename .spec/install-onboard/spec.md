---
title: 安装与项目接入
status: active
desc: 分别安装宿主并接入项目；Codex 可按显式配置目录逐位置管理；Claude 用户级子代理与门禁模板随发布副本分发；核心检查通过后才预检执行器，生成命令按字面值传参
code:
  - src/onboard.mjs
  - src/projects.mjs
  - src/install.mjs
  - src/subagents.mjs
  - bin/workflow.mjs
  - src/entry.mjs
  - src/learning-config.mjs
  - src/runner.mjs
related:
  - docs/usage.md
  - docs/learning.md
---
# 安装与项目接入

## 目标

- `install --agent codex|claude` 与 `project onboard --root <目录>` 分别显式执行：安装只登记宿主 hooks，接入只绑定项目并写 AGENTS 管理区。
- Claude Code 把随发布副本分发的只读子代理定义写入用户级 `<configDir>/agents/`，并按名字记录 `managed`、`user`、`deleted` 三种状态。无记录时，内容与发布一致的既有文件（包括用户事先放置、中断重试时已写入但账本尚未更新）认作 `managed`，内容不同则记为 `user`；`managed` 内容等于账本或本次发布即视为未改动并随发布更新，被改或不是普通文件时转为 `user`；`user` 的同名文件即使内容等于发布仍保持 `user`，重装不覆盖也不报冲突；`deleted` 表示用户删除过，安装不补回，文件重新出现时转为 `user`。认作 `managed` 后卸载会移除，但仅当内容仍等于账本记录，其余保留并列出。`doctor` 按同一口径只读判断：文件缺失记 `deleted`，被改或非普通文件记 `user`；新版默认与现有文件不同时只在 `doctor` 和安装回执提示。Codex 不写子代理定义。
- 发布副本包含 `workflow-gate.example.json` 模板，用于项目自行复制为 `workflow-gate.json`；安装器不把它写成任何项目的配置，也不预置业务路径规则。
- `project onboard` 先核对核心接入（宿主安装与版本、目录与 Git 身份、AGENTS 残留管理区）；全部通过才写入，不通过时返回 `status: blocked`、`written: false`，一次列出全部问题及修复命令。
- 核心检查未通过时不读取也不执行个人 `config.json` 或项目 `.workflow/config.json` 指定的执行器；学习报告为 `status: not-run`、`reason: core-blocked`。加 `--skip-learning` 时仍为 `status: skipped`。
- 核心检查通过且未加 `--skip-learning` 时才运行执行器能力预检（不调用模型）。执行器与各执行器路径可在个人配置和项目配置中设置，项目值覆盖个人值。
- 正常接入、重复接入、显式 `--enable-learning` 和 `--skip-learning` 维持既有语义：重复接入保留已有学习开关、计划任务和对齐裁决；显式请求学习而未完整生效时返回 `status: partial`，CLI 退出码为 1。
- 安装、卸载和项目接入先落盘意图再改用户文件；重试按配置前后指纹、`current` 原/新目标和管理区绑定意图收敛，遇到第三种用户内容保留现场待核对。核心接入检查把实际注册缺失、分组 `matcher`、`disableAllHooks` 与配置无法读取一并列为问题，不只核对追溯记录。
- Codex 支持显式传入的附加配置目录（如 Cindy 的 `CODEX_HOME`）：默认 Codex 配置位置保持旧单条权威记录；非默认位置即使先安装也只登记为附加位置，不把“第一个安装的位置”当成权威记录。附加位置按规范化配置文件路径单独登记，互不覆盖；路径按 Windows 大小写与分隔符归一，同一目录只登记一次。`doctor --user-dir` 只报告该位置，不带参数时报告默认位置并列出所有已登记位置及各自状态；只有附加位置时顶层报告默认位置未安装，并在 `locations` 中列出附加位置。`uninstall --user-dir` 只撤销该位置自己登记的 handlers，保留其他插件、用户配置和其他位置；不带参数时只撤销默认位置，不撤销附加位置，并在结果中列出仍登记的附加位置。项目接入的核心安装检查同时遍历默认记录与所有附加位置：只有附加位置且注册完整时不报 `NOT_INSTALLED`，各位置的注册、副本完整性和版本分别核对，修复命令带对应 `--user-dir`。
- 宿主 Hook 事件进入公共流程前由 `entry.hostTool` 只提取工具名与对象参数为 `{name, input}`；形状归一不导入宿主专有工具语义，也不改变各宿主已登记 hooks 的注册、信任与执行范围。
- 给用户或代理的 CLI 命令由 `command()` 生成，可直接粘贴到 Windows PowerShell 5.1 或 PowerShell 7；入口路径和特殊参数使用单引号字面量，空格、单引号、`$`、反引号、分号和 `$(...)` 按原值传入 CLI。5.1 无法原样传递的双引号与空参数改用 `workflow-arg64:` 编码标记，并由生成命令追加 `--workflow-arg64-transport` 开关；CLI 只在带开关时还原，直接手写的同名文本保持字面值。

## 原因

- 旧顺序在汇总核心问题并返回 `blocked` 之前就运行学习预检，项目配置里的 `executorPath` 会在核心接入未获批的情况下被执行。
- 旧命令生成用可展开的双引号包裹特殊参数，`$(...)` 会被 PowerShell 当作子表达式解释。
- context 的 signalUsage 也曾用双引号拼接入口路径；安装路径含 `$HOME` 或 `$(...)` 时，用户照抄提示就会触发展开或执行，现统一改用单引号字面量。
- 传输标记缺少生成侧开关时无法与用户直接输入的同名文本区分；改为只在 command() 实际编码时追加开关，导入入口模块不再改写调用者的 argv。
- Windows PowerShell 5.1 调用原生程序时不转义参数里的双引号并丢弃空参数；单引号字面量只保证 PowerShell 解析层安全，到原生命令行这一步仍会失真，所以这类值需要编码传输。
- 旧安装修复命令手工用双引号拼接插件路径，路径含 `$` 或 `$(...)` 时会被展开甚至执行。

## 验收

- 核心接入失败（如未安装宿主、AGENTS 管理区冲突）时，执行器调用次数为零；显式学习请求只记录 `requested`。
- Claude Code 安装后两个只读子代理定义出现在用户级 `agents/`；未改动的文件随升级更新；手改或同名文件在重装与卸载时都不返回 `conflict` 且内容不变；删除后重装不补回；`uninstall` 只移除未改动的文件；`doctor` 列出每个定义的状态和是否与发布默认不同。发布副本包含 `workflow-gate.example.json`，安装不把它写成项目 `workflow-gate.json`。
- 注册分组带限制性 `matcher`、设置 `disableAllHooks: true`、handler 被修改或配置无法读取时，`onboard`/`doctor` 都不报告已注册；修正配置或重装后恢复。`install`/`uninstall` 在意图落盘后失败时，重试可收敛；用户又写入第三种内容时保留配置与事务待核对。
- 默认 Codex 目录与一个附加目录分别安装后两条记录并存、互不覆盖；空状态先装附加目录、后装默认目录时，默认目录仍成为权威记录，附加目录留在 `extra`；只有附加位置时，无参数 `doctor` 报默认位置未安装并列出附加位置，无参数 `uninstall` 不撤销附加位置并在结果中列出它们。附加目录 `doctor` 只报告该位置，无参数 `doctor` 列出全部已登记位置；撤销附加目录只移除该位置自身的 handlers，其他插件、用户配置和默认位置保持不变；仅含旧单条记录（无论路径）的状态文件仍可 `doctor`/`uninstall`；同一目录不同大小写或分隔符写法不产生第二条记录。只有附加位置且注册完整时 `project onboard` 不报 `NOT_INSTALLED` 并正常继续；附加位置注册缺失、副本不完整或版本不符时同样阻断，修复命令指向该位置。
- 正常接入、重复接入、显式学习启用和 `--skip-learning` 的既有行为与测试通过。
- 真实 `powershell.exe` 5.1 与 `pwsh.exe`（实际可用时分别验证）子进程中，空格、单引号、双引号、美元符号、反引号、子表达式字符、空参数和普通路径按原值往返，不被额外执行；普通路径的生成命令可直接执行。
- 未安装时的安装修复命令由 `command()` 生成；插件路径含 `$`、`$(...)` 或空格时，在真实 shell 中按字面值执行，修复命令里的子表达式不执行。
- 入口路径含 `$HOME`、`$(...)` 或空格时，`command()` 生成的 signal 命令在真实 PowerShell 5.1/7 中按原值执行，并由真实 PostToolUse Hook 识别、接受回执；双引号或未引用位置的 `$`、额外命令、管道和伪造入口仍被拒绝。

## 边界

- 不改变执行器可信范围：仍使用个人配置，项目 `.workflow/config.json` 可覆盖；只是必须等核心检查通过才预检。不新增自动运行项目命令的权限。
- 子代理定义是用户级文件，不纳入 hooks 自有分组；用户改动或删除后，安装器不再写入。真实宿主发现与调用已在本机实测，`effort` 实际下发值未验证。
- `workflow-gate.example.json` 只是随发布副本分发的模板，不预置业务项目的路径规则，也不改变项目配置；项目需自行复制为 `workflow-gate.json` 后维护。
- 不合并 `src/install.mjs`、`src/runner.mjs` 已有的转义写法，也不建立通用命令框架。
- 不自动发现或接管 `Roaming\Cindy` 等 Codex 配置目录，也不修改 Cindy 的 `config.toml`；附加目录必须由用户显式传入。多个 Codex 配置位置共用同一个 `current`，升级需逐位置重新安装，不在安装器内自动批量升级。
- 预检只核对能力，不调用模型。安装副本完整性、宿主 hook 信任和后台复盘的模型调用细节不在本 spec 范围内。
- `task show` 增加 `reviewWaived` 展示与对应帮助文案变化不改变安装、接入、命令生成和参数传输语义。
- `learning digest` 子命令与 `days` 参数只读取学习报告，不改变安装、接入、命令生成和参数传输语义。

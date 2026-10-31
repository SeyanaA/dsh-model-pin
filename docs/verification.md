# 验证记录 · dsh-model-pin 0.1.0

验证时间：2026-11-01（Asia/Shanghai）
环境：macOS（arm64）、DeepSeek Harness Desktop **0.2.1-rc.5**（内部 `@deepseek-ai/*` 包
**0.2.1-rc.3**）、`desktop` profile。

本文件记录插件交付时的实际验证证据，方便日后升级 DSH 后对照复查。命令均在
`/Users/seyana/Desktop/DSH/dsh-model-pin` 或隔离的 `DSH_HOME` 下执行；隔离验证没有写入
真实 `~/.dsh`，也没有动正在运行的 DSH 进程。

## 1. 静态检查

```bash
cd /Users/seyana/Desktop/DSH/dsh-model-pin
node test/run.mjs
# 28 passed, 0 failed (of 28)  →  all dsh-model-pin tests passed
```

覆盖：package.json 清单 / `cordis.patch.yml` 语义 / locale 元数据 / icon / 纯函数 /
host 与 client 静态语法与模块形状 / README 字段覆盖。

## 2. 安装与行状态

```text
plugin_manager install_bundle(target=/Users/seyana/Desktop/DSH/dsh-model-pin)
→ profile package.json: "dsh-model-pin": "link:/Users/seyana/Desktop/DSH/dsh-model-pin"
→ profile dsh.profile.bundles 末位: "dsh-model-pin"
→ node_modules/dsh-model-pin -> ../../../../Desktop/DSH/dsh-model-pin
```

`plugin_manager list_plugins`（共 209 项）中的关键两行：

```json
{"entryId":"include:dsh-model-pin","moduleName":"dsh-model-pin","enabled":true,"fiberPhase":"active","patchId":"dsh-model-pin"}
{"entryId":"include:agent-default-model","moduleName":"@deepseek-ai/dsh-agent-default-model","enabled":false,"fiberPhase":null,"patchId":"agent-default-model"}
```

即：插件行已启用且服务激活；内置默认模型行已禁用，不存在同名服务冲突。
`list_bundles` 中 `dsh-model-pin` 的 `overrides` 为 `["agent-default-model"]`。

## 3. 组合结果（隔离 DSH_HOME，`--dump-config`）

把真实 `desktop` profile 复制为 `/tmp/dsh-e2e/profiles/desktop-copy` 后执行
`DSH_HOME=/tmp/dsh-e2e dsh --profile desktop-copy --dump-config`，得到：

```yaml
# == @deepseek-ai/dsh-base, patched by dsh-model-pin, .../desktop-copy/cordis.patch.yml
- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config: { provider: opencode-go, model: deepseek-v4.1-flash }
  disabled: true
# == dsh-model-pin
- id: dsh-model-pin
  name: dsh-model-pin
  config: { provider: opencode-go, model: deepseek-v4.1-flash, reasoningEffort: max }
```

`agent-default-model` 只有一处、且 `disabled: true`；`dsh-model-pin` 只有一行；共 206 个
entry、无重复 id。`--dump-config-schema` 中该行对应 `$defs/config105`：
`provider`、`model`、`reasoningEffort` 三者都是可选字段（0.1.1 起不再 required，见第 7 节），
且都带 `x-cordis.volatile: true`。

## 4. 运行时行为（隔离 web 实例 + 已认证 RPC）

在隔离副本上启动 web 实例（`--port 0`，仅监听 127.0.0.1），用启动日志里的 token 换
HttpOnly cookie 后调用 Host RPC：

```text
POST /api/session/modelCatalog  →  value.default =
  {"provider":"opencode-go","model":"deepseek-v4.1-flash","reasoningEffort":"max"}
```

这就是替换后的 `agentDefaultModel.currentSelection()` 的真实返回值，也是新会话默认使用
的组合、以及输入框模型选择器展示的默认值。

设置页依赖的 `settings.describe` 里可以找到本插件的配置项（证明
`ctx.configForms.get('dsh-model-pin')` 能拿到 ready 的表单）：

```json
{"ns":"dsh-model-pin","autoGenerate":false,"revision":0,
 "value":{"provider":"opencode-go","model":"deepseek-v4.1-flash","reasoningEffort":"max"},
 "base":{...同上...},"user":{},"applies":"live"}
```

再用与页面完全相同的原子写（`settings.mutate` 三字段 set）验证热更新：

```text
mutate → reasoningEffort: "max" → "high"   ok:true, revision 0→1
session/modelCatalog.default                → {... "reasoningEffort":"high"}   # 无需重启
mutate → 还原 "max"                         ok:true, revision 1→2
session/modelCatalog.default                → {... "reasoningEffort":"max"}
```

即 volatile 字段在 Settings 写入后立即对新会话生效；`saveSelection()` 为空操作的路径
（会话内选择器只改当前会话、不改默认值）由 `node test/run.mjs` 中的
`host: saveSelection never persists the picker choice` 与其代码审查覆盖。

## 5. 浏览器侧

隔离实例的 boot payload 中 77 个 client 模块包含：

```json
{"id":"dsh-model-pin","url":"plugins/??dsh-model-pin/client.js&rev=…",
 "inject":["@deepseek-ai/dsh-client-ui-settings","@deepseek-ai/dsh-api-remotes"]}
```

该 `client.js` 制品由 web 服务器正常下发（28696 B）。也就是说浏览器会加载本插件的
bundle 并向 `settings.section` 注册「模型固定」页面；页面读取的就是第 4 节验证过的
`configForms` 与模型目录。

## 6. 0.1.1 加固后的复验

独立代码审计（3 个 major / 若干 minor）后的修复在**同一套隔离环境**复验：

- **缺字段容错（对应 major「配置写错会拖垮会话服务」）**：`settings.mutate` 把
  `provider` 改成空字符串 → 写入成功；`settings/describe` 仍返回该行（插件仍挂载）；
  `session/modelCatalog` 仍成功返回 `default: {"provider":"","model":"deepseek-v4.1-flash"}`
  ——依赖 `agentDefaultModel` 的 Session controller 没有跟着卸载。恢复 `provider` 后一切复原。
- **schema 不再 required**：`--dump-config-schema` 的 `$defs/config105` 中
  `provider` / `model` / `reasoningEffort` 均为可选（且仍 `x-cordis.volatile: true`）；
  `settings.describe` 返回的表单 schema 中没有 `required` 数组。
- **热更新仍成立**：`settings.mutate` 把 `reasoningEffort` 从 `max` 改成 `high` →
  `session/modelCatalog.default` 立即变为 `high`；再改回 `max`，无需重启。
- **客户端**：boot payload 中本插件模块的 `rev` 由 `0a17caa4d41b` 变为
  `79929bbed9ec`，制品 30603 B 正常下发（含 `formStale` / `notConfigured` 等新文案）。
- `node test/run.mjs`：28/28 通过。

> 运行中的真实 DSH 实例**尚未重启**，它仍加载安装时的 0.1.0 宿主模块（两者机制一致，
> 且 0.1.1 的行为已在隔离实例验证）；重启 DeepSeek Harness 后即为 0.1.1。

## 7. 未验证 / 已知边界

- **设置页的视觉渲染与鼠标操作**：本机没有可用的浏览器自动化，未做截图级验证；
  页面逻辑依赖的 `settings.describe` / `settings.mutate` / `session.modelCatalog`
  三条 Host 通路均已按页面实际调用参数验证。
- **真实 UI 中新建会话**：未通过界面点击创建会话；默认值以 Host 服务返回值（第 4 节）
  与 `agentOptions()` 的代码路径为准。
- **推理强度清空**：`reasoningEffort` 的安装种子（`max`）位于 bundle patch 层；设置页的
  「跟随模型默认」通过写入空字符串覆盖实现（`unset` 会回落到种子值），已在
  `client.js` 与测试中固化。

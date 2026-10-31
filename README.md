# dsh-model-pin · 模型固定

给 [DeepSeek Harness Desktop](https://github.com/deepseek-ai) 用的**新会话默认模型固定**插件：
新开的会话永远从你指定的 `provider` + `model`（可带推理强度）开始；会话内的模型选择器、
`/model` 命令照常可用，但**切换只影响当前会话，不会再改写默认值**。

- **固定**：新会话 / 新对话一律使用你固定下来的供应商与模型；
- **不劫持**：会话内模型选择器与 `/model` 继续可用，只是保存默认那一步变成空操作；
- **可视化配置**：`设置 → 模型固定` 里选供应商、模型、推理强度，保存即生效；
- **热更新**：配置字段是 volatile 的，改完新会话立刻用新值，不用重启 DSH；
- **可回滚**：卸载插件后系统自带的默认模型行为自动恢复。

> A small plugin for DeepSeek Harness Desktop that pins the provider/model used by **newly
> created sessions**. It replaces the built-in `agentDefaultModel` service and turns
> `saveSelection()` into a no-op, so the in-session model picker and `/model` still work
> per session but never rewrite the saved default. See [English](#english).

---

## 目录

- [功能](#功能)
- [为什么需要](#为什么需要)
- [环境要求](#环境要求)
- [安装](#安装)
  - [方式一：让 DSH 里的 Agent 安装（推荐）](#方式一让-dsh-里的-agent-安装推荐)
  - [方式二：手动安装](#方式二手动安装)
- [配置](#配置)
  - [设置页：设置 → 模型固定](#设置页设置--模型固定)
  - [cordis.patch.yml 配置](#cordispatchyml-配置)
- [工作原理](#工作原理)
- [与系统自带模型选择的关系](#与系统自带模型选择的关系)
- [已有会话 / 子代理 / headless 行为](#已有会话--子代理--headless-行为)
- [验证与排查](#验证与排查)
- [卸载与回滚](#卸载与回滚)
- [已知限制](#已知限制)
- [开发与测试](#开发与测试)
- [目录结构](#目录结构)
- [License](#license)

---

## 功能

| 能力 | 说明 |
| --- | --- |
| 固定新会话默认模型 | 新建会话时使用 `设置 → 模型固定` 里保存的 `provider` / `model` |
| 固定推理强度 | 可选 `reasoningEffort`（如 `max`）；留空则跟随模型自身的默认强度 |
| 保留会话内切换 | 会话内模型选择器、`/model` 命令仍然可用，只影响当前会话 |
| 不改写默认 | 会话内切模型不会再写入 profile，不会被下次新建会话继承 |
| 可视化配置 | `设置 → 模型固定` 页读取实时模型目录，提供供应商 / 模型 / 推理强度下拉与保存 |
| 配置即数据 | 固定值就是 profile `cordis.patch.yml` 里 `dsh-model-pin` 行的 `config`，可手工编辑、可版本管理 |
| 热更新 | 配置字段声明为 volatile，保存后新会话立即使用新值，无需重启 DSH |
| 轻量 | 无第三方依赖、不联网、不读会话内容；宿主半边只 register 一个服务与一个配置项 |

## 为什么需要

DSH 自带的默认模型服务是 `@deepseek-ai/dsh-agent-default-model`（总线里的
`agentDefaultModel` 服务）。它的设计目标很直接：给「没有显式指定模型的」新会话一个默认
`provider` + `model`。问题出在它同时把**写入默认值**的入口也暴露给了会话内的模型选择器：

1. 你在对话里用模型选择器 / `/model` 换一次模型，这个选择会**应用到下一轮请求**；
2. 同一路径还会调用 `agentDefaultModel.saveSelection(selection)`，把这个选择**写回 profile**，
   于是它成了以后所有新会话的默认值；
3. 结果就是：临时换一次模型，不知不觉把默认模型也改掉了。想长期固定用某个模型
   （例如本机常用的 `opencode-go / deepseek-v4.1-flash` + `max` 推理强度）时，任何一次临时
   切换都会把它覆盖掉。

但直接禁用模型选择器又不行——临时换一个模型来对比回答，本身是有用的能力。

`dsh-model-pin` 的取舍是：**保留选择器，只把「保存默认」这一步变成空操作**。于是

- 会话内选模型：仍然可用，作用于当前会话；
- 新建会话：永远回到你固定的那一组 `provider` / `model` / `reasoningEffort`。

## 环境要求

- **DeepSeek Harness Desktop ≥ 0.2.0-rc.3**（本插件在 macOS 的 DSH Desktop **0.2.1-rc.5**，
  内部 `@deepseek-ai/*` 包版本 0.2.1-rc.3 的 `desktop` profile 上开发与验证）；
- 插件是纯 JavaScript（ESM），无原生模块、无第三方依赖，macOS / 其它桌面平台通用；
- Node.js ≥ 22（使用 DSH 自带运行时即可，**不需要** `npm install`）；
- 宿主半边把 `@deepseek-ai/cordis` 与 `@deepseek-ai/schemastery` 声明为 peerDependencies，
  由 DSH 自身提供，不会额外安装。

## 安装

> 插件以「本地 bundle」形式安装进 DSH 的 profile（默认 `desktop`）。
> 安装后要**保留插件目录**，不要删除或移动它（profile 通过 `link:` 依赖引用它）。
> 本插件目前不发布到 npm / Release，直接使用本机目录安装。

### 方式一：让 DSH 里的 Agent 安装（推荐）

1. 确认插件目录在本机固定位置，例如：

   ```text
   /Users/seyana/Desktop/DSH/dsh-model-pin
   ```

2. 打开 DeepSeek Harness，新建一个对话，对 Agent 说：

   > 把 `/Users/seyana/Desktop/DSH/dsh-model-pin` 作为本地插件安装到当前 profile。

   Agent 会调用插件管理工具（`plugin_manager` 的 `install_bundle`，target 为该目录绝对路径），
   自动完成依赖链接与 bundle 注册。

3. **完全退出并重新打开** DeepSeek Harness（宿主插件要重启；设置页也要重新加载）。

4. 打开 `设置 → 模型固定`，确认当前固定值。安装种子是：

   | 字段 | 种子值 |
   | --- | --- |
   | `provider` | `opencode-go` |
   | `model` | `deepseek-v4.1-flash` |
   | `reasoningEffort` | `max` |

   改成你要的组合，点 **保存**。

安装成功的标志：`设置` 导航里出现 **模型固定**，打开后能看到「当前固定」与三个下拉框，
新开一个对话时模型选择器默认显示的就是这组模型。

### 方式二：手动安装

适合不想让 Agent 代操作、或需要批量部署的情况。

1. 把插件目录放到固定位置，例如：

   ```text
   ~/.dsh/local-plugins/dsh-model-pin
   ```

2. 编辑 profile 清单 `~/.dsh/profiles/desktop/package.json`（其它 profile 换掉 `desktop`）：

   ```jsonc
   {
     "dependencies": {
       // ……
       "dsh-model-pin": "link:/Users/你的用户名/.dsh/local-plugins/dsh-model-pin"
     },
     "dsh": {
       "profile": {
         "bundles": [
           // ……
           "dsh-model-pin"
         ]
       }
     }
   }
   ```

3. 在 profile 目录安装依赖（任选其一）：

   ```bash
   cd ~/.dsh/profiles/desktop
   pnpm install
   ```

   没有 pnpm 时可用 DSH 自带的那份（macOS 路径示例，版本号可能不同）：

   ```bash
   node "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.cjs" install
   ```

4. 完全退出并重新打开 DeepSeek Harness，然后到 `设置 → 模型固定` 确认 / 修改固定值。

> 安装后会同时发生三件事：插件自身作为 bundle 插入一行 `dsh-model-pin`；插件的 bundle
> patch 会把内置的 `agent-default-model` 行标记为 `disabled`；`agentDefaultModel` 服务改由
> 本插件提供。具体见[工作原理](#工作原理)。

## 配置

固定值有两个入口，写的是同一份数据：profile 的 `cordis.patch.yml` 里 id 为
`dsh-model-pin` 的条目 `config`。

### 设置页：设置 → 模型固定

- **当前固定**：以 `供应商 / 模型 · 推理强度` 展示当前生效的固定值，下面附原始 id；
- **供应商**：来自实时模型目录（当前已配置且可路由的 provider）；
- **模型**：所选供应商下的模型列表；
- **推理强度**：仅当模型声明了推理档位时出现；第一项是 **跟随模型默认**，
  选它表示不使用固定档位，由模型自己的默认强度决定（保存时会把 profile 覆盖写成
  空字符串 `reasoningEffort: ""`，见下面字段表的说明）；
- **保存**：一次性写入 `provider` / `model` /（可选）`reasoningEffort`，保存成功显示「已保存」；
  保存失败会保留错误提示，可重试。

模型目录由宿主实时提供：在 `设置 → 模型` 里新增供应商 / 模型后，重新打开或刷新该页即可出现。
若模型目录读取失败，页面会提示「模型目录读取失败，仍可保存当前值。」——下拉框不完整，
但已保存的值不受影响。

> 页面本身不改写会话内的选择。它写入的是**默认值**，新会话才会使用。

### cordis.patch.yml 配置

插件安装后会向 profile 的 patch 层插入这一行（文件：`~/.dsh/profiles/desktop/cordis.patch.yml`）：

```yaml
- id: dsh-model-pin
  name: 'dsh-model-pin'
  config:
    provider: opencode-go
    model: deepseek-v4.1-flash
    reasoningEffort: max
```

字段表（即插件 `Config` 的 schema）：

| 字段 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `provider` | **是** | `opencode-go`（安装种子） | 供应商路由 id，必须与 `设置 → 模型` 里的 Provider ID 一致（如 `opencode-go`、`deepseek-official`、`deepseek-account`） |
| `model` | **是** | `deepseek-v4.1-flash`（安装种子） | 该供应商下的**模型 id**（不是显示名，如 `deepseek-v4.1-flash`，而不是 `DeepSeek V4.1 Flash`） |
| `reasoningEffort` | 否 | `max`（安装种子）；省略 = 跟随模型默认 | 推理强度 id，取值由模型声明（常见 `off` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`）；写模型不支持的档位会在请求时报错，见[已知限制](#已知限制) |

`reasoningEffort` 的三种写法等价于「不固定推理强度」：

- 整行**省略**该字段；
- 写成**空字符串** `reasoningEffort: ""`；
- 设置页里选 **跟随模型默认**。

> 设置页为什么写空字符串而不是删字段：`dsh-settings` 的 `unset` 语义是「移除本层覆盖」，
> 移除后解析结果会**回落到插件 bundle patch 里的种子值**（`max`），于是「跟随模型默认」
> 反而变成了固定 `max`。写一个空字符串覆盖则留在本层，Host 的 `currentSelection()`
> 会把空值当作「未设置」并省略 `reasoningEffort`，模型才会真正使用自身默认强度。
> 手写 `cordis.patch.yml` 时，省略字段与留空都可以，效果相同。

手工编辑的注意事项：

- `config` 是**整体替换**语义：改这一行时要把需要的字段都写上（`provider` 与 `model`
  必填；`reasoningEffort` 可省略，省略即跟随模型默认）；
- 改完**不需要重启 DSH**——三个字段都是 volatile 的，配置引用会被重新采样，**新会话**立即生效；
- 正在进行的会话不会中途换模型：它在每轮请求开始时已经确定了自己要用的模型。

## 工作原理

本插件在宿主（Node 侧）只有一个很薄的实现，本质上就是「换一个默认模型服务 + 关掉内置那一个」。

### 1. 禁用内置的 `agent-default-model` 行

DSH 的基础 bundle（`@deepseek-ai/dsh-base`）里有一行插件：

```yaml
- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: deepseek-official
    model: deepseek-flash
```

它是 `agentDefaultModel` 服务的提供者。插件的 `cordis.patch.yml` 先按 id 把它 **`disabled`**：

```yaml
- id: agent-default-model
  disabled: true

- insert:
    - id: dsh-model-pin
      name: 'dsh-model-pin'
      config:
        provider: opencode-go
        model: deepseek-v4.1-flash
        reasoningEffort: max
```

同名的服务只能有一个提供者，所以这一步是必须的：内置行关掉之后，`agentDefaultModel`
才由本插件提供，读取的也是本插件的 Config。

### 2. 注册自己的 `agentDefaultModel` 服务

宿主入口 `index.js` 是一个 Cordis `Service` 子类，构造时用服务名 `agentDefaultModel` 注册：

```js
static Config = z.object({
  provider: z.string().required().volatile(),
  model: z.string().required().volatile(),
  reasoningEffort: z.string().volatile(),
})

currentSelection() {
  return normalizeSelection({
    provider: this.config.provider.get(),
    model: this.config.model.get(),
    reasoningEffort: this.config.reasoningEffort.get(),
  })
}
```

`currentSelection()` 与内置实现同签名，因此所有原有调用方（新会话创建、fork、headless
入口、模型目录的 `default` 字段等）都不用改，直接读到固定值。归一化在纯函数
`src/pin.js` 里完成：去空白、`provider` / `model` 必填、空字符串的推理强度视为「未设置」
（不会被当成一个叫 `""` 的档位带进请求）。

### 3. `saveSelection()` 校验后丢弃（不写回）

内置实现会把选择通过 `configEditor` 写回 profile 的 `cordis.patch.yml`；本插件收到保存
请求后只做校验，然后**丢弃**它——既不写 profile，也不改自己的 Config：

```js
async saveSelection(next) {
  const requested = normalizeSelection(next) // 格式错误仍按同类错误抛出
  if (selectionEquals(requested, this.currentSelection())) return
  // 固定值优先：请求被丢弃。当前会话的切换在调用本方法之前就已经生效。
}
```

这条路径正是模型选择器 / `/model` 使用的路径：控制器的顺序是「先对当前会话生效
（`selectForNextRequest`），再调用 `saveSelection()` 尝试持久化默认值」，所以空操作之后
选择器功能完好，只是不再污染默认值。副作用是：即使 profile 没有挂载配置编辑器，
插件也照常工作（不依赖 `configEditor` 服务）。

### 4. volatile 配置 ⇒ 热更新

`provider` / `model` / `reasoningEffort` 都声明为 `.volatile()`：DSH 的配置编辑器改写
`cordis.patch.yml` 后，Cordis 会重新采样这些字段，而不是要求插件卸载重载。因此
「设置页保存 → 新会话使用新值」是即时的；只有插件自身代码改动才需要重启应用。

### 5. 设置页（浏览器侧）

`client.js` 向 `settings.section` 注册一个名为 **模型固定** 的页面：

- 通过 `ctx.remote.session.modelCatalog()` 读取实时模型目录（供应商 / 模型 / 推理档位）；
- 通过 `ctx.configForms.get('dsh-model-pin')` 拿到同一份配置的共享表单，用一次原子
  `mutate` 写入三个字段，因此保存要么全部生效、要么全部不生效；
- 配置不可写（例如部署被设为只读）时页面只读，保存按钮禁用。

## 与系统自带模型选择的关系

| 能力 | 位置 | 安装本插件后 |
| --- | --- | --- |
| 会话内模型选择器 | 输入框旁的模型按钮 | **不变**，仍然可用；只影响当前会话，不再改写默认 |
| `/model` 命令 | 会话命令面板 | **不变**，与模型按钮走同一条选择路径 |
| 默认模型（新会话起点） | 内置 `agentDefaultModel` 服务 | **由本插件接管**，读取 `dsh-model-pin` 的 Config |
| 供应商 / API Key / 模型目录配置 | `设置 → 模型` | **不变**，仍然管理 provider、密钥与模型清单（本插件只读取目录，不写它） |
| 固定默认模型 | —— | **新增** `设置 → 模型固定` |

一句话：**「这次用哪个模型」和「以后默认用哪个模型」被拆成了两件事**。前者还是系统原生
的选择器，后者由本插件独占。

## 已有会话 / 子代理 / headless 行为

- **已有会话**：不受影响。会话自身的模型解析优先使用会话日志里记录的
  `request/header` 配置（以及会话内的待生效选择），只有完全没有路由记录的会话才回落到
  默认服务。所以装插件前开始的对话不会突然换模型，旧会话里切模型也不会影响新会话。
- **新建会话**：使用固定值。`设置 → 模型固定` 保存后，之后新建的会话立即使用新值。
- **会话分支（fork）**：分叉出来的会话会带上源会话的日志，因此继续沿用源会话实际使用的
  模型；插件只负责没有显式路由记录时的兜底值。
- **子代理（subagent）**：子代理会话由宿主按父会话配置创建，不单独读取「默认模型」；
  子代理内也不会出现默认模型选择器。本插件不会让子代理偏离父会话的既有选择。
- **headless 运行**（如 `dsh --profile headless "…"`）：headless 入口同样调用
  `agentDefaultModel.currentSelection()`，因此也会使用固定值。
- **登录后自动选择模型**：如果某个 provider 完全没有可用凭证，宿主可能会走
  「登录后自动挑第一个可用模型并保存默认」的流程；本插件的空操作同样会忽略这次保存，
  固定值保持不变。

## 验证与排查

### 安装成功的标志

1. `设置` 导航里出现 **模型固定**，页面显示「当前固定」与三个下拉框；
2. 新开一个对话，输入框旁的模型选择器默认显示固定值对应的模型名；
3. 在会话内切到另一个模型并发送一轮，然后**新开**一个对话——仍是固定值（说明默认没被改写）。

### 用 plugin_manager 检查

让 Agent 执行 `plugin_manager` 的 `list_plugins`（或在插件管理面板里查看），关注两行：

| `entryId` | 期望 `enabled` | 期望 `fiberPhase` | 含义 |
| --- | --- | --- | --- |
| `dsh-model-pin` | `true` | `active` | 本插件已启用且服务在运行 |
| `agent-default-model` | `false` | `null` | 内置默认模型行已禁用（未加载所以没有 fiber 阶段） |

如果 `dsh-model-pin` 的 `fiberPhase` 是 `failed`：看 DSH 日志（`~/.dsh/logs/`，
或从终端启动 DSH 时的标准错误输出）里的加载错误；`pending` / `loading` 则等它加载完
或重启一次 DSH。若 `agent-default-model` 仍是 `enabled: true`，说明本插件的 bundle patch
没有生效（bundle 未启用或被更高优先级的 patch 层覆盖），两个同名服务会冲突。

### 设置页检查

- 页面提示 **「插件配置当前不可用（请确认 dsh-model-pin 已启用）。」**：宿主半边没起来，
  重启 DSH；确认 profile 的 `dsh.profile.bundles` 里有 `dsh-model-pin`。
- 下拉框一直显示 **「正在读取模型目录…」** 或提示 **「模型目录读取失败，仍可保存当前值。」**：
  模型注册表还没就绪或某个 provider 报错。等几秒重试；仍失败时可直接用
  `cordis.patch.yml` 手填 `provider` / `model`。
- 提示 **「模型目录为空：请先在「设置 → 模型」里配置供应商与模型。」**：这个 profile 还没有
  任何可路由的 provider，先去 `设置 → 模型` 配好（API Key 或 DeepSeek 账号登录），再回到本页。
- 模型目录里**没有**某个新模型：先到 `设置 → 模型` 确认该 provider 已配置、密钥可用。

### 常见问题

**Q：新会话还是旧模型？**
① 确认保存成功（页面出现「已保存」）；② 确认是**新开**的会话，不是旧会话；③ 用
`plugin_manager list_plugins` 看 `agent-default-model` 是否已 `enabled: false`；④ 若 profile
的 `cordis.patch.yml` 里另有 `- id: agent-default-model` 且被显式设置 `disabled: false`，
删掉那条覆盖或改为禁用。

**Q：会话内切模型后，新会话变回了切换的模型？**
说明本插件没有接管到默认服务（`dsh-model-pin` 行未 `active`，或内置行仍启用）。

**Q：提示不支持某个推理强度（`does not support reasoning effort …`）？**
固定值里的 `reasoningEffort` 该模型不支持。到 `设置 → 模型固定` 把它改成
**跟随模型默认**（不写该字段），或选模型声明过的档位。

**Q：保存按钮是灰的 / 保存报错？**
灰的三种原因：没有改动、正在保存、或者当前 profile 的配置只读（页面会显示
「当前 profile 的配置为只读，无法保存。」）。报错时页面会显示「保存失败，请重试」，
检查 profile 目录是否可写、DSH 是否有另一个实例正在占用同一个 profile。

## 卸载与回滚

### 卸载

- 让 Agent 调用 `plugin_manager` 的 `remove_bundle`（target：`dsh-model-pin`）；或
- 手动：从 `~/.dsh/profiles/desktop/package.json` 中删除 `dependencies` 的
  `"dsh-model-pin"` 与 `dsh.profile.bundles` 里的 `"dsh-model-pin"`，再在 profile 目录
  `pnpm install`；
- 然后完全退出并重新打开 DSH。

卸载后：

- 插件插入的 `dsh-model-pin` 行随之消失；
- bundle patch 不再把 `agent-default-model` 标为禁用，**系统自带的默认模型行为自动恢复**；
- profile 里如果之前有 `- id: agent-default-model` 的配置条目，会重新按照它生效；
- 通常还应手动删除 `cordis.patch.yml` 里遗留的 `- id: dsh-model-pin` 条目（如果存在），保持文件干净。

### 回滚到安装前的默认模型

1. 先到 `设置 → 模型固定` 把值改回你想要的默认组合（可选）；
2. 按上面的步骤卸载插件；
3. 如果 profile 的 `cordis.patch.yml` 里没有 `agent-default-model` 条目，可以补一条
   写回你原来的默认值：

   ```yaml
   - id: agent-default-model
     name: '@deepseek-ai/dsh-agent-default-model'
     config:
       provider: deepseek-official
       model: deepseek-flash
   ```

4. 重启 DSH。

> 回滚不会影响已有会话的模型（它们记录在各自会话日志里），也不需要迁移任何数据——
> 插件不保存任何独立状态，所有配置只有 `cordis.patch.yml` 一处。

## 已知限制

- **依赖 DSH 内部契约**：插件按 DSH 内部包 **0.2.1-rc.3** 的
  `@deepseek-ai/dsh-agent-default-model` 服务契约（`currentSelection()` /
  `saveSelection()` 与 `provider` / `model` / `reasoningEffort` 三个 volatile 配置字段）实现。
  DSH 升级时如果官方改了服务名、方法签名或字段语义，插件需要同步适配；升级后请重新验证
  本页的「[验证与排查](#验证与排查)」清单。插件不会主动修改 DSH 自身的安装文件。
- **只影响新会话**：默认值是「会话创建 / 首次请求」时读取的；已经在跑的会话、正在进行的
  一轮请求都不会中途换模型。想让旧会话也用固定值，请新开会话。
- **Config 的 `provider` / `model` 必填**：这两个字段没有默认值兜底（安装种子只是写入 profile
  的初始值）。把 `cordis.patch.yml` 里这两个字段删掉会导致该插件行加载失败，届时默认模型
  服务缺失，新建会话会报错。
- **不校验模型可用性**：插件只做「默认值」这一件事，不检查模型是否存在于目录、凭证是否
  可用。固定到一个已下线 / 未配置密钥的模型时，错误会在真正发起请求时才由供应商适配器报出。
- **推理强度是模型能力**：`reasoningEffort` 的合法取值由模型自己声明；写了模型不支持的档位
  会在请求时报 `UNSUPPORTED_REASONING_EFFORT`。拿不准就留空（跟随模型默认）。
- **同名服务只有一个提供者**：本插件必须与内置 `agent-default-model` 行互斥。若你手工在
  更高优先级的 patch 层把内置行重新启用，两者会争用同一个服务名，需要二选一。
- **设置页依赖模型目录**：Live catalog 读不到时只能显示 / 保存已有值，不能从下拉里挑选
  新模型；此时请直接编辑 `cordis.patch.yml`。

## 开发与测试

```bash
cd /Users/seyana/Desktop/DSH/dsh-model-pin
node test/run.mjs
```

纯 Node ESM、零外部依赖，全部用例应在 **秒级** 完成。测试内容：

- `test/run.mjs`：断言工具 + 用例调度，退出码非 0 表示失败；
- 清单检查：`package.json` 的 `name` / `type` / `exports` / `files` / `dsh.bundle.patch` /
  `dsh.client.platform`，以及 `files[]` 声明的文件都真实存在；
- `cordis.patch.yml` 结构：内置 `agent-default-model` 行被 `disabled`，且插入了带
  `provider` / `model` / `reasoningEffort` 的 `dsh-model-pin` 行；
- locale 元数据：`locale/en.json`、`locale/zh.json` 的 `meta.title` / `meta.description`；
- `icon.svg`：XML 形态合法、体积 < 20KB；
- `src/pin.js` 纯函数：`normalizeSelection` / `selectionEquals` / `describeSelection` 的行为；
- 静态语法检查：把 `index.js` / `client.js` 复制到临时 `.mjs` 后用 `node --check` 校验；
- `client.js` 的依赖约束：除 `require('react')` 外不引入宿主包；
- README 覆盖：`provider` / `model` / `reasoningEffort` 三个 Config 字段都写进文档。

修改宿主代码后需要重启 DSH 才能加载；只改设置页样式/文案时客户端支持热加载
（`pnpm run dev:web` 相关流程由 DSH 自身负责，本插件不引入构建步骤）。

## 目录结构

```text
index.js            宿主半边：agentDefaultModel 服务 + Config（volatile 字段）
src/pin.js          纯函数辅助（选择值归一化 / 比较 / 展示文案），可单独测试
client.js           浏览器半边：设置 → 模型固定 页面（settings.section）
cordis.patch.yml    禁用内置 agent-default-model 行 + 插入 dsh-model-pin 行
package.json        插件清单（dsh.bundle / dsh.client 声明、exports、files）
icon.svg            插件图标
locale/en.json      英文元数据（标题 / 描述）
locale/zh.json      中文元数据（标题 / 描述）
test/               纯 Node 冒烟测试（node test/run.mjs）
.github/workflows/  CI
```

## License

[MIT](./LICENSE) © 2026 SeyanaA

---

## English

A **model-pin** plugin for DeepSeek Harness Desktop (≥ 0.2.0-rc.3). It pins the default
provider/model used by **newly created sessions**.

The built-in `@deepseek-ai/dsh-agent-default-model` service both answers "which model should a
fresh session use?" and persists a selection written back by the in-session picker. That means
a temporary model switch in one conversation silently becomes the default for every future
conversation. This plugin keeps the picker but removes the persistence:

- its bundle patch disables the built-in `agent-default-model` row and inserts a `dsh-model-pin`
  row whose `config` carries `provider`, `model` and an optional `reasoningEffort`;
- the host half registers the same `agentDefaultModel` service name: `currentSelection()` reads
  the plugin config (volatile fields, so edits apply without a restart) and
  `saveSelection()` is a deliberate no-op;
- the client half adds **设置 → 模型固定** (Settings → Model Pin) under the settings navigation,
  reading the live model catalog from the host and writing the shared config atomically.

In-session model switching (the composer model control and `/model`) keeps working for that
session only. Existing sessions, forked sessions and sessions that already logged a request
header keep the model they were using; headless runs and sessions with no logged route use the
pinned default. Uninstalling the bundle restores the built-in default-model behavior.

**Install:** put this directory at a stable path and ask the DSH agent to install it as a local
bundle, then restart DSH:

> “Install `/Users/you/dsh-model-pin` as a local bundle in the current profile.”

The agent calls `plugin_manager` → `install_bundle` with the absolute path. Or add
`"dsh-model-pin": "link:/abs/path/to/dsh-model-pin"` to the profile `dependencies`, append
`"dsh-model-pin"` to `dsh.profile.bundles`, run `pnpm install`, and restart.

**Verify:** `plugin_manager` → `list_plugins` should show `dsh-model-pin` as `enabled: true` and
`fiberPhase: "active"`, and `agent-default-model` as `enabled: false`. Settings → 模型固定 should
open and save. Seed values: `opencode-go` / `deepseek-v4.1-flash` / `max`.

**Test:** `node test/run.mjs` (plain Node ESM, no dependencies).

MIT licensed. Verified on macOS with DSH Desktop 0.2.1-rc.5 (`desktop` profile).

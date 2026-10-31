# dsh-model-pin · 模型固定

[![test](https://github.com/SeyanaA/dsh-model-pin/actions/workflows/test.yml/badge.svg)](https://github.com/SeyanaA/dsh-model-pin/actions/workflows/test.yml)
[![release](https://img.shields.io/github/v/release/SeyanaA/dsh-model-pin)](https://github.com/SeyanaA/dsh-model-pin/releases)
[![license](https://img.shields.io/github/license/SeyanaA/dsh-model-pin)](./LICENSE)

<img src="./docs/icon.png" width="72" height="72" alt="dsh-model-pin 图标">

**GitHub 仓库**：[SeyanaA/dsh-model-pin](https://github.com/SeyanaA/dsh-model-pin) ·
**问题反馈**：[Issues](https://github.com/SeyanaA/dsh-model-pin/issues) ·
**更新日志**：[CHANGELOG](./CHANGELOG.md)

给 [DeepSeek Harness Desktop](https://github.com/deepseek-ai) 用的**新会话默认模型固定**插件：
新开的会话永远从你指定的 `provider` + `model`（可带推理强度）开始；会话内的模型选择器、
`/model` 命令照常可用，但**切换只影响当前会话，不会再改写默认值**。

- **固定**：新会话 / 新对话一律使用你固定下来的供应商与模型；
- **不劫持**：会话内模型选择器与 `/model` 继续可用，只是保存默认那一步变成空操作；
- **可视化配置**：`设置 → 模型固定` 里选供应商、模型、推理强度，保存即生效；
- **热更新**：配置字段是 volatile 的，改完新会话立刻用新值，不用重启 DSH；
- **新模型提醒**：按周期检查你配置的 provider 是否上架了新模型，只在界面上提醒，
  **不自动修改任何模型配置**；
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
- [注册方法（安装到 DSH）](#注册方法安装到-dsh)
  - [方式零：从 GitHub 获取插件目录](#方式零从-github-获取插件目录)
  - [方式一：让 DSH 里的 Agent 注册（推荐）](#方式一让-dsh-里的-agent-注册推荐)
  - [方式二：手动注册](#方式二手动注册)
  - [注册成功的标志](#注册成功的标志)
- [使用方法](#使用方法)
  - [3 分钟上手](#3-分钟上手)
  - [日常使用速查](#日常使用速查)
  - [生效规则](#生效规则)
- [配置](#配置)
  - [设置页：设置 → 模型固定](#设置页设置--模型固定)
  - [cordis.patch.yml 配置](#cordispatchyml-配置)
- [模型检索周期（新模型提醒）](#模型检索周期新模型提醒)
  - [检查什么](#检查什么)
  - [周期](#周期)
  - [只提醒，不改配置](#只提醒不改配置)
  - [提醒出现在哪里](#提醒出现在哪里)
  - [快速跳转（尽力而为）](#快速跳转尽力而为)
  - [状态文件与隐私](#状态文件与隐私)
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
| 新模型提醒 | 按 `modelCheckInterval` 周期检查各 provider 端点是否有你没配置的新模型，在侧边栏 / 官方模型页 / 模型固定页提醒；只提醒，不改配置 |
| 热更新 | 配置字段声明为 volatile，保存后新会话立即使用新值，无需重启 DSH |
| 轻量 | 无第三方依赖、不读会话内容；除按周期访问你**已配置的** provider 端点外不发起其它网络请求 |

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

- **DeepSeek Harness Desktop ≥ 0.2.0-rc.3，且 < 0.3.0**（`engines.dsh` 已限制上界：
  本插件替换核心服务，跨 minor 升级需要重新适配；验证环境为 macOS 的 DSH Desktop
  **0.2.1-rc.5**、内部 `@deepseek-ai/*` 包 0.2.1-rc.3 的 `desktop` profile）；
- 插件是纯 JavaScript（ESM），无原生模块、无第三方依赖，macOS / 其它桌面平台通用；
- Node.js ≥ 22（使用 DSH 自带运行时即可，**不需要** `npm install`）；
- 宿主半边把 `@deepseek-ai/cordis` 与 `@deepseek-ai/schemastery` 声明为 peerDependencies，
  由 DSH 自身提供，不会额外安装。

## 注册方法（安装到 DSH）

> 「注册」指让 DSH 把这个包当作 **profile bundle** 加载：依赖里加 `dsh-model-pin`、
> `dsh.profile.bundles` 里登记它，随后 bundle patch 会自动禁用内置的
> `agent-default-model` 行并插入本插件的行。注册后要**保留插件目录**，不要删除或移动它
> （profile 通过 `link:` 依赖引用它）。本插件不发布到 npm，使用 Git 仓库 / 本地目录注册。

### 方式零：从 GitHub 获取插件目录

```bash
git clone https://github.com/SeyanaA/dsh-model-pin.git ~/.dsh/local-plugins/dsh-model-pin
```

也可以用浏览器下载仓库 ZIP（或 Release 源码包）解压到固定位置，例如
`~/.dsh/local-plugins/dsh-model-pin`。下面两种注册方式都使用这个目录的**绝对路径**。

### 方式一：让 DSH 里的 Agent 注册（推荐）

1. 确认插件目录在本机固定位置，例如：

   ```text
   ~/.dsh/local-plugins/dsh-model-pin
   ```

2. 打开 DeepSeek Harness，新建一个对话，对 Agent 说：

   > 把 `~/.dsh/local-plugins/dsh-model-pin` 作为本地插件注册到当前 profile。

   Agent 会调用插件管理工具（`plugin_manager` 的 `install_bundle`，target 为该目录绝对路径），
   自动完成依赖链接与 bundle 注册。

3. **完全退出并重新打开** DeepSeek Harness（宿主插件要重启；设置页也要重新加载）。

4. 打开 `设置 → 模型固定`，确认当前固定值。注册种子是：

   | 字段 | 种子值 |
   | --- | --- |
   | `provider` | `opencode-go` |
   | `model` | `deepseek-v4.1-flash` |
   | `reasoningEffort` | `max` |
   | `modelCheckInterval` | `7d`（7 天检查一次新模型；可改「手动」） |

   改成你要的组合，点 **保存**。

### 方式二：手动注册

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

> 注册后会同时发生三件事：插件自身作为 bundle 插入一行 `dsh-model-pin`；插件的 bundle
> patch 会把内置的 `agent-default-model` 行标记为 `disabled`；`agentDefaultModel` 服务改由
> 本插件提供。具体见[工作原理](#工作原理)。

### 注册成功的标志

1. `设置` 导航里出现 **模型固定**，打开后能看到「当前固定」「模型检索周期」两张卡片；
2. `plugin_manager` 的 `list_plugins` 中 `dsh-model-pin` 为 `enabled: true` +
   `fiberPhase: active`，内置的 `agent-default-model` 为 `enabled: false`；
3. 新开一个对话，模型选择器默认显示你固定的那组模型。

完整排查步骤见[验证与排查](#验证与排查)。

## 使用方法

注册并重启 DSH 后，这个插件只做两件事：**给新会话固定默认模型** 和 **按周期提醒新模型**。

### 3 分钟上手

1. 打开 `设置 → 模型固定`，在「默认对话模型」卡片里选好 **供应商 / 模型 / 推理强度**，点 **保存**
   （注册种子是 `opencode-go / deepseek-v4.1-flash / max`，通常不用改）。
2. 在同一页的「模型检索周期」卡片里选择检查周期：`1天 / 3天 / 7天 / 14天 / 30天 / 手动`
   （默认 7 天；不想自动检查就选「手动」）。
3. 新开一个对话——输入框旁的模型选择器显示的就是固定值；之后无论你在哪个会话里临时换过
   模型，新会话仍然回到固定值。
4. 有候选新模型时，侧边栏页脚会出现带数字徽标的提醒按钮；点它尝试跳到官方
   `设置 → 模型` 手动抓取，抓完回来点「清除提醒」。

### 日常使用速查

| 我想…… | 怎么做 |
| --- | --- |
| 固定 / 更换新会话的默认模型 | `设置 → 模型固定` → 选供应商 / 模型 / 推理强度 → **保存**（立即生效，新会话使用） |
| 临时用另一个模型聊 | 直接用输入框旁的模型选择器或 `/model`——只影响当前会话，不会改默认值 |
| 调整自动检查周期 | `设置 → 模型固定` →「模型检索周期」下拉，选完立即保存 |
| 立即检查有没有新模型 | 同一张卡片点 **立即检查**（「手动」周期下也可用） |
| 查看最近一次检查结果 | 「模型检索周期」卡片里看上次 / 下次检查时间、各 provider 结果与新增模型列表 |
| 处理新模型提醒 | 侧边栏提醒按钮 → 跳到官方 `设置 → 模型` 手动抓取 → 回来点 **清除提醒** |
| 在官方模型配置页处理 | 官方 `设置 → 模型` 页脚也会出现「模型固定：发现 N 个新模型」提示卡，可直接再次检查 / 清除提醒 |
| 直接改配置文件 | 改 profile `cordis.patch.yml` 里 `dsh-model-pin` 行的 `config`（字段见[配置](#配置)） |

> 提醒只告诉你「哪些模型在端点上存在、但你的模型目录里没有」。它**不会**替你添加模型、改
> API Key / `baseURL`，也不会改你的固定值；真正的抓取与配置始终在官方 `设置 → 模型` 里由你
> 手动完成（见[模型检索周期（新模型提醒）](#模型检索周期新模型提醒)）。

### 生效规则

- **新会话**：使用固定值；在设置页保存后立即生效（volatile 配置，无需重启）。
- **已有会话**：保持它自己记录的模型，不会中途被换；在里面换模型也不会改写默认值。
- **会话分支 / 子代理**：沿用父会话的路由记录；插件只做「没有显式路由时的兜底」。
- **headless**：只有该 profile 也注册了本插件时才使用固定值。
- **模型检索**：插件激活约 8 秒后做第一次检查，之后每 60 秒判断一次是否到期；DSH 关闭期间
  不检查。

更细的配置项与排查方式见下文。

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
  保存失败会保留错误提示，可重试；
- **模型检索周期**：同一页面下方的独立卡片，选择 `1d` / `3d` / `7d` / `14d` / `30d` / `manual`
  并立即保存，同时展示上次 / 下次检查时间、最近结果与新增模型列表；详见
  [模型检索周期（新模型提醒）](#模型检索周期新模型提醒)。

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

| 字段 | 填写建议 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `provider` | **建议填写**（缺失时插件仍加载，但新会话无法发起请求，日志会报错；设置页可补全） | `opencode-go`（安装种子） | 供应商路由 id，必须与 `设置 → 模型` 里的 Provider ID 一致（如 `opencode-go`、`deepseek-official`、`deepseek-account`） |
| `model` | **建议填写**（同上） | `deepseek-v4.1-flash`（安装种子） | 该供应商下的**模型 id**（不是显示名，如 `deepseek-v4.1-flash`，而不是 `DeepSeek V4.1 Flash`） |
| `reasoningEffort` | 否 | `max`（安装种子）；省略 = 跟随模型默认 | 推理强度 id，取值由模型声明（常见 `off` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`）；写模型不支持的档位会在请求时报错，见[已知限制](#已知限制) |
| `modelCheckInterval` | 否 | `7d`（安装种子） | 模型检索周期，可选 `1d` / `3d` / `7d` / `14d` / `30d` / `manual`；`manual` = 不自动检查（「立即检查」仍可用）；未知取值按 `manual` 处理。见[模型检索周期（新模型提醒）](#模型检索周期新模型提醒) |

> `provider` / `model` 在 schema 里**不是** required：把配置写错/写空不会让插件行加载失败，
> 从而也不会连带卸载依赖 `agentDefaultModel` 的会话服务。代价是固定值不完整时，
> 新会话在第一次请求时才会失败并给出错误；此时到 `设置 → 模型固定` 里补全保存即可恢复。

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

- `config` 是**整体替换**语义：改这一行时把需要的字段都写上（强烈建议写全 `provider` 与
  `model`；`reasoningEffort` 可省略，省略即跟随模型默认）；
- 改完**不需要重启 DSH**——配置字段都是 volatile 的，配置引用会被重新采样，**新会话**立即生效；
- 正在进行的会话不会中途换模型：它在每轮请求开始时已经确定了自己要用的模型。

## 模型检索周期（新模型提醒）

> 一句话：按周期去看看「供应商那边有没有上架你还没配置的新模型」，有就在界面上提醒你。
> **它只提醒，永远不会自己改你的模型配置。**

### 检查什么

- 对每个**已注册**的 provider，按它自己适配器的模型发现能力去问「你现在提供哪些模型」
  （没有配置模型或凭证的 provider 会被跳过并附注）：
  - 适配器自带模型目录的（例如由目录直接描述模型的供应商），直接用适配器已知的目录回答，
    不额外发请求（「已安装目录」型适配器就是这种情况）；
  - 需要访问端点的，用你在 `设置 → 模型` 里已经配好的 `baseURL` / `api` 与保存的密钥去
    查询该端点声明的模型列表；
- 再与**当前模型目录**（`设置 → 模型` 里这个 provider 下已配置的模型清单）对比，只记录
  「端点有、目录里没有」的新模型 id 与显示名；
- 不支持的 provider（适配器没有模型发现能力，例如官方 DeepSeek 账号 / 官方 API 适配器）
  会在结果里标明「该提供商不支持自动检查」；没有配置模型或凭证的 provider 会跳过并附注，
  不会让整次检查失败。

### 周期

在 `设置 → 模型固定` →「模型检索周期」卡片里选择，也可直接改 `cordis.patch.yml` 的
`modelCheckInterval` 字段：

| 取值 | 含义 |
| --- | --- |
| `1d` / `3d` / `7d` / `14d` / `30d` | 每隔对应天数自动检查一次（安装种子 `7d`） |
| `manual` | 不自动检查；想检查时点「立即检查」 |

- 插件激活后约 8 秒先检查一次，之后每 60 秒判断一次是否到期（不是固定每天零点执行）；
- **应用没在运行时不会检查**；界面会按「上次检查时间 + 周期」显示下次自动检查时间；
- 未知取值按 `manual` 处理：打错字不会意外触发自动网络探测。

### 只提醒，不改配置

发现有新模型后，插件只是把「哪个 provider 多了哪些模型」记下来并提醒你。它**不会**：

- 往 `设置 → 模型` 里添加 / 删除模型或供应商；
- 修改 API Key、`baseURL`、`api` 等任何模型配置；
- 修改本插件的 `provider` / `model` / `reasoningEffort` 固定值；
- 替你抓取（fetch）新模型（提醒里的模型只是端点声明的 id / 名称）。

想真正使用新模型，请到官方 `设置 → 模型` 里手动完成抓取 / 添加，然后回到
`设置 → 模型固定` 点「清除提醒」。清除只是把这批新模型标记为「已看过」，不会改动模型目录；
之后端点又出现**不同**的新模型时会重新提醒。

### 提醒出现在哪里

| 位置 | 表现 |
| --- | --- |
| 侧边栏页脚 | 有新模型时出现提醒按钮，带数量徽标；点击尝试跳到官方 `设置 → 模型` |
| 官方 `设置 → 模型` 页脚 | 出现「模型固定：发现 N 个新模型」提示卡，附 provider / 模型列表，可立即再次检查或清除提醒 |
| `设置 → 模型固定` | 「模型检索周期」卡片展示上次 / 下次检查时间、最近一次结果与新增模型列表，并提供「立即检查」「前往 设置 → 模型」「清除提醒」 |

三处读的是同一份提醒状态（来自宿主的 `GET /api/dsh-model-pin/status`），任何一处清除提醒，
另外两处也会随之收起。

### 快速跳转（尽力而为）

DSH 0.2.1 没有公开的「打开某个设置页」API，所以「前往 设置 → 模型」是**尽力而为的界面
导航**：先触发官方设置入口（侧边栏设置按钮，找不到时尝试设置快捷键），再在设置导航里找到
「模型」这一行并点击（标签优先取官方 `settings.models` 的本地化文本，找不到时回退到
「模型」/「Models」）。如果 DSH 后续版本改了设置界面结构导致跳转失败，界面会提示
「请手动打开 设置 → 模型」，提醒本身仍然有效。

### 状态文件与隐私

- **状态文件**：`$DSH_HOME/dsh-model-pin/state.json`；未设置 `DSH_HOME` 时即
  `~/.dsh/dsh-model-pin/state.json`（DSH 数据目录）。内容只有上次检查时间、各 provider 的
  检查结果 / 新增模型 id、已清除提醒的指纹，**不含密钥、不含对话内容**，文件权限为仅当前
  用户可读写（0600）；
- 写入采用原子替换（临时文件 + rename）；文件损坏或目录不可写时插件继续工作，只是提醒
  状态可能重置；
- **网络范围**：只访问你**已经在 `设置 → 模型` 里配置过的** provider 端点（沿用你自己保存的
  API Key / 账号凭证），或由适配器直接回答的内置模型目录；除此之外不发起任何外部网络
  请求、不上传任何数据、不读取会话内容（固定默认模型那部分仍然只在本地读配置）。

### 本功能的已知限制

- 适配器没有模型发现能力的 provider 无法自动检查，结果里会显示「该提供商不支持自动检查」；
- 需要 DSH 正在运行：调度器随插件激活，应用关闭期间不会检查；
- `manual` 周期不自动检查，只有「立即检查」会真正访问端点；
- 提醒来自「端点模型列表 − 当前模型目录」的差集：端点需要额外权限、离线、响应超时（20 秒）
  或适配器不暴露模型端点时会检查失败，错误会显示在结果里，但不影响模型正常使用；
- 快速跳转依赖 DSH 当前设置界面结构，官方调整 UI 后可能需要手动导航（提醒本身不受影响）。
- 单次检查里「读取当前模型目录」（`llm.listModels`）没有单独超时：极端情况下某个适配器的
  目录读取卡住会让这次检查停住（下一次 60 秒 tick 会跳过它，等它结束），重启应用可恢复；
  端点探测本身有 20 秒超时。

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
- 配置不可写时保存按钮禁用（当前版本 `settings.describe().writable` 恒为 `true`，
  这里只是防御性处理，正常部署不会触发）。

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
- **headless 运行**（如 `dsh --profile headless "…"`）：**如果 headless profile 也安装并
  启用了本插件**，headless 入口会调用 `agentDefaultModel.currentSelection()`，因此同样使用
  固定值；没有安装本插件的 headless profile 仍用系统自带的默认模型行为。
- **登录后自动选择模型**：如果某个 provider 完全没有可用凭证，宿主可能会走
  「登录后自动挑第一个可用模型并保存默认」的流程；本插件的空操作同样会忽略这次保存，
  固定值保持不变（见[已知限制](#已知限制)）。

## 验证与排查

> 交付时的实测证据（行状态、隔离 `--dump-config`、运行时 `session/modelCatalog` /
> `settings.describe` / `settings.mutate` 结果、client 启动图）见
> [`docs/verification.md`](./docs/verification.md)。

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
**跟随模型默认**（页面会写入空字符串覆盖，等价于不固定强度），或选模型声明过的档位。

**Q：保存按钮是灰的 / 保存报错？**
灰的原因是：没有改动、正在保存、或配置不可写（后者在当前版本恒为可写，只是防御性处理）。
报错时页面会显示「保存失败，请重试」，检查 profile 目录是否可写、DSH 是否有另一个实例
正在占用同一个 profile。

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
> 固定值只有 `cordis.patch.yml` 一处；插件不保存密钥或对话内容，唯一的独立状态是
> `~/.dsh/dsh-model-pin/state.json`（新模型提醒记录），卸载后删除即可。

## 已知限制

- **依赖 DSH 内部契约**：插件按 DSH 内部包 **0.2.1-rc.3** 的
  `@deepseek-ai/dsh-agent-default-model` 服务契约（`currentSelection()` /
  `saveSelection()` 与 `provider` / `model` / `reasoningEffort` 三个 volatile 配置字段）实现。
  DSH 升级时如果官方改了服务名、方法签名或字段语义，插件需要同步适配；升级后请重新验证
  本页的「[验证与排查](#验证与排查)」清单。插件不会主动修改 DSH 自身的安装文件。
  新模型提醒还依赖 `ctx.llm.discoverModels` / `listConfigurableProviders` 的发现能力与
  官方 `settings.models.footer`、`sidebar.footer.action` 插槽；这些内部契约变化时提醒功能
  会降级（不再出现或检查报错），但固定默认模型不受影响。
- **只影响新会话**：默认值是「会话创建 / 首次请求」时读取的；已经在跑的会话、正在进行的
  一轮请求都不会中途换模型。想让旧会话也用固定值，请新开会话。
- **Config 的 `provider` / `model` 建议写全**：这两个字段没有默认值兜底（安装种子只是写入
  profile 的初始值）。缺字段/写错时插件行仍会加载（避免连带卸载会话服务），但
  `currentSelection()` 返回空路由、日志记录一条明确错误，新会话在发起请求时报
  `no provider/model`；到 `设置 → 模型固定` 补全保存即可恢复。
- **插件包更新会带回种子值**：首次安装时固定值来自插件 bundle patch 里的种子
  （`opencode-go` / `deepseek-v4.1-flash` / `max`）。如果你**没有**在设置页保存过，
  更新插件包/重新安装会把固定值重置为新的种子值；只要保存过一次，你的值就在 profile
  的 `cordis.patch.yml` 覆盖层里，包更新不会覆盖它。
- **账号首次登录的自动选模不会生效**：宿主内置的 `initializeDefaultModel()`
  会在「没有任何可用 provider」时把第一个账号模型保存为默认；本插件的空操作会忽略这次
  保存，固定值保持不变（这正是「固定」的含义）。若固定值指向不可用路由，请手动改到可用模型。
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
- `src/model-check.js` 纯函数：`INTERVAL_IDS`（含 `manual`）/ `normalizeIntervalId` /
  `intervalMs` / `diffDiscovered` / `pendingFingerprint` / `nextCheckAt` 的行为；
- `index.js`：三条 `/api/dsh-model-pin/*` 路由、状态文件名与 `version` 字段；
- `client.js`：`settings.models.footer` / `sidebar.footer.action` 注册、三条路由调用、
  `openOfficialModelsSettings` 跳转 helper、`modelCheckInterval` 写入；
- 静态语法检查：把 `index.js` / `client.js` 复制到临时 `.mjs` 后用 `node --check` 校验；
- `client.js` 的依赖约束：除 `require('react')` 外不引入宿主包；
- README 覆盖：`provider` / `model` / `reasoningEffort` / `modelCheckInterval` 四个 Config
  字段都写进文档（含六种周期取值与「只提醒」语义）。

修改宿主代码后需要重启 DSH 才能加载；只改设置页样式/文案时客户端支持热加载
（`pnpm run dev:web` 相关流程由 DSH 自身负责，本插件不引入构建步骤）。

## 目录结构

```text
index.js            宿主半边：agentDefaultModel 服务 + Config（volatile 字段）+ 新模型检查调度器与 HTTP 路由
src/pin.js          纯函数辅助（选择值归一化 / 比较 / 展示文案），可单独测试
src/model-check.js  纯函数辅助（检索周期归一化 / 毫秒映射 / 新增模型 diff / 提醒指纹 / 下次检查时间），可单独测试
client.js           浏览器半边：设置 → 模型固定 页面 + 官方模型页页脚提示 + 侧边栏提醒按钮
cordis.patch.yml    禁用内置 agent-default-model 行 + 插入 dsh-model-pin 行（含 modelCheckInterval 种子）
package.json        插件清单（dsh.bundle / dsh.client 声明、exports、files）
icon.svg            插件图标
locale/en.json      英文元数据（标题 / 描述）
locale/zh.json      中文元数据（标题 / 描述）
docs/               图标预览与交付验证记录（docs/verification.md）
test/               纯 Node 冒烟测试（node test/run.mjs）
.github/workflows/  CI
```

## License

[MIT](./LICENSE) © 2026 SeyanaA

---

## English

A **model-pin** plugin for DeepSeek Harness Desktop (≥ 0.2.0-rc.3). It pins the default
provider/model used by **newly created sessions**.
Repository: <https://github.com/SeyanaA/dsh-model-pin> — clone it with
`git clone https://github.com/SeyanaA/dsh-model-pin.git ~/.dsh/local-plugins/dsh-model-pin`.

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

**New-model reminders (0.2.0):** a `modelCheckInterval` setting (`1d` / `3d` / `7d` / `14d` /
`30d` / `manual`, seeded `7d`) makes the host periodically ask each configured provider endpoint —
through that provider adapter's own model discovery — which models it advertises, compare the
answer with your configured catalog, and remember the difference in
`~/.dsh/dsh-model-pin/state.json`. Reminders show up as a sidebar footer badge, a notice in the
footer of the official Settings → Models page, and in the Model Pin page. The feature is
**reminder-only**: it never adds models, never edits your provider/model configuration and never
fetches anything on your behalf — fetch new models manually in Settings → Models, then dismiss the
reminder. `manual` disables automatic checks while keeping "check now". Checks only contact the
provider endpoints you already configured (using the credentials you stored) plus the adapter's
built-in catalog, and the jump to Settings → Models is best-effort DOM navigation with a manual
fallback.

**Register (install into DSH):** put this directory at a stable path (for example the clone
above) and ask the DSH agent to register it as a local bundle, then restart DSH:

> “Register `~/.dsh/local-plugins/dsh-model-pin` as a local bundle in the current profile.”

The agent calls `plugin_manager` → `install_bundle` with the absolute path. Manual alternative:
add `"dsh-model-pin": "link:/abs/path/to/dsh-model-pin"` to the profile `dependencies`, append
`"dsh-model-pin"` to `dsh.profile.bundles`, run `pnpm install` in the profile directory (or use
DSH's bundled pnpm), and restart. Keep the directory in place afterwards: the profile references
it through a `link:` dependency.

**Use:** `设置 → 模型固定` (Settings → Model Pin) lets you pick the pinned provider/model/effort
and the new-model check interval (`1d`/`3d`/`7d`/`14d`/`30d`/`manual`, seeded `7d`); saves apply
to new sessions immediately. The in-session picker and `/model` keep working for the current
session only. When the periodic check finds models that your catalog lacks, a sidebar badge, a
notice in the official Settings → Models page footer and the Model Pin page show the reminder;
fetch the models manually in Settings → Models, then dismiss the reminder.

**Verify:** `plugin_manager` → `list_plugins` should show `dsh-model-pin` as `enabled: true` and
`fiberPhase: "active"`, and `agent-default-model` as `enabled: false`. Settings → 模型固定 should
open and save. Seed values: `opencode-go` / `deepseek-v4.1-flash` / `max` / `7d`.

**Test:** `node test/run.mjs` (plain Node ESM, no dependencies).

MIT licensed. Verified on macOS with DSH Desktop 0.2.1-rc.5 (`desktop` profile).

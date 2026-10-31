# Changelog

## 0.2.0 — 2026-11-01

新增「模型检索周期（新模型提醒）」：按周期检查各 provider 端点是否上架了新模型，
**只提醒、不自动改任何模型配置**。

### 新功能

- **`modelCheckInterval` 配置字段**（volatile）：`1d` / `3d` / `7d` / `14d` / `30d` /
  `manual`，安装种子 `7d`；`manual` 表示不自动检查（「立即检查」仍然可用），
  未知取值按 `manual` 处理，避免打错字就自动联网探测；
- **模型发现与对比**：按周期遍历已注册且已配置的 provider，用该 provider 适配器自己的
  模型发现能力（`ctx.llm.discoverModels`，目录型适配器直接回答、不额外发请求）查询端点
  声明的模型，再与当前模型目录（`ctx.llm.listModels`）对比，只记录「端点有、目录里没有」
  的新模型 id 与显示名；不支持的 provider 标为「该提供商不支持自动检查」，未配置模型 /
  凭证的 provider 跳过并附注，单个 provider 失败不影响整次检查；
- **调度器**：插件激活后约 8 秒做首次检查，之后每 60 秒判断一次是否到期
  （`manual` 永不自动到期），随插件卸载清理定时器；
- **提醒状态持久化**：`$DSH_HOME/dsh-model-pin/state.json`（默认
  `~/.dsh/dsh-model-pin/state.json`，`version: 1`），记录 `lastCheckAt` / 各 provider 检查
  结果 / 新增模型 / 提醒指纹，原子写入，读写失败不影响插件；
- **同源 HTTP 路由**（宿主 `index.js`）：
  `GET /api/dsh-model-pin/status`、`POST /api/dsh-model-pin/check`、
  `POST /api/dsh-model-pin/dismiss`；POST 要求 `content-type: application/json` 与
  `x-dsh-model-pin-client: 1` 头，并拒绝跨站请求；
- **三处提醒 UI**（`client.js`）：
  - `设置 → 模型固定` 新增「模型检索周期」卡片：周期下拉（立即保存）、上次 / 下次检查时间、
    最近结果与新模型列表、「立即检查」「前往 设置 → 模型」「清除提醒」；
  - 官方 `设置 → 模型` 页脚（`settings.models.footer`）出现新模型提示卡；
  - 侧边栏页脚（`sidebar.footer.action`）出现带数量徽标的提醒按钮；
- **快速跳转**：DSH 0.2.1 没有公开的「打开指定设置页」API，因此
  `openOfficialModelsSettings` 做尽力而为的 DOM 导航（先点官方设置入口，再点「模型」导航行，
  标签经 `ctx.locale.bind('settings.models')('nav')` 解析），失败时提示手动打开
  `设置 → 模型`；
- `package.json`：版本 `0.2.0`，`dsh.client.inject` 增加
  `@deepseek-ai/dsh-client-ui-settings-models`（官方模型页页脚插槽的提供方）；
  `cordis.patch.yml` 种子增加 `modelCheckInterval: 7d`。

### 语义与边界

- **只提醒，不改配置**：检查从不写 provider / model / 凭证，也不改动本插件的固定值；
  新模型需要用户在官方 `设置 → 模型` 里手动抓取后才进入模型目录；「清除提醒」只把当前
  这批新模型标记为已看过（按指纹记录），之后出现不同新模型会重新提醒；
- **网络范围**：只访问用户已经在 `设置 → 模型` 里配置过的 provider 端点（沿用保存的密钥）
  或适配器内置目录，不访问其它地址、不上传数据、不读取会话内容；
- **提醒只在应用运行时产生**：关闭 DSH 期间不检查；`manual` 周期只有手动检查会访问端点。

### 文档与测试

- README：新增「模型检索周期（新模型提醒）」章节（检查内容 / 周期 / 只提醒语义 / 三处提醒 /
  快速跳转与兜底 / 状态文件与隐私 / 本功能限制），配置字段表增加 `modelCheckInterval`，
  功能表与目录结构更新，卸载回滚说明补上状态文件，英文段补充说明；
- `node test/run.mjs`（零依赖）新增断言：`dsh.client.inject` 的官方模型页包、patch 种子
  `modelCheckInterval: 7d`、`src/model-check.js` 动态 import 后的纯函数行为、`index.js` 的
  三条路由与状态文件名 / 版本、`client.js` 的 `settings.models.footer` /
  `sidebar.footer.action` 注册与三条路由 / `openOfficialModelsSettings` / `modelCheckInterval`、
  README 的六种周期取值与「只提醒」措辞；既有 0.1.x 断言全部保留。

### 发布

- **GitHub**：仓库 <https://github.com/SeyanaA/dsh-model-pin>（tag `v0.2.0`，含 Release）；
- README 的「安装」章节重构为 **「注册方法（安装到 DSH）」**：新增从 GitHub 克隆步骤、
  Agent 注册 / 手动注册、注册成功标志；新增 **「使用方法」** 章节（3 分钟上手、日常使用速查、
  生效规则）；
- `package.json` 增加 `repository` / `homepage` / `bugs` / `author` / `keywords`，便于在
  GitHub 与插件生态中检索。

## 0.1.1 — 2026-11-01

交付后加固（独立代码审计 + 运行时验证后的修订，机制不变）。

### 加固

- **配置缺失不再拖垮会话服务**：`provider` / `model` 从 schema 的 required 改为可选。
  原实现里配置写错会让插件行加载失败，而 `agentDefaultModel` 的消费方
  （Session controller）会跟着卸载、整个应用静默降级；现在插件保持挂载，
  `currentSelection()` 返回空路由并记录一次明确错误，设置页可当场补全并保存；
- **启动期诊断**：插件激活时检查固定 `provider` 是否在本部署的 LLM 注册表中；
  不在则输出警告（含修复指引），不再等到第一次新会话请求才失败；
- **`engines.dsh` 收紧到 `>=0.2.0-rc.3 <0.3.0`**：替换的是核心服务，跨 minor 升级
  必须显式适配，不能让 0.3 静默通过兼容检查；
- **`saveSelection()` 不再抛错**：畸形请求直接丢弃，避免给模型选择器路径新增失败点。

### 设置页

- 未固定（配置缺字段）时显示「尚未固定」而不是空标题，并可在页面内直接补全保存；
- 推理强度下拉不再因所选模型没有声明档位而消失：只要当前固定值带推理强度就保留该行，
  从而可以从页面清掉一个陈旧的 `reasoningEffort`；
- 配置读取超时（例如插件行未激活）8 秒后给出明确提示，不再永远停在「正在读取配置…」；
- 样式标签在每次激活时刷新文本，client HMR 后不会残留旧样式。

### 文档

- README：字段表的必填说明改为「建议填写」并说明缺失时的行为；补充「插件包更新会带来
  bundle patch 里的种子值，已通过设置页保存过的值在 profile 覆盖层不受影响」；修正
  headless 适用条件与设置只读说明；`docs/` 纳入发布文件清单；
- 新增 `docs/verification.md`：交付时的实测证据（隔离 `--dump-config`、运行时 RPC、
  `settings.describe` / `settings.mutate` 热更新、client 启动图）。

## 0.1.0 — 2026-11-01

首个版本（本地 bundle）。

### 功能

- **固定新会话默认模型**：宿主半边注册自己的 `agentDefaultModel` 服务，
  `currentSelection()` 从插件 Config 读取 `provider` / `model` / 可选 `reasoningEffort`；
  新会话、fork、headless 等没有显式模型路由的入口统一使用固定值；
- **`saveSelection()` 空操作**：内置的会话内模型选择器与 `/model` 命令仍然可用（只作用于
  当前会话），但不再把选择写回 profile，因此不会改写以后新会话的默认模型；
- **禁用内置行**：`cordis.patch.yml` 把 `@deepseek-ai/dsh-agent-default-model`
  （id `agent-default-model`）标记为 `disabled`，并插入 id 为 `dsh-model-pin` 的插件行，
  避免两个同名服务提供者冲突；
- **volatile 配置热更新**：`provider` / `model` / `reasoningEffort` 均为 volatile 字段，
  配置编辑器改写后新会话立即生效，无需重启 DSH；
- **设置 → 模型固定** 设置页：读取宿主实时模型目录（供应商 / 模型 / 推理档位），
  展示当前固定值，支持供应商 / 模型 / 推理强度下拉与原子保存；推理强度可留空
  （跟随模型默认）；
- **locale 元数据**：中文（模型固定）+ 英文（Model Pin）标题与描述，插件图标 `icon.svg`；
- 安装种子：`provider: opencode-go`、`model: deepseek-v4.1-flash`、`reasoningEffort: max`
  （即安装时本机当前生效的默认组合）。

### 安装与兼容

- 以本地 bundle 安装进 profile（`plugin_manager` → `install_bundle`，target 为插件目录
  绝对路径），安装后需完全退出并重新打开 DSH；
- 适用于 DeepSeek Harness Desktop ≥ 0.2.0-rc.3；在 macOS + DSH Desktop 0.2.1-rc.5
  （`desktop` profile）上验证；
- 宿主半边无第三方依赖，`@deepseek-ai/cordis` / `@deepseek-ai/schemastery` 为 peer 依赖，
  由 DSH 提供。

### 测试

- 纯 Node ESM 冒烟测试 `node test/run.mjs`（零依赖）：清单 / patch / locale / 图标 /
  纯函数 / 静态语法 / README 配置字段覆盖；
- 提供 GitHub Actions CI（Ubuntu + macOS，Node 22）。

# Changelog

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

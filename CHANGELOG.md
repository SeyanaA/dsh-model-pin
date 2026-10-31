# Changelog

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

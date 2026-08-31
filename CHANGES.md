# CHANGES.md — dsh-workspace-manager 改动日志

> 每次修改后更新此文件（时间 / 改动 / 涉及文件 / 验证 / 回退）。详见 SELF-RESCUE.md。

## 2026-08-31 v0.2.1 — 修复 client 加载崩溃（createWebConnectionRpc 未导出）
- **问题**：v0.2.0 的 `client/index.js` 用 `require("@deepseek-ai/dsh-client-connection/client").createWebConnectionRpc`，该函数在 v0.1.1-rc.2 中**源码存在但未导出** → `createWebConnectionRpc is not a function` → 插件加载失败 → DSH web 启动即崩
- **修复**（WorkBuddy 诊断 + 修改，2026-08-31 22:49）：
  1. `client/index.js`：删除错误 require，改用官方 `ctx.connection.rpc`（inject 加 `"connection"`），apply 里做防御性降级（connection 不可用则跳过分区注册，不崩）
  2. `package.json`：v0.2.0 → v0.2.1；删掉未用到的 `@deepseek-ai/dsh-client-runtime` peerDependency（`dsh.client.inject` 里的环境声明保留）
- **涉及文件**：client/index.js（修复前备份 `client/index.js.bak-20260831`）、package.json
- **验证**：node --check client/index.js 通过；`ctx.connection` 服务存在（client-runtime L10315 provide("connection")）
- **回退**：还原 `client/index.js.bak-20260831` + 重启；或按 SELF-RESCUE 第四节整体卸载

## 2026-08-31 v0.2.0 — 新增设置页 UI（含此 bug，勿安装此版）
- client 端：设置页「工作区管理」分区（settings.section 插槽）+ 工作区列表 + 路径输入迁移
- host 端：RPC channel `/workspace-manager`（list/relocate，authority=loopback），重构 relocateCore 供工具与 RPC 共用
- ⚠️ 该版本 client 有 createWebConnectionRpc bug（见上），**任何安装 v0.2.0 都会导致 DSH 启动崩溃**，已被 0.2.1 取代

## 2026-08-31 v0.1.0 — 首次发布（host 工具插件）
- `workspace_relocate` 工具：官方存储写链改工作区路径，校验存在性/防冲突
- npm + GitHub 首次发布

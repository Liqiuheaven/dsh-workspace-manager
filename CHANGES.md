# CHANGES.md — dsh-workspace-manager 改动日志

> 每次修改后更新此文件（时间 / 改动 / 涉及文件 / 验证 / 回退）。详见 SELF-RESCUE.md。

## 2026-08-31 v0.3.0 — 原生目录选择器 + 可选内容复制迁移
- **client**：每行加「浏览…」按钮 → 官方 `ctx.workspaces.pickDirectory()`（Windows 原生对话框，自带新建文件夹）；迁移确认区加「同时复制原目录内容到新路径」勾选（默认不勾）+ 原目录处理单选（保留/改名 .bak/删除）+ 警告文案
- **host**：`relocate` 扩展 `moveFiles` + `oldDirAction`（keep/bak/delete）：预检同名冲突（有则中止并列出，不复制）→ 递归复制（中断自动回滚已复制内容）→ 按策略处理原目录（keep 不动 / bak 改名 .bak / delete 删除）
- **验证**：node --check 双端通过；文件操作冒烟 13/13（复制+keep / 冲突预检中止+目标未覆盖+记录未写 / bak 改名 / delete 删除 / 幂等）
- **涉及文件**：index.js（host 文件操作 + relocateCore 扩展）、client/index.js（浏览/复制选项）
- **回退**：还原 v0.2.1 版本（git 历史 a3b011b 之前）

## 2026-08-31 v0.2.1（再追加）— 修复 UI 迁移不生效（window.confirm 被 iframe 拦截）
- **问题**：方案 A 的 `window.confirm` 迁移提醒在 dsh 沙箱 iframe 中被静默拒绝（返回 false）→ `if (!sure) return` → **点迁移后无反应、不执行、刷新后路径还原**
- **修复**：移除原生 confirm，改**内联两段式确认**（纯 React state）：有会话时点「迁移」→ 按钮变红「⚠️ 确认迁移」+ 行内警告文案 → 再点一次执行；改输入框/点还原取消确认态。iframe 安全
- **验证**：node --check 通过；host RPC 实测正常（HTTP 直调 list/relocate 均成功）；「测试」经 RPC 恢复至 D:\AI_learn\test2
- **附**：Console 报错 `Unchecked runtime.lastError: message port closed` 是浏览器扩展噪音（chrome.runtime API），与插件无关，可忽略

## 2026-08-31 v0.2.1（追加）— 迁移前会话提醒（方案 A）+ 方案 B 评估
- **方案 A**（已实现）：client 端迁移前 `window.confirm` 提醒——有会话时告知「对话将进入未分组，历史记录不丢」；迁移成功后提示会话去向。涉及 client/index.js 的 doRelocate
- **方案 B**（评估，未实施）：`方案B-会话跟随迁移.md`——官方无 cwd 更新通道，硬做需绕过持久层改 `jsonl.zstd` + 同步多个内存态（registry 索引 / session entity / projcache），风险高不建议；中期可调研官方 `dsh-session-log-export` 的导入能力

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

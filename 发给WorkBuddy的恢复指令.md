# 恢复指令 —— 发给 WorkBuddy（或其他 AI）修复 dsh-workspace-manager

> 用法：DSH 崩溃/异常且怀疑与本插件有关时，把下面「📋 指令内容」整段复制发给 WorkBuddy。
> 本文件在运行时插件目录和发布仓库各存一份；崩溃时先看这里，再按 SELF-RESCUE.md 回退。

---

## 📋 指令内容（复制这一段发给 AI）

你是 DSH（DeepSeek Harness）修复工程师。dsh-workspace-manager 插件可能导致 DSH web 启动崩溃或功能异常，请按以下步骤诊断并修复：

**1. 先读文档（都有，别自己瞎猜）**
- `C:\Users\SAM\.dsh\profiles\node_modules\dsh-workspace-manager\SELF-RESCUE.md` —— 自救手册：插件架构、4 个已知故障（症状→根因→修复）、最坏回退、修改规范、版本管理
- 同目录 `CHANGES.md` —— 改动日志（每个版本改了什么）
- 同目录 `方案B-会话跟随迁移.md` —— 方案 B 评估（如涉及）

**2. 看 git 状态与历史（版本管理）**
```powershell
$d = 'C:\Users\SAM\.dsh\profiles\node_modules\dsh-workspace-manager'   # 运行时（dsh 实际加载）
$r = 'D:\AI_learn\deepseek_harness\dsh-workspace-manager'              # 发布仓库（GitHub Liqiuheaven/dsh-workspace-manager）
git -C $d status      # 运行时未提交改动（最近一次改了什么）
git -C $d log --oneline
git -C $d tag         # 可用回退版本：v0.1.0 / v0.2.0 / v0.2.1 / v0.3.0 ...
git -C $r log --oneline   # 发布仓库历史（正式版本）
```

**3. 判断是否回退（最快恢复手段）**
- 若 DSH 起不来且怀疑是最近改动导致 → 回退到上一个发布版本：
```powershell
git -C $d checkout v0.2.1 -- .   # 换成上一个 tag；或 git -C $d checkout -- . 丢弃未提交改动
```
- 若回退后仍起不来 → 整体卸载（SELF-RESCUE 第四节）：注释 `C:\Users\SAM\.dsh\profiles\web\cordis.patch.yml` 的 dsh-workspace-manager insert 段 + 删除运行时目录
- 重启 dsh web，用 **Chrome** 打开 http://127.0.0.1:3080 验证（Edge 打不开 DSH 是已知问题，勿用 Edge 判断）

**4. 如果是新 bug，修复后按规范提交**
- 改前备份：`Copy-Item <文件> <文件>.bak-<日期>`
- 验证：`node --check index.js` / `node --check client/index.js` / JSON 合法性 / node 端可加载（命令见 SELF-RESCUE 第五节）
- 同步运行时 ↔ 发布仓库 → `git add -A && git commit -m "..."` → 打新 tag → 更新 CHANGES.md
- 如需重新发布 npm：`npm publish --registry=https://registry.npmjs.org`（token 在发布仓库 `.npmrc`，勿提交 git）

**5. 已知坑（先查再修）**
- client 端禁止 `require("@deepseek-ai/dsh-client-connection/client").createWebConnectionRpc`（未导出）→ 用 `ctx.connection.rpc`
- client 端禁止 `window.confirm`（沙箱 iframe 拦截）→ 用内联两段式确认
- client 端 inject 必须声明所有用到的服务（slots/connection/workspaces）
- 勿同时用 cordis.patch.yml insert 和 `dsh plugin add`（双挂载→插件树失败）
- 修复完给出：改动摘要 + 验证结果 + 是否需要用户重启

---

## 位置速查

| 内容 | 路径 |
|---|---|
| 运行时插件（git 仓库，tag 可回退） | `C:\Users\SAM\.dsh\profiles\node_modules\dsh-workspace-manager\` |
| 发布仓库（正式 git，GitHub） | `D:\AI_learn\deepseek_harness\dsh-workspace-manager\` |
| 激活配置 | `C:\Users\SAM\.dsh\profiles\web\cordis.patch.yml` |
| 会话/工作区数据 | `C:\Users\SAM\.dsh\storages\`、`C:\Users\SAM\.dsh\sessions\` |
| DSH 本体日志 | 启动终端输出（MCP 子进程 stderr 会透传） |

## 版本 tag 一览（截至 v0.3.0）

- v0.1.0 —— 首发：workspace_relocate 工具
- v0.2.0 —— 设置页 UI（**含 createWebConnectionRpc bug，勿装**）
- v0.2.1 —— 修 UI 加载崩溃 + window.confirm 拦截 + 迁移提醒
- v0.3.0 —— 原生目录选择器 + 可选内容复制迁移（预检冲突/回滚/原目录处理）

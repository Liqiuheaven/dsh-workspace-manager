# dsh-workspace-manager 自救手册（SELF-RESCUE）

> 用途：本插件改动后若导致 DSH web 无法启动/异常，**另一个 AI 或用户凭本手册即可定位、回退或修复**。
> 维护约定：每次改动插件后，必须同步更新本手册 + `CHANGES.md`，并保留修改前备份（`.bak-日期`）。

## 一、插件是什么

DeepSeek Harness 工作区路径管理插件：
- **host 端**：`workspace_relocate` 工具（agent 对话式改路径）+ RPC channel `/workspace-manager`（list / relocate，供 UI 调用）
- **client 端**：设置页「工作区管理」分区（`settings.section` 官方插槽），列出工作区、输入新路径一键迁移
- 迁移走官方 `dsh-storage-domain` durable 写链（先落盘→改内存→广播），不直接编辑 workspace.json

## 二、文件结构与职责

```
dsh-workspace-manager/
├── index.js            # host 端（node）：工具 + RPC channel。inject: [tools, storageDomain, connection]
├── client/index.js     # client 端（浏览器）：设置页分区。inject: [slots, connection]
├── package.json        # version / exports(./client) / dsh.bundle+client 配置
├── cordis.patch.yml    # 安装注册示例（npm 包用）
└── SELF-RESCUE.md / CHANGES.md
```

运行时安装位置：`C:\Users\SAM\.dsh\profiles\node_modules\dsh-workspace-manager\`
激活配置：`C:\Users\SAM\.dsh\profiles\web\cordis.patch.yml`（insert 注册，**勿同时用 `dsh plugin add` 装 bundle——双挂载会插件树失败**）
发布仓库：`D:\AI_learn\deepseek_harness\dsh-workspace-manager\`（GitHub: Liqiuheaven/dsh-workspace-manager，npm: dsh-workspace-manager）

## 三、已知故障与修复（症状 → 根因 → 修复）

### 故障 1：DSH 启动即崩 —— `failed to import loader entry ... createWebConnectionRpc is not a function`（v0.2.0，已修）
- **根因**：client 端 `require("@deepseek-ai/dsh-client-connection/client").createWebConnectionRpc` —— 该函数在包源码中存在但**未导出**（v0.1.1-rc.2 的 `/client` 子路径只导出 AbstractApiClient/RpcId/apply/inject/transportError）→ 取到 undefined → 调用崩 → 插件加载失败
- **修复**：改用官方 `ctx.connection.rpc`（inject 声明 `connection` 服务，apply 里 `rpc = ctx.connection.rpc`），并加防御性降级（connection 不可用则跳过注册，不崩）
- **自查**：client/index.js 头部有"修复记录"注释；备份 `client/index.js.bak-20260831`（修复前原版）

### 故障 2：`cannot get property "xxx" without inject`（启动失败/渲染崩）
- **根因**：client 端读 `ctx.<服务>` 但 `inject` 数组没声明该服务
- **修复**：把服务名加进 `client/index.js` 的 `var inject = [...]`。本插件需要：`slots`（设置页插槽）、`connection`（RPC 调用）

### 故障 3：`No "exports" main defined`（启动失败）
- **根因**：package.json 缺 `main` 或 exports 无 `.` 指向，cordis loader 加载 node 端失败
- **修复**：package.json 必须含 `"main": "index.js"` 和 `"exports": { ".": "./index.js", "./client": "./client/index.js", "./package.json": "./package.json" }`

### 故障 4：双挂载 → 插件树失败
- **根因**：同时用 cordis.patch.yml insert 和 `dsh plugin add`（bundles）注册同一插件
- **修复**：只保留一种注册方式。本机现在用 insert 方式（cordis.patch.yml），**不要**再执行 `dsh plugin --profile web add dsh-workspace-manager`

## 四、最坏情况回退（保证 DSH 能启动）

1. 注释掉 `C:\Users\SAM\.dsh\profiles\web\cordis.patch.yml` 里 `dsh-workspace-manager` 的 insert 段（3 行）
2. 删除目录 `C:\Users\SAM\.dsh\profiles\node_modules\dsh-workspace-manager\`（或重命名加 `.disabled`）
3. 重启 dsh web —— 完全回到未装状态，**不影响任何现有数据**（工作区路径改动在 workspace.json，与插件无关）

## 五、修改规范（每次改动必做）

1. **先备份**：`Copy-Item <要改的文件> <文件>.bak-<日期>`
2. **改完验证**：
   - `node --check client/index.js`（client 语法）
   - `node --check index.js`（host 语法）
   - node 端加载：`node -e "const {createRequire}=require('module'); const r=createRequire('C:/Users/SAM/.dsh/profiles/web/package.json'); const m=r('dsh-workspace-manager'); console.log(Object.keys(m))"`（应含 apply/inject/name）
   - JSON：`node -e "JSON.parse(require('fs').readFileSync('.../package.json','utf8'))"`
3. **同步**：运行时目录 ↔ 发布仓库 `D:\AI_learn\deepseek_harness\dsh-workspace-manager\`
4. **记录**：更新 `CHANGES.md` + 本手册（如果改动涉及故障/架构）
5. **重启验证**：用 Chrome 打开 http://127.0.0.1:3080（Edge 打不开 DSH，已知问题，勿用 Edge 判断）

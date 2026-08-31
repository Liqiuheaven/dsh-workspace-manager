# dsh-workspace-manager

> Workspace path manager for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — safely relocate workspace paths through the official storage write-chain.
> DeepSeek Harness 工作区路径管理插件：通过官方存储写链安全修改工作区注册路径。

The official workspace API has **no "change path" method** (only `list` / `create` / `rename` / `delete` / `insertBefore` / `archiveSession`). When you move a folder, the workspace keeps pointing at the old path and the only official workaround (delete + recreate) loses session grouping. This plugin relocates a workspace's registered path safely — without touching `workspace.json` by hand.

官方 workspace API **没有"修改路径"方法**（只有 list/create/rename/delete/insertBefore/archiveSession）。文件夹被移动后，工作区仍指向旧路径；官方变通做法（删旧建新）会丢失会话分组。本插件安全地修改工作区注册路径——无需手动编辑 `workspace.json`。

## Features / 功能

- **🗂 设置页「工作区管理」分区（v0.2.0）**：列出全部工作区（标题/路径/会话数），手动输入新路径后一键迁移，即时反馈（列表直读 domain 内存，无需重启）
- **`workspace_relocate(workspaceId, newPath, title?)`** — agent 对话式迁移（命令行方式）
- Writes through the official `dsh-storage-domain` durable write-chain (disk → memory → change broadcast)
- Validates the new path with `fs.realpath` (same canonical semantics as official `create`); rejects missing paths, non-directories, and paths/titles already claimed by another workspace
- Preserves `sessionIds` / `createdAt`; only `path` (and optional `title`) + `updatedAt` change
- Host RPC channel `/workspace-manager` (`list` / `relocate`), `authority: loopback` — browser-trust fenced, localhost only

## Install / 安装

```bash
dsh plugin --profile web add dsh-workspace-manager
```

Or local install (dev): copy the package into `~/.dsh/profiles/node_modules/` and add an `insert` entry to `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-workspace-manager
      name: dsh-workspace-manager
```

Restart `dsh web`, then open a **new session** (tools are injected at session creation).

## Usage / 使用

In a new session, tell the agent (or invoke the tool directly):

```
调用 workspace_relocate，把工作区 <id> 的路径改为 <new absolute path>
```

Example response: `changed: true`, new `path`, preserved `sessionIds`.

## How it works / 原理

| Step | Detail |
|---|---|
| 1. Locate domain | `ctx.storageDomain.get("workspace")` — the domain already opened by the official `dsh-workspace` registry |
| 2. Validate path | `fs.realpath` + `stat().isDirectory()` (same canon as official `create`) |
| 3. Guard conflicts | reject a path/title already owned by another workspace |
| 4. Durable update | `table("workspaces").update(id, fn)` — official write-chain: disk first, then memory, then `domain/changed` broadcast |

Never edit `workspace.json` directly — the in-memory domain state would overwrite it.

## Known boundaries / 已知边界

1. **Session cwd is immutable** (no official API). Workspace membership display filters sessions by `session cwd === workspace path`, so historical sessions whose cwd no longer exists fall into **ungrouped** — their logs are not lost.
2. This plugin's write bypasses the official `WorkspaceRegistry` entity snapshot, so any **workspace/session writes** (attach/detach/rename/archive...) made *before a restart* could overwrite the relocation from a stale snapshot. Relocate, then restart — or just avoid other workspace operations until the next restart.
3. **Refresh scope (UI)**: the plugin's own「工作区管理」panel reads the domain in-memory state and refreshes immediately; the official sidebar / file browser may need a **restart** to fully re-index, especially when the new path is far outside the old one (e.g. moved to a parent level).
4. **File browser follows the session cwd**: after migrating, a workspace with **no sessions yet** shows an empty file browser — create a new session in the migrated workspace first, then the (copied) files appear.

## Usage notes / 使用注意

- 迁移只改**工作区注册路径**；「同时复制原目录内容」默认不勾选，勾选后按 预检冲突→复制→原目录处理(保留/.bak/删除) 执行
- 改名（title）与改路径（path）互相独立：改名不影响对话归属，改路径后旧对话在官方列表进入「未分组」（历史不丢）
- 大跨度改路径（如改到原路径上级）后，官方侧边栏/文件栏需**重启**才能完整刷新
- 迁移后文件浏览器以会话 cwd 为准：新工作区空对话时看不到文件，新建对话后可见

## Uninstall / 卸载

```bash
dsh plugin --profile web remove dsh-workspace-manager
```

Local install: comment out the `insert` entry in `cordis.patch.yml` and delete the package directory.

## License

MIT

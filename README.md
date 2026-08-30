# dsh-workspace-manager

> Workspace path manager for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — safely relocate workspace paths through the official storage write-chain.
> DeepSeek Harness 工作区路径管理插件：通过官方存储写链安全修改工作区注册路径。

The official workspace API has **no "change path" method** (only `list` / `create` / `rename` / `delete` / `insertBefore` / `archiveSession`). When you move a folder, the workspace keeps pointing at the old path and the only official workaround (delete + recreate) loses session grouping. This plugin adds a `workspace_relocate` tool that moves a workspace's registered path safely — without touching `workspace.json` by hand.

官方 workspace API **没有"修改路径"方法**（只有 list/create/rename/delete/insertBefore/archiveSession）。文件夹被移动后，工作区仍指向旧路径；官方变通做法（删旧建新）会丢失会话分组。本插件提供 `workspace_relocate` 工具，安全地修改工作区注册路径——无需手动编辑 `workspace.json`。

## Features / 功能

- **`workspace_relocate(workspaceId, newPath, title?)`** — dialog-driven path relocation
- Writes through the official `dsh-storage-domain` durable write-chain (disk → memory → change broadcast), so the GUI reflects the change **immediately** (no restart needed, unlike editing the JSON file)
- Validates the new path with `fs.realpath` (same canonical semantics as official `create`); rejects missing paths, non-directories, and paths/titles already claimed by another workspace
- Preserves `sessionIds` / `createdAt`; only `path` (and optional `title`) + `updatedAt` change
- Host-only plugin: no UI, no client bundle — minimal crash surface

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

## Uninstall / 卸载

```bash
dsh plugin --profile web remove dsh-workspace-manager
```

Local install: comment out the `insert` entry in `cordis.patch.yml` and delete the package directory.

## License

MIT

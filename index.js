/**
 * dsh-workspace-manager —— 工作区路径管理插件（host + client 双端）
 * ==========================================================
 * 背景：官方 workspace API 没有"修改路径"方法（只有 list/create/rename/
 * delete/insertBefore/archiveSession），文件夹挪走/改名后只能手动编辑
 * workspace.json。本插件通过官方 dsh-storage-domain 的 durable 写链
 * （先落盘 → 改内存 → 广播 domain/changed）安全更新 workspace 记录的
 * path 字段，避免绕过 domain 直接改文件导致的内存缓存覆盖。
 *
 * v0.1.0 —— host 工具插件：workspace_relocate（agent 对话式调用）
 * v0.2.0 —— client 端设置页「工作区管理」分区 + RPC channel /workspace-manager
 * v0.3.0 —— 原生目录选择器（client 调官方 pickDirectory）+ 内容迁移：
 *   relocate 可选 moveFiles=true 时，预检同名冲突（有则中止）→ 递归复制到新目录
 *   （中断自动回滚已复制内容）→ 原目录按 oldDirAction 处理（keep/bak/delete）。
 *
 * 已知边界（官方无通道，文档化）：
 *   1. 会话 header 的 cwd 官方不可更新；workspace 的会话展示归属按会话 cwd
 *      与新 path 重新匹配，旧会话可能变为 ungrouped（历史记录不丢）。
 *   2. registry 内存 entity 快照不会跟随外部写入：改动立即落盘并更新
 *      domain 内存，但官方 RPC（GUI 左侧列表）需重启 dsh web 后完整刷新；
 *      本插件 UI 的列表直接读 domain（已更新），故 UI 内即时可见。
 *
 * 卸载：从 profiles/web/cordis.patch.yml 删除 dsh-workspace-manager 行，
 *       再删除本目录。
 */
import { realpath, stat, readdir, mkdir, copyFile, rename, rm } from "node:fs/promises";
import { join, basename } from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";

export const name = "dsh-workspace-manager";
export const inject = ["tools", "storageDomain", "connection"];

// ───────────────────────── 文件操作（内容迁移） ─────────────────────────

/** 递归预检：目标树中与源树同名的条目（冲突路径列表）。目录同名继续深入，文件/混合类型算冲突。 */
async function precheckConflicts(src, dst, conflicts = []) {
  let entries;
  try {
    entries = await readdir(src, { withFileTypes: true });
  } catch {
    return conflicts;
  }
  for (const e of entries) {
    const sp = join(src, e.name);
    const dp = join(dst, e.name);
    let dstStat = null;
    try {
      dstStat = await stat(dp);
    } catch {
      /* 目标无此条目 */
    }
    if (dstStat) {
      if (e.isDirectory() && dstStat.isDirectory()) {
        await precheckConflicts(sp, dp, conflicts);
      } else {
        conflicts.push(dp);
      }
    }
  }
  return conflicts;
}

/** 递归复制（保留目录结构），把创建过的目标路径记入 createdLog 供回滚。 */
async function copyTree(src, dst, createdLog) {
  await mkdir(dst, { recursive: true });
  createdLog.push(dst);
  const entries = await readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const sp = join(src, e.name);
    const dp = join(dst, e.name);
    if (e.isDirectory()) {
      await copyTree(sp, dp, createdLog);
    } else if (e.isFile()) {
      await copyFile(sp, dp);
      createdLog.push(dp);
    }
    // 其他类型（符号链接等）跳过
  }
}

/** 回滚：删除本次复制创建的路径（先深后浅，目录整体删）。 */
async function rollbackCopy(createdLog) {
  const sorted = [...createdLog].sort((a, b) => b.length - a.length);
  for (const p of sorted) {
    try {
      await rm(p, { recursive: true, force: true });
    } catch {
      /* 忽略单点失败 */
    }
  }
}

/** 原目录改名 .bak（已存在则加序号），返回最终名字。 */
async function backupDir(src) {
  const dir = src.slice(0, src.lastIndexOf("\\") === -1 ? src.length : src.lastIndexOf("\\"));
  const base = basename(src);
  let target = join(dir, base + ".bak");
  for (let i = 2; ; i++) {
    try {
      await stat(target);
      target = join(dir, base + ".bak" + i);
    } catch {
      break;
    }
  }
  await rename(src, target);
  return target;
}

// ───────────────────────── 迁移核心逻辑 ─────────────────────────

/**
 * 迁移核心逻辑（工具 execute 与 RPC relocate 共用）。
 * @param table workspace domain 表
 * @param args { workspaceId, newPath, title?, moveFiles?, oldDirAction? }
 */
async function relocateCore(table, args) {
  const workspaceId = String(args.workspaceId ?? "");
  const newPath = String(args.newPath ?? "");
  const title = args.title === undefined ? undefined : String(args.title);
  const moveFiles = args.moveFiles === true || args.moveFiles === "true";
  const oldDirAction = moveFiles ? String(args.oldDirAction ?? "keep") : "keep";
  if (!workspaceId || !newPath) throw new Error("workspaceId 与 newPath 均为必填");

  const current = table.get(workspaceId);
  if (!current) throw new Error(`工作区不存在：${workspaceId}`);
  const oldPath = current.path;

  // 1) 校验新路径存在且为目录，并规范化（同官方 create 的 canonical 语义）
  let canonical;
  try {
    const st = await stat(newPath);
    if (!st.isDirectory()) throw new Error(`不是目录：${newPath}`);
    canonical = await realpath(newPath);
  } catch (error) {
    if (error && error.code === "ENOENT") throw new Error(`路径不存在：${newPath}`);
    throw error;
  }

  // 2) 防冲突：路径被其他工作区占用 / 标题与其他工作区重复 → 拒绝
  for (const [id, record] of table.entries()) {
    if (id === workspaceId) continue;
    if (record.path === canonical) {
      throw new Error(`路径已被工作区占用：${canonical}（workspaceId=${id}）`);
    }
    if (title !== undefined && record.title === title) {
      throw new Error(`标题已被工作区占用：${title}（workspaceId=${id}）`);
    }
  }

  // 3) 无变化则跳过写入（不产生 durable 写）
  if (current.path === canonical && (title === undefined || title === current.title)) {
    return {
      workspaceId,
      path: canonical,
      title: current.title,
      sessionCount: current.sessionIds.length,
      changed: false,
      note: "路径与标题均无变化，未写入"
    };
  }

  // 4) 内容迁移（可选）：预检 → 复制 → 原目录处理
  let fileResult = null;
  if (moveFiles) {
    let oldExists = true;
    try {
      await stat(oldPath);
    } catch {
      oldExists = false;
    }
    if (!oldExists) {
      fileResult = { moved: false, reason: "原目录不存在，跳过内容复制" };
    } else if (canonical === oldPath) {
      fileResult = { moved: false, reason: "新旧路径相同，无需复制" };
    } else {
      // 4a) 预检冲突：有同名冲突则中止（不复制）
      const conflicts = await precheckConflicts(oldPath, canonical);
      if (conflicts.length > 0) {
        const shown = conflicts.slice(0, 10).join("\n");
        throw new Error(
          `新目录存在 ${conflicts.length} 处同名冲突，已中止（未复制任何内容）：\n${shown}${conflicts.length > 10 ? "\n…" : ""}`
        );
      }
      // 4b) 复制（中断自动回滚）
      const createdLog = [];
      try {
        await copyTree(oldPath, canonical, createdLog);
      } catch (error) {
        await rollbackCopy(createdLog);
        throw new Error(`复制中断，已回滚已复制内容：${error instanceof Error ? error.message : String(error)}`);
      }
      // 4c) 原目录处理
      let oldDirResult = { action: "kept", detail: "原目录保留未动" };
      if (oldDirAction === "bak") {
        const bakPath = await backupDir(oldPath);
        oldDirResult = { action: "bak", detail: `原目录已改名为 ${bakPath}` };
      } else if (oldDirAction === "delete") {
        await rm(oldPath, { recursive: true, force: true });
        oldDirResult = { action: "delete", detail: "原目录已删除" };
      }
      fileResult = { moved: true, files: createdLog.filter((p) => !p.endsWith("\\") && !p.endsWith("/") && p !== canonical).length, oldDir: oldDirResult };
    }
  }

  // 5) durable 写链更新（先落盘 → 改内存 → 广播 domain/changed）
  const next = {
    ...current,
    path: canonical,
    ...(title !== undefined ? { title } : {}),
    updatedAt: new Date().toISOString()
  };
  await table.update(workspaceId, () => next);

  return {
    workspaceId,
    path: next.path,
    title: next.title,
    sessionCount: next.sessionIds.length,
    changed: true,
    fileResult,
    note: "已写入磁盘；重启 dsh web 后官方列表完整刷新"
  };
}

// ───────────────────────── 插件 apply ─────────────────────────

export function apply(ctx) {
  // ── v0.1.0 工具：workspace_relocate（agent 对话式）──
  ctx.tools.register(defineTool({
    name: "workspace_relocate",
    description:
      "修改 DeepSeek Harness 工作区（Workspace）的注册目录路径。适用场景：文件夹被移动/改名后，" +
      "工作区仍指向旧路径。会校验新路径存在、防止与其他工作区路径/标题冲突，并通过官方存储写链持久化。" +
      "可选 moveFiles=true 时把原工作区目录内容复制到新目录（预检同名冲突→中止、中断自动回滚）；" +
      "oldDirAction 控制复制后原目录处理：keep（保留，默认）/ bak（改名 .bak）/ delete（删除）。" +
      "注意：改动立即落盘，但官方 GUI 列表需重启 dsh web 后完整刷新；会话历史记录不受影响。",
    parameters: {
      workspaceId: {
        type: "string",
        required: true,
        description: "目标工作区的 id（uuid，形如 6415497b-b38e-4d76-a8dc-4aa082ac4114）"
      },
      newPath: {
        type: "string",
        required: true,
        description: "新目录的绝对路径，必须是已存在的目录"
      },
      title: {
        type: "string",
        description: "可选：同时修改工作区显示标题"
      },
      moveFiles: {
        type: "boolean",
        description: "可选：是否把原工作区目录内容复制到新目录（默认 false）"
      },
      oldDirAction: {
        type: "string",
        enum: ["keep", "bak", "delete"],
        description: "可选：复制后原目录处理（keep/bak/delete，默认 keep；仅 moveFiles=true 时生效）"
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          workspaceId: { type: "string", required: true },
          path: { type: "string", required: true },
          title: { type: "string", required: true },
          sessionCount: { type: "number", required: true },
          changed: { type: "boolean" },
          fileResult: { type: "object", additionalProperties: true },
          note: { type: "string" }
        }
      },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }]
    },
    async execute(args, _exec) {
      const domain = requireDomain(ctx);
      return relocateCore(domain.table("workspaces"), args);
    }
  }));

  // ── v0.2.0 RPC channel：供设置页 UI 调用 ──
  ctx.connection.rpc.handle(
    "/workspace-manager",
    async (endpoint, payload) => {
      const domain = requireDomain(ctx);
      const table = domain.table("workspaces");
      try {
        if (endpoint === "list") {
          const items = [...table.entries()].map(([id, record]) => ({
            workspaceId: id,
            title: record.title,
            path: record.path,
            sessionCount: record.sessionIds.length,
            updatedAt: record.updatedAt
          }));
          const order = domain.global.get().workspaceIds ?? [];
          items.sort((a, b) => order.indexOf(a.workspaceId) - order.indexOf(b.workspaceId));
          return { ok: true, value: { items } };
        }
        if (endpoint === "relocate") {
          const value = await relocateCore(table, payload ?? {});
          return { ok: true, value };
        }
        return {
          ok: false,
          error: { code: "command-error", message: `未知端点：${endpoint}`, details: {} }
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "command-error",
            message: error instanceof Error ? error.message : String(error),
            details: {}
          }
        };
      }
    },
    { authority: "loopback" }
  );
}

/** 取 workspace domain（storageDomain 已由官方 dsh-workspace 打开）。 */
function requireDomain(ctx) {
  const domain = ctx.storageDomain.get("workspace");
  if (!domain) throw new Error("workspace domain 尚未打开（插件加载时序问题）");
  return domain;
}

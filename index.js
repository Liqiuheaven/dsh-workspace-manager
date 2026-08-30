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
 * v0.2.0 —— 新增 client 端：设置页「工作区管理」分区（settings.section 官方
 *   插槽），列表 + 官方目录选择器 + 一键迁移；host 端暴露 RPC channel
 *   /workspace-manager（list / relocate），authority=loopback 只信任本机。
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
import { realpath, stat } from "node:fs/promises";
import { defineTool } from "@deepseek-ai/dsh-tools";

export const name = "dsh-workspace-manager";
export const inject = ["tools", "storageDomain", "connection"];

/** 迁移核心逻辑（工具 execute 与 RPC relocate 共用）。@returns 迁移结果对象 */
async function relocateCore(table, args) {
  const workspaceId = String(args.workspaceId ?? "");
  const newPath = String(args.newPath ?? "");
  const title = args.title === undefined ? undefined : String(args.title);
  if (!workspaceId || !newPath) throw new Error("workspaceId 与 newPath 均为必填");

  const current = table.get(workspaceId);
  if (!current) throw new Error(`工作区不存在：${workspaceId}`);

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

  // 4) durable 写链更新（先落盘 → 改内存 → 广播 domain/changed）
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
    note: "已写入磁盘；重启 dsh web 后官方列表完整刷新"
  };
}

export function apply(ctx) {
  // ── v0.1.0 工具：workspace_relocate（agent 对话式）──
  ctx.tools.register(defineTool({
    name: "workspace_relocate",
    description:
      "修改 DeepSeek Harness 工作区（Workspace）的注册目录路径。适用场景：文件夹被移动/改名后，" +
      "工作区仍指向旧路径。会校验新路径存在、防止与其他工作区路径/标题冲突，并通过官方存储写链持久化。" +
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
          // 按 workspaceIds 全局顺序排序（读 domain.global）
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
          error: {
            code: "command-error",
            message: `未知端点：${endpoint}`,
            details: {}
          }
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

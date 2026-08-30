/**
 * dsh-workspace-manager —— 工作区路径管理工具插件（host 端，无 UI）
 * ==========================================================
 * 背景：官方 workspace API 没有"修改路径"方法（只有 list/create/rename/
 * delete/insertBefore/archiveSession），文件夹挪走/改名后只能手动编辑
 * workspace.json。本插件通过官方 dsh-storage-domain 的 durable 写链
 * （先落盘 → 改内存 → 广播 domain/changed）安全更新 workspace 记录的
 * path 字段，避免绕过 domain 直接改文件导致的内存缓存覆盖。
 *
 * 工具：workspace_relocate
 *   - 校验新路径存在且是目录（fs.realpath 规范化，同官方 create 语义）
 *   - 防重复：新路径已被其他工作区占用 → 拒绝；新标题与其他工作区冲突 → 拒绝
 *   - 保留 sessionIds / createdAt 不变，仅更新 path（及可选 title）与 updatedAt
 *
 * 已知边界（官方无通道，文档化）：
 *   1. 会话 header 的 cwd 官方不可更新；workspace 的会话展示归属按会话 cwd
 *      与新 path 重新匹配，旧会话可能变为 ungrouped（历史记录不丢）。
 *   2. registry 内存 entity 快照不会跟随外部写入：改动立即落盘并更新
 *      domain 内存，但 GUI 列表需重启 dsh web 后完整刷新；重启前避免任何
 *      工作区/会话写操作（旧快照可能回写覆盖）。
 *
 * 卸载：从 profiles/web/cordis.patch.yml 删除 dsh-workspace-manager 行，
 *       再删除本目录。
 */
import { realpath, stat } from "node:fs/promises";
import { defineTool } from "@deepseek-ai/dsh-tools";

export const name = "dsh-workspace-manager";
export const inject = ["tools", "storageDomain"];

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: "workspace_relocate",
    description:
      "修改 DeepSeek Harness 工作区（Workspace）的注册目录路径。适用场景：文件夹被移动/改名后，" +
      "工作区仍指向旧路径。会校验新路径存在、防止与其他工作区路径/标题冲突，并通过官方存储写链持久化。" +
      "注意：改动立即落盘，但 GUI 侧需重启 dsh web 后完整刷新；会话历史记录不受影响。",
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
          sessionIds: { type: "array", required: true, items: { type: "string" } },
          changed: { type: "boolean" },
          note: { type: "string" }
        }
      },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }]
    },
    async execute(args, _exec) {
      const domain = ctx.storageDomain.get("workspace");
      if (!domain) throw new Error("workspace domain 尚未打开（插件加载时序问题）");
      const table = domain.table("workspaces");

      const current = table.get(args.workspaceId);
      if (!current) throw new Error(`工作区不存在：${args.workspaceId}`);

      // 1) 校验新路径存在且为目录，并规范化（同官方 create 的 canonical 语义）
      let canonical;
      try {
        const st = await stat(args.newPath);
        if (!st.isDirectory()) throw new Error(`不是目录：${args.newPath}`);
        canonical = await realpath(args.newPath);
      } catch (error) {
        if (error && error.code === "ENOENT") throw new Error(`路径不存在：${args.newPath}`);
        throw error;
      }

      // 2) 防冲突：路径被其他工作区占用 / 标题与其他工作区重复 → 拒绝
      for (const [id, record] of table.entries()) {
        if (id === args.workspaceId) continue;
        if (record.path === canonical) {
          throw new Error(`路径已被工作区占用：${canonical}（workspaceId=${id}）`);
        }
        if (args.title !== undefined && record.title === args.title) {
          throw new Error(`标题已被工作区占用：${args.title}（workspaceId=${id}）`);
        }
      }

      // 3) 无变化则跳过写入（不产生 durable 写）
      if (
        current.path === canonical &&
        (args.title === undefined || args.title === current.title)
      ) {
        return {
          workspaceId: args.workspaceId,
          path: canonical,
          title: current.title,
          sessionIds: current.sessionIds,
          changed: false,
          note: "路径与标题均无变化，未写入"
        };
      }

      // 4) durable 写链更新（先落盘 → 改内存 → 广播 domain/changed）
      const next = {
        ...current,
        path: canonical,
        ...(args.title !== undefined ? { title: args.title } : {}),
        updatedAt: new Date().toISOString()
      };
      await table.update(args.workspaceId, () => next);

      return {
        workspaceId: args.workspaceId,
        path: next.path,
        title: next.title,
        sessionIds: next.sessionIds,
        changed: true,
        note: "已写入磁盘；请重启 dsh web 使 GUI 完整刷新，重启前避免其他工作区/会话写操作"
      };
    }
  }));
}

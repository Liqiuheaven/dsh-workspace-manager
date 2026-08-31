# 方案 B：会话跟随迁移 —— 粗略实现方案（未实施，仅评估）

> 状态：🟡 未实施·初步评估。目标：迁移工作区路径时，把该工作区下的旧对话**也搬过去**（不再掉进未分组）。
> 结论先行：**官方无通道，实现需绕过持久层直接改会话文件，风险高，不建议实施**。详细技术路径与替代方案如下。

## 一、为什么难：会话归属的底层机制

1. **会话 cwd 固化**：每个会话创建时，header.cwd（工作目录）写入持久化并存入内存 entity，**官方无更新 API**（dsh-session 只在创建时写 cwd）。
2. **动态匹配**：workspace registry 维护 `sessionPaths` 索引（从 sessionPersistence.list() 的 headers 构建，`realpath(header.cwd)` 成功才入索引，失败进 `invalidSessionPaths`）；工作区显示会话 = `record.sessionIds.filter(id => sessionPath(id) === record.path)`。
3. 迁移后：工作区 path 指向新目录，旧会话 cwd 仍是旧目录（已不存在）→ realpath 失败 → 被过滤 → 未分组。**这不是 bug，是 cwd 固化的直接结果。**

## 二、实现路径（若要硬做）

**核心动作：把目标会话 header 的 cwd 改为新路径。** 需要动 3 层：

| 层 | 位置 | 做法 | 风险 |
|---|---|---|---|
| 持久层 | `~/.dsh/sessions/<cwd路径哈希>/session-*.jsonl.zstd`（会话日志文件） | 解压 → 找到 header 记录 → 改 cwd → 重压写回 | ⚠️ zstd 压缩文件，解/压失败 = 会话损坏；文件锁（E4 教训：WorkBuddy/多实例锁文件） |
| 内存索引 | workspace registry 的 `headers` / `sessionPaths` / `invalidSessionPaths` | 改完后需要重新索引（`indexHeaders` 是私有方法，无公开触发） | 不重建 → 展示仍按旧 cwd 过滤，**重启才一致** |
| 会话 entity | dsh-session 的 live session header（如果会话正打开） | 内存 header 也要同步改 | 与持久层不一致 → 下次写日志可能回写旧 cwd |

**结论**：直接改文件 + 多个内存态不同步 = 高风险操作；即使成功，**重启前展示错乱**、重启后会话 id/分组虽保住但**破坏了官方持久层一致性**（官方后续写操作可能基于旧 header 覆盖）。

## 三、替代方案（官方通道，更稳）

1. **官方会话导出/导入**：`dsh-session-log-export`（官方包，会话日志导出）→ 导出旧会话 → 迁移后在新工作区导入。代价：导入生成**新会话 id**，历史引用（链接、归档）断开。需进一步验证该包是否支持 cwd 变更导入。
2. **接受未分组 + 方案 A 提醒**（当前路线）：历史不丢、新对话自动归属，代价是旧对话分组位置变化。
3. **UI 分组覆盖层**（不改底层）：在侧边栏给未分组会话加"临时归组"视图（纯展示层，不动 cwd）。重启/重连后仍按真实 cwd 分组——治标不治本。

## 四、建议

- **短期**：方案 A（已实现）。
- **中期**：调研 `dsh-session-log-export` 的导入能力，如果支持"以新 cwd 重放"，可以做"迁移时可选：旧对话导入新工作区（新 id）"。
- **不做**：直接改 jsonl.zstd 的 cwd 方案（风险/收益不成比例）。

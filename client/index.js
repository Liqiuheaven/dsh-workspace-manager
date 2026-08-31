// dsh-workspace-manager —— client bundle（v0.2.0）
// 设置页「工作区管理」分区：列出全部工作区，手动输入/修改路径后一键迁移。
// 数据与操作走本插件 host 端 RPC channel /workspace-manager（list/relocate），
// 路径存在性/防冲突由 host 校验（复用 workspace_relocate 同一逻辑）。
//
// 说明：官方目录选择器（DirectoryBrowser）是 picker 包的内部组件（未导出），
// 本版采用"路径输入 + host 校验"的安全路线；树形浏览后续版本再评估。
//
// 注意：纯 React.createElement（无 JSX，无编译步骤）；全部内联样式（不注入 CSS）。
window.__ModuleLoader__.load({
  id: "dsh-workspace-manager",
  factory: function (require) {
    var React = require("react");
    var useState = React.useState;
    var useEffect = React.useEffect;
    var useCallback = React.useCallback;

    // 修复记录（2026-08-31）：原代码 require("@deepseek-ai/dsh-client-connection/client")
    // 取 createWebConnectionRpc——该函数在包源码中存在但未导出（v0.1.1-rc.2），
    // 导致 "createWebConnectionRpc is not a function" 插件加载失败、DSH 无法启动。
    // 正确写法：官方客户端已注册名为 "connection" 的服务（含 rpc.call），
    // 在下方 inject 声明依赖后，从 ctx.connection.rpc 取调用器。
    var rpc = null;                              // apply(ctx) 时从 ctx.connection.rpc 注入
    var CHANNEL = "/workspace-manager";

    // 常用根目录快捷填充（用户可自行增改）
    var QUICK_ROOTS = ["D:\\AI_learn\\projects\\", "D:\\AI_learn\\", "D:\\workspace\\"];

    function WorkspaceManagerSection() {
      var itemsState = useState(null);           // null=加载中, []/数组=已加载
      var items = itemsState[0], setItems = itemsState[1];
      var errState = useState("");
      var err = errState[0], setErr = errState[1];
      var busyState = useState(false);
      var busy = busyState[0], setBusy = busyState[1];
      var noticeState = useState(null);          // {ok:boolean, text:string} 成功/信息提示
      var notice = noticeState[0], setNotice = noticeState[1];
      var draftsState = useState({});            // { [workspaceId]: 输入框内容 }
      var drafts = draftsState[0], setDrafts = draftsState[1];

      var load = useCallback(function () {
        setErr(""); setNotice(null);
        rpc.call(CHANNEL, "list", {}).then(function (res) {
          if (res && res.ok) setItems(res.value.items);
          else setErr((res && res.error && res.error.message) || "读取工作区失败");
        }).catch(function (e) {
          setErr(String((e && e.message) || e));
        });
      }, []);

      useEffect(function () {
        load();
      }, [load]);

      function doRelocate(ws, newPath) {
        var path = (newPath || "").trim();
        if (!path) { setErr("路径不能为空"); return; }
        // 迁移前提醒（v0.2.1，方案 A）：有会话时告知会话将进入「未分组」，知情确认
        if (ws.sessionCount > 0) {
          var sure = window.confirm(
            "「" + ws.title + "」有 " + ws.sessionCount + " 个对话。\n\n" +
            "迁移工作区路径后，这些对话将进入「未分组」（历史记录不丢，新对话自动归属新路径）。\n\n" +
            "确定继续迁移？"
          );
          if (!sure) return;
        }
        setBusy(true); setErr(""); setNotice(null);
        rpc.call(CHANNEL, "relocate", { workspaceId: ws.workspaceId, newPath: path }).then(function (res) {
          setBusy(false);
          if (res && res.ok) {
            var v = res.value;
            setNotice({
              ok: true,
              text: (v.changed ? "✅ 已迁移：" : "ℹ️ 无变化：") + v.title + " → " + v.path +
                (v.note ? "（" + v.note + "）" : "") +
                (v.changed && ws.sessionCount > 0 ? "（原 " + ws.sessionCount + " 个对话已进入未分组）" : "")
            });
            setDrafts({});
            load();
          } else {
            setErr((res && res.error && res.error.message) || "迁移失败");
          }
        }).catch(function (e) {
          setBusy(false);
          setErr(String((e && e.message) || e));
        });
      }

      function fillQuick(ws, root) {
        // 取旧路径最后一段作为新目录名：D:\AI_learn\测试 → root + 测试
        var seg = (ws.path || "").split(/[\\/]/).filter(Boolean).pop() || ws.title;
        setDrafts({ ...drafts, [ws.workspaceId]: root + seg });
      }

      var rowStyle = {
        padding: "10px 12px",
        borderBottom: "1px solid #f0f1f5"
      };
      var muted = { fontSize: 12, color: "#8a8f99", marginTop: 2, wordBreak: "break-all" };
      var inputStyle = {
        flex: 1, minWidth: 0,
        border: "1px solid #d9dde3", borderRadius: 8,
        padding: "6px 10px", fontSize: 12,
        fontFamily: "Consolas, monospace"
      };
      var btnStyle = {
        background: "#eef0f5", border: "none", borderRadius: 8,
        padding: "6px 12px", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap"
      };
      var primaryBtn = Object.assign({}, btnStyle, { background: "#3b82f6", color: "#fff" });

      var body;
      if (err) {
        body = React.createElement("div", { style: { padding: 16, color: "#d05c5c", fontSize: 13, lineHeight: 1.6 } },
          "⚠️ " + err,
          React.createElement("div", { style: { marginTop: 8 } },
            React.createElement("button", { onClick: load, style: btnStyle }, "重试")));
      } else if (items === null) {
        body = React.createElement("div", { style: { padding: 16, color: "#8a8f99", fontSize: 13 } }, "加载中…");
      } else if (!items.length) {
        body = React.createElement("div", { style: { padding: 16, color: "#8a8f99", fontSize: 13, lineHeight: 1.8 } },
          "还没有工作区。");
      } else {
        body = items.map(function (ws) {
          var draft = drafts[ws.workspaceId] !== undefined ? drafts[ws.workspaceId] : ws.path;
          return React.createElement("div", { key: ws.workspaceId, style: rowStyle },
            React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 } },
              React.createElement("strong", { style: { fontSize: 13 } }, ws.title),
              React.createElement("span", { style: muted }, ws.sessionCount + " 个会话")),
            React.createElement("div", { style: muted }, "当前路径：" + ws.path),
            React.createElement("div", { style: { display: "flex", gap: 6, marginTop: 8, alignItems: "center" } },
              React.createElement("input", {
                value: draft,
                onChange: function (e) { setDrafts(Object.assign({}, drafts, { [ws.workspaceId]: e.target.value })); },
                style: inputStyle,
                placeholder: "新目录绝对路径"
              }),
              React.createElement("button", {
                onClick: function () { doRelocate(ws, draft); },
                disabled: busy,
                style: primaryBtn
              }, busy ? "…" : "迁移"),
              React.createElement("button", {
                onClick: function () { setDrafts(Object.assign({}, drafts, { [ws.workspaceId]: ws.path })); },
                disabled: busy,
                style: btnStyle
              }, "还原")),
            React.createElement("div", { style: { display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" } },
              QUICK_ROOTS.map(function (root) {
                return React.createElement("button", {
                  key: root,
                  onClick: function () { fillQuick(ws, root); },
                  disabled: busy,
                  style: Object.assign({}, btnStyle, { fontSize: 11, padding: "3px 8px" })
                }, "📁 " + root);
              })));
        });
      }

      return React.createElement("div", { style: { display: "flex", flexDirection: "column", height: "100%" } },
        React.createElement("div", {
          style: {
            padding: "10px 14px", display: "flex", alignItems: "center", gap: 8,
            borderBottom: "1px solid #e4e6eb", fontWeight: 600, fontSize: 13
          }
        },
          "🗂 工作区路径管理",
          React.createElement("button", {
            onClick: load,
            style: Object.assign({}, btnStyle, { marginLeft: "auto" })
          }, "刷新")),
        notice
          ? React.createElement("div", {
              style: {
                margin: "10px 14px 0", padding: "8px 12px", borderRadius: 8, fontSize: 12, lineHeight: 1.5,
                background: notice.ok ? "#e8f5e9" : "#fff8e1", color: notice.ok ? "#2e7d32" : "#8d6e63",
                wordBreak: "break-all"
              }
            }, notice.text)
          : null,
        React.createElement("div", { style: { flex: 1, overflowY: "auto" } }, body));
    }

    // —— 注册设置页分区（settings.section 官方插槽）——
    // 必须声明依赖 "connection" 服务（ctx.connection.rpc 的来源），
    // 与 "slots"（官方设置页插槽服务）并列。
    var inject = ["slots", "connection"];

    function apply(ctx) {
      // 取官方 connection 服务上的通用 RPC 调用器（与 host 端 rpc.handle 配套）
      if (!ctx.connection || !ctx.connection.rpc || typeof ctx.connection.rpc.call !== "function") {
        // connection 服务不可用（版本过旧/未加载）：不注册分区，不影响其他插件
        console.warn("[dsh-workspace-manager] ctx.connection.rpc 不可用，跳过工作区管理分区注册");
        return;
      }
      rpc = ctx.connection.rpc;

      ctx.slots.inject("settings.section", function () {
        return ctx.slots.register({
          name: "settings.section",
          id: "workspace-manager",
          order: 200,
          label: function () { return "工作区管理"; }
        }, WorkspaceManagerSection);
      });
    }

    return { apply: apply, inject: inject };
  }
});

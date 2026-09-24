# xfileviewer

## 新增 Tauri 命令必须同步 ACL 白名单

新增 `#[tauri::command]` 时，三处缺一不可：

1. `src-tauri/src/lib.rs` 的 `tauri::generate_handler![...]` 注册命令；
2. `src-tauri/permissions/shell.toml` 把命令名加进白名单（视频管线相关加到 `allow-video-pipeline`，其余加到 `allow-shell-commands`）；
3. 权限已通过 `src-tauri/capabilities/default.json` 授予 `main` / `video-overlay` 窗口，一般无需改动；若新开窗口 label，要把它加进该文件的 `windows`。

漏掉第 2 步的症状：前端 invoke 报 `Command xxx not allowed by ACL`。改动 permissions/capabilities 后需重新编译 Rust 侧（`cargo check` / 重启 `tauri dev`）才生效。

## 其他约定

项目背景与历史决策记录在 `memory-bank/activeContext.md` 和 `memory-bank/progress.md`，做改动前值得先翻一下。

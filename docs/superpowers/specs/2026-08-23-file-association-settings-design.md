# 设置页：关联文件格式

日期：2026-08-23

## 目标

无文件打开时，从空状态进入设置页，按扩展勾选：把本应用设成该格式的系统默认打开方式，或撤回。覆盖当前已注册的全部扩展（内置图/视频/Markdown + 第三方插件）。

## 决策

- 入口：只在空状态；看文件时没有齿轮
- 形态：点「设置」换成整页，返回再回空状态
- 粒度：按 Kind 分组（图片 / 视频 / 文档），组标题和组内扩展都可勾选；行内显示来源插件名
- 生效：勾选只改草稿，点 Apply 才写入系统
- 勾选状态：以系统查询为准，不是只信 `associations.json`
- `associations.json` 仍记录 granted/denied，避免插件关联确认再弹
- 插件首次打开时的确认对话框保留：仅当该扩展尚无决定时才问

## 架构

空状态与设置页是壳内两种视图，不新开窗口。

- 空状态：现有提示 + 「设置」按钮
- 设置页：顶部「返回」、标题「关联文件格式」、按 Kind 分组的勾选列表、底部 Apply
- Esc 与「返回」都回到空状态
- 扩展来源：`PluginRegistry` 当前注册表（内置 + 已加载插件）
- 系统关联只走 Tauri：查询 / 授予 / 撤回；前端不直接调 `xdg-mime`
- Linux：`xdg-mime query default <mime>` 是否为 `com.xfileviewer.app.desktop`；授予用 `xdg-mime default`；撤回从 `~/.config/mimeapps.list` 的 Default Applications 中去掉本应用对应项
- 非 Linux：只更新 `associations.json`，勾选状态跟 json 的 granted 走

同一 MIME 在系统层只有一个默认程序（如 `.jpg` 与 `.jpeg` 都是 `image/jpeg`）。Apply 后重新查询，列表里同 MIME 的扩展同步显示勾选状态。未点 Apply 就返回则丢弃草稿。

## 组件

- 空状态 / 设置视图切换：`src/main.ts` + `index.html`
- 列表行模型：扩展、插件名、是否已是默认、错误文案（`src/shell/associationSettings.ts`）
- 现有 `associationDecision` / `rememberAssociation` 不变，设置勾选时调用后者
- Registry：列出「扩展 → 插件名」（已有 `pluginFor`，补一个按扩展枚举即可）
- MIME 表：Rust `mime_for_ext` 覆盖全部内置扩展（jpg/jpeg/png/gif/webp/bmp/svg、mp4/webm/mkv/mov/avi、md/markdown）以及已知名插件格式（psd/psb/tif/tiff/heic/avif）。前端 `mimeForExt` 仍只服务视频流，本次不改职责
- Rust 命令：
  - 现有 `grant_file_associations`：补全 MIME 表
  - 新增 `query_file_associations(extensions) -> { ext: bool }`
  - 新增 `revoke_file_associations(extensions)`

## 数据流

无参数启动 → 空状态 → 点设置 → 从 registry 收集扩展并按 Kind 分组 → `query_file_associations` → 渲染草稿列表。

勾选只改草稿。Apply → 对 diff 逐个 `grant_file_associations` / `revoke_file_associations` → `rememberAssociation` → `save_association_settings` → 再 query 刷新（同 MIME 同步）。未 Apply 就返回则丢弃草稿。

打开带 `requestAssociation` 的插件文件：仍用 `associationDecision`；`ask` 才弹窗。设置里勾过的在 granted，不会再问；取消过的在 denied，也不会再问。

## 错误

- `xdg-mime` 查询失败：该扩展视为未关联（未勾选），不阻断整页
- 授予/撤回失败：该行显示简短错误，其它行不受影响
- 查不到 MIME 的扩展仍出现在列表；Apply 时该行显示「无法关联」
- `mimeapps.list` 不存在：撤回视为成功（本就不是默认）

## 测试

纯函数，不测真实 `xdg-mime`：

- 从 registry 生成设置行：排序、插件名、去重
- 查询结果合并到行的勾选状态
- 同 MIME 多扩展：一次授予后，合并结果里相关扩展均为勾选
- `rememberAssociation` 勾选写入 granted、取消写入 denied（现有测试保留并补取消用例）

## 非目标

看文件时进设置、关闭当前文件回到空状态、恢复「取消前」的其它默认程序、Windows/macOS 真实关联、按 Kind 批量勾选、插件清单声明 MIME。

# Progress

- 产品合同：`docs/plans/2026-08-22-001-feat-kind-viewer-shell-plan.md`
- 框架：Kind 注册、Sequence（按类型过滤 + 自然序 + 循环）、PluginRegistry、外部插件加载
- 内置 Viewer：图片、视频（ended 后由壳前进）、Markdown（GFM + KaTeX + Mermaid）
- 壳：可多开（每次双击新进程/新窗口）、左右键、Esc 退出当前窗口、插件关联确认、拖放；系统标题栏显示当前文件名；文档 Kind 记住窗口尺寸、滚轮不翻页
- 图片/视频窗口：适应尺寸（默认）或固定窗口，设置页 + 查看时右上角切换，localStorage 持久化
- 视频：画面 contain 铺满剩余区域，控制条高度计入窗口，无垂直滚动条
- 设置：空状态进入，按 Kind 分组勾选，Apply 后才改系统默认打开方式
- 系统：fileAssociations（含 md/markdown）、asset protocol；允许多进程多开
- 安装：`./install.sh` 每次安装自动升高版本（`max(源码补丁+1, git提交数, 已安装+1)`），写入 package.json / tauri.conf.json / Cargo.toml；空状态与设置页显示 `v…`
- 安装选包：按戳记版本匹配 `*_${version}_*.deb`（rpm：`*-${version}-*.rpm`），找不到则列出目录并失败；同版本 `apt --reinstall`；构建前清理旧 bundle
- 验证：`npm test` 85 passed；适应尺寸缩放保持窗口中心（贴边时夹到工作区内）

未做：图片墙、插件市场、原生解码插件、PlantUML / Markdown 导出。

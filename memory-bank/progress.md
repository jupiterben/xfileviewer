# Progress

- 产品合同：`docs/plans/2026-08-22-001-feat-kind-viewer-shell-plan.md`
- 框架：Kind 注册、Sequence（按类型过滤 + 自然序 + 循环）、PluginRegistry、外部插件加载
- 内置 Viewer：图片、视频（ended 后由壳前进）、Markdown（GFM + KaTeX + Mermaid）
- 壳：单窗口替换、左右键、Esc 退出、插件关联确认、拖放；系统标题栏显示当前文件名；文档 Kind 记住窗口尺寸、滚轮不翻页
- 图片/视频窗口：适应尺寸（默认）或固定窗口，设置页 + 查看时右上角切换，localStorage 持久化
- 视频：画面 contain 铺满剩余区域，控制条高度计入窗口，无垂直滚动条
- 设置：空状态进入，按 Kind 分组勾选，Apply 后才改系统默认打开方式
- 系统：fileAssociations（含 md/markdown）、single-instance、asset protocol
- 安装：`./install.sh`
- 验证：`npm test` 73 passed；`npm run build` 通过

未做：图片墙、插件市场、原生解码插件、PlantUML / Markdown 导出。

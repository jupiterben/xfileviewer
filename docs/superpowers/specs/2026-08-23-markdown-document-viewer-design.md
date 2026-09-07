# Markdown 文档查看器

日期：2026-08-23

## 目标

打开 `.md` / `.markdown` 时用接近 markdown-preview-enhanced 的预览（GFM + KaTeX + Mermaid）。内置插件走现有 Viewer 契约；同时开放 `document` Kind，外部插件也可声明它。

## 决策

- 接入：内置 + `document` Kind 对外开放
- 深度：GFM、代码高亮、KaTeX、Mermaid；不做 PlantUML / TOC / 导出 / 编辑
- 窗口：记住 `document` Kind 上次尺寸；无记录时用 1100×720
- HTML：原样执行（本地文件，不做消毒）

## 架构

- `KIND_DOCUMENT = "document"` 加入 `BUILTIN_KINDS`
- 内置 `builtin-markdown` / viewer `markdown-gfm`，扩展名 `md`、`markdown`
- 渲染在 WebView：`markdown-it`（`html: true`）+ highlight.js + KaTeX + Mermaid
- 正文通过已有 asset `src` `fetch` 读取
- `document` 不调用 `onContentSize` 适配窗口
- 滚轮在文档 Kind 下不翻文件（要能滚正文）；左右键仍切换同目录文档

## 组件

- `src/plugins/markdown/assets.ts`：相对路径是否改写、解析为绝对路径
- `src/plugins/markdown/render.ts`：Markdown → HTML
- `src/plugins/markdownViewer.ts`：`mount()`、资源改写、KaTeX/Mermaid 水合、链接点击
- `src/shell/windowSizes.ts`：按 Kind 记住/取出尺寸
- 壳：`openPath` 时恢复文档窗；`onResized` 防抖写入；Rust `window-sizes.json`

## 数据流

打开 `.md` → kind=`document` → 恢复窗口尺寸 → `fetch(src)` → `renderMarkdown` → `innerHTML` → 改写本地 `img/video/source` → 高亮已在 render 完成 → KaTeX 已在 render 完成 → `mermaid.run` → 点击 `http(s)` 用 opener；`#锚点` 页内跳转

## 错误

- 读文件失败：`onError("无法读取 Markdown")`
- 单块 Mermaid 失败：该块显示错误，不拆整篇
- 空文件：空白预览，不报错

## 非目标

PDF 导出、双向滚动同步、PlantUML、front matter 专用 UI、编辑、本地 `.md` 链接在查看器内打开。

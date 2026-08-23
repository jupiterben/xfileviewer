# 关联文件格式设置页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 空状态进入设置页，按扩展勾选本应用是否为系统默认打开方式。

**Architecture:** 壳内视图切换。Registry 列出扩展；纯函数生成排序行并合并查询结果；Tauri 在 Linux 上 query/grant/revoke（xdg-mime + mimeapps.list），非 Linux 只信 associations.json。

**Tech Stack:** TypeScript、Vitest、Tauri 2、Rust

## Global Constraints

- 只在空状态进设置；看文件时无入口
- 每个扩展单独勾选，按 Kind 分组；点 Apply 才生效
- Linux 勾选状态以系统查询为准；同一 MIME 的扩展同步
- 查不到 MIME 的扩展仍列出，勾选失败显示「无法关联」
- 插件首次确认对话框保留

---

### Task 1: Registry 列出扩展与插件名

**Files:**
- Modify: `src/core/registry.ts`
- Test: `src/core/registry.test.ts`

**Interfaces:**
- Produces: `PluginRegistry.extensionsWithPlugins(): { ext: string; pluginName: string }[]`

- [ ] 失败测试：注册后能列出扩展与插件显示名
- [ ] 实现 `extensionsWithPlugins`
- [ ] 测试通过

### Task 2: 设置行纯函数

**Files:**
- Create: `src/shell/associationSettings.ts`
- Test: `src/shell/associationSettings.test.ts`
- Modify: `src/shell/associations.test.ts`

**Interfaces:**
- Produces:
  - `AssociationRow { ext, pluginName, granted, error?: string }`
  - `buildAssociationRows(entries): AssociationRow[]`（小写、去重、按 ext 排序、granted=false）
  - `mergeAssociationState(rows, queried, settings, osManaged): AssociationRow[]`
  - `setAssociationRowError(rows, ext, error): AssociationRow[]`
- Consumes: `AssociationSettings`

- [ ] 测试：排序/去重、osManaged 用 queried、非 os 用 settings.granted、同 MIME 查询结果同步、行内错误、remember 取消写入 denied
- [ ] 实现
- [ ] 测试通过

### Task 3: Rust 查询/授予/撤回

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces:
  - `query_file_associations(extensions) -> { osManaged: bool, granted: { ext: bool } }`
  - `grant_file_associations` 补全 MIME；未知 MIME 返回错误
  - `revoke_file_associations(extensions)`
- MIME 覆盖内置全部扩展 + psd/psb/tif/tiff/heic/avif
- Desktop id: `com.xfileviewer.app.desktop`
- 撤回：改 `mimeapps.list` 的 `[Default Applications]`，文件不存在视为成功

- [ ] 实现命令并注册
- [ ] `cargo check`

### Task 4: 空状态与设置页 UI

**Files:**
- Modify: `index.html`, `src/styles.css`, `src/main.ts`

- [ ] 空状态加「设置」；设置页返回/标题/勾选列表；Esc 返回
- [ ] 打开设置：registry → query → merge → 渲染
- [ ] 勾选：grant/revoke → remember → save → 再 query 刷新；失败写「无法关联」或命令错误
- [ ] `npm test`、`npm run build`、`cargo check`

## Spec coverage

入口/整页切换/按扩展勾选/即生效/系统查询/json 记忆/插件确认/MIME 同步/未知 MIME/非 Linux/错误行 — 均有对应任务。

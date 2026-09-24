# Active Context

Tauri ACL：本项目前端可调用的自定义命令是白名单制。新增 `#[tauri::command]` 后，除了在 `src-tauri/src/lib.rs` 的 `invoke_handler` 注册，还必须把命令名加进 `src-tauri/permissions/shell.toml`（视频相关放 `allow-video-pipeline`，其余放 `allow-shell-commands`；权限本身已在 `src-tauri/capabilities/default.json` 授予 main / video-overlay 窗口）。漏加会报 `Command xxx not allowed by ACL`，改完需重新编译 Rust 侧生效。

FBX 显示：`@infloopgame/lib-fbx` 用 `^0.1.2`。加载走 lib-fbx 参考 viewer 的 SDK 路径：`parse` → `buildScene` → `src/plugins/model/fbx/sceneToThree.ts`（从 lib-fbx `tools/fbx-viewer/src/fbx-sdk-to-three.ts` 移植；`transform.ts`/`geometry.ts`/`common.ts` 对应 viewer 的 fbx-transform / fbx-three-geometry / fbx-three-common）。蒙皮绑定对齐 three r184（`Inverse(TransformLink)` + `bind(skeleton, mesh.matrixWorld)`）；Z-up（UpAxis=2）绕 X 转 -90°；6.x 无 UniqueId 由 buildScene 按名字解析。在参考实现之上补了漫反射贴图加载（材质 `diffuse.srcObjects` 的 FbxFileTexture，内嵌 content 走 blob URL 记入 `userData.fbxObjectURLs` 由 disposeModel 回收）。库不采样动画曲线，animStacks 以空 AnimationClip 呈现（信息面板只显示数量）。旧的 three r169 移植 `treeToThree.js` 与 `normalizeRefs.ts` 已删除。回归测试 `test/plugins/model/fbx/fbx6.test.ts`（fixtures 内联 base64）。

前端 Vitest 用例在仓库根 `test/`，目录镜像 `src/`（如 `src/shell/foo.ts` → `test/shell/foo.test.ts`）。`vite.config.ts` 的 `test.include` 为 `test/**/*.test.ts`。

图标：git 只跟踪 `assets/icon-source.svg`。`tauri dev` / `tauri build` 前跑 `npm run prepare:icons`（`tauri icon`），按源图生成各平台图标到 `src-tauri/icons/`（该目录已 gitignore）。

可多开：已去掉单实例锁，再双击文件会新开窗口，互不影响。向已有窗口拖放仍替换该窗口内容。Esc 只关当前窗口。

Esc：查看/空状态关闭窗口退出；设置页先关掉设置；关联确认弹层不退出。Markdown 主题选择器打开时 Esc 仍先关掉选择器。

系统窗口标题栏显示当前文件名：前端同步 `document.title` 与 Tauri `setTitle`；启动/二次打开时 Rust 也会立刻设标题。空状态留空，设置页显示「设置」。

视频画面在窗口内 contain，控制条高度计入适应尺寸；不出现垂直滚动条。

音量条：Linux WebKitGTK 忽略 `writing-mode` 竖向原生 `range`（GTK Scale 默认横向）。自绘 `.video-volume-rail`，按指针 Y 映射（上=100%、下=0%）。macOS WKWebView 原先竖向是好的。

首次打开图片：等窗口 `setSize`/`setPosition` 完成后再去掉 `image-pending`，避免 WebViewGTK 在程序化改尺寸后不重算 object-fit，图停在默认窗口的旧位置。

图片左右翻页按钮：`top: 50%` 配 `translateY(-50%)` 垂直居中，贴窗口左右各 10px。不要用 `translateX(-50%)`（会把上一张再往左、下一张相对右缘错位）。

图片/视频窗口有两种模式，默认「适应尺寸」：
- 适应尺寸：窗口跟着当前媒体分辨率走（超出工作区则缩小），缩放时保持窗口中心点不动
- 固定窗口：记住该 Kind 的窗口大小，媒体在窗口内 contain

设置页空状态可改；看图/视频时右上角按钮也可切换。文档 Kind 仍始终记住窗口尺寸。

空状态可进设置：关联文件格式（按 Kind 分组勾选，Apply 才改系统默认打开方式）。看文件时没有关联入口。

内置 Markdown 查看器支持 8 套主题和 4 档正文宽度。一键编译安装：`./install_linux.sh`（`./install.sh` 转交同一脚本；默认沿用源码版本，加 `--bump-version` 才升高补丁号，取 源码+1 / git 提交数 / 已安装+1 的最大值）。空状态和设置页显示当前版本。

Windows 默认走随安装包分发的 libmpv（`native/mpv/libmpv-2.dll`），自带 HEVC 解码。`install.bat` 不再检测系统 HEVC；运行中若 libmpv 失败回退到 WebView 元素、且 HEVC/H.265 视频被 `MEDIA_ERR_SRC_NOT_SUPPORTED` 拒绝，DevTools 会提示装微软官方 HEVC 视频扩展。

`install_linux.sh` 安装时按戳记版本选包（`*_${version}_*.deb` / rpm 等价），不再用 `*.deb[0]`；同版本走 `apt-get install --reinstall`。构建前会清掉 deb/rpm 输出目录里的旧包，避免残留干扰。

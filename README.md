# xfileviewer

本机图片/视频/Markdown/3D 模型打开器。双击打开后，同目录同一类文件组成可循环序列。视频播完自动下一个；左右键快进/快退，上下键切换视频；图片用左右键切换；Markdown 可滚动预览，左右键切换同目录文档。

Linux：

```bash
./install_linux.sh                 # 一键编译安装（沿用当前版本）
./install_linux.sh --bump-version  # 升高补丁号后再编译安装
```

Windows：安装 Node.js 22+、Rust 的 Windows MSVC 工具链，以及 Visual Studio Build Tools（勾选"使用 C++ 的桌面开发"和 Windows SDK），重新打开终端后，双击根目录的 `install.bat`。

脚本自动下载内置 libmpv 解码器、执行 `npm ci`、编译 Release 版 NSIS 安装包并静默安装到当前用户，完成后可从开始菜单打开。安装前请关闭正在运行的 xfileviewer。首次构建需要联网下载依赖和打包工具；缺少 WebView2 时安装程序会下载运行时。

```powershell
.\install.bat                 # 一键编译安装
.\install.bat -BuildOnly      # 仅生成安装包
.\install.bat -Help           # 查看帮助
```

### 视频解码

Windows 安装包内置 libmpv（`native/mpv/libmpv-2.dll`），HEVC / H.264 / VP9 等常见编码开箱即用，不需要额外装系统解码器。如果遇到"当前内核不支持该视频格式"，DevTools 会同时给出线索（控制台 + 控制条状态栏）。

安装包位于 `src-tauri/target/<Rust 主机架构>/release/bundle/nsis/`。Windows 脚本仅需 `install.bat`，不依赖 PowerShell 脚本。自动化调用时可设置环境变量 `XFILEVIEWER_NO_PAUSE=1`，关闭结束暂停。

开发：

建议使用 Node.js 22（见 `.nvmrc`）。Windows 系统 tar 不支持解码器压缩格式时，需要 PATH 中有 `7z.exe`，脚本会自动回退。

```bash
npm ci
npm test
npm run build
npm run tauri dev -- -- /path/to/file.jpg
```

模块职责、查看器接口和媒体服务授权流程见 [架构说明](docs/architecture.md)。

第三方插件目录：`~/.config/com.xfileviewer.app/plugins/<id>/manifest.json`（Linux）。插件声明 Kind（`image`、`video`、`document` 或 `3dmodel`）和 `mount()` 查看器。

### 3D 模型

支持 FBX、OBJ（含相对路径 MTL 和纹理）、GLB、glTF（含外部缓冲区和纹理）、PLY 网格/点云，以及 PLY、SPLAT、KSPLAT 高斯泼溅。GLB/glTF 支持 Draco（`KHR_draco_mesh_compression`）与 meshopt（`EXT_meshopt_compression`）压缩几何体，解码器位于 `public/draco/`；KTX2 压缩纹理（`KHR_texture_basisu`）暂不支持，会给出明确提示。拖动旋转，右键拖动平移，滚轮缩放，左右键切换同目录模型；工具栏支持重置视角、线框和自动旋转。参考 xmodelviewer，使用 Three.js 按需加载。FBX Binary/ASCII 由 `@infloopgame/lib-fbx` 解析，再转换为 Three.js 场景（保留蒙皮、形变、动画和材质）。提供参考网格、可折叠模型信息（文件大小、尺寸、网格、材质、顶点、三角形、高斯点、动画数量），支持“打开”按钮和 Ctrl/Cmd+O。动画与参考项目一致，显示数量但不自动播放。

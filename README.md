# xfileviewer

本机图片/视频/Markdown 打开器。双击打开后，同目录同一类文件组成可循环序列。视频播完自动下一个；左右键快进/快退，Page Up / Page Down 切换视频；图片用左右键切换；Markdown 可滚动预览，左右键切换同目录文档。

Linux：

```bash
./install.sh
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

```bash
npm install
npm test
npm run tauri dev -- -- /path/to/file.jpg
```

第三方插件目录：`~/.config/com.xfileviewer.app/plugins/<id>/manifest.json`（Linux）。插件声明 Kind（`image`、`video` 或 `document`）和 `mount()` 查看器。

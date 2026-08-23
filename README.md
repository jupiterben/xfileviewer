# xfileviewer

本机图片/视频/Markdown 打开器。双击打开后，同目录同一类文件组成可循环序列。视频播完自动下一个；左右键快进/快退，Page Up / Page Down 切换视频；图片用左右键切换；Markdown 可滚动预览，左右键切换同目录文档。

```bash
./install.sh
```

开发：

```bash
npm install
npm test
npm run tauri dev -- -- /path/to/file.jpg
```

第三方插件目录：`~/.config/com.xfileviewer.app/plugins/<id>/manifest.json`（Linux）。插件声明 Kind（`image`、`video` 或 `document`）和 `mount()` 查看器。

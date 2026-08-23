import type { PluginManifest } from "../core/types";
import { imageViewer } from "./imageViewer";
import { markdownViewer } from "./markdownViewer";
import { videoViewer } from "./videoViewer";

export function builtinPlugins(): PluginManifest[] {
  return [
    {
      id: "builtin-image",
      name: "Image",
      version: "1.0.0",
      viewers: [
        imageViewer("image-raster", [
          "jpg",
          "jpeg",
          "png",
          "gif",
          "webp",
          "bmp",
          "svg",
        ]),
      ],
    },
    {
      id: "builtin-video",
      name: "Video",
      version: "1.0.0",
      viewers: [
        videoViewer("video-html5", ["mp4", "webm", "mkv", "mov", "avi"]),
      ],
    },
    {
      id: "builtin-markdown",
      name: "Markdown",
      version: "1.0.0",
      viewers: [markdownViewer("markdown-gfm", ["md", "markdown"])],
    },
  ];
}

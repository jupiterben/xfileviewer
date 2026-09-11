import type { PluginManifest } from "../core/types";
import { imageViewer } from "./imageViewer";
import { lazyViewer } from "./lazyViewer";

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
        lazyViewer(
          { id: "video-html5", kindId: "video", extensions: ["mp4", "webm", "mkv", "mov", "avi"] },
          async () => (await import("./videoViewer")).videoViewer("video-html5", ["mp4", "webm", "mkv", "mov", "avi"]),
        ),
      ],
    },
    {
      id: "builtin-markdown",
      name: "Markdown",
      version: "1.0.0",
      viewers: [lazyViewer(
        { id: "markdown-gfm", kindId: "document", extensions: ["md", "markdown"] },
        async () => (await import("./markdownViewer")).markdownViewer("markdown-gfm", ["md", "markdown"]),
      )],
    },
  ];
}

import { MODEL_EXTENSIONS } from "./model/formats";
import type { PluginManifest } from "../core/types";
import { lazyViewer } from "./lazyViewer";

// Registration is metadata-only. Keep implementations inside import() factories;
// new file types must not pull their runtime dependencies into the shell.
export function builtinPlugins(): PluginManifest[] {
  return [
    {
      id: "builtin-3dmodel",
      name: "3D Model",
      version: "1.0.0",
      viewers: [lazyViewer(
        { id: "model-three", kindId: "3dmodel", extensions: MODEL_EXTENSIONS },
        async () => (await import("./modelViewer")).modelViewer(),
      )],
    },
    {
      id: "builtin-image",
      name: "Image",
      version: "1.0.0",
      viewers: [
        lazyViewer(
          { id: "image-raster", kindId: "image", extensions: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"] },
          async () => (await import("./imageViewer")).imageViewer("image-raster", ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"]),
        ),
        lazyViewer(
          { id: "image-decoded", kindId: "image", extensions: ["tga", "psd"] },
          async () => (await import("./decodedImageViewer")).decodedImageViewer(),
        ),
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

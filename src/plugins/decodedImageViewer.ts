import { extensionOf } from "../core/path";
import type { Viewer, ViewerHandle } from "../core/types";
import { decodeImage } from "./image/decode";
import { imageViewer } from "./imageViewer";

export function decodedImageViewer(): Viewer {
  const raster = imageViewer("image-decoded", ["tga", "psd"]);
  return {
    ...raster,
    mount(el, ctx) {
      const controller = new AbortController();
      let handle: ViewerHandle | undefined;
      let url: string | undefined;
      let destroyed = false;

      async function load() {
        const response = await fetch(ctx.src, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        if (destroyed) return;
        const blob = await decodeImage(buffer, extensionOf(ctx.path));
        if (destroyed) return;
        url = URL.createObjectURL(blob);
        handle = raster.mount(el, { ...ctx, src: url });
      }

      void load().catch((error: unknown) => {
        if (url) {
          URL.revokeObjectURL(url);
          url = undefined;
        }
        if (!destroyed) {
          const reason = error instanceof Error ? error.message : String(error);
          ctx.onError(`无法加载图片：${reason}`);
        }
      });

      return {
        destroy() {
          if (destroyed) return;
          destroyed = true;
          controller.abort();
          handle?.destroy();
          if (url) {
            URL.revokeObjectURL(url);
            url = undefined;
          }
        },
      };
    },
  };
}

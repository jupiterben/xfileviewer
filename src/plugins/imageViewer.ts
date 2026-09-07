import type { Viewer, ViewerContext, ViewerHandle } from "../core/types";

export function imageViewer(id: string, extensions: string[]): Viewer {
  return {
    id,
    kindId: "image",
    extensions,
    mount(el, ctx) {
      return mountImage(el, ctx);
    },
  };
}

function mountImage(el: HTMLElement, ctx: ViewerContext): ViewerHandle {
  const img = document.createElement("img");
  img.className = "media image";
  img.alt = ctx.path;
  img.src = ctx.src;
  img.addEventListener("load", () => {
    ctx.onContentSize?.(img.naturalWidth, img.naturalHeight);
  });
  img.addEventListener("error", () => ctx.onError("无法解码图片"));
  el.append(img);
  return {
    destroy() {
      img.remove();
    },
  };
}

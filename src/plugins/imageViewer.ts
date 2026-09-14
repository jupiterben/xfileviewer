import { mount, unmount } from "svelte";
import ImageViewer from "../ui/ImageViewer.svelte";
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
  const view = mount(ImageViewer, { target: el, props: { ctx } });
  return { destroy() { void unmount(view); } };
}

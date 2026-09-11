import type { Viewer, ViewerHandle, ViewerNavigation } from "../core/types";

export function lazyViewer(
  descriptor: Pick<Viewer, "id" | "kindId" | "extensions">,
  load: () => Promise<Viewer>,
): Viewer {
  let pending: Promise<Viewer> | undefined;
  return {
    ...descriptor,
    mount(el, ctx) {
      let destroyed = false;
      let handle: ViewerHandle | undefined;
      let navigation: ViewerNavigation | undefined;
      pending ??= load().catch((error: unknown) => {
        pending = undefined;
        throw error;
      });
      void pending.then(viewer => {
        if (destroyed) return;
        const mounted = viewer.mount(el, ctx);
        if (destroyed) {
          mounted.destroy();
          return;
        }
        handle = mounted;
        if (navigation) handle.setNavigation?.(navigation);
      }).catch((error: unknown) => {
        if (!destroyed) ctx.onError(error instanceof Error ? error.message : String(error));
      });
      return {
        setNavigation(state) {
          navigation = state;
          handle?.setNavigation?.(state);
        },
        destroy() {
          if (destroyed) return;
          destroyed = true;
          handle?.destroy();
        },
      };
    },
  };
}

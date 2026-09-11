import type { Viewer, ViewerContext, ViewerHandle, ViewerNavigation } from "../core/types";

export function createViewerSession() {
  let generation = 0;
  let handle: ViewerHandle | undefined;

  function destroy() {
    generation += 1;
    const previous = handle;
    handle = undefined;
    try {
      previous?.destroy();
    } catch (error) {
      console.warn("[viewer] teardown failed", error);
    }
  }

  return {
    destroy,
    setNavigation(state: ViewerNavigation) {
      handle?.setNavigation?.(state);
    },
    mount(viewer: Viewer, element: HTMLElement, ctx: ViewerContext) {
      destroy();
      const current = generation;
      const active = () => generation === current;
      const guarded: ViewerContext = {
        ...ctx,
        onEnded: () => { if (active()) ctx.onEnded(); },
        onError: message => { if (active()) ctx.onError(message); },
        onNavigate: step => { if (active()) ctx.onNavigate?.(step); },
        onContentSize: (...args) => { if (active()) ctx.onContentSize?.(...args); },
        onToolbar: toolbar => { if (active()) ctx.onToolbar?.(toolbar); },
        onVolumePopup: (...args) => { if (active()) ctx.onVolumePopup?.(...args); },
        isInteractionBlocked: () => !active() || !!ctx.isInteractionBlocked?.(),
      };
      try {
        const mounted = viewer.mount(element, guarded);
        if (active()) handle = mounted;
        else mounted.destroy();
      } catch (error) {
        guarded.onError(error instanceof Error ? error.message : String(error));
      }
    },
  };
}

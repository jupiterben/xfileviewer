export interface ViewerNavigation {
  disabled: boolean;
  previousTitle?: string;
  nextTitle?: string;
}

export interface ViewerHandle {
  destroy(): void;
  setNavigation?(state: ViewerNavigation): void;
}

export interface ViewerContext {
  path: string;
  src: string;
  onEnded: () => void;
  onError: (message: string) => void;
  isInteractionBlocked?: () => boolean;
  onToolbar?: (element: HTMLElement | null) => void;
  onContentSize?: (
    width: number,
    height: number,
    chrome?: { width: number; height: number },
  ) => void;
  /**
   * Sequence navigation from inside the viewer (e.g. the video control bar).
   * The native video backend draws over the whole surface, so the floating
   * window-level prev/next buttons are invisible there; the control bar
   * (below the video) provides the same actions instead.
   */
  onNavigate?: (step: 1 | -1) => void;
  /**
   * Show/hide the floating volume popup inside the transparent overlay
   * webview ("video-overlay"), which sits exactly over the video surface and
   * above the mpv HWND. Coordinates are CSS pixels relative to the surface;
   * `bottom` is the popup's bottom edge measured up from the surface bottom.
   * Omitted `pos` (show=false) hides the popup.
   */
  onVolumePopup?: (
    show: boolean,
    pos?: { x: number; bottom: number; volume: number; muted: boolean },
  ) => void;
}

export interface Viewer {
  id: string;
  kindId: string;
  extensions: string[];
  mount(el: HTMLElement, ctx: ViewerContext): ViewerHandle;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  viewers: Viewer[];
  requestAssociation?: boolean;
}

export interface Sequence {
  folder: string;
  kindId: string;
  items: string[];
  index: number;
  loop: boolean;
}

export const KIND_IMAGE = "image";
export const KIND_VIDEO = "video";
export const KIND_DOCUMENT = "document";
export const BUILTIN_KINDS = [KIND_IMAGE, KIND_VIDEO, KIND_DOCUMENT] as const;

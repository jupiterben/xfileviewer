export interface ViewerHandle {
  destroy(): void;
}

export interface ViewerContext {
  path: string;
  src: string;
  onEnded: () => void;
  onError: (message: string) => void;
  onContentSize?: (
    width: number,
    height: number,
    chrome?: { width: number; height: number },
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

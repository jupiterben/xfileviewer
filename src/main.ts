import { getCurrentWebview } from "@tauri-apps/api/webview";

// Select the window before loading modules that install DOM/event handlers.
const boot = getCurrentWebview().label === "video-overlay"
  ? import("./shell/videoOverlayPage").then(module => module.bootVideoOverlay())
  : import("./shell/application").then(module => module.bootApplication());

void boot.catch(error => {
  console.error("[app] boot failed", error);
  const host = document.querySelector<HTMLElement>("#viewer-host");
  if (host) host.textContent = error instanceof Error ? error.message : String(error);
});

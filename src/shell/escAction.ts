export type EscAction = "quit" | "close-settings" | "ignore";

export function escAction(
  overlayOpen: boolean,
  settingsOpen: boolean,
): EscAction {
  if (overlayOpen) return "ignore";
  if (settingsOpen) return "close-settings";
  return "quit";
}

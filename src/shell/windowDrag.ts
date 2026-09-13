const SKIP_WINDOW_DRAG =
  'button, input, select, textarea, a, label, [role="button"], [contenteditable="true"], [data-no-window-drag]';

export function shouldStartWindowDrag(target: EventTarget | null): boolean {
  return target instanceof Element && !target.closest(SKIP_WINDOW_DRAG);
}

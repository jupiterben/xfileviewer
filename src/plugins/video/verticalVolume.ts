/** Top of the rail is 100%, bottom is 0% — matches vertical-lr + rtl on WebKit. */
export function volumePercentFromRailY(clientY: number, rail: Pick<DOMRect, "bottom" | "height">): number {
  if (rail.height <= 0) return 0;
  const t = (rail.bottom - clientY) / rail.height;
  return Math.round(Math.min(1, Math.max(0, t)) * 100);
}

/**
 * Drive a hidden range from pointer Y on a vertical rail. WebKitGTK paints
 * native range inputs horizontally and ignores writing-mode.
 */
export function bindVerticalVolumeRail(
  rail: HTMLElement,
  input: HTMLInputElement,
  options?: { onDragChange?: (dragging: boolean) => void },
): () => void {
  let dragging = false;

  const applyY = (clientY: number) => {
    const next = String(volumePercentFromRailY(clientY, rail.getBoundingClientRect()));
    if (input.value === next) return;
    input.value = next;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const setDragging = (next: boolean) => {
    if (dragging === next) return;
    dragging = next;
    options?.onDragChange?.(next);
  };

  const onDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    setDragging(true);
    applyY(event.clientY);
  };

  const onMove = (event: PointerEvent) => {
    if (!dragging) return;
    applyY(event.clientY);
  };

  const onUp = () => {
    setDragging(false);
  };

  rail.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);

  return () => {
    rail.removeEventListener("pointerdown", onDown);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
  };
}

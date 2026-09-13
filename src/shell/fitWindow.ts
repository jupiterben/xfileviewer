export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point, Size {}

export function positionKeepingCenter(
  current: Rect,
  nextSize: Size,
): Point {
  const x = Math.round(current.x + current.width / 2 - nextSize.width / 2);
  const y = Math.round(current.y + current.height / 2 - nextSize.height / 2);
  return { x, y };
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

/**
 * Keep `position` inside `workArea` so the whole window stays on screen.
 * The centered position is preserved whenever it fits; when the window is
 * larger than the work area in a dimension it pins to the work area edge
 * instead of letting that dimension go off-screen.
 */
export function clampPositionToWorkArea(
  position: Point,
  size: Size,
  workArea: Rect,
): Point {
  const x = size.width >= workArea.width
    ? workArea.x
    : clamp(position.x, workArea.x, workArea.x + workArea.width - size.width);
  const y = size.height >= workArea.height
    ? workArea.y
    : clamp(position.y, workArea.y, workArea.y + workArea.height - size.height);
  return { x, y };
}

/**
 * Size the window to fit `content` inside `workArea`.
 *
 * `chrome` is viewer chrome rendered INSIDE the webview (e.g. the video
 * control bar) and is included in the returned inner size. `frame` is the OS
 * window decorations (outer minus inner size) which sit OUTSIDE the webview:
 * it is subtracted from the available space so that the resulting *outer*
 * window never exceeds the work area — otherwise a tall image would fill the
 * webview while the window bottom is hidden under the taskbar.
 */
export function fitWindowToContent(
  content: Size,
  chrome: Size,
  workArea: Size,
  min: Size = { width: 240, height: 160 },
  frame: Size = { width: 0, height: 0 },
): Size {
  const maxContentW = Math.max(1, workArea.width - chrome.width - frame.width);
  const maxContentH = Math.max(1, workArea.height - chrome.height - frame.height);
  const scale = Math.min(
    1,
    maxContentW / Math.max(1, content.width),
    maxContentH / Math.max(1, content.height),
  );
  return {
    width: Math.max(min.width, Math.round(content.width * scale) + chrome.width),
    height: Math.max(
      min.height,
      Math.round(content.height * scale) + chrome.height,
    ),
  };
}

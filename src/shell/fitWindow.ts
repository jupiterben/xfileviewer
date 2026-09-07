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

export function fitWindowToContent(
  content: Size,
  chrome: Size,
  workArea: Size,
  min: Size = { width: 240, height: 160 },
): Size {
  const maxContentW = Math.max(1, workArea.width - chrome.width);
  const maxContentH = Math.max(1, workArea.height - chrome.height);
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

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { shouldStartWindowDrag } from "./windowDrag";

function el(html: string): Element {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root.firstElementChild!;
}

describe("shouldStartWindowDrag", () => {
  it("drags the window from ordinary image and video content", () => {
    expect(shouldStartWindowDrag(el('<img class="media image">'))).toBe(true);
    expect(shouldStartWindowDrag(el('<video class="media">'))).toBe(true);
  });

  it("skips controls and links", () => {
    expect(shouldStartWindowDrag(el("<button>next</button>"))).toBe(false);
    expect(shouldStartWindowDrag(el("<a href='#'>link</a>"))).toBe(false);
    expect(shouldStartWindowDrag(el('<label><input type="checkbox">线框</label>'))).toBe(false);
  });

  it("lets 3D viewports keep pointer drags for orbiting", () => {
    const viewport = el('<div data-no-window-drag><canvas></canvas></div>');
    expect(shouldStartWindowDrag(viewport)).toBe(false);
    expect(shouldStartWindowDrag(viewport.querySelector("canvas"))).toBe(false);
  });

  it("still drags from 3D chrome outside the viewport", () => {
    expect(shouldStartWindowDrag(el('<div class="model-toolbar"></div>'))).toBe(true);
  });
});

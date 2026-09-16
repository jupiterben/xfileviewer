// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  bindVerticalVolumeRail,
  volumePercentFromRailY,
} from "../../../src/plugins/video/verticalVolume";

describe("volumePercentFromRailY", () => {
  const rail = { top: 100, bottom: 228, height: 128 } as DOMRect;

  it("maps the top of the rail to 100 and the bottom to 0", () => {
    expect(volumePercentFromRailY(100, rail)).toBe(100);
    expect(volumePercentFromRailY(228, rail)).toBe(0);
    expect(volumePercentFromRailY(164, rail)).toBe(50);
  });

  it("clamps outside the rail", () => {
    expect(volumePercentFromRailY(10, rail)).toBe(100);
    expect(volumePercentFromRailY(300, rail)).toBe(0);
  });

  it("returns 0 when the rail has no height", () => {
    expect(volumePercentFromRailY(100, { top: 0, bottom: 0, height: 0 } as DOMRect)).toBe(0);
  });
});

function pointer(type: string, clientY: number) {
  return Object.assign(new Event(type, { bubbles: true }), { clientY, button: 0 });
}

describe("bindVerticalVolumeRail", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  function mountRail() {
    const rail = document.createElement("div");
    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = "100";
    input.value = "40";
    rail.append(input);
    document.body.append(rail);
    rail.getBoundingClientRect = () =>
      ({ top: 100, bottom: 228, height: 128, left: 0, right: 32, width: 32, x: 0, y: 100, toJSON() {} }) as DOMRect;
    return { rail, input };
  }

  it("writes volume from pointer Y and fires input, ignoring native range geometry", () => {
    const { rail, input } = mountRail();
    const values: string[] = [];
    input.addEventListener("input", () => values.push(input.value));
    bindVerticalVolumeRail(rail, input);

    rail.dispatchEvent(pointer("pointerdown", 164));
    expect(input.value).toBe("50");
    expect(values).toEqual(["50"]);

    window.dispatchEvent(pointer("pointermove", 100));
    expect(input.value).toBe("100");
    expect(values).toEqual(["50", "100"]);
  });
});

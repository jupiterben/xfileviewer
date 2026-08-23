import { describe, expect, it } from "vitest";
import { escAction } from "./escAction";

describe("escAction", () => {
  it("quits from the viewer or empty state", () => {
    expect(escAction(false, false)).toBe("quit");
  });

  it("closes settings instead of quitting", () => {
    expect(escAction(false, true)).toBe("close-settings");
  });

  it("ignores escape while the association overlay is open", () => {
    expect(escAction(true, false)).toBe("ignore");
    expect(escAction(true, true)).toBe("ignore");
  });
});

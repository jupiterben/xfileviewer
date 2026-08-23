import { describe, expect, it } from "vitest";
import {
  associationDecision,
  rememberAssociation,
} from "./associations";

describe("associationDecision", () => {
  it("asks when no decision exists", () => {
    expect(
      associationDecision({ granted: [], denied: [] }, ["psd"]),
    ).toBe("ask");
  });

  it("returns granted when every extension was accepted", () => {
    expect(
      associationDecision({ granted: ["psd", "psb"], denied: [] }, ["psd"]),
    ).toBe("granted");
  });

  it("returns denied when the user already declined", () => {
    expect(
      associationDecision({ granted: [], denied: ["psd"] }, ["psd"]),
    ).toBe("denied");
  });
});

describe("rememberAssociation", () => {
  it("records granted extensions", () => {
    expect(rememberAssociation({ granted: [], denied: [] }, ["psd"], true)).toEqual({
      granted: ["psd"],
      denied: [],
    });
  });

  it("records denied extensions and removes them from granted", () => {
    expect(
      rememberAssociation({ granted: ["psd"], denied: [] }, ["psd"], false),
    ).toEqual({
      granted: [],
      denied: ["psd"],
    });
  });
});

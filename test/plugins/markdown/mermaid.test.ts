// @vitest-environment jsdom
import { expect, it } from "vitest";

it("parses common diagrams with the upgraded Mermaid runtime and strict security", async () => {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
  for (const source of [
    "graph TD; A-->B;",
    "sequenceDiagram\nAlice->>Bob: Hello",
    "classDiagram\nclass Viewer\nclass Parser\nViewer --> Parser",
  ]) {
    await expect(mermaid.parse(source)).resolves.toBeTruthy();
  }
}, 30000);

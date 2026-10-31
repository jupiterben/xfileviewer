import { lazyModule } from "../../core/lazyModule";

// Allow the bounded layout declarations used by KaTeX, not arbitrary CSS that
// can position document content over application controls or fetch remote URLs.
const lengthProperties = new Set([
  "height", "width", "min-width", "max-width", "top", "bottom", "left", "right",
  "margin-left", "margin-right", "margin-top", "margin-bottom",
  "padding-left", "padding-right", "vertical-align", "border-width",
  "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
]);

function safeInlineStyle(node: Element, source: string): string {
  const style = node.ownerDocument.createElement("span").style;
  style.cssText = source;
  // KaTeX color boxes use the shorthand too; expand it before validating each
  // length/color independently, keeping the same bounds as longhand values.
  if (style.border && !style.getPropertyPriority("border")) {
    const width = style.borderWidth;
    const borderStyle = style.borderStyle;
    const color = style.borderColor;
    style.removeProperty("border");
    style.setProperty("border-width", width);
    style.setProperty("border-style", borderStyle);
    style.setProperty("border-color", color);
  }
  const safe: string[] = [];
  for (let i = 0; i < style.length; i++) {
    const property = style.item(i);
    const value = style.getPropertyValue(property).trim();
    if (style.getPropertyPriority(property)) continue;
    if (property === "position" && value === "relative") {
      safe.push("position: relative");
    } else if (["color", "background-color", "border-color"].includes(property)
      && /^(?:[a-z]+|#[\da-f]{3,8}|rgba?\([\d.,%\s]+\))$/i.test(value)) {
      safe.push(`${property}: ${value}`);
    } else if (property === "border-style" && value === "solid") {
      safe.push("border-style: solid");
    } else if (lengthProperties.has(property)) {
      const length = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(em|ex|px|%)?$/.exec(value);
      if (!length) continue;
      const number = Number(length[1]);
      const unit = length[2];
      const limit = unit === "px" ? 512 : unit === "%" ? 100 : 32;
      if (Math.abs(number) <= limit && (unit || number === 0)) {
        safe.push(`${property}: ${value}`);
      }
    }
  }
  return safe.join("; ");
}

// Own instance: Mermaid also uses DOMPurify, so do not mutate its global hooks.
// Both the import and instance construction remain outside the startup shell.
const loadPurifier = lazyModule(async () => {
  const purifier = (await import("dompurify")).default(window);
  purifier.addHook("uponSanitizeAttribute", (node, data) => {
    if (data.attrName !== "style") return;
    data.attrValue = safeInlineStyle(node, data.attrValue);
    if (!data.attrValue) data.keepAttr = false;
  });
  return purifier;
});

export async function sanitizeMarkdown(html: string): Promise<string> {
  const purifier = await loadPurifier();
  const fragment = purifier.sanitize(html, {
    // Preserve ordinary Markdown HTML, KaTeX's MathML/SVG and local media, but
    // never execute document scripts or embed another privileged web context.
    ADD_TAGS: ["video", "source"],
    ADD_ATTR: ["controls", "poster", "data-source"],
    FORBID_TAGS: ["script", "iframe", "object", "embed", "base", "link", "meta", "style"],
    SANITIZE_NAMED_PROPS: true,
    RETURN_DOM_FRAGMENT: true,
  });
  // Namespacing IDs must also update references. Only reference IDs that really
  // exist inside this fragment; never point SVG/labels at the application shell.
  const ids = new Set([...fragment.querySelectorAll("[id]")].map(node => node.id));
  const resolveId = (id: string) => {
    const prefixed = `user-content-${id}`;
    return ids.has(prefixed) ? prefixed : ids.has(id) ? id : undefined;
  };
  for (const node of fragment.querySelectorAll("*")) {
    for (const attribute of [...node.attributes]) {
      const name = attribute.name;
      let value = attribute.value;
      if ((name === "href" || name === "xlink:href") && value.startsWith("#")) {
        let id: string;
        try { id = decodeURIComponent(value.slice(1)); } catch { node.removeAttribute(name); continue; }
        const target = resolveId(id);
        if (!target) { node.removeAttribute(name); continue; }
        value = `#${target}`;
      } else if (["for", "aria-labelledby", "aria-describedby", "aria-controls", "headers"].includes(name)) {
        value = value.split(/\s+/).map(resolveId).filter(Boolean).join(" ");
        if (!value) { node.removeAttribute(name); continue; }
      }
      // Only canonical local SVG resource URLs are accepted. Reject CSS escape
      // variants and external URLs rather than trying to decode CSS ourselves.
      // Do not rewrite arbitrary text/data attributes (e.g. Mermaid source).
      if (["fill", "stroke", "clip-path", "filter", "mask", "marker", "marker-start", "marker-mid", "marker-end", "cursor"].includes(name)) {
        if (value.includes("\\")) { node.removeAttribute(name); continue; }
        if (/url\s*\(/i.test(value)) {
          const reference = /^url\(\s*["']?#([^\s)"']+)["']?\s*\)$/i.exec(value);
          const target = reference && resolveId(reference[1]);
          value = target ? `url(#${target})` : "none";
        }
      }
      if (value !== attribute.value) node.setAttribute(name, value);
    }
  }
  const root = fragment.ownerDocument.createElement("div");
  root.append(fragment);
  return root.innerHTML;
}

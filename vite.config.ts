/// <reference types="vitest/config" />
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const host = process.env.TAURI_DEV_HOST;
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

// Check emitted chunks, not source imports: shared chunks and accidental
// static imports can otherwise defeat a perfectly good import() boundary.
function lazyBoundaryGuard(): Plugin {
  return {
    name: "lazy-boundary-guard",
    apply: "build",
    generateBundle: { order: "post", handler(_options, bundle) {
      const heavy = /\/node_modules\/(three|mermaid|dompurify|highlight\.js|katex|@mdit\/plugin-katex|ag-psd|@infloopgame\/lib-fbx|@mkkellogg\/gaussian-splats-3d)\//;
      const rules = [
        { entry: "/src/main.ts", forbidden: heavy },
        { entry: "/src/shell/application.ts", forbidden: heavy },
        { entry: "/src/shell/videoOverlayPage.ts", forbidden: heavy },
        { entry: "/src/plugins/modelViewer.ts", forbidden: /\/(loaders\/|libs\/meshopt_decoder|lib-fbx\/|gaussian-splats-3d\/)/ },
        { entry: "/src/plugins/markdownViewer.ts", forbidden: /\/node_modules\/(mermaid|highlight\.js|katex|@mdit\/plugin-katex)\// },
        { entry: "/src/plugins/model/gltf.ts", forbidden: /\/(DRACOLoader\.js|meshopt_decoder\.module\.js)$/ },
      ];
      for (const rule of rules) {
        const root = Object.values(bundle).find(item => item.type === "chunk"
          && Object.keys(item.modules).some(id => id.replace(/\\/g, "/").endsWith(rule.entry)));
        if (!root || root.type !== "chunk") this.error(`Missing lazy entry: ${rule.entry}`);
        const visited = new Set<string>();
        let bytes = 0;
        const visit = (file: string) => {
          if (visited.has(file)) return;
          visited.add(file);
          const chunk = bundle[file];
          if (!chunk || chunk.type !== "chunk") return;
          bytes += new TextEncoder().encode(chunk.code).length;
          for (const id of Object.keys(chunk.modules)) {
            if (rule.forbidden.test(id.replace(/\\/g, "/"))) {
              this.error(`Lazy boundary violated: ${rule.entry} statically loads ${id}`);
            }
          }
          // Only static imports are on the critical path; never traverse dynamicImports.
          chunk.imports.forEach(visit);
        };
        visit(root.fileName);
        console.info(`[lazy-boundary] ${rule.entry}: ${(bytes / 1000).toFixed(1)} kB static JS`);
        if (rule.entry === "/src/shell/application.ts" && bytes > 180_000) {
          this.error("Application startup JS exceeds the 180 kB budget");
        }
      }
    } },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  build: { manifest: true },
  // Controllers hold native DOM references; reload the page when templates change.
  plugins: [svelte({ hot: false }), lazyBoundaryGuard()],
  // Component tests execute the browser runtime inside jsdom.
  resolve: { conditions: ["browser"] },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    pool: "threads",
    // Let jsdom own storage instead of inheriting Node's native Web Storage.
    execArgv: ["--no-experimental-webstorage"],
  },
}));

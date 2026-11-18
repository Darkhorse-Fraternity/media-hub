import { readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

const crucibleRoot = dirname(
  createRequire(import.meta.url).resolve("@codepawlhq/crucible/package.json"),
);
function runtimeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? runtimeFiles(path) : [path];
  });
}

export default defineConfig({
  server: {
    port: 3051,
    host: true,
    allowedHosts: [
      "mediahub.test-xm.pumpkii.click",
      "media-hub.test-xm.pumpkii.click",
    ],
  },
  plugins: [
    tsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    paraglideVitePlugin({
      project: "./project.inlang",
      outdir: "./src/lib/paraglide",
    }),
    nitro({
      externals: {
        // The worker starts the pinned CLI; its browser modules/assets are runtime files.
        traceInclude: ["bin", "build", "assets"].flatMap((dir) =>
          runtimeFiles(join(crucibleRoot, dir)),
        ),
      },
      routeRules: {
        "/": {
          headers: {
            "cache-control": "no-store, no-cache, must-revalidate",
            pragma: "no-cache",
            expires: "0",
          },
        },
      },
    }),
    tanstackStart(),
    viteReact(),
    tailwindcss(),
  ],
});

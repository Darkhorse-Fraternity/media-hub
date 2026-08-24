import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  server: {
    port: 3051,
    host: true,
    allowedHosts: ["mediahub.test-xm.pumpkii.click"],
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

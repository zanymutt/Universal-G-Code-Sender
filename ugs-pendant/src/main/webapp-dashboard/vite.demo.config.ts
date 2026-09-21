import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config";

// The online demo: the same dashboard, built to run on a static host (GitHub
// Pages) against a simulated machine in the browser (see src/demo). Relative
// asset URLs, so it works from any path such as /Universal-G-Code-Sender/, and
// its own output folder so it never lands in the jar's resources.
export default mergeConfig(
  base,
  defineConfig({
    base: "./",
    define: {
      "import.meta.env.VITE_DEMO": JSON.stringify("true"),
    },
    build: {
      outDir: "dist-demo",
      emptyOutDir: true,
    },
  })
);

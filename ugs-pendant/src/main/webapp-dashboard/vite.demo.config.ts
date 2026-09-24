import { cpSync, existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config";

// The online demo: the same dashboard, built to run on a static host (GitHub
// Pages) against a simulated machine in the browser (see src/demo). Relative
// asset URLs, so it works from any path such as /Universal-G-Code-Sender/, and
// its own output folder so it never lands in the jar's resources.

const root = fileURLToPath(new URL(".", import.meta.url));
const outDir = "dist-demo";

// The example plugins the demo offers, copied from ugs-pendant/examples/<id>
// (the same files the real dashboard installs) so there's no second copy to
// keep in sync. svg-to-gcode is left out on purpose.
const DEMO_PLUGINS = ["nesting", "rotate-gcode"];
const examplesDir = join(root, "..", "..", "..", "examples");

// Development-only files that sit next to a plugin's runtime files.
const isRuntimeFile = (path: string) =>
  !/(^|[\\/])(README\.md|preview-host\.[a-z]+|settings\.json)$/.test(path) &&
  !/\.test\.cjs$/.test(path) &&
  !/\.before-/.test(basename(path));

// What GET /api/v1/plugins/list returns in the demo: each plugin's manifest,
// with its entry (and icon) pointing at the static copy beside the page.
const pluginList = DEMO_PLUGINS.filter((id) => existsSync(join(examplesDir, id, "plugin.json"))).map((id) => {
  const manifest = JSON.parse(readFileSync(join(examplesDir, id, "plugin.json"), "utf8"));
  return {
    id,
    name: manifest.name ?? id,
    description: manifest.description,
    version: manifest.version,
    entryUrl: `plugins/${id}/${manifest.entry ?? "index.html"}`,
    iconUrl: manifest.icon ? `plugins/${id}/${manifest.icon}` : undefined,
    allowMultipleInstances: manifest.allowMultipleInstances === true,
  };
});

const copyDemoPlugins = () => ({
  name: "copy-demo-plugins",
  closeBundle() {
    for (const { id } of pluginList) {
      cpSync(join(examplesDir, id), join(root, outDir, "plugins", id), { recursive: true, filter: isRuntimeFile });
    }
  },
});

export default mergeConfig(
  base,
  defineConfig({
    base: "./",
    plugins: [copyDemoPlugins()],
    define: {
      "import.meta.env.VITE_DEMO": JSON.stringify("true"),
      __DEMO_PLUGINS__: JSON.stringify(pluginList),
    },
    build: {
      outDir,
      emptyOutDir: true,
    },
  })
);

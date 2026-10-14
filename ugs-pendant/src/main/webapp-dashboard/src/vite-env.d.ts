/// <reference types="vite/client" />

// Set by vite.demo.config.ts: the plugins the online demo offers, as the
// plugin-list response (see src/demo/demoMachine.ts). Demo builds only.
declare const __DEMO_PLUGINS__: import("./services/plugins").PluginInfo[];
// Large demo sample programs that are fetched on first open instead of being
// bundled: workspace path, size in characters, and the static URL.
declare const __DEMO_LIBRARY__: { path: string; size: number; url: string }[];

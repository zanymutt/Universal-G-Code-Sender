import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: "/dashboard/",
  // Off here; vite.demo.config.ts turns it on. A literal, so the demo code is
  // dead code (and dropped) in the normal build.
  define: {
    "import.meta.env.VITE_DEMO": JSON.stringify("false"),
  },
  build: {
    outDir: "../../../target/classes/resources/ugs-dashboard",
  },
  resolve: {
    alias: [
      {
        find: "/fonts",
        replacement: "/fonts",
      },
    ],
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        ws: false,
      },
      "/ws": {
        target: "http://localhost:8080",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});

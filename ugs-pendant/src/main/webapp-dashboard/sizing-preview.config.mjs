import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config.ts";
export default mergeConfig(base, defineConfig({server: {
  proxy: {
    "/api": { target: "http://127.0.0.1:18080", changeOrigin: true },
    "/ws": { target: "http://127.0.0.1:18080", ws: true }
  }
}}));

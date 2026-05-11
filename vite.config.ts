import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Force WKWebView to never serve stale JS from its cache
    headers: {
      "Cache-Control": "no-store",
    },
    watch: {
      usePolling: true,
    },
  },
  build: {
    target: ["es2021"],
    minify: !process.env.TAURI_DEBUG,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
}));

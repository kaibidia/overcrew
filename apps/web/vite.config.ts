import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Bind to 0.0.0.0 so phones on the same Wi-Fi can reach the dev server via the
// Mac's LAN IP (docs/ARCHITECTURE.md §4). Override the port with --port if 5173
// is taken.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
  },
  preview: {
    host: "0.0.0.0",
    port: 5173,
  },
  // Consume @overcrew/shared straight from its TypeScript source rather than
  // pre-bundling it, so shared changes hot-reload during Stage 1+.
  optimizeDeps: {
    exclude: ["@overcrew/shared"],
  },
});

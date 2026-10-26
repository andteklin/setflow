import { defineConfig } from "vite";

// In development the host runs separately (npm run dev:server) and Vite proxies to it.
const host = process.env.SETFLOW_HOST ?? "http://localhost:5280";

export default defineConfig({
  server: {
    host: true,
    proxy: {
      "/api": host,
      "/ws": { target: host.replace(/^http/, "ws"), ws: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});

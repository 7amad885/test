import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: path.resolve(__dirname, "src/client"),
  publicDir: path.resolve(__dirname, "src/client/public"),
  plugins: [react()],
  server: { host: true, port: 5173 },
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    target: "es2020",
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules/three/")) return "three";
          if (id.includes("@react-three") || id.includes("postprocessing") || id.includes("n8ao")) return "r3f";
        },
      },
    },
  },
});

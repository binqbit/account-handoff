import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
export default defineConfig(({ mode }) => ({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  // Never copy the host's generated LOCAL descriptor into a remote build.
  publicDir: mode === "testnet" ? false : "public",
  ...(mode === "testnet" ? { envDir: false as const } : {}),
  build: {
    outDir: mode === "testnet" ? "../../dist-testnet" : "../../dist",
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    host: "127.0.0.1",
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
  },
}));

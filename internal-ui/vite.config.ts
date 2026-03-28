import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const hyperionTarget =
    env.VITE_HYPERION_PROXY_TARGET?.trim() || "https://yieldai.app";

  const hyperionProxy = {
    "/api/yieldai": {
      target: hyperionTarget,
      changeOrigin: true,
      secure: true,
      rewrite: (path: string) => path.replace(/^\/api\/yieldai/, ""),
    },
  };

  return {
    plugins: [react()],
    server: {
      host: true,
      port: 5173,
      // If 5173 is taken, Vite picks the next free port (see terminal URL).
      strictPort: false,
      proxy: hyperionProxy,
    },
    preview: {
      host: true,
      port: 4173,
      strictPort: false,
      proxy: hyperionProxy,
    },
  };
});

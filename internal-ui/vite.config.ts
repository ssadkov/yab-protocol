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
      port: 5173,
      proxy: hyperionProxy,
    },
    preview: {
      port: 4173,
      proxy: hyperionProxy,
    },
  };
});

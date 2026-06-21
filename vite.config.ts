import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // 生产构建移除 console / debugger，减小体积并避免泄露调试信息（保留 warn/error 便于排障）
  esbuild: {
    drop: process.env.TAURI_DEBUG ? [] : ['debugger'],
    pure: process.env.TAURI_DEBUG ? [] : ['console.log', 'console.debug', 'console.info'],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  // 使用相对路径，确保打包后资源能正确加载
  base: "./",
}));

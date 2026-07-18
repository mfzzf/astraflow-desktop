import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from "kimi-plugin-inspect-react"

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => ({
  base: command === "serve" ? "/" : "/download/",
  publicDir: path.resolve(__dirname, "../public"),
  plugins: [
    ...(mode === "development" ? [inspectAttr()] : []),
    react(),
  ],
  server: {
    port: 3000,
    proxy: {
      // 与线上 Nginx 保持一致：同源代理 latest.json，避免 US3 桶的 CORS 限制
      '/latest.json': {
        target: 'https://astraflow-desktop.cn-sh2.ufileos.com',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}))

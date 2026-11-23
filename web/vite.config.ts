import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Built into ../docs for GitHub Pages (`npm run build` then re-exports docs/data from SQLite), or, with
// AIRTIME_OUT=dist, into web/dist for Vercel (`npm run build:site`).
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  build: { outDir: process.env.AIRTIME_OUT ?? "../docs", emptyOutDir: true, chunkSizeWarningLimit: 1000 },
  server: { fs: { allow: [".."] } },
})

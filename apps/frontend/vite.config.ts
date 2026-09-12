import path from 'path';
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  // The packaged app loads index.html off disk with `win.loadFile`, so absolute
  // asset URLs ("/assets/...") resolve against the filesystem root and 404 — a
  // blank window with no JS and no API calls. Relative base keeps both the dev
  // server and the file:// load working.
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})

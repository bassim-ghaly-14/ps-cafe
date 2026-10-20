import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 2 + Vite: fixed dev port, strict fs, no network calls in app code.
//
// Developer tools (Developer Mode toggle in Settings) are compiled in only
// when VITE_ENABLE_DEVTOOLS === "1" (read via import.meta.env):
//   npm run dev            -> devtools ON  (VITE_ENABLE_DEVTOOLS=1)
//   npm run build          -> devtools OFF (production release)
//   npm run build:internal -> devtools ON  (explicit internal testing build)
// See docs/POST_RELEASE_HARDENING_REPORT.md for the build matrix.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2022" },
});

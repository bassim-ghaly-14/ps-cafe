import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 2 + Vite: fixed dev port, strict fs, no network calls in app code.
//
// The Developer Mode section in Settings is always visible; activation is
// PIN-gated (PIN centralized in src/dev/developerMode.ts). The legacy
// VITE_ENABLE_DEVTOOLS prefix on the dev / build:internal scripts no longer
// controls UI visibility — the internal build remains only as a separate
// bundle output/profile (see src-tauri/tauri.internal.conf.json).
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2022" },
});

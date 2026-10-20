/// <reference types="vite/client" />

// Vite client ambient types:
// - declares modules for static assets imported by the app (e.g. `*.css`,
//   `*.svg`), so `import "./styles.css"` in src/App.tsx type-checks;
// - provides `import.meta.env` typing.
//
// This file is the canonical Vite env declaration file; keep it inside `src`
// so that it is picked up by the `include` of tsconfig.json.

interface ImportMetaEnv {
  /**
   * Opt-in switch for the developer-mode tools. Set to "1" to enable
   * (`npm run dev`, `npm run build:internal`); unset/anything else keeps
   * developer tools out of production builds.
   */
  readonly VITE_ENABLE_DEVTOOLS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

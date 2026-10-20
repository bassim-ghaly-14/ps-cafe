import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Build-configuration regression tests.
 *
 * Developer Mode is always visible in Settings now (PIN-gated activation;
 * PIN centralized in src/dev/developerMode.ts), so the VITE_ENABLE_DEVTOOLS
 * script prefix no longer controls UI visibility. The internal build still
 * exists as a separate bundle with its own output dir, identifier and
 * product name, so these tests keep guarding that production and internal
 * builds stay wired to their own frontends and never share an output dir —
 * caught by `npm test` rather than by manual inspection of a built bundle.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface TauriConfig {
  productName: string;
  identifier: string;
  build: {
    beforeBuildCommand?: string;
    beforeDevCommand?: string;
    frontendDist: string;
    devUrl?: string;
  };
  bundle?: { active?: boolean; targets?: string[] };
}

interface PackageScripts {
  [name: string]: string;
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(ROOT, relativePath), "utf8")) as T;
}

const pkg = readJson<{ scripts: PackageScripts }>("package.json");
const prodTauri = readJson<TauriConfig>("src-tauri/tauri.conf.json");
const internalTauri = readJson<TauriConfig>(
  "src-tauri/tauri.internal.conf.json",
);

describe("frontend build scripts", () => {
  it("production build never enables developer tools", () => {
    expect(pkg.scripts.build).toBeDefined();
    expect(pkg.scripts.build).not.toContain("VITE_ENABLE_DEVTOOLS=1");
  });

  it("internal build enables developer tools explicitly", () => {
    expect(pkg.scripts["build:internal"]).toContain("VITE_ENABLE_DEVTOOLS=1");
  });

  it("production and internal builds write to separate output directories", () => {
    // A shared output dir would let a plain `npm run build` overwrite the
    // internal bundle (or vice versa), silently flipping the flag in the
    // bundle that ends up embedded in the desktop app.
    expect(pkg.scripts["build:internal"]).toContain("dist-internal");
    expect(pkg.scripts.build).not.toContain("dist-internal");
  });
});

describe("tauri desktop build configuration", () => {
  it("default (production) tauri build uses the production frontend", () => {
    expect(prodTauri.build.beforeBuildCommand).toBe("npm run build:prod");
    expect(prodTauri.build.frontendDist).toBe("../dist");
  });

  it("canonical production command exists and never builds internal", () => {
    expect(pkg.scripts["build:prod"]).toBeDefined();
    expect(pkg.scripts["build:prod"]).not.toContain("internal");
    expect(pkg.scripts["build:prod"]).not.toContain("VITE_ENABLE_DEVTOOLS=1");
    expect(pkg.scripts["build:prod:tauri"]).toContain("tauri build");
    expect(pkg.scripts["build:prod:tauri"]).not.toContain("internal");
    expect(pkg.scripts["clean:prod-bundles"]).toContain(
      "clean-prod-bundles.mjs",
    );
    expect(pkg.scripts["prebuild:prod"]).toContain("clean:prod-bundles");
  });

  it("production bundle targets installers, not redundant formats", () => {
    expect(prodTauri.bundle?.targets).toContain("nsis");
    expect(prodTauri.bundle?.targets).toContain("dmg");
    expect(prodTauri.bundle?.targets).not.toContain("app");
    expect(prodTauri.bundle?.targets).not.toContain("msi");
  });

  it("production identifier is a valid reverse-DNS id (not a reserved TLD)", () => {
    expect(prodTauri.identifier).not.toMatch(/\.app$/);
    expect(prodTauri.identifier).toBe("com.pscafe.desktop");
  });

  it("internal tauri build uses the internal frontend bundle", () => {
    expect(internalTauri.build.beforeBuildCommand).toBe(
      "npm run build:internal",
    );
    expect(internalTauri.build.frontendDist).toBe("../dist-internal");
  });

  it("internal tauri config points at a different frontend dist than production", () => {
    // If these were equal, the internal config would embed whatever the last
    // frontend build produced — the whole point of the separate dist dir is
    // that the embedded assets are always the ones matching the flag.
    expect(internalTauri.build.frontendDist).not.toBe(
      prodTauri.build.frontendDist,
    );
  });

  it("internal build is reachable via a dedicated script", () => {
    expect(pkg.scripts["tauri:internal"]).toContain("tauri.internal.conf.json");
    // The plain `tauri` script must stay production-only.
    expect(pkg.scripts.tauri).not.toContain("tauri.internal.conf.json");
  });

  it("internal build is isolated from the production app identity", () => {
    // A separate identifier gives the internal app its own app-data dir, so
    // its SQLite database is never the production `ps-cafe.db`.
    expect(internalTauri.identifier).not.toBe(prodTauri.identifier);
    expect(internalTauri.productName).not.toBe(prodTauri.productName);
  });
});

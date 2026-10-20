/**
 * Safe cleanup for PS-Cafe production bundle outputs.
 *
 * Removes ONLY verified generated installer artifacts:
 *   - src-tauri/target/release/bundle/nsis/PS Cafe_*.exe
 *   - src-tauri/target/release/bundle/nsis/PS-Cafe-Setup-*.exe (renamed CI copies)
 *   - src-tauri/target/release/bundle/dmg/PS Cafe_*.dmg
 *
 * Explicitly preserves:
 *   - Rust incremental caches (target/release/{deps,build,.fingerprint}, target/debug)
 *   - Source files, dist/ sources are rebuilt by Vite (--emptyOutDir), not deleted here
 *   - SQLite databases (*.db, *-wal, *-shm), user config dirs, installed app data
 *   - Git history (.git), published GitHub Releases, unrelated files
 *   - Internal build outputs (PS Cafe Internal*) which live alongside but are
 *     NOT touched — internal and production are distinguished by productName.
 *
 * Usage: npm run clean:prod-bundles
 * Runs automatically before `npm run build:prod` via the `prebuild:prod` hook.
 */
import { readdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NSIS_DIR = join(ROOT, "src-tauri", "target", "release", "bundle", "nsis");
const DMG_DIR = join(ROOT, "src-tauri", "target", "release", "bundle", "dmg");

const PROD_PATTERNS = [
  // Native Tauri NSIS output, e.g. "PS Cafe_0.1.0_x64-setup.exe"
  { dir: NSIS_DIR, prefix: "PS Cafe_", suffix: ".exe" },
  // Deterministic CI rename, e.g. "PS-Cafe-Setup-0.1.0.exe"
  { dir: NSIS_DIR, prefix: "PS-Cafe-Setup-", suffix: ".exe" },
  // Native Tauri DMG output, e.g. "PS Cafe_0.1.0_aarch64.dmg"
  { dir: DMG_DIR, prefix: "PS Cafe_", suffix: ".dmg" },
];

let removed = 0;
for (const { dir, prefix, suffix } of PROD_PATTERNS) {
  if (!existsSync(dir)) continue;
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(prefix) && entry.endsWith(suffix)) {
      // Guard: never follow a path outside the bundle dir.
      const full = join(dir, entry);
      if (!full.startsWith(dir)) continue;
      rmSync(full, { force: true });
      console.log(`removed ${full}`);
      removed += 1;
    }
  }
}
console.log(`clean:prod-bundles: removed ${removed} production artifact(s).`);

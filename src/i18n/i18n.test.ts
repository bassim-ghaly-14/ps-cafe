import { describe, expect, it, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import i18n, { readyPromise, SUPPORTED_LANGS } from "./index";
import { __clearMemoryDb } from "../db/memory";
import { __resetDbForTests } from "../db/client";
import * as dayRepo from "../repositories/businessDayRepo";
import * as stationRepo from "../repositories/stationRepo";
import { useCafeActions } from "../hooks/useCafe";

const I18N_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(I18N_DIR, "..");

/** Raw (on-disk) resources per supported locale — catches malformed JSON that a typed import would hide. */
function readLocaleRaw(lang: string): Record<string, unknown> {
  const path = join(I18N_DIR, "locales", lang, "translation.json");
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

/** Flatten a nested resource tree into dotted key paths mapped to leaf strings. */
function flatten(
  node: unknown,
  prefix = "",
  out: Record<string, string> = {},
): Record<string, string> {
  if (typeof node === "string") {
    out[prefix] = node;
    return out;
  }
  if (node !== null && typeof node === "object" && !Array.isArray(node)) {
    for (const [k, v] of Object.entries(node)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
  }
  return out;
}

/** Extract i18next interpolation placeholder names from a translation string. */
function placeholders(value: string): string[] {
  const names = new Set<string>();
  for (const m of value.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) {
    const name = m[1];
    if (name !== undefined) names.add(name);
  }
  return [...names].sort();
}

/**
 * Dependency-free duplicate-key detector: JSON.parse silently lets the last
 * value win, so resources are re-scanned with a tiny tokenizer that reports
 * every repeated key within the same object, with its full dotted path.
 */
function findDuplicateKeys(text: string): string[] {
  const dupes: string[] = [];
  let i = 0;

  const skipWs = (): void => {
    while (i < text.length && /\s/.test(text[i] as string)) i++;
  };

  const parseString = (): string => {
    i++; // opening quote
    let out = "";
    while (i < text.length) {
      const c = text[i] as string;
      if (c === "\\") {
        out += text[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (c === '"') {
        i++;
        return out;
      }
      out += c;
      i++;
    }
    throw new Error("Unterminated string in JSON resource.");
  };

  const parseValue = (path: string): void => {
    skipWs();
    const c = text[i];
    if (c === "{") {
      i++;
      const keys = new Set<string>();
      skipWs();
      while (text[i] !== "}") {
        skipWs();
        if (text[i] !== '"') throw new Error(`Expected object key at ${i}.`);
        const key = parseString();
        const childPath = path ? `${path}.${key}` : key;
        if (keys.has(key)) dupes.push(childPath);
        keys.add(key);
        skipWs();
        if (text[i] !== ":") throw new Error(`Expected ':' at ${i}.`);
        i++;
        parseValue(childPath);
        skipWs();
        if (text[i] === ",") {
          i++;
          continue;
        }
      }
      i++; // closing brace
      return;
    }
    if (c === "[") {
      i++;
      skipWs();
      let index = 0;
      while (text[i] !== "]") {
        parseValue(`${path}[${index}]`);
        index++;
        skipWs();
        if (text[i] === ",") i++;
        skipWs();
      }
      i++; // closing bracket
      return;
    }
    if (c === '"') {
      parseString();
      return;
    }
    // number | true | false | null
    while (i < text.length && !/[\s,\]}]/.test(text[i] as string)) i++;
  };

  skipWs();
  parseValue("");
  return dupes;
}

function* walkSourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === "i18n" || entry === "node_modules") continue;
      yield* walkSourceFiles(p);
    } else if (
      /\.(ts|tsx)$/.test(entry) &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".test.tsx")
    ) {
      yield p;
    }
  }
}

/**
 * Sentinel used by useCafe.closeBusinessDay: "BLOCKED" is intercepted by
 * BusinessDayScreen before any t() call and never reaches i18next.
 */
const NON_TRANSLATION_KEYS = new Set(["BLOCKED"]);

beforeEach(async () => {
  await readyPromise;
});

describe("translation resource integrity", () => {
  it("every supported locale has a parseable translation.json on disk", () => {
    for (const lang of SUPPORTED_LANGS) {
      expect(() => readLocaleRaw(lang)).not.toThrow();
    }
  });

  it("no locale resource contains duplicate keys", () => {
    for (const lang of SUPPORTED_LANGS) {
      const path = join(I18N_DIR, "locales", lang, "translation.json");
      const dupes = findDuplicateKeys(readFileSync(path, "utf8"));
      expect(dupes, `duplicate keys in ${lang}`).toEqual([]);
    }
  });

  it("every supported locale is registered with i18next", () => {
    for (const lang of SUPPORTED_LANGS) {
      expect(i18n.hasResourceBundle(lang, "translation")).toBe(true);
    }
  });

  it("no translation value is empty or whitespace-only", () => {
    for (const lang of SUPPORTED_LANGS) {
      for (const [key, value] of Object.entries(flatten(readLocaleRaw(lang)))) {
        expect(value.trim(), `${lang}:${key}`).not.toBe("");
      }
    }
  });

  it("all resource leaves are strings (no arrays/null/numbers)", () => {
    const walk = (node: unknown, path: string): void => {
      if (typeof node === "string") return;
      expect(
        node !== null && typeof node === "object" && !Array.isArray(node),
        `${path} must be an object or string`,
      ).toBe(true);
      for (const [k, v] of Object.entries(node as object)) {
        walk(v, path ? `${path}.${k}` : k);
      }
    };
    for (const lang of SUPPORTED_LANGS) {
      walk(readLocaleRaw(lang), `${lang}`);
    }
  });

  it("no malformed interpolation syntax in any locale", () => {
    for (const lang of SUPPORTED_LANGS) {
      for (const [key, value] of Object.entries(flatten(readLocaleRaw(lang)))) {
        const stripped = value.replace(/\{\{\s*[\w.]+\s*\}\}/g, "");
        expect(stripped, `${lang}:${key} has stray {{ or }}`).not.toMatch(
          /\{\{|\}\}/,
        );
        expect(stripped, `${lang}:${key} has single-brace token`).not.toMatch(
          /\{\s*[\w.]+\s*\}/,
        );
      }
    }
  });
});

describe("visitor / read-only locale contract", () => {
  /** Keys the read-only visitor mode relies on. */
  const REQUIRED_READ_ONLY_KEYS = [
    "common.readOnly",
    "lan.readOnlyNotice",
    "lan.phoneReadOnly",
  ];

  /** Obsolete write-toggle keys that must never come back. */
  const OBSOLETE_KEYS = ["lan.allowWrites", "lan.writesHint", "lan.writesOff"];

  it("every locale defines the read-only keys", () => {
    for (const lang of SUPPORTED_LANGS) {
      const flat = flatten(readLocaleRaw(lang));
      for (const key of REQUIRED_READ_ONLY_KEYS) {
        expect(flat[key], `${lang}:${key}`).toBeTypeOf("string");
        expect((flat[key] as string).trim(), `${lang}:${key}`).not.toBe("");
      }
    }
  });

  it("no locale keeps the obsolete write-toggle keys", () => {
    for (const lang of SUPPORTED_LANGS) {
      const flat = flatten(readLocaleRaw(lang));
      for (const key of OBSOLETE_KEYS) {
        expect(flat[key], `${lang}:${key} must be removed`).toBeUndefined();
      }
    }
  });
});

describe("cross-locale parity", () => {
  it("all locales expose identical key sets", () => {
    const first = SUPPORTED_LANGS[0] as string;
    const reference = Object.keys(flatten(readLocaleRaw(first))).sort();
    for (const lang of SUPPORTED_LANGS) {
      const keys = Object.keys(flatten(readLocaleRaw(lang))).sort();
      const missing = reference.filter((k) => !keys.includes(k));
      const extra = keys.filter((k) => !reference.includes(k));
      expect(missing, `keys missing in ${lang}`).toEqual([]);
      expect(extra, `unexpected keys in ${lang}`).toEqual([]);
    }
  });

  it("equivalent keys require identical interpolation placeholder sets", () => {
    const first = SUPPORTED_LANGS[0] as string;
    const reference = flatten(readLocaleRaw(first));
    for (const lang of SUPPORTED_LANGS) {
      const flat = flatten(readLocaleRaw(lang));
      for (const [key, value] of Object.entries(reference)) {
        expect(
          placeholders(flat[key] as string).join(","),
          `placeholder mismatch for ${key} in ${lang}`,
        ).toBe(placeholders(value).join(","));
      }
    }
  });
});

describe("interpolation rendering", () => {
  it("regression: stations.stopped substitutes name and duration", () => {
    const msg = i18n.t("stations.stopped", {
      name: "Coffee Machine",
      duration: "00:15:30",
    });
    expect(msg).toBe("تم إيقاف Coffee Machine. المدة المحفوظة 00:15:30.");
    expect(msg).not.toMatch(/\{\{/);
    expect(msg).not.toMatch(/\}\}/);
  });

  it("every placeholder-bearing key renders with all variables supplied", () => {
    for (const lang of SUPPORTED_LANGS) {
      for (const [key, value] of Object.entries(flatten(readLocaleRaw(lang)))) {
        const required = placeholders(value);
        if (required.length === 0) continue;
        const options: Record<string, string | number> = {};
        for (const name of required) {
          options[name] = name === "count" ? 2 : `val-${name}`;
        }
        const msg = i18n.t(key, { ...options, lng: lang });
        expect(msg, `${lang}:${key} left literal tokens`).not.toMatch(/\{\{/);
        for (const name of required) {
          expect(msg, `${lang}:${key} lost {{${name}}}`).toContain(
            name === "count" ? "2" : `val-${name}`,
          );
        }
      }
    }
  });

  it("known interpolation keys render correctly (Arabic)", () => {
    expect(i18n.t("stations.started", { name: "PS5 — جهاز 1" })).toBe(
      "بدأ تشغيل PS5 — جهاز 1.",
    );
    expect(
      i18n.t("settings.confirmDeactivateBody", { name: "جهاز 2" }),
    ).toContain("«جهاز 2»");
    expect(i18n.t("settings.deviceCount", { count: 4 })).toBe("4 جهاز");
    expect(i18n.t("day.closeBlockedBody", { count: "٣" })).toContain("٣");
  });
});

describe("fallback behavior", () => {
  it("unknown keys fall back to the key itself", () => {
    expect(i18n.t("nope.not.a.key")).toBe("nope.not.a.key");
    expect(i18n.t("stations.noSuchKey")).toBe("stations.noSuchKey");
  });

  it("configured language is Arabic with Arabic fallback", () => {
    expect(i18n.language).toBe("ar");
    // i18next normalizes fallbackLng to an array internally.
    expect(i18n.options.fallbackLng).toEqual(["ar"]);
  });
});

describe("static call-site audit", () => {
  it("every literal translation key used in source exists in resources", () => {
    const patterns = [
      /\bt\(\s*["']([A-Za-z0-9_.-]+)["']/g,
      /\bmessageKey:\s*["']([A-Za-z0-9_.-]+)["']/g,
      /\blabelKey:\s*["']([A-Za-z0-9_.-]+)["']/g,
    ];
    const first = SUPPORTED_LANGS[0] as string;
    const reference = flatten(readLocaleRaw(first));
    const missing: string[] = [];
    for (const file of walkSourceFiles(SRC_DIR)) {
      const content = readFileSync(file, "utf8");
      for (const pattern of patterns) {
        for (const m of content.matchAll(pattern)) {
          const key = m[1] as string;
          if (NON_TRANSLATION_KEYS.has(key)) continue;
          if (!(key in reference)) {
            missing.push(`${file}: ${key}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("stopStation data flow (root-cause regression)", () => {
  beforeEach(() => {
    __clearMemoryDb();
    __resetDbForTests();
  });

  it("stopStation supplies every placeholder required by stations.stopped", async () => {
    const actions = useCafeActions(async () => {});
    await dayRepo.openDay(Date.now());
    const station = await stationRepo.createStation(
      "Coffee Machine",
      "#2ee6ff",
    );
    const start = await actions.startStation(station.id);
    expect(start.ok).toBe(true);

    const stop = await actions.stopStation(station.id);
    expect(stop.ok).toBe(true);
    expect(stop.messageKey).toBe("stations.stopped");

    const resource = flatten(readLocaleRaw("ar"))["stations.stopped"] as string;
    const params = stop.params as Record<string, unknown>;
    for (const name of placeholders(resource)) {
      expect(params, `missing runtime value for {{${name}}}`).toHaveProperty(
        name,
      );
    }

    const msg = i18n.t(stop.messageKey, params as Record<string, string>);
    expect(msg).toContain("Coffee Machine");
    expect(msg).toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(msg).not.toMatch(/\{\{/);
  });
});

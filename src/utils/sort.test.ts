import { describe, expect, it } from "vitest";
import {
  compareNullableNumber,
  compareNullableText,
  compareTimestamps,
  nextSort,
  type SortDirection,
} from "./sort";

describe("compareNullableNumber", () => {
  it("sorts numerically, not lexicographically (2, 20, 100)", () => {
    const values = [2, 20, 100];
    const asc = [...values].sort((a, b) => compareNullableNumber(a, b, "asc"));
    expect(asc).toEqual([2, 20, 100]);

    const desc = [...values].sort((a, b) =>
      compareNullableNumber(a, b, "desc"),
    );
    expect(desc).toEqual([100, 20, 2]);
  });

  it("treats null/undefined as missing and sorts them last", () => {
    const asc = [20, null, 2, undefined, 100].sort((a, b) =>
      compareNullableNumber(a as number | null, b as number | null, "asc"),
    );
    expect(asc).toEqual([2, 20, 100, null, undefined]);

    const desc = [20, null, 2, undefined, 100].sort((a, b) =>
      compareNullableNumber(a as number | null, b as number | null, "desc"),
    );
    expect(desc).toEqual([100, 20, 2, null, undefined]);
  });

  it("treats non-finite values as missing", () => {
    const asc = [20, NaN, 2, Infinity, 100].sort((a, b) =>
      compareNullableNumber(a, b, "asc"),
    );
    expect(asc).toEqual([2, 20, 100, NaN, Infinity]);
  });
});

describe("compareNullableText", () => {
  it("sorts text locale-aware with numeric collation", () => {
    const values = ["item 2", "item 20", "item 100"];
    const asc = [...values].sort((a, b) =>
      compareNullableText(a, b, "asc", "ar"),
    );
    expect(asc).toEqual(["item 2", "item 20", "item 100"]);
  });

  it("treats empty strings as missing and sorts them last", () => {
    const asc = ["b", "", "a", null].sort((a, b) =>
      compareNullableText(a as string | null, b as string | null, "asc", "ar"),
    );
    expect(asc).toEqual(["a", "b", "", null]);
  });
});

describe("compareTimestamps", () => {
  const base = 1_700_000_000_000; // 2023-11-14

  it("sorts ascending chronologically", () => {
    const values = [base + 2000, base, base + 1000];
    const asc = [...values].sort((a, b) => compareTimestamps(a, b, "asc"));
    expect(asc).toEqual([base, base + 1000, base + 2000]);
  });

  it("sorts descending chronologically (newest first)", () => {
    const values = [base, base + 2000, base + 1000];
    const desc = [...values].sort((a, b) => compareTimestamps(a, b, "desc"));
    expect(desc).toEqual([base + 2000, base + 1000, base]);
  });

  it("asc and desc are exact inverses", () => {
    const values = [base, base + 1000, base + 2000, base + 3000];
    const asc = [...values].sort((a, b) => compareTimestamps(a, b, "asc"));
    const desc = [...values].sort((a, b) => compareTimestamps(a, b, "desc"));
    expect(desc).toEqual([...asc].reverse());
  });

  it("uses id tie-breaker for identical timestamps", () => {
    const asc = [
      { ts: base, id: 2 },
      { ts: base, id: 1 },
    ].sort((a, b) =>
      compareTimestamps(a.ts, b.ts, "asc", { a: a.id, b: b.id }),
    );
    expect(asc.map((x) => x.id)).toEqual([1, 2]);

    const desc = [
      { ts: base, id: 1 },
      { ts: base, id: 2 },
    ].sort((a, b) =>
      compareTimestamps(a.ts, b.ts, "desc", { a: a.id, b: b.id }),
    );
    expect(desc.map((x) => x.id)).toEqual([2, 1]);
  });

  it("sorts missing/invalid timestamps last in both directions", () => {
    const values: unknown[] = [base, null, undefined, NaN, -1, base + 1000];
    const asc = [...values].sort((a, b) => compareTimestamps(a, b, "asc"));
    expect(asc[0]).toBe(base);
    expect(asc[1]).toBe(base + 1000);
    // Missing values at the end in any order
    expect([asc[2], asc[3], asc[4], asc[5]]).toEqual(
      expect.arrayContaining([null, undefined, NaN, -1]),
    );

    const desc = [...values].sort((a, b) => compareTimestamps(a, b, "desc"));
    expect(desc[0]).toBe(base + 1000);
    expect(desc[1]).toBe(base);
    expect([desc[2], desc[3], desc[4], desc[5]]).toEqual(
      expect.arrayContaining([null, undefined, NaN, -1]),
    );
  });
});

describe("nextSort", () => {
  it("selects a new column with its initial direction", () => {
    const result = nextSort(null, "name", "asc");
    expect(result).toEqual({ key: "name", dir: "asc" });
  });

  it("toggles direction on same column", () => {
    const first = nextSort({ key: "name", dir: "asc" }, "name", "asc");
    expect(first).toEqual({ key: "name", dir: "desc" });

    const second = nextSort(first, "name", "asc");
    expect(second).toEqual({ key: "name", dir: "asc" });
  });

  it("switching columns resets to initial direction", () => {
    const current = { key: "name", dir: "desc" } as {
      key: string;
      dir: SortDirection;
    };
    const result = nextSort(current, "date", "desc");
    expect(result).toEqual({ key: "date", dir: "desc" });
  });
});

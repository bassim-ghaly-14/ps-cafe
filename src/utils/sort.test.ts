import { describe, expect, it } from "vitest";
import {
  compareNullableNumber,
  compareNullableText,
  compareTimestamps,
  nextSort,
  nextSortCycle,
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

describe("nextSortCycle (three-state: null -> asc -> desc -> null)", () => {
  it("starts ascending on a new column", () => {
    expect(nextSortCycle(null, "revenue", "asc")).toEqual({
      key: "revenue",
      dir: "asc",
    });
  });

  it("cycles asc -> desc -> unsorted on repeated clicks", () => {
    const asc = nextSortCycle(null, "revenue", "asc");
    expect(asc).toEqual({ key: "revenue", dir: "asc" });
    const desc = nextSortCycle(asc, "revenue", "asc");
    expect(desc).toEqual({ key: "revenue", dir: "desc" });
    expect(nextSortCycle(desc, "revenue", "asc")).toBeNull();
  });

  it("switching columns restarts at ascending", () => {
    const current = { key: "revenue", dir: "desc" } as {
      key: string;
      dir: SortDirection;
    };
    expect(nextSortCycle(current, "sessions", "asc")).toEqual({
      key: "sessions",
      dir: "asc",
    });
  });
});

describe("sorting pipeline semantics", () => {
  it("sorts 2, 10, 100 numerically (not lexicographically)", () => {
    const rows = [{ v: 100 }, { v: 2 }, { v: 10 }];
    const asc = [...rows].sort((a, b) =>
      compareNullableNumber(a.v, b.v, "asc"),
    );
    expect(asc.map((r) => r.v)).toEqual([2, 10, 100]);
  });

  it("sorts decimals and monetary minor-units numerically", () => {
    const rows = [{ v: 1999 }, { v: 200 }, { v: 20000 }, { v: 1050 }];
    const asc = [...rows].sort((a, b) =>
      compareNullableNumber(a.v, b.v, "asc"),
    );
    expect(asc.map((r) => r.v)).toEqual([200, 1050, 1999, 20000]);
    const floats = [{ v: 1.5 }, { v: 1.25 }, { v: 10.1 }, { v: 2.75 }];
    expect(
      [...floats]
        .sort((a, b) => compareNullableNumber(a.v, b.v, "asc"))
        .map((r) => r.v),
    ).toEqual([1.25, 1.5, 2.75, 10.1]);
  });

  it("sorts dates by timestamp, not display string", () => {
    const rows = [
      { ts: 1_700_000_000_000 + 80_000_000, label: "9:30 AM" },
      { ts: 1_700_000_000_000, label: "10:00 PM" },
    ];
    const asc = [...rows].sort((a, b) => compareTimestamps(a.ts, b.ts, "asc"));
    expect(asc.map((r) => r.label)).toEqual(["10:00 PM", "9:30 AM"]);
  });

  it("keeps missing values last in both directions", () => {
    const nums = [5, null, 3, undefined, 9];
    const ascNums = [...nums].sort((x, y) =>
      compareNullableNumber(
        x as number | null | undefined,
        y as number | null | undefined,
        "asc",
      ),
    );
    expect(ascNums.slice(0, 3)).toEqual([3, 5, 9]);
    const descNums = [...nums].sort((x, y) =>
      compareNullableNumber(
        x as number | null | undefined,
        y as number | null | undefined,
        "desc",
      ),
    );
    expect(descNums.slice(0, 3)).toEqual([9, 5, 3]);
  });

  it("is stable: equal values keep their relative order", () => {
    const rows = [
      { id: 1, revenue: 100 },
      { id: 2, revenue: 100 },
      { id: 3, revenue: 50 },
    ];
    const asc = [...rows].sort((a, b) =>
      compareNullableNumber(a.revenue, b.revenue, "asc"),
    );
    expect(asc.map((r) => r.id)).toEqual([3, 1, 2]);
  });

  it("does not mutate the source array", () => {
    const rows = [{ v: 3 }, { v: 1 }, { v: 2 }];
    const snapshot = rows.map((r) => ({ ...r }));
    const sorted = [...rows].sort((a, b) =>
      compareNullableNumber(a.v, b.v, "asc"),
    );
    expect(rows).toEqual(snapshot);
    expect(sorted.map((r) => r.v)).toEqual([1, 2, 3]);
  });

  it("filter -> sort -> paginate pipeline reorders the visible page", () => {
    const rows = [
      { id: 1, name: "alpha", revenue: 300 },
      { id: 2, name: "beta", revenue: 100 },
      { id: 3, name: "alphabet", revenue: 200 },
    ];
    const filtered = rows.filter((r) => r.name.includes("alpha"));
    const sorted = [...filtered].sort((a, b) =>
      compareNullableNumber(a.revenue, b.revenue, "asc"),
    );
    expect(sorted.slice(0, 2).map((r) => r.id)).toEqual([3, 1]);
  });

  it("compares Arabic text consistently", () => {
    const a = "القاهرة";
    const b = "الجيزة";
    const ascCmp = compareNullableText(a, b, "asc", "ar");
    expect(ascCmp).not.toBe(0);
    expect(compareNullableText(a, b, "desc", "ar")).toBe(-ascCmp);
  });
});

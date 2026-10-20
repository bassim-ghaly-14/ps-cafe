import { describe, expect, it, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import HistoryScreen from "./HistoryScreen";
import { readyPromise } from "../i18n";
import type { BusinessDay } from "../domain/types";

function day(id: number, start: number, end: number | null): BusinessDay {
  return { id, startedAtUtc: start, endedAtUtc: end, createdAtUtc: start };
}

// Row order helper: day ids render as `#<id>` in the first cell of each row.
function rowIds(): number[] {
  const cells = document.querySelectorAll("tbody tr td:first-child");
  return Array.from(cells).map((td) =>
    Number((td.textContent ?? "").replace("#", "")),
  );
}

const t0 = Date.UTC(2026, 9, 17, 8, 0, 0);
// Newest-first: the genuine server default from businessDayRepo.listDays.
const days = [
  day(3, t0 + 2000, t0 + 3000),
  day(2, t0 + 1000, t0 + 2000),
  day(1, t0, t0 + 1000),
];
const aggs = new Map([
  [1, { count: 1, totalMs: 300, revenueMinor: 300 }],
  [2, { count: 2, totalMs: 100, revenueMinor: 100 }],
  [3, { count: 3, totalMs: 200, revenueMinor: 200 }],
]);

function renderHistory(
  override?: Partial<{ days: BusinessDay[]; aggs: typeof aggs }>,
) {
  render(
    <HistoryScreen
      openDay={null}
      days={override?.days ?? days}
      dayAggregates={override?.aggs ?? aggs}
      onBack={() => {}}
    />,
  );
}

describe("HistoryScreen sorting (regression: header clicks reordered nothing)", () => {
  beforeEach(async () => {
    cleanup();
    await readyPromise;
  });

  it("starts unsorted (server default) with neutral indicators", () => {
    renderHistory();
    expect(rowIds()).toEqual([3, 2, 1]);
    for (const th of document.querySelectorAll("th")) {
      expect(th.getAttribute("aria-sort")).toBe("none");
    }
  });

  it("clicking a column cycles asc -> desc -> unsorted (default)", () => {
    renderHistory();
    const revenueBtn = screen.getByRole("button", { name: /إجمالي الإيراد/ });
    fireEvent.click(revenueBtn);
    expect(rowIds()).toEqual([2, 3, 1]); // 100, 200, 300
    expect(document.querySelectorAll("th")[6]?.getAttribute("aria-sort")).toBe(
      "ascending",
    );

    fireEvent.click(revenueBtn);
    expect(rowIds()).toEqual([1, 3, 2]); // 300, 200, 100
    expect(document.querySelectorAll("th")[6]?.getAttribute("aria-sort")).toBe(
      "descending",
    );

    fireEvent.click(revenueBtn);
    expect(rowIds()).toEqual([3, 2, 1]); // back to server default
    expect(document.querySelectorAll("th")[6]?.getAttribute("aria-sort")).toBe(
      "none",
    );
  });

  it("selecting a different column restarts at ascending", () => {
    renderHistory();
    fireEvent.click(screen.getByRole("button", { name: /إجمالي الإيراد/ }));
    expect(rowIds()).toEqual([2, 3, 1]);
    fireEvent.click(screen.getByRole("button", { name: /مرات التشغيل/ }));
    // counts: day1=1, day2=2, day3=3 -> asc yields ids [1,2,3].
    expect(rowIds()).toEqual([1, 2, 3]);
  });

  it("refetched data keeps the active sort applied (no stale order)", () => {
    const { rerender } = render(
      <HistoryScreen
        openDay={null}
        days={days}
        dayAggregates={aggs}
        onBack={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /إجمالي الإيراد/ }));
    expect(rowIds()).toEqual([2, 3, 1]);
    const grown = [
      day(4, t0 + 3000, t0 + 4000),
      day(3, t0 + 2000, t0 + 3000),
      day(2, t0 + 1000, t0 + 2000),
      day(1, t0, t0 + 1000),
    ];
    const grownAggs = new Map([
      ...aggs,
      [4, { count: 4, totalMs: 50, revenueMinor: 50 }],
    ]);
    rerender(
      <HistoryScreen
        openDay={null}
        days={grown}
        dayAggregates={grownAggs}
        onBack={() => {}}
      />,
    );
    expect(rowIds()).toEqual([4, 2, 3, 1]); // 50, 100, 200, 300
  });
});

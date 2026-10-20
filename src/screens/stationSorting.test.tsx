import { describe, expect, it, beforeEach } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import { __clearMemoryDb } from "../db/memory";
import { __resetDbForTests as resetClient } from "../db/client";
import StationDetailsScreen from "./StationDetailsScreen";
import * as dayRepo from "../repositories/businessDayRepo";
import * as stationRepo from "../repositories/stationRepo";
import * as sessionRepo from "../repositories/sessionRepo";
import { readyPromise } from "../i18n";

beforeEach(async () => {
  __clearMemoryDb();
  resetClient();
  cleanup();
  localStorage.clear();
  await readyPromise;
});

// Durations render as HH:MM:SS via formatHMS in the third column.
function durationCells(): string[] {
  const rows = document.querySelectorAll("tbody tr");
  return Array.from(rows).map(
    (tr) => tr.querySelectorAll("td")[2]?.textContent ?? "",
  );
}

describe("StationDetailsScreen server-side sorting", () => {
  it("regression: clicking headers refetches in the new order (no stale rows)", async () => {
    const t0 = Date.UTC(2026, 9, 17, 8, 0, 0);
    const open = await dayRepo.openDay(t0);
    const stations = await stationRepo.listStations();
    const sid = stations[0]!.id;
    // Three sessions with distinct durations: 20m, 100m, 2h.
    const mk = async (startOff: number, durMs: number) => {
      const s = await sessionRepo.startSession(sid, open.id, t0 + startOff);
      await sessionRepo.stopSession(s.id, t0 + startOff + durMs);
    };
    await mk(0, 2 * 3_600_000);
    await mk(10_000, 20 * 60_000);
    await mk(20_000, 100 * 60_000);

    render(
      <StationDetailsScreen
        stationId={sid}
        openDay={open}
        onBack={() => {}}
        onStart={async () => ({ ok: true, messageKey: "x" })}
        onStop={async () => ({ ok: true, messageKey: "x" })}
        setNotice={() => {}}
      />,
    );

    // Default: newest-first by startedAt.
    await waitFor(() => expect(durationCells().length).toBe(3));
    const initial = durationCells();
    // Newest (100m) first in the default order.
    expect(initial[0]).toContain("01:40");

    // Click المدة (duration): null -> asc => shortest first, page reset to 0.
    fireEvent.click(screen.getByRole("button", { name: /المدة/ }));
    await waitFor(() => expect(durationCells()[0]).toContain("00:20"));
    expect(durationCells()).toEqual(
      expect.arrayContaining([
        expect.stringContaining("00:20"),
        expect.stringContaining("01:40"),
        expect.stringContaining("02:00"),
      ]),
    );
    const ascFirst: string = durationCells()[0] ?? "";
    expect(ascFirst).toContain("00:20");
    expect(document.querySelector('th[aria-sort="ascending"]')).not.toBeNull();

    // Click again: asc -> desc => longest first.
    fireEvent.click(screen.getByRole("button", { name: /المدة/ }));
    await waitFor(() => expect(durationCells()[0]).toContain("02:00"));

    // Third click: back to unsorted server default (newest first).
    fireEvent.click(screen.getByRole("button", { name: /المدة/ }));
    await waitFor(() => expect(durationCells()[0]).toContain("01:40"));
    expect(document.querySelector('th[aria-sort="ascending"]')).toBeNull();
    expect(document.querySelector('th[aria-sort="descending"]')).toBeNull();
  });
});

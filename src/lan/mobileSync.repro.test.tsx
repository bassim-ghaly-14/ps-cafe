import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  act,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import { __clearMemoryDb } from "../db/memory";
import { __resetDbForTests as resetClient } from "../db/client";
import { clearLanToken, writeLanToken } from "../db/http";
import App from "../App";
import { readyPromise } from "../i18n";

const LAN_MARKER = "__PSCAFE_LAN__";
const TOKEN = `pscafe_${"a".repeat(32)}`;

function setLan(on: boolean): void {
  if (on) {
    (window as unknown as Record<string, unknown>)[LAN_MARKER] = 1;
  } else {
    delete (window as unknown as Record<string, unknown>)[LAN_MARKER];
  }
}

function mockFetch(
  rowsBySql: Record<string, unknown[] | (() => unknown[])>,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (_url: string, init: any) => {
    const body = JSON.parse(init.body as string) as {
      sql: string;
      params: unknown[];
    };
    const key = Object.keys(rowsBySql).find((k) => body.sql.includes(k));
    let rows = key ? rowsBySql[key] : [];
    if (typeof rows === "function") rows = (rows as () => unknown[])();
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, rows }),
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const STATIONS_SQL = "SELECT * FROM stations ORDER BY sort_order ASC, id ASC";
const OPEN_DAY_SQL =
  "SELECT * FROM business_days WHERE ended_at_utc IS NULL LIMIT 1";
const STATIONS = [
  {
    id: 1,
    name: "PS5 — جهاز 1",
    color_hex: "#2ee6ff",
    sort_order: 0,
    is_visible: 1,
    is_active: 1,
    hourly_rate_minor: 3000,
    created_at_utc: 1_700_000_000_000,
    updated_at_utc: 1_700_000_000_000,
  },
];
const OPEN_DAY = [
  {
    id: 1,
    started_at_utc: 1_700_000_000_000,
    ended_at_utc: null,
    created_at_utc: 1_700_000_000_000,
  },
];

async function renderReadyApp() {
  render(<App />);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 3500));
  });
}

beforeEach(async () => {
  __clearMemoryDb();
  resetClient();
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  clearLanToken();
  window.location.hash = "";
  vi.unstubAllGlobals();
  await readyPromise;
});

afterEach(() => {
  setLan(false);
  cleanup();
  vi.unstubAllGlobals();
});

describe("mobile LAN sync diagnostics", () => {
  it("paired client renders authoritative gateway data and reports synchronized", async () => {
    setLan(true);
    writeLanToken(TOKEN);
    const fetchMock = mockFetch({
      [STATIONS_SQL]: STATIONS,
      [OPEN_DAY_SQL]: OPEN_DAY,
    });

    await renderReadyApp();

    fireEvent.click(screen.getByRole("button", { name: "الأجهزة" }));
    await waitFor(() =>
      expect(screen.getByText("PS5 — جهاز 1")).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByText(/مزامَن مع الكمبيوتر/)).toBeInTheDocument(),
    );
    fetchMock.mock.calls.forEach(([url]) => {
      expect(url).toBe("/api/select");
    });
    const authHeaders = fetchMock.mock.calls.map(
      ([, init]) => init.headers.Authorization,
    );
    expect(authHeaders.every((h) => h === `Bearer ${TOKEN}`)).toBe(true);
  });

  it("paired client whose LAN request fails does NOT report synchronized", async () => {
    setLan(true);
    writeLanToken(TOKEN);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );

    await renderReadyApp();

    expect(screen.queryByText(/مزامَن مع الكمبيوتر/)).not.toBeInTheDocument();
  });

  it("unpaired LAN client (marker, no token) does not report synchronized", async () => {
    setLan(true);
    await renderReadyApp();

    expect(screen.queryByText(/مزامَن مع الكمبيوتر/)).not.toBeInTheDocument();
    expect(screen.getByText(/غير مقترن/)).toBeInTheDocument();
  });

  it("live update: mobile re-renders when mocked gateway data changes via polling without reload", async () => {
    vi.useFakeTimers();
    try {
      setLan(true);
      writeLanToken(TOKEN);
      let currentStations: typeof STATIONS = [...STATIONS];
      mockFetch({
        [STATIONS_SQL]: () => currentStations,
        [OPEN_DAY_SQL]: OPEN_DAY,
      });

      render(<App />);
      // Advance past the 3s splash and let the mount-time refresh settle.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000);
      });

      fireEvent.click(screen.getByRole("button", { name: "الأجهزة" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(screen.getByText("PS5 — جهاز 1")).toBeInTheDocument();

      // Desktop-side change: the gateway now returns a renamed station.
      currentStations = STATIONS.map((s) => ({ ...s, name: "PS5 — جهاز 9" }));
      // Advance past the 10s revalidation interval so the poll fires.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(11_000);
      });
      expect(screen.getByText("PS5 — جهاز 9")).toBeInTheDocument();
      expect(screen.queryByText("PS5 — جهاز 1")).not.toBeInTheDocument();
      expect(screen.getByText(/مزامَن مع الكمبيوتر/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

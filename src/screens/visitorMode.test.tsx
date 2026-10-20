import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  render,
  screen,
  act,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import { __clearMemoryDb } from "../db/memory";
import { __resetDbForTests as resetClient } from "../db/client";
import App from "../App";
import { readyPromise } from "../i18n";

/**
 * Visitor mode (a browser served by the desktop's LAN gateway) is
 * permanently read-only. These tests assert the UX layer: mutation
 * controls are not offered at all, so a visitor never attempts a write.
 * The authoritative enforcement lives in the Rust gateway.
 */

const LAN_MARKER = "__PSCAFE_LAN__";

function setVisitor(on: boolean): void {
  if (on) {
    (window as unknown as Record<string, unknown>)[LAN_MARKER] = 1;
  } else {
    delete (window as unknown as Record<string, unknown>)[LAN_MARKER];
  }
}

beforeEach(async () => {
  __clearMemoryDb();
  resetClient();
  cleanup();
  localStorage.clear();
  window.location.hash = "";
  await readyPromise;
});

afterEach(() => {
  setVisitor(false);
});

/** Renders App and waits past the 3s splash so the app content is shown. */
async function renderReadyApp() {
  render(<App />);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 3200));
  });
}

describe("visitor mode (read-only LAN browser)", () => {
  it("does not offer the business-day open/close control", async () => {
    setVisitor(true);
    await renderReadyApp();
    expect(screen.queryByRole("button", { name: "بدء يوم العمل" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "إغلاق يوم العمل" }),
    ).toBeNull();
  });

  it("does not offer start/stop controls on the station cards", async () => {
    setVisitor(true);
    await renderReadyApp();
    fireEvent.click(screen.getByRole("button", { name: "الأجهزة" }));
    await waitFor(() =>
      expect(document.querySelectorAll(".card-open").length).toBeGreaterThan(0),
    );
    expect(screen.queryByRole("button", { name: "بدء" })).toBeNull();
    expect(screen.queryByRole("button", { name: "إغلاق" })).toBeNull();
  });

  it("does not offer station management controls in settings", async () => {
    setVisitor(true);
    await renderReadyApp();
    fireEvent.click(screen.getByRole("button", { name: "الإعدادات" }));
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "كروت الأجهزة" }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /إضافة جهاز/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "تعديل" })).toBeNull();
  });

  it("keeps the read-only data visible (stations are still listed)", async () => {
    setVisitor(true);
    await renderReadyApp();
    fireEvent.click(screen.getByRole("button", { name: "الأجهزة" }));
    await waitFor(() =>
      expect(document.querySelectorAll(".card-open").length).toBeGreaterThan(0),
    );
    expect(screen.getByText("PS5 — جهاز 1")).toBeInTheDocument();
  });
});

describe("desktop mode keeps full write access", () => {
  it("still offers the business-day open control", async () => {
    await renderReadyApp();
    expect(
      screen.getByRole("button", { name: "بدء يوم العمل" }),
    ).toBeInTheDocument();
  });

  it("still offers start/stop controls on the station cards", async () => {
    await renderReadyApp();
    fireEvent.click(screen.getByRole("button", { name: "الأجهزة" }));
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "بدء" }).length,
      ).toBeGreaterThan(0),
    );
  });

  it("still offers station management controls in settings", async () => {
    await renderReadyApp();
    fireEvent.click(screen.getByRole("button", { name: "الإعدادات" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /إضافة جهاز/ }),
      ).toBeInTheDocument(),
    );
  });
});

import { describe, expect, it, beforeEach, vi } from "vitest";
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
import { __resetDbForTests as resetClient, isDemoDbActive } from "../db/client";
import App from "../App";
import { readyPromise } from "../i18n";
import { ACTIVE_TAB_KEY } from "../constants";

beforeEach(async () => {
  __clearMemoryDb();
  resetClient();
  cleanup();
  localStorage.clear();
  await readyPromise;
});

/** Renders App and waits past the 3s splash so the app content is shown. */
async function renderReadyApp() {
  render(<App />);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 3200));
  });
}

/** Helper: render App and wait past the 3s splash (old name kept for readability). */
function renderApp() {
  render(<App />);
}

describe("RTL and i18n", () => {
  it("html lang is ar and dir is rtl", async () => {
    await renderReadyApp();
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
  });

  it("splash displays Arabic title and tagline before app reveal", async () => {
    renderApp();
    // Within the 3s minimum the splash must still be visible.
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("PS Cafe")).toBeInTheDocument();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 3500));
    });
    // After the min duration the app content replaces the splash.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("bottom nav has three Arabic items in RTL order", async () => {
    await renderReadyApp();
    const nav = screen.getByRole("navigation", { name: "التنقل الرئيسي" });
    const items = nav.querySelectorAll("button");
    expect(items).toHaveLength(3);
    const labels = Array.from(items).map((b) => b.textContent ?? "");
    expect(labels).toEqual(["يوم العمل", "الأجهزة", "الإعدادات"]);
  });
});

describe("Business day screen", () => {
  it("shows closed pill before opening a business day", async () => {
    await renderReadyApp();
    expect(screen.getByText("يوم العمل مقفول")).toBeInTheDocument();
  });

  it("opens a business day and shows the start control", async () => {
    await renderReadyApp();
    const btn = screen.getByRole("button", { name: "بدء يوم العمل" });
    expect(btn).toBeInTheDocument();
  });
});

describe("business-day workflow", () => {
  it("opening a day shows live open state and the close control", async () => {
    await renderReadyApp();
    fireEvent.click(screen.getByRole("button", { name: "بدء يوم العمل" }));
    await waitFor(() =>
      expect(screen.getByText("يوم العمل مفتوح")).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "إغلاق يوم العمل" }),
    ).toBeInTheDocument();
    const clock = document.querySelector(".clock");
    expect(clock?.textContent).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("closing an empty day succeeds via confirmation dialog", async () => {
    await renderReadyApp();
    fireEvent.click(screen.getByRole("button", { name: "بدء يوم العمل" }));
    await waitFor(() =>
      expect(screen.getByText("يوم العمل مفتوح")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "إغلاق يوم العمل" }));
    await waitFor(() =>
      expect(screen.getByRole("alertdialog")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "تأكيد الإغلاق" }));
    await waitFor(() =>
      expect(screen.getByText("يوم العمل مقفول")).toBeInTheDocument(),
    );
  });
});

describe("stations workflow", () => {
  it("starting a station requires an open business day", async () => {
    await renderReadyApp();
    fireEvent.click(screen.getByRole("button", { name: "الأجهزة" }));
    await waitFor(() =>
      expect(screen.getByText(/يوم العمل مقفول —/)).toBeInTheDocument(),
    );
    const startBtn = screen.getAllByRole("button", { name: "بدء" })[0];
    expect(startBtn).toBeDisabled();
  });

  it("station starts, shows running state, then stops", async () => {
    await renderReadyApp();
    fireEvent.click(screen.getByRole("button", { name: "بدء يوم العمل" }));
    await waitFor(() =>
      expect(screen.getByText("يوم العمل مفتوح")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "الأجهزة" }));
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "بدء" }).length,
      ).toBeGreaterThan(0),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "بدء" })[0]!);
    await waitFor(() =>
      expect(screen.getAllByText("شغال").length).toBeGreaterThan(0),
    );
    expect(
      screen.getAllByRole("button", { name: "إغلاق" }).length,
    ).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "إغلاق" })[0]!);
    // The stop operation is async (persist session → refresh → notice), and
    // the other seeded stations already render "فاضي" while this one runs, so
    // waiting on "فاضي" cannot observe the stop. Wait for the stop notice,
    // which is set only after the operation completes.
    await waitFor(() =>
      expect(document.querySelector(".notice.ok")?.textContent).toMatch(
        /^تم إيقاف .+\. المدة المحفوظة \d{2}:\d{2}:\d{2}\.$/,
      ),
    );
    // The stopped station must be idle again and no card may still be running.
    expect(screen.getAllByText("فاضي").length).toBeGreaterThan(0);
    expect(screen.queryByText("شغال")).toBeNull();
    // Regression: the stop notice must interpolate the station name and the
    // saved duration — never render literal {{name}} / {{duration}} tokens.
    const notice = document.querySelector(".notice.ok");
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toMatch(
      /^تم إيقاف .+\. المدة المحفوظة \d{2}:\d{2}:\d{2}\.$/,
    );
    expect(notice?.textContent).not.toContain("{{");
  });

  it("closing a day while a station runs is blocked with Arabic message", async () => {
    await renderReadyApp();
    fireEvent.click(screen.getByRole("button", { name: "بدء يوم العمل" }));
    await waitFor(() =>
      expect(screen.getByText("يوم العمل مفتوح")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "الأجهزة" }));
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "بدء" }).length,
      ).toBeGreaterThan(0),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "بدء" })[0]!);
    await waitFor(() =>
      expect(screen.getAllByText("شغال").length).toBeGreaterThan(0),
    );
    fireEvent.click(screen.getByRole("button", { name: "يوم العمل" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "إغلاق يوم العمل" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "إغلاق يوم العمل" }));
    await waitFor(() =>
      expect(screen.getByRole("alertdialog")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "تأكيد الإغلاق" }));
    await waitFor(() =>
      expect(screen.getByText("لا يمكن إغلاق يوم العمل")).toBeInTheDocument(),
    );
    expect(screen.getByText("يوم العمل مفتوح")).toBeInTheDocument();
  });
});

describe("tab persistence", () => {
  it("saves selected tab and restores it after reload", async () => {
    await renderReadyApp();
    fireEvent.click(screen.getByRole("button", { name: "الإعدادات" }));
    await waitFor(() =>
      expect(localStorage.getItem(ACTIVE_TAB_KEY)).toBe("settings"),
    );
    cleanup();
    render(<App />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 3200));
    });
    const nav = screen.getByRole("navigation", { name: "التنقل الرئيسي" });
    const activeItem = nav.querySelector(".nav-item.active");
    expect(activeItem).toHaveTextContent("الإعدادات");
  });

  it("falls back to day tab for invalid persisted value", async () => {
    localStorage.setItem(ACTIVE_TAB_KEY, "evil-value");
    await renderReadyApp();
    const nav = screen.getByRole("navigation", { name: "التنقل الرئيسي" });
    const activeItem = nav.querySelector(".nav-item.active");
    expect(activeItem).toHaveTextContent("يوم العمل");
  });
});

describe("no footer and exactly three destinations", () => {
  it("renders no footer element", async () => {
    await renderReadyApp();
    expect(document.querySelector("footer")).toBeNull();
  });

  it("has exactly three nav destinations", async () => {
    await renderReadyApp();
    const nav = screen.getByRole("navigation", { name: "التنقل الرئيسي" });
    expect(nav.querySelectorAll("button")).toHaveLength(3);
  });
});

describe("settings action controls", () => {
  it("station rows show icon + Arabic label actions", async () => {
    await renderReadyApp();
    fireEvent.click(screen.getByRole("button", { name: "الإعدادات" }));
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "تعديل" }).length,
      ).toBeGreaterThan(0),
    );
    // Each action is icon + label with an accessible name (title mirrors it).
    for (const label of ["تعديل", "تغيير اللون"]) {
      const btns = screen.getAllByRole("button", { name: label });
      expect(btns.length).toBeGreaterThan(0);
      expect(btns[0]!.querySelector("svg")).not.toBeNull();
    }
    // Add-station button: icon + Arabic label (name may include icon prefix).
    const addBtns = screen.getAllByRole("button", { name: /إضافة جهاز/ });
    expect(addBtns.length).toBeGreaterThan(0);
    expect(addBtns[0]!.querySelector("svg")).not.toBeNull();
    expect(
      screen.getAllByRole("button", { name: "إخفاء" }).length,
    ).toBeGreaterThan(0);
  });

  it("settings header labels align with the station row cells", async () => {
    await renderReadyApp();
    fireEvent.click(screen.getByRole("button", { name: "الإعدادات" }));
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "تعديل" }).length,
      ).toBeGreaterThan(0),
    );

    const head = document.querySelector(".settings-station-row.head");
    expect(head).not.toBeNull();
    // The header must use the same cell count as a data row, otherwise the
    // grid wraps and the labels drift out of alignment with the columns.
    const dataRow = document.querySelector(".settings-station-row:not(.head)");
    expect(dataRow).not.toBeNull();
    expect(head!.children.length).toBe(dataRow!.children.length);
  });
});

describe("developer mode availability", () => {
  it("renders when the devtools env flag is absent, and stays inactive", async () => {
    vi.stubEnv("VITE_ENABLE_DEVTOOLS", undefined);
    try {
      await renderReadyApp();
      fireEvent.click(screen.getByRole("button", { name: "الإعدادات" }));
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "تفعيل وضع المطور" }),
        ).toBeInTheDocument(),
      );
      // Visible but inactive on a fresh launch: no demo banner, no demo DB.
      expect(screen.queryByText("بيانات تجريبية — ليست حقيقية")).toBeNull();
      expect(isDemoDbActive()).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("renders in production-like conditions (former capability flag off)", async () => {
    vi.stubEnv("VITE_ENABLE_DEVTOOLS", "0");
    try {
      await renderReadyApp();
      fireEvent.click(screen.getByRole("button", { name: "الإعدادات" }));
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "تفعيل وضع المطور" }),
        ).toBeInTheDocument(),
      );
      // The former build-time capability flag must not hide the section.
      expect(
        screen.getByRole("region", { name: "وضع المطور" }),
      ).toBeInTheDocument();
      expect(isDemoDbActive()).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("gates activation on the developer PIN (1422 rejected, 2214 accepted)", async () => {
    await renderReadyApp();
    fireEvent.click(screen.getByRole("button", { name: "الإعدادات" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "تفعيل وضع المطور" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "تفعيل وضع المطور" }));
    await waitFor(() =>
      expect(screen.getByRole("alertdialog")).toBeInTheDocument(),
    );
    // Masked numeric input.
    const input = screen.getByLabelText("الرمز") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(input.inputMode).toBe("numeric");
    // The previous PIN is rejected with the existing localized error and
    // must never activate Demo Mode.
    fireEvent.change(input, { target: { value: "1422" } });
    fireEvent.click(screen.getAllByRole("button", { name: "تاكيد" })[0]!);
    await waitFor(() =>
      expect(screen.getByText("الرمز غير صحيح")).toBeInTheDocument(),
    );
    expect(screen.queryByText("بيانات تجريبية — ليست حقيقية")).toBeNull();
    expect(isDemoDbActive()).toBe(false);
    // Correct PIN activates the simulated environment banner.
    fireEvent.change(input, { target: { value: "2214" } });
    fireEvent.click(screen.getAllByRole("button", { name: "تاكيد" })[0]!);
    await waitFor(() =>
      expect(
        screen.getAllByText("بيانات تجريبية — ليست حقيقية").length,
      ).toBeGreaterThan(0),
    );
    expect(isDemoDbActive()).toBe(true);
  });

  it("LAN client sees the developer section while restricted actions stay hidden", async () => {
    (window as unknown as Record<string, unknown>).__PSCAFE_LAN__ = 1;
    try {
      await renderReadyApp();
      fireEvent.click(screen.getByRole("button", { name: "الإعدادات" }));
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "تفعيل وضع المطور" }),
        ).toBeInTheDocument(),
      );
      // Visibility on a LAN client must not un-hide the LAN-restricted
      // destructive database reset section.
      expect(
        screen.queryByRole("region", { name: "إعادة ضبط قاعدة البيانات" }),
      ).toBeNull();
      // No demo state exists without the PIN-gated activation flow.
      expect(isDemoDbActive()).toBe(false);
      expect(screen.queryByText("بيانات تجريبية — ليست حقيقية")).toBeNull();
    } finally {
      delete (window as unknown as Record<string, unknown>).__PSCAFE_LAN__;
    }
  });
});

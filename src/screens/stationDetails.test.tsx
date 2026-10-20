import { describe, expect, it, beforeEach } from "vitest";
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

beforeEach(async () => {
  __clearMemoryDb();
  resetClient();
  cleanup();
  localStorage.clear();
  window.location.hash = "";
  await readyPromise;
});

/** Renders App and waits past the 3s splash so the app content is shown. */
async function renderReadyApp() {
  render(<App />);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 3200));
  });
}

async function openDayAndStations() {
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
}

describe("device details page", () => {
  it("clicking a device card navigates to its dedicated full-page route", async () => {
    await openDayAndStations();
    const cards = document.querySelectorAll(".card-open");
    expect(cards.length).toBeGreaterThan(0);
    fireEvent.click(cards[0]!);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "رجوع للأجهزة" }),
      ).toBeInTheDocument(),
    );
    expect(window.location.hash).toMatch(/^#\/stations\/\d+$/);
    // Dedicated page (not a modal/drawer/dialog overlay).
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("سجل الجلسات")).toBeInTheDocument();
    expect(screen.getByText("إجمالي الإيراد")).toBeInTheDocument();
  });

  it("back navigation returns to the stations grid", async () => {
    await openDayAndStations();
    fireEvent.click(document.querySelectorAll(".card-open")[0]!);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "رجوع للأجهزة" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "رجوع للأجهزة" }));
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "بدء" }).length,
      ).toBeGreaterThan(0),
    );
    expect(window.location.hash).not.toMatch(/^#\/stations\//);
  });

  it("deep-linking an unknown id shows a safe not-found state", async () => {
    window.location.hash = "#/stations/99999";
    await renderReadyApp();
    await waitFor(() =>
      expect(screen.getByText("الجهاز غير موجود")).toBeInTheDocument(),
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("start/stop buttons still work from the grid (no regression)", async () => {
    await openDayAndStations();
    fireEvent.click(screen.getAllByRole("button", { name: "بدء" })[0]!);
    await waitFor(() =>
      expect(screen.getAllByText("شغال").length).toBeGreaterThan(0),
    );
  });
});

describe("per-device hourly rate form", () => {
  it("edit form shows a rate field below the name field and saves it", async () => {
    await renderReadyApp();
    fireEvent.click(screen.getByRole("button", { name: "الإعدادات" }));
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "تعديل" }).length,
      ).toBeGreaterThan(0),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "تعديل" })[0]!);
    await waitFor(() =>
      expect(screen.getByText("سعر الساعة (جنيه)")).toBeInTheDocument(),
    );
    // form-associated query via the explicit label `for` attribute.
    const rateInput = document.getElementById(
      "station-rate",
    ) as HTMLInputElement;
    const nameInput = document.getElementById(
      "station-name",
    ) as HTMLInputElement;
    expect(rateInput).not.toBeNull();
    expect(rateInput.type).toBe("number");
    expect(rateInput.min).toBe("0");
    // Rate field is directly below the name field in the same form.
    expect(
      nameInput.compareDocumentPosition(rateInput) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.change(rateInput, { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    await waitFor(() =>
      expect(screen.getByText("تم تحديث الجهاز.")).toBeInTheDocument(),
    );
  });

  it("rejects empty and negative rates without saving", async () => {
    await renderReadyApp();
    fireEvent.click(screen.getByRole("button", { name: "الإعدادات" }));
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "تعديل" }).length,
      ).toBeGreaterThan(0),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "تعديل" })[0]!);
    await waitFor(() =>
      expect(screen.getByText("سعر الساعة (جنيه)")).toBeInTheDocument(),
    );
    const rateInput = document.getElementById(
      "station-rate",
    ) as HTMLInputElement;
    fireEvent.change(rateInput, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    await waitFor(() =>
      expect(screen.getByText(/سعر الساعة مطلوب/)).toBeInTheDocument(),
    );
    fireEvent.change(rateInput, { target: { value: "-5" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    await waitFor(() =>
      expect(screen.getByText(/سعر الساعة غير صالح/)).toBeInTheDocument(),
    );
  });
});

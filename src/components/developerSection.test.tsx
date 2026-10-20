import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import DeveloperSection from "./DeveloperSection";
import { readyPromise } from "../i18n";

type Props = ComponentProps<typeof DeveloperSection>;

interface Handlers {
  onEnter: ReturnType<typeof vi.fn>;
  onReseed: ReturnType<typeof vi.fn>;
  onExit: ReturnType<typeof vi.fn>;
}

function makeHandlers(): Handlers {
  return {
    onEnter: vi.fn().mockResolvedValue({ ok: true }),
    onReseed: vi.fn().mockResolvedValue({ ok: true }),
    onExit: vi.fn().mockResolvedValue(undefined),
  };
}

/** Render the section with inactive-by-default props and spy handlers. */
function renderSection(
  overrides: Partial<Props> = {},
  handlers: Handlers = makeHandlers(),
): Handlers {
  const props: Props = {
    demoActive: false,
    demoScenario: null,
    demoError: null,
    busy: false,
    ...handlers,
    ...overrides,
  };
  render(<DeveloperSection {...props} />);
  return handlers;
}

/** Every localStorage key/value as one string, to assert nothing stores the PIN. */
function localStorageDump(): string {
  const parts: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key !== null) parts.push(key, localStorage.getItem(key) ?? "");
  }
  return parts.join("\n");
}

function clickEnable() {
  fireEvent.click(screen.getByRole("button", { name: "تفعيل وضع المطور" }));
}

async function openPinDialog() {
  clickEnable();
  await waitFor(() =>
    expect(screen.getByRole("alertdialog")).toBeInTheDocument(),
  );
  return screen.getByLabelText("الرمز") as HTMLInputElement;
}

beforeEach(async () => {
  cleanup();
  localStorage.clear();
  await readyPromise;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  delete (window as unknown as Record<string, unknown>).__PSCAFE_LAN__;
});

describe("DeveloperSection PIN gate", () => {
  it("accepts PIN 2214 and invokes the activation callback exactly once with the selected scenario", async () => {
    const h = renderSection();
    const logSpies = (["log", "info", "warn", "error", "debug"] as const).map(
      (m) => vi.spyOn(console, m),
    );

    // Pick a non-default scenario before enabling.
    fireEvent.change(screen.getByLabelText("السيناريو التجريبي"), {
      target: { value: "empty" },
    });
    const input = await openPinDialog();
    expect(input.type).toBe("password");
    expect(input.inputMode).toBe("numeric");
    fireEvent.change(input, { target: { value: "2214" } });
    fireEvent.click(screen.getByRole("button", { name: "تاكيد" }));

    await waitFor(() => expect(h.onEnter).toHaveBeenCalledTimes(1));
    expect(h.onEnter).toHaveBeenCalledWith("empty");
    // Successful verification closes the dialog; nothing else fires.
    expect(h.onReseed).not.toHaveBeenCalled();
    expect(h.onExit).not.toHaveBeenCalled();
    // The PIN is never persisted or logged.
    expect(localStorageDump()).not.toContain("2214");
    const logged = logSpies
      .flatMap((s) => s.mock.calls.flat().map(String))
      .join(" ");
    expect(logged).not.toContain("2214");
    expect(logged).not.toContain("2214");
  });

  it("rejects the previous PIN 1422 and every wrong PIN without ever invoking activation", async () => {
    const h = renderSection();
    const input = await openPinDialog();

    for (const wrong of ["1422", "0000", "142", "22141"]) {
      fireEvent.change(input, { target: { value: wrong } });
      fireEvent.click(screen.getByRole("button", { name: "تاكيد" }));
      expect(screen.getByText("الرمز غير صحيح")).toBeInTheDocument();
      expect(h.onEnter).not.toHaveBeenCalled();
    }

    // Existing contract: the dialog stays open for a retry after a miss.
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(h.onEnter).not.toHaveBeenCalled();
    expect(localStorageDump()).not.toContain("2214");
  });
});

describe("DeveloperSection visibility", () => {
  it("renders when the devtools environment flag is absent", async () => {
    vi.stubEnv("VITE_ENABLE_DEVTOOLS", undefined);
    renderSection();
    expect(screen.getByText("وضع المطور")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "تفعيل وضع المطور" }),
    ).toBeInTheDocument();
    expect(screen.getByText("غير مفعل")).toBeInTheDocument();
  });

  it("renders in production-like conditions (former capability flag off)", async () => {
    vi.stubEnv("VITE_ENABLE_DEVTOOLS", "0");
    renderSection();
    // The former build-time capability flag must not hide the section.
    expect(
      screen.getByRole("button", { name: "تفعيل وضع المطور" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("بيانات تجريبية — ليست حقيقية")).toBeNull();
  });

  it("is a pure component: read-only gating happens in the Settings screen", () => {
    // The section itself performs no LAN/read-only gating — the parent
    // Settings screen decides whether to offer it. A visitor never gets
    // this component mounted (see SettingsScreen + visitorMode tests).
    (window as unknown as Record<string, unknown>).__PSCAFE_LAN__ = 1;
    renderSection();
    expect(
      screen.getByRole("button", { name: "تفعيل وضع المطور" }),
    ).toBeInTheDocument();
  });
});

describe("DeveloperSection activation (default state)", () => {
  it("a fresh mount never activates Demo Mode by itself", () => {
    const h = renderSection();
    expect(h.onEnter).not.toHaveBeenCalled();
    expect(h.onReseed).not.toHaveBeenCalled();
    expect(h.onExit).not.toHaveBeenCalled();
    expect(screen.getByText("غير مفعل")).toBeInTheDocument();
    expect(screen.queryByText("بيانات تجريبية — ليست حقيقية")).toBeNull();
    expect(screen.queryByText("التعديلات هنا لا تمس الحقيقية")).toBeNull();
    expect(localStorageDump()).not.toContain("2214");
  });

  it("disables controls while busy", () => {
    renderSection({ busy: true });
    expect(
      screen.getByRole("button", { name: "تفعيل وضع المطور" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("السيناريو التجريبي")).toBeDisabled();
  });
});

describe("DeveloperSection active mode", () => {
  it("shows the active indicator, isolation notice and demo error when active", () => {
    renderSection(
      {
        demoActive: true,
        demoScenario: "open-busy",
        demoError: "seed failed",
      },
      makeHandlers(),
    );
    expect(screen.getByText("مفعل")).toBeInTheDocument();
    expect(
      screen.getByText("بيانات تجريبية — ليست حقيقية"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("التعديلات هنا لا تمس الحقيقية"),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("seed failed");
    expect(
      screen.queryByRole("button", { name: "تفعيل وضع المطور" }),
    ).toBeNull();
  });

  it("changing the scenario while active never reseeds without confirmation", async () => {
    const h = renderSection(
      { demoActive: true, demoScenario: "full" },
      makeHandlers(),
    );
    const select = screen.getByLabelText(
      "السيناريو التجريبي",
    ) as HTMLSelectElement;
    expect(select.value).toBe("full");

    // Changing the selection updates local state only — no silent reseed,
    // no bypass of the reset confirmation flow.
    fireEvent.change(select, { target: { value: "empty" } });
    expect(h.onReseed).not.toHaveBeenCalled();
    expect(h.onEnter).not.toHaveBeenCalled();
    expect(h.onExit).not.toHaveBeenCalled();

    // Reset requires the existing confirmation dialog; cancel does nothing.
    fireEvent.click(
      screen.getByRole("button", { name: "اعادة ضبط التجريبية" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("alertdialog", { name: "اعادة ضبط التجريبية؟" }),
      ).toBeInTheDocument(),
    );
    expect(h.onReseed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "إلغاء" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(h.onReseed).not.toHaveBeenCalled();

    // Confirming reseeds the selected scenario exactly once.
    fireEvent.click(
      screen.getByRole("button", { name: "اعادة ضبط التجريبية" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("alertdialog", { name: "اعادة ضبط التجريبية؟" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "اعادة الضبط" }));
    await waitFor(() => expect(h.onReseed).toHaveBeenCalledTimes(1));
    expect(h.onReseed).toHaveBeenCalledWith("empty");
    expect(h.onEnter).not.toHaveBeenCalled();
    expect(h.onExit).not.toHaveBeenCalled();
  });

  it("exit invokes the existing exit flow exactly once", async () => {
    const h = renderSection(
      { demoActive: true, demoScenario: "full" },
      makeHandlers(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "الخروج للبيانات الحقيقية" }),
    );
    await waitFor(() => expect(h.onExit).toHaveBeenCalledTimes(1));
    expect(h.onEnter).not.toHaveBeenCalled();
    expect(h.onReseed).not.toHaveBeenCalled();
  });

  it("disables active-mode controls while busy", () => {
    renderSection(
      { demoActive: true, demoScenario: "full", busy: true },
      makeHandlers(),
    );
    expect(
      screen.getByRole("button", { name: "اعادة ضبط التجريبية" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "الخروج للبيانات الحقيقية" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("السيناريو التجريبي")).toBeDisabled();
  });
});

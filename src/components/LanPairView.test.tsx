import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import LanPairView from "./LanPairView";
import { readyPromise } from "../i18n";
import type { LanPairing, LanStatus } from "../lan/bridge";

const status: LanStatus = {
  running: true,
  enabled: true,
  allowWrites: true,
  address: "192.168.1.10",
  port: 7741,
  url: "http://192.168.1.10:7741",
  candidates: [{ name: "en0", address: "192.168.1.10" }],
  pairedDevices: 0,
  pairedLabels: [],
  error: null,
};

const pairing: LanPairing = {
  url: "http://192.168.1.10:7741/#k=pscafe_abc",
  payload: "http://192.168.1.10:7741/#k=pscafe_abc",
  qrSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
  pairedDevices: 0,
};

const renderView = () =>
  render(
    <LanPairView
      status={status}
      pairing={pairing}
      busy={false}
      setBusy={() => {}}
      setNotice={() => {}}
      onStatus={() => {}}
      onPairing={() => {}}
      lanPair={async () => pairing}
    />,
  );

describe("LanPairView copy-link button success state", () => {
  beforeEach(async () => {
    await readyPromise;
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the default ghost styling before copying", () => {
    renderView();
    const btn = screen.getByRole("button", { name: /نسخ الرابط/ });
    expect(btn.classList.contains("btn")).toBe(true);
    expect(btn.classList.contains("ghost")).toBe(true);
    expect(btn.classList.contains("copied")).toBe(false);
  });

  it("adds the green copied state after a successful copy", async () => {
    renderView();
    const btn = screen.getByRole("button", { name: /نسخ الرابط/ });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /تم النسخ/ }),
      ).toBeInTheDocument();
    });
    expect(btn.classList.contains("copied")).toBe(true);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(pairing.payload);
  });

  it("reverts to the default styling after the copied timeout", async () => {
    renderView();
    const btn = screen.getByRole("button", { name: /نسخ الرابط/ });
    fireEvent.click(btn);

    await waitFor(
      () => {
        expect(
          screen.getByRole("button", { name: /تم النسخ/ }),
        ).toBeInTheDocument();
      },
      { timeout: 2000 },
    );

    await waitFor(
      () => {
        expect(
          screen.getByRole("button", { name: /نسخ الرابط/ }),
        ).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
    expect(btn.classList.contains("copied")).toBe(false);
    expect(btn.classList.contains("ghost")).toBe(true);
  });
});

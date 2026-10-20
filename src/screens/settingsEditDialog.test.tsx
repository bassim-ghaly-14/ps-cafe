import { describe, expect, it, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import SettingsScreen from "./SettingsScreen";
import type { Station } from "../domain/types";
import { readyPromise } from "../i18n";

const STATION: Station = {
  id: 1,
  name: "PC 1",
  colorHex: "#2ee6ff",
  sortOrder: 0,
  isVisible: true,
  isActive: true,
  hourlyRateMinor: 0,
  createdAtUtc: 0,
  updatedAtUtc: 0,
};

beforeEach(async () => {
  cleanup();
  localStorage.clear();
  await readyPromise;
});

function renderSettings() {
  render(
    <SettingsScreen
      stations={[STATION]}
      activeSessions={[]}
      busy={false}
      notice={null}
      onSave={async () => ({ ok: true, messageKey: "saved" })}
      setNotice={() => {}}
      setBusy={() => {}}
      demoActive={false}
      demoScenario={null}
      demoError={null}
      onDemoEnter={async () => ({ ok: true })}
      onDemoReseed={async () => ({ ok: true })}
      onDemoExit={async () => {}}
      onResetDone={async () => {}}
    />,
  );
}

/** Opens the device edit dialog via the row's edit button. */
function openEditDialog() {
  fireEvent.click(screen.getByRole("button", { name: "تعديل" }));
  return screen.getByRole("dialog");
}

describe("settings device edit dialog dismissal", () => {
  it("clicking the backdrop closes the dialog", () => {
    renderSettings();
    openEditDialog();
    const backdrop = document.querySelector(".modal-backdrop");
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("clicking inside the dialog does not close it", () => {
    renderSettings();
    const dialog = openEditDialog();
    fireEvent.click(dialog);
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });

  it("clicking a form field inside the dialog does not close it", () => {
    renderSettings();
    openEditDialog();
    fireEvent.click(screen.getByLabelText("اسم الجهاز"));
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });

  it("Escape closes the dialog", () => {
    renderSettings();
    openEditDialog();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

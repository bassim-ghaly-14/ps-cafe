import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BackButton from "./BackButton";
import { readyPromise } from "../i18n";

beforeEach(async () => {
  await readyPromise;
});

describe("BackButton", () => {
  it("renders with an arrow icon and accessible label", () => {
    render(<BackButton onClick={() => {}} />);
    const btn = screen.getByRole("button", { name: /رجوع/ });
    expect(btn).toBeInTheDocument();
    expect(btn.querySelector("svg")).not.toBeNull();
  });

  it("calls onClick when clicked", () => {
    const handleClick = vi.fn();
    render(<BackButton onClick={handleClick} />);
    fireEvent.click(screen.getByRole("button", { name: /رجوع/ }));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("is disabled when disabled prop is set", () => {
    render(<BackButton onClick={() => {}} disabled />);
    const btn = screen.getByRole("button", { name: /رجوع/ });
    expect(btn).toBeDisabled();
  });

  it("has the back-btn class for touch-target styling", () => {
    render(<BackButton onClick={() => {}} />);
    const btn = screen.getByRole("button", { name: /رجوع/ });
    expect(btn.classList.contains("back-btn")).toBe(true);
  });

  it("is focusable", () => {
    render(<BackButton onClick={() => {}} />);
    const btn = screen.getByRole("button", { name: /رجوع/ });
    expect(btn).toBeInTheDocument();
    expect(btn.tabIndex).toBeGreaterThanOrEqual(0);
  });
});

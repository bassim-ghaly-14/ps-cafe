import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import WorkdayStamp from "./WorkdayStamp";

describe("WorkdayStamp", () => {
  const ts = Date.UTC(2026, 9, 17, 20, 34, 0);

  it("renders the date and the clock in separate LTR isolates", () => {
    const { container } = render(<WorkdayStamp tsUtc={ts} />);
    const date = container.querySelector(".stamp-date");
    const time = container.querySelector(".stamp-time");
    expect(date).not.toBeNull();
    expect(time).not.toBeNull();
    expect(date).toHaveAttribute("dir", "ltr");
    expect(time).toHaveAttribute("dir", "ltr");
  });

  it("keeps the numeric date in day/month/year order", () => {
    const { container } = render(<WorkdayStamp tsUtc={ts} />);
    const date = container.querySelector(".stamp-date")?.textContent ?? "";
    expect(date).toMatch(/^\d{1,2}\/\d{1,2}\/\d{4}$/);
  });

  it("emits no bidi control characters in the rendered output", () => {
    const { container } = render(<WorkdayStamp tsUtc={ts} showWeekday />);
    expect(container.textContent ?? "").not.toMatch(
      /[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/,
    );
  });

  it("shows the Arabic weekday only when requested", () => {
    const withDay = render(<WorkdayStamp tsUtc={ts} showWeekday />);
    expect(
      withDay.container.querySelector(".stamp-weekday")?.textContent ?? "",
    ).not.toBe("");

    const withoutDay = render(<WorkdayStamp tsUtc={ts} />);
    expect(withoutDay.container.querySelector(".stamp-weekday")).toBeNull();
  });

  it("keeps the Arabic meridiem out of the LTR clock isolate", () => {
    const { container } = render(<WorkdayStamp tsUtc={ts} />);
    const time = container.querySelector(".stamp-time");
    const period = container.querySelector(".stamp-dayperiod");
    expect(time?.textContent).not.toContain("م");
    expect(period?.textContent).toBe("م");
  });
});

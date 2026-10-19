import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import Splash from "./Splash";
import "../i18n";

describe("EGO branding", () => {
  it("splash shows the official EGO logo with meaningful alt text", () => {
    render(<Splash />);
    const logo = screen.getByAltText("EGO — PS & Café & more");
    expect(logo).toBeInTheDocument();
    expect(logo).toHaveAttribute("src", "/ego-logo.png");
  });
});

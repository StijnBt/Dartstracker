import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import App from "./App";
import { branding } from "./branding";

describe("App", () => {
  it("renders the branded app name using the theme's primary color and heading font", () => {
    render(<App />);
    const heading = screen.getByRole("heading", { name: branding.appName });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveClass("text-primary");
    expect(heading).toHaveClass("font-heading");
  });

  it("renders the branded logo", () => {
    render(<App />);
    const logo = screen.getByRole("img", { name: branding.appName });
    expect(logo).toHaveAttribute("src", branding.logoSrc);
  });
});

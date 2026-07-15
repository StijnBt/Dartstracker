import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import App from "./App";

describe("App", () => {
  it("renders the app heading using the theme's primary color and heading font", () => {
    render(<App />);
    const heading = screen.getByRole("heading", { name: "Darts League" });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveClass("text-primary");
    expect(heading).toHaveClass("font-heading");
  });
});

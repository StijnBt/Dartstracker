import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import HighestCheckoutAward from "./HighestCheckoutAward";

describe("HighestCheckoutAward", () => {
  it("renders the value and player name for a single holder", () => {
    render(<HighestCheckoutAward award={{ value: 121, players: [{ id: 1, displayName: "Alice" }] }} />);

    expect(screen.getByText(/Highest Checkout/)).toBeInTheDocument();
    expect(screen.getByText(/121/)).toBeInTheDocument();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
  });

  it("renders every tied player's name, comma-separated", () => {
    render(
      <HighestCheckoutAward
        award={{
          value: 100,
          players: [
            { id: 1, displayName: "Alice" },
            { id: 3, displayName: "Carol" },
          ],
        }}
      />
    );

    expect(screen.getByText(/Alice, Carol/)).toBeInTheDocument();
  });

  it("renders a placeholder when no award is recorded yet", () => {
    render(<HighestCheckoutAward award={null} />);

    expect(screen.getByText("No checkouts recorded yet")).toBeInTheDocument();
  });
});

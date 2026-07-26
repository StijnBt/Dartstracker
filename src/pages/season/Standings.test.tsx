import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import Standings from "./Standings";
import type { StandingsRow } from "../../lib/standings";

const rows: StandingsRow[] = [
  { player: { id: 1, displayName: "Alice" }, matchesPlayed: 2, legsWon: 6, legsLost: 1, diff: 5, rank: 1, highestCheckout: null },
  { player: { id: 2, displayName: "Bob" }, matchesPlayed: 2, legsWon: 3, legsLost: 4, diff: -1, rank: 2, highestCheckout: null },
];

describe("Standings", () => {
  it("renders a row per player with rank, name, and stats, in the given order", () => {
    render(<Standings rows={rows} />);

    const dataRows = screen.getAllByRole("row").slice(1);
    expect(dataRows).toHaveLength(2);
    expect(dataRows[0]).toHaveTextContent("Alice");
    expect(dataRows[0]).toHaveTextContent("6");
    expect(dataRows[1]).toHaveTextContent("Bob");
    expect(dataRows[1]).toHaveTextContent("-1");
  });

  it("renders the column headers", () => {
    render(<Standings rows={rows} />);

    expect(screen.getByText("Player")).toBeInTheDocument();
    expect(screen.getByText("Legs Won")).toBeInTheDocument();
    expect(screen.getByText("Legs Lost")).toBeInTheDocument();
    expect(screen.getByText("Diff")).toBeInTheDocument();
  });

  it("shows only the header row when there are no rows", () => {
    render(<Standings rows={[]} />);

    expect(screen.getAllByRole("row")).toHaveLength(1);
  });
});

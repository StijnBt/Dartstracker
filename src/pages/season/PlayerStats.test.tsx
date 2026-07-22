import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import PlayerStats from "./PlayerStats";
import type { SeasonPlayerStat } from "../../lib/api-client";

const stats: SeasonPlayerStat[] = [
  { playerId: 1, displayName: "Alice", threeDartAverage: 60.5, oneEightyCount: 2 },
  { playerId: 2, displayName: "Bob", threeDartAverage: 45.25, oneEightyCount: 0 },
];

describe("PlayerStats", () => {
  it("renders a row per player with name, average, and 180 count, in the given order", () => {
    render(<PlayerStats stats={stats} />);

    const dataRows = screen.getAllByRole("row").slice(1);
    expect(dataRows).toHaveLength(2);
    expect(dataRows[0]).toHaveTextContent("Alice");
    expect(dataRows[0]).toHaveTextContent("60.50");
    expect(dataRows[0]).toHaveTextContent("2");
    expect(dataRows[1]).toHaveTextContent("Bob");
    expect(dataRows[1]).toHaveTextContent("45.25");
  });

  it("renders the column headers", () => {
    render(<PlayerStats stats={stats} />);

    expect(screen.getByText("Player")).toBeInTheDocument();
    expect(screen.getByText("3-Dart Avg")).toBeInTheDocument();
    expect(screen.getByText("180s")).toBeInTheDocument();
  });

  it("shows only the header row when there are no stats", () => {
    render(<PlayerStats stats={[]} />);

    expect(screen.getAllByRole("row")).toHaveLength(1);
  });
});

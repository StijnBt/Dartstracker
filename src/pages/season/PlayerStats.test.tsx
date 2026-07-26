import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("sorts by a column ascending on first click, descending on second click", async () => {
    render(<PlayerStats stats={stats} />);

    await userEvent.click(screen.getByRole("button", { name: "3-Dart Avg" }));
    let dataRows = screen.getAllByRole("row").slice(1);
    expect(dataRows[0]).toHaveTextContent("Bob");
    expect(dataRows[1]).toHaveTextContent("Alice");
    expect(screen.getByRole("columnheader", { name: /3-Dart Avg/ })).toHaveAttribute("aria-sort", "ascending");

    await userEvent.click(screen.getByRole("button", { name: /3-Dart Avg/ }));
    dataRows = screen.getAllByRole("row").slice(1);
    expect(dataRows[0]).toHaveTextContent("Alice");
    expect(dataRows[1]).toHaveTextContent("Bob");
    expect(screen.getByRole("columnheader", { name: /3-Dart Avg/ })).toHaveAttribute("aria-sort", "descending");
  });

  it("sorts by player name case-insensitively", async () => {
    render(
      <PlayerStats
        stats={[
          { playerId: 1, displayName: "bob", threeDartAverage: 50, oneEightyCount: 1 },
          { playerId: 2, displayName: "Alice", threeDartAverage: 40, oneEightyCount: 0 },
        ]}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Player" }));

    const dataRows = screen.getAllByRole("row").slice(1);
    expect(dataRows[0]).toHaveTextContent("Alice");
    expect(dataRows[1]).toHaveTextContent("bob");
  });
});

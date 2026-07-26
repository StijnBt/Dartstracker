import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import Standings from "./Standings";
import type { StandingsRow } from "../../lib/standings";

const rows: StandingsRow[] = [
  { player: { id: 1, displayName: "Alice" }, matchesPlayed: 3, legsWon: 6, legsLost: 1, diff: 5, rank: 1, highestCheckout: 80 },
  { player: { id: 2, displayName: "Bob" }, matchesPlayed: 2, legsWon: 3, legsLost: 4, diff: -1, rank: 2, highestCheckout: null },
  { player: { id: 3, displayName: "Carol" }, matchesPlayed: 1, legsWon: 1, legsLost: 3, diff: -2, rank: 3, highestCheckout: 150 },
];

describe("Standings", () => {
  it("renders a row per player with rank, name, and stats, in the given order", () => {
    render(<Standings rows={rows} />);

    const dataRows = screen.getAllByRole("row").slice(1);
    expect(dataRows).toHaveLength(3);
    expect(dataRows[0]).toHaveTextContent("Alice");
    expect(dataRows[0]).toHaveTextContent("6");
    expect(dataRows[1]).toHaveTextContent("Bob");
    expect(dataRows[1]).toHaveTextContent("-1");
    expect(dataRows[2]).toHaveTextContent("Carol");
  });

  it("renders the column headers", () => {
    render(<Standings rows={rows} />);

    expect(screen.getByText("Player")).toBeInTheDocument();
    expect(screen.getByText("Legs Won")).toBeInTheDocument();
    expect(screen.getByText("Legs Lost")).toBeInTheDocument();
    expect(screen.getByText("Diff")).toBeInTheDocument();
    expect(screen.getByText("Highest Checkout")).toBeInTheDocument();
  });

  it("shows only the header row when there are no rows", () => {
    render(<Standings rows={[]} />);

    expect(screen.getAllByRole("row")).toHaveLength(1);
  });

  it("renders each player's highest checkout, or a dash when null", () => {
    render(<Standings rows={rows} />);

    const dataRows = screen.getAllByRole("row").slice(1);
    expect(dataRows[0]).toHaveTextContent("80");
    expect(within(dataRows[1]).getByText("—")).toBeInTheDocument();
    expect(dataRows[2]).toHaveTextContent("150");
  });

  it("sorts by a column ascending on first click, descending on second click", async () => {
    render(<Standings rows={rows} />);

    await userEvent.click(screen.getByRole("button", { name: "Legs Won" }));
    let dataRows = screen.getAllByRole("row").slice(1);
    expect(dataRows[0]).toHaveTextContent("Carol");
    expect(dataRows[1]).toHaveTextContent("Bob");
    expect(dataRows[2]).toHaveTextContent("Alice");
    expect(screen.getByRole("columnheader", { name: /Legs Won/ })).toHaveAttribute("aria-sort", "ascending");

    await userEvent.click(screen.getByRole("button", { name: /Legs Won/ }));
    dataRows = screen.getAllByRole("row").slice(1);
    expect(dataRows[0]).toHaveTextContent("Alice");
    expect(dataRows[1]).toHaveTextContent("Bob");
    expect(dataRows[2]).toHaveTextContent("Carol");
    expect(screen.getByRole("columnheader", { name: /Legs Won/ })).toHaveAttribute("aria-sort", "descending");
  });

  it("keeps each row's rank unchanged when the table is sorted by a different column", async () => {
    render(<Standings rows={rows} />);

    await userEvent.click(screen.getByRole("button", { name: "Legs Won" }));

    const dataRows = screen.getAllByRole("row").slice(1);
    const firstRowCells = within(dataRows[0]).getAllByRole("cell");
    expect(firstRowCells[0]).toHaveTextContent("3");
    expect(firstRowCells[1]).toHaveTextContent("Carol");
  });

  it("sorts nulls last for Highest Checkout in both directions", async () => {
    render(<Standings rows={rows} />);

    await userEvent.click(screen.getByRole("button", { name: "Highest Checkout" }));
    let dataRows = screen.getAllByRole("row").slice(1);
    expect(dataRows[0]).toHaveTextContent("Alice");
    expect(dataRows[1]).toHaveTextContent("Carol");
    expect(dataRows[2]).toHaveTextContent("Bob");

    await userEvent.click(screen.getByRole("button", { name: /Highest Checkout/ }));
    dataRows = screen.getAllByRole("row").slice(1);
    expect(dataRows[0]).toHaveTextContent("Carol");
    expect(dataRows[1]).toHaveTextContent("Alice");
    expect(dataRows[2]).toHaveTextContent("Bob");
  });
});

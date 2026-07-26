import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import MatchList from "./MatchList";
import type { SeasonMatch } from "../../lib/api-client";

const noResult = {
  player1Legs: null,
  player2Legs: null,
  player1Checkout: null,
  player2Checkout: null,
  resultEnteredBy: null,
  resultEnteredAt: null,
} as const;

const matches: SeasonMatch[] = [
  {
    id: 101,
    roundNumber: 1,
    date: "2026-08-01",
    status: "scheduled",
    player1: { id: 1, displayName: "Administrator" },
    player2: { id: 2, displayName: "Bob Smith" },
    ...noResult,
  },
  {
    id: 102,
    roundNumber: 1,
    date: "2026-08-08",
    status: "cancelled",
    player1: { id: 1, displayName: "Administrator" },
    player2: { id: 3, displayName: "Carol Smith" },
    ...noResult,
  },
];

describe("MatchList", () => {
  it("renders every match as a flat list, no headings", () => {
    render(<MatchList matches={matches} />);

    expect(screen.getByText("Administrator vs Bob Smith")).toBeInTheDocument();
    expect(screen.getByText("Administrator vs Carol Smith")).toBeInTheDocument();
    expect(screen.queryAllByRole("heading")).toHaveLength(0);
  });

  it("marks a cancelled match", () => {
    render(<MatchList matches={matches} />);
    expect(screen.getByText("cancelled")).toBeInTheDocument();
  });

  it("renders the formatted date by default for a scheduled match", () => {
    render(<MatchList matches={[matches[0]]} />);
    expect(screen.getByText(new Date("2026-08-01").toLocaleDateString())).toBeInTheDocument();
  });

  it("renders custom match actions when provided instead of the date", () => {
    render(<MatchList matches={[matches[0]]} renderMatchActions={(match) => <button>Cancel {match.id}</button>} />);
    expect(screen.getByRole("button", { name: "Cancel 101" })).toBeInTheDocument();
    expect(screen.queryByText(new Date("2026-08-01").toLocaleDateString())).not.toBeInTheDocument();
  });

  it("renders nothing for an empty match list", () => {
    const { container } = render(<MatchList matches={[]} />);
    expect(container.querySelectorAll("li")).toHaveLength(0);
  });
});

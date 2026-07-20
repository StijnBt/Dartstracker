import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import RoundRobinSchedule from "./RoundRobinSchedule";
import type { SeasonMatch, SeasonParticipantSummary } from "../../lib/api-client";

const participants: SeasonParticipantSummary[] = [
  { id: 1, displayName: "Administrator" },
  { id: 2, displayName: "Bob Smith" },
  { id: 3, displayName: "Carol Smith" },
];

const matches: SeasonMatch[] = [
  {
    id: 101,
    roundNumber: 1,
    date: "2026-08-01",
    status: "scheduled",
    player1: { id: 1, displayName: "Administrator" },
    player2: { id: 2, displayName: "Bob Smith" },
  },
  {
    id: 102,
    roundNumber: 2,
    date: "2026-08-08",
    status: "cancelled",
    player1: { id: 1, displayName: "Administrator" },
    player2: { id: 3, displayName: "Carol Smith" },
  },
];

describe("RoundRobinSchedule", () => {
  it("groups matches under round headings in ascending order", () => {
    render(<RoundRobinSchedule matches={matches} participants={participants} />);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Round 1", "Round 2"]);
  });

  it("shows the opponent pairing for each match", () => {
    render(<RoundRobinSchedule matches={matches} participants={participants} />);
    expect(screen.getByText("Administrator vs Bob Smith")).toBeInTheDocument();
    expect(screen.getByText("Administrator vs Carol Smith")).toBeInTheDocument();
  });

  it("shows a bye for the participant missing from that round", () => {
    render(<RoundRobinSchedule matches={matches} participants={participants} />);
    expect(screen.getByText("Carol Smith: bye")).toBeInTheDocument(); // round 1
    expect(screen.getByText("Bob Smith: bye")).toBeInTheDocument(); // round 2
  });

  it("marks a cancelled match", () => {
    render(<RoundRobinSchedule matches={matches} participants={participants} />);
    expect(screen.getByText("cancelled")).toBeInTheDocument();
  });

  it("renders the formatted date by default", () => {
    render(<RoundRobinSchedule matches={[matches[0]]} participants={participants} />);
    expect(screen.getByText(new Date("2026-08-01").toLocaleDateString())).toBeInTheDocument();
  });

  it("renders custom match actions when provided instead of the date", () => {
    render(
      <RoundRobinSchedule
        matches={[matches[0]]}
        participants={participants}
        renderMatchActions={(match) => <button>Cancel {match.id}</button>}
      />
    );
    expect(screen.getByRole("button", { name: "Cancel 101" })).toBeInTheDocument();
    expect(screen.queryByText(new Date("2026-08-01").toLocaleDateString())).not.toBeInTheDocument();
  });
});

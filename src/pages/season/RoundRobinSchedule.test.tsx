import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import RoundRobinSchedule, { formatMatchSummary } from "./RoundRobinSchedule";
import type { SeasonMatch, SeasonParticipantSummary } from "../../lib/api-client";

const participants: SeasonParticipantSummary[] = [
  { id: 1, displayName: "Administrator" },
  { id: 2, displayName: "Bob Smith" },
  { id: 3, displayName: "Carol Smith" },
];

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
    roundNumber: 2,
    date: "2026-08-08",
    status: "cancelled",
    player1: { id: 1, displayName: "Administrator" },
    player2: { id: 3, displayName: "Carol Smith" },
    ...noResult,
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

  it("renders the formatted date by default for a scheduled match", () => {
    render(<RoundRobinSchedule matches={[matches[0]]} participants={participants} />);
    expect(screen.getByText(new Date("2026-08-01").toLocaleDateString())).toBeInTheDocument();
  });

  it("renders the final score instead of the date for a played match", () => {
    const playedMatch: SeasonMatch = { ...matches[0], status: "played", player1Legs: 3, player2Legs: 1 };
    render(<RoundRobinSchedule matches={[playedMatch]} participants={participants} />);
    expect(screen.getByText("3–1")).toBeInTheDocument();
    expect(screen.queryByText(new Date("2026-08-01").toLocaleDateString())).not.toBeInTheDocument();
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

  it("renders multiple byes when 2+ participants have no match in a round", () => {
    const fiveParticipants: SeasonParticipantSummary[] = [
      { id: 1, displayName: "Alice" },
      { id: 2, displayName: "Bob" },
      { id: 3, displayName: "Carol" },
      { id: 4, displayName: "Dave" },
      { id: 5, displayName: "Eve" },
    ];
    const oneMatchPerRound: SeasonMatch[] = [
      {
        id: 201,
        roundNumber: 1,
        date: "2026-08-01",
        status: "scheduled",
        player1: { id: 1, displayName: "Alice" },
        player2: { id: 2, displayName: "Bob" },
        ...noResult,
      },
    ];
    render(<RoundRobinSchedule matches={oneMatchPerRound} participants={fiveParticipants} />);
    expect(screen.getByText("Carol: bye")).toBeInTheDocument();
    expect(screen.getByText("Dave: bye")).toBeInTheDocument();
    expect(screen.getByText("Eve: bye")).toBeInTheDocument();
  });

  it("renders no bye text when all participants have a match in a round", () => {
    const fourParticipants: SeasonParticipantSummary[] = [
      { id: 1, displayName: "Alice" },
      { id: 2, displayName: "Bob" },
      { id: 3, displayName: "Carol" },
      { id: 4, displayName: "Dave" },
    ];
    const allMatchesRound: SeasonMatch[] = [
      {
        id: 301,
        roundNumber: 1,
        date: "2026-08-01",
        status: "scheduled",
        player1: { id: 1, displayName: "Alice" },
        player2: { id: 2, displayName: "Bob" },
        ...noResult,
      },
      {
        id: 302,
        roundNumber: 1,
        date: "2026-08-01",
        status: "scheduled",
        player1: { id: 3, displayName: "Carol" },
        player2: { id: 4, displayName: "Dave" },
        ...noResult,
      },
    ];
    render(<RoundRobinSchedule matches={allMatchesRound} participants={fourParticipants} />);
    expect(screen.queryByText(/: bye$/)).not.toBeInTheDocument();
  });

  it("renders roundNumber 0 matches under an Additional Matches heading, separate from round groups", () => {
    const additionalMatch: SeasonMatch = {
      id: 401,
      roundNumber: 0,
      date: "2026-09-01",
      status: "scheduled",
      player1: { id: 2, displayName: "Bob Smith" },
      player2: { id: 3, displayName: "Carol Smith" },
      ...noResult,
    };
    render(<RoundRobinSchedule matches={[...matches, additionalMatch]} participants={participants} />);

    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Round 1", "Round 2", "Additional Matches"]);
    expect(screen.getByText("Bob Smith vs Carol Smith")).toBeInTheDocument();
  });

  it("does not compute byes for the Additional Matches section", () => {
    const additionalMatch: SeasonMatch = {
      id: 401,
      roundNumber: 0,
      date: "2026-09-01",
      status: "scheduled",
      player1: { id: 1, displayName: "Administrator" },
      player2: { id: 2, displayName: "Bob Smith" },
      ...noResult,
    };
    render(<RoundRobinSchedule matches={[additionalMatch]} participants={participants} />);

    expect(screen.queryByText(/: bye$/)).not.toBeInTheDocument();
  });

  it("omits the Additional Matches heading when there are no roundNumber 0 matches", () => {
    render(<RoundRobinSchedule matches={matches} participants={participants} />);
    expect(screen.queryByText("Additional Matches")).not.toBeInTheDocument();
  });

  it("formatMatchSummary returns the score for a played match and the date otherwise", () => {
    expect(formatMatchSummary({ ...matches[0], status: "played", player1Legs: 3, player2Legs: 0 })).toBe("3–0");
    expect(formatMatchSummary(matches[0])).toBe(new Date("2026-08-01").toLocaleDateString());
  });
});

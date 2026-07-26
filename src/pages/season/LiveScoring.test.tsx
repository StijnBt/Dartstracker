import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import LiveScoring from "./LiveScoring";
import * as apiClient from "../../lib/api-client";
import { useAuth } from "../../lib/AuthContext";

vi.mock("../../lib/api-client");
vi.mock("../../lib/AuthContext", () => ({
  useAuth: vi.fn(),
}));

const scheduledMatch: apiClient.SeasonMatch = {
  id: 101,
  roundNumber: 1,
  date: "2026-08-01",
  status: "scheduled",
  player1: { id: 1, displayName: "Administrator" },
  player2: { id: 2, displayName: "Bob Smith" },
  player1Legs: null,
  player2Legs: null,
  player1Checkout: null,
  player2Checkout: null,
  resultEnteredBy: null,
  resultEnteredAt: null,
};

const inProgressMatch: apiClient.SeasonMatch = { ...scheduledMatch, id: 102, status: "in_progress" };

const season: apiClient.Season = {
  id: 1,
  name: "Spring 2026",
  roundType: "single",
  status: "active",
  participants: [
    { id: 1, displayName: "Administrator" },
    { id: 2, displayName: "Bob Smith" },
    { id: 3, displayName: "Carol Jones" },
  ],
  matches: [scheduledMatch, inProgressMatch],
};

function mockAuth(id: number, role: "admin" | "player") {
  vi.mocked(useAuth).mockReturnValue({
    user: { id, username: "x", role, displayName: "X" },
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
  });
}

function mockSeasonLoad() {
  vi.mocked(apiClient.listSeasons).mockResolvedValue([
    { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
  ]);
  vi.mocked(apiClient.getSeason).mockResolvedValue(season);
}

function renderWithRouter(matchId: number) {
  return render(
    <MemoryRouter initialEntries={[`/season/matches/${matchId}/live`]}>
      <Routes>
        <Route path="/season/matches/:id/live" element={<LiveScoring />} />
        <Route path="/season/matches" element={<div>Matches page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

const freshLiveState: apiClient.LiveMatchState = {
  match: { id: 101, status: "in_progress", player1Id: 1, player2Id: 2 },
  legs: [{ id: 10, legNumber: 1, startingPlayerId: 1, winnerPlayerId: null, checkoutValue: null, throws: [] }],
  currentTurn: { legNumber: 1, turnNumber: 1, dartNumber: 1, playerId: 1, player1Remaining: 501, player2Remaining: 501 },
  matchOutcome: { complete: false, winnerPlayerId: null, player1Legs: 0, player2Legs: 0, player1Checkout: null, player2Checkout: null },
};

describe("LiveScoring", () => {
  it("shows a Start Match button for a scheduled match that hasn't been started", async () => {
    mockAuth(1, "admin");
    mockSeasonLoad();

    renderWithRouter(101);

    await waitFor(() => expect(screen.getByRole("button", { name: "Start Match" })).toBeInTheDocument());
  });

  it("starts the match and shows the tap grid on Start Match click", async () => {
    mockAuth(1, "admin");
    mockSeasonLoad();
    vi.mocked(apiClient.startLiveMatch).mockResolvedValue(freshLiveState);

    renderWithRouter(101);
    await waitFor(() => screen.getByRole("button", { name: "Start Match" }));
    await userEvent.click(screen.getByRole("button", { name: "Start Match" }));

    await waitFor(() => {
      expect(apiClient.startLiveMatch).toHaveBeenCalledWith(101);
      expect(screen.getByRole("button", { name: "20" })).toBeInTheDocument();
    });
  });

  it("loads the live state directly for an already in_progress match", async () => {
    mockAuth(1, "admin");
    mockSeasonLoad();
    vi.mocked(apiClient.getLiveMatch).mockResolvedValue(freshLiveState);

    renderWithRouter(102);

    await waitFor(() => {
      expect(apiClient.getLiveMatch).toHaveBeenCalledWith(102);
      expect(screen.getByRole("button", { name: "20" })).toBeInTheDocument();
    });
  });

  it("records a throw when a number is tapped, using the selected multiplier", async () => {
    mockAuth(1, "admin");
    mockSeasonLoad();
    vi.mocked(apiClient.getLiveMatch).mockResolvedValue(freshLiveState);
    vi.mocked(apiClient.recordLiveThrow).mockResolvedValue(freshLiveState);

    renderWithRouter(102);
    await waitFor(() => screen.getByRole("button", { name: "20" }));

    await userEvent.click(screen.getByRole("button", { name: "triple" }));
    await userEvent.click(screen.getByRole("button", { name: "20" }));

    await waitFor(() => {
      expect(apiClient.recordLiveThrow).toHaveBeenCalledWith(102, { multiplier: "triple", segment: 20 });
    });
  });

  it("hides the Bull option when triple is selected", async () => {
    mockAuth(1, "admin");
    mockSeasonLoad();
    vi.mocked(apiClient.getLiveMatch).mockResolvedValue(freshLiveState);

    renderWithRouter(102);
    await waitFor(() => screen.getByRole("button", { name: "20" }));

    expect(screen.getByRole("button", { name: "Bull" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "triple" }));
    expect(screen.queryByRole("button", { name: "Bull" })).not.toBeInTheDocument();
  });

  it("undoes the last throw when Undo is clicked", async () => {
    mockAuth(1, "admin");
    mockSeasonLoad();
    const stateWithOneThrow: apiClient.LiveMatchState = {
      ...freshLiveState,
      legs: [{ ...freshLiveState.legs[0], throws: [{ id: 1, turnNumber: 1, dartNumber: 1, playerId: 1, multiplier: "triple", segment: 20, value: 60, busted: false }] }],
    };
    vi.mocked(apiClient.getLiveMatch).mockResolvedValue(stateWithOneThrow);
    vi.mocked(apiClient.undoLiveThrow).mockResolvedValue(freshLiveState);

    renderWithRouter(102);
    await waitFor(() => screen.getByRole("button", { name: "Undo" }));
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() => {
      expect(apiClient.undoLiveThrow).toHaveBeenCalledWith(102);
    });
  });

  it("shows a completion summary with a Back to Matches button when the match is complete", async () => {
    mockAuth(1, "admin");
    mockSeasonLoad();
    vi.mocked(apiClient.getLiveMatch).mockResolvedValue({
      ...freshLiveState,
      currentTurn: null,
      matchOutcome: { complete: true, winnerPlayerId: 1, player1Legs: 3, player2Legs: 1, player1Checkout: 82, player2Checkout: null },
    });

    renderWithRouter(102);

    await waitFor(() => {
      expect(screen.getByText("Match complete: Administrator wins 3–1")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "20" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Back to Matches" }));
    await waitFor(() => expect(screen.getByText("Matches page")).toBeInTheDocument());
  });

  it("shows a read-only message with no scoring controls for a non-participant player", async () => {
    mockAuth(3, "player");
    mockSeasonLoad();

    renderWithRouter(102);

    await waitFor(() => {
      expect(screen.getByText("You are not allowed to score this match.")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Start Match" })).not.toBeInTheDocument();
  });

  it("shows an error when no match with that id exists in the active season", async () => {
    mockAuth(1, "admin");
    vi.mocked(apiClient.listSeasons).mockResolvedValue([]);

    renderWithRouter(999);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Match not found");
    });
  });
});

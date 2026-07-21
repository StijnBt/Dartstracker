import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import MatchResult from "./MatchResult";
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

const playedMatch: apiClient.SeasonMatch = {
  ...scheduledMatch,
  id: 102,
  status: "played",
  player1Legs: 3,
  player2Legs: 1,
  player1Checkout: 82,
  resultEnteredBy: { id: 1, displayName: "Administrator" },
  resultEnteredAt: "2026-08-01T20:00:00.000Z",
};

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
  matches: [scheduledMatch, playedMatch],
};

function mockAuth(id: number, role: "admin" | "player") {
  vi.mocked(useAuth).mockReturnValue({
    user: { id, username: "x", role, displayName: "X" },
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
  });
}

function renderWithRouter(matchId: number) {
  return render(
    <MemoryRouter initialEntries={[`/season/matches/${matchId}/result`]}>
      <Routes>
        <Route path="/season/matches/:id/result" element={<MatchResult />} />
        <Route path="/season" element={<div>Season page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

function mockSeasonLoad() {
  vi.mocked(apiClient.listSeasons).mockResolvedValue([
    { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
  ]);
  vi.mocked(apiClient.getSeason).mockResolvedValue(season);
}

describe("MatchResult", () => {
  it("renders an editable form for the admin", async () => {
    mockAuth(1, "admin");
    mockSeasonLoad();

    renderWithRouter(101);

    await waitFor(() => expect(screen.getByLabelText("Administrator legs")).toBeInTheDocument());
    expect(screen.getByLabelText("Bob Smith legs")).toBeInTheDocument();
  });

  it("renders an editable form for a participant who is not admin", async () => {
    mockAuth(2, "player");
    mockSeasonLoad();

    renderWithRouter(101);

    await waitFor(() => expect(screen.getByLabelText("Administrator legs")).toBeInTheDocument());
  });

  it("renders a read-only view with no controls for a non-participant player", async () => {
    mockAuth(3, "player");
    mockSeasonLoad();

    renderWithRouter(101);

    await waitFor(() => expect(screen.getByText("No result recorded yet.")).toBeInTheDocument());
    expect(screen.queryByLabelText("Administrator legs")).not.toBeInTheDocument();
  });

  it("shows the recorded result read-only for a non-participant when the match is played", async () => {
    mockAuth(3, "player");
    mockSeasonLoad();

    renderWithRouter(102);

    await waitFor(() => {
      expect(screen.getByText("Result: Administrator 3–1 Bob Smith")).toBeInTheDocument();
    });
  });

  it("pre-fills the form with the existing result when editing a played match", async () => {
    mockAuth(1, "admin");
    mockSeasonLoad();

    renderWithRouter(102);

    await waitFor(() => expect(screen.getByLabelText("Administrator legs")).toHaveValue(3));
    expect(screen.getByLabelText("Bob Smith legs")).toHaveValue(1);
    expect(screen.getByLabelText("Administrator highest checkout (optional)")).toHaveValue(82);
  });

  it("submits the entered result and navigates to /season", async () => {
    mockAuth(1, "admin");
    mockSeasonLoad();
    vi.mocked(apiClient.submitMatchResult).mockResolvedValue({
      id: scheduledMatch.id,
      roundNumber: scheduledMatch.roundNumber,
      date: scheduledMatch.date,
      status: "played",
      player1Id: scheduledMatch.player1.id,
      player2Id: scheduledMatch.player2.id,
      player1Legs: 3,
      player2Legs: 0,
      player1Checkout: null,
      player2Checkout: null,
      resultEnteredBy: null,
      resultEnteredAt: null,
    });

    renderWithRouter(101);
    await waitFor(() => screen.getByLabelText("Administrator legs"));

    await userEvent.type(screen.getByLabelText("Administrator legs"), "3");
    await userEvent.type(screen.getByLabelText("Bob Smith legs"), "0");
    await userEvent.click(screen.getByRole("button", { name: "Save Result" }));

    await waitFor(() => {
      expect(apiClient.submitMatchResult).toHaveBeenCalledWith(101, { player1Legs: 3, player2Legs: 0 });
    });
    await waitFor(() => expect(screen.getByText("Season page")).toBeInTheDocument());
  });

  it("includes a checkout in the payload only when entered", async () => {
    mockAuth(1, "admin");
    mockSeasonLoad();
    vi.mocked(apiClient.submitMatchResult).mockResolvedValue({
      id: scheduledMatch.id,
      roundNumber: scheduledMatch.roundNumber,
      date: scheduledMatch.date,
      status: "played",
      player1Id: scheduledMatch.player1.id,
      player2Id: scheduledMatch.player2.id,
      player1Legs: null,
      player2Legs: null,
      player1Checkout: null,
      player2Checkout: null,
      resultEnteredBy: null,
      resultEnteredAt: null,
    });

    renderWithRouter(101);
    await waitFor(() => screen.getByLabelText("Administrator legs"));

    await userEvent.type(screen.getByLabelText("Administrator legs"), "3");
    await userEvent.type(screen.getByLabelText("Bob Smith legs"), "1");
    await userEvent.type(screen.getByLabelText("Administrator highest checkout (optional)"), "82");
    await userEvent.click(screen.getByRole("button", { name: "Save Result" }));

    await waitFor(() => {
      expect(apiClient.submitMatchResult).toHaveBeenCalledWith(101, {
        player1Legs: 3,
        player2Legs: 1,
        player1Checkout: 82,
      });
    });
  });

  it("shows an error message when submitMatchResult rejects", async () => {
    mockAuth(1, "admin");
    mockSeasonLoad();
    vi.mocked(apiClient.submitMatchResult).mockRejectedValue(
      new Error("Cannot modify a match in an archived season")
    );

    renderWithRouter(101);
    await waitFor(() => screen.getByLabelText("Administrator legs"));

    await userEvent.type(screen.getByLabelText("Administrator legs"), "3");
    await userEvent.type(screen.getByLabelText("Bob Smith legs"), "0");
    await userEvent.click(screen.getByRole("button", { name: "Save Result" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Cannot modify a match in an archived season");
    });
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

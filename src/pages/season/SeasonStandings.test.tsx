import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import SeasonStandings from "./SeasonStandings";
import * as apiClient from "../../lib/api-client";

vi.mock("../../lib/api-client");

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
  matches: [
    {
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
    },
  ],
};

describe("SeasonStandings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.getSeasonStats).mockResolvedValue([]);
  });

  it("shows an empty state when there is no active season", async () => {
    vi.mocked(apiClient.listSeasons).mockResolvedValue([]);
    render(
      <MemoryRouter>
        <SeasonStandings />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("No active season.")).toBeInTheDocument());
  });

  it("renders a standings table computed from the season's matches", async () => {
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue({
      ...season,
      matches: [{ ...season.matches[0], status: "played", player1Legs: 3, player2Legs: 1 }],
    });
    render(
      <MemoryRouter>
        <SeasonStandings />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));

    expect(screen.getByText("Legs Won")).toBeInTheDocument();
    const administratorRow = screen.getByText("Administrator").closest("tr")!;
    expect(administratorRow).toHaveTextContent("3");
  });

  it("renders the player stats table computed from the season's throw history", async () => {
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue(season);
    vi.mocked(apiClient.getSeasonStats).mockResolvedValue([
      { playerId: 1, displayName: "Administrator", threeDartAverage: 65.5, oneEightyCount: 1 },
    ]);
    render(
      <MemoryRouter>
        <SeasonStandings />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));

    expect(screen.getByText("3-Dart Avg")).toBeInTheDocument();
    const statsTable = screen.getByText("3-Dart Avg").closest("table")!;
    expect(within(statsTable).getByText("Administrator")).toBeInTheDocument();
    expect(within(statsTable).getByText("65.50")).toBeInTheDocument();
  });

  it("renders the highest checkout award computed from the season's matches", async () => {
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue({
      ...season,
      matches: [{ ...season.matches[0], status: "played", player1Legs: 3, player2Legs: 1, player1Checkout: 121 }],
    });
    render(
      <MemoryRouter>
        <SeasonStandings />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));

    const awardParagraph = screen.getByText(/Highest Checkout:/).closest("p")!;
    expect(awardParagraph).toBeInTheDocument();
    expect(within(awardParagraph).getByText("121")).toBeInTheDocument();
  });
});

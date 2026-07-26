import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import SeasonMatches from "./SeasonMatches";
import * as apiClient from "../../lib/api-client";
import { useAuth } from "../../lib/AuthContext";

vi.mock("../../lib/api-client");
vi.mock("../../lib/AuthContext", () => ({
  useAuth: vi.fn(),
}));

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

const multiDateSeason: apiClient.Season = {
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
    {
      id: 102,
      roundNumber: 1,
      date: "2026-08-01",
      status: "cancelled",
      player1: { id: 1, displayName: "Administrator" },
      player2: { id: 3, displayName: "Carol Jones" },
      player1Legs: null,
      player2Legs: null,
      player1Checkout: null,
      player2Checkout: null,
      resultEnteredBy: null,
      resultEnteredAt: null,
    },
    {
      id: 103,
      roundNumber: 2,
      date: "2026-08-08",
      status: "scheduled",
      player1: { id: 2, displayName: "Bob Smith" },
      player2: { id: 3, displayName: "Carol Jones" },
      player1Legs: null,
      player2Legs: null,
      player1Checkout: null,
      player2Checkout: null,
      resultEnteredBy: null,
      resultEnteredAt: null,
    },
  ],
};

function mockNonParticipant() {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 3, username: "cjones", role: "player", displayName: "Carol Jones" },
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
  });
}

function mockParticipant() {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 2, username: "bsmith", role: "player", displayName: "Bob Smith" },
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
  });
}

function mockAdmin() {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 1, username: "admin", role: "admin", displayName: "Administrator" },
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
  });
}

describe("SeasonMatches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows an empty state with no Create Season link for a player when there is no active season", async () => {
    mockNonParticipant();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([]);
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("No active season.")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "Create Season" })).not.toBeInTheDocument();
  });

  it("shows a Create Season link for an admin when there is no active season", async () => {
    mockAdmin();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([]);
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Create Season" })).toHaveAttribute("href", "/season/new");
    });
  });

  it("renders the active season's schedule", async () => {
    mockNonParticipant();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue(season);
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("Spring 2026")).toBeInTheDocument());
    expect(screen.getByText("Administrator vs Bob Smith")).toBeInTheDocument();
  });

  it("shows no controls, not even Enter Result, for a non-participant player", async () => {
    mockNonParticipant();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue(season);
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive Season" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Enter Result" })).not.toBeInTheDocument();
  });

  it("shows only an Enter Result link, no reschedule/cancel, for a non-admin participant", async () => {
    mockParticipant();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue(season);
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Enter Result" })).toHaveAttribute(
      "href",
      "/season/matches/101/result"
    );
  });

  it("shows a Start Live link for a scheduled match, alongside Enter Result", async () => {
    mockParticipant();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue(season);
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));
    expect(screen.getByRole("link", { name: "Start Live" })).toHaveAttribute("href", "/season/matches/101/live");
  });

  it("shows a Resume Live link for an in_progress match", async () => {
    mockParticipant();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue({
      ...season,
      matches: [{ ...season.matches[0], status: "in_progress" }],
    });
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));
    expect(screen.getByRole("link", { name: "Resume Live" })).toHaveAttribute("href", "/season/matches/101/live");
  });

  it("shows no live-scoring link once a match is played", async () => {
    mockAdmin();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue({
      ...season,
      matches: [{ ...season.matches[0], status: "played", player1Legs: 3, player2Legs: 1 }],
    });
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));
    expect(screen.queryByRole("link", { name: "Start Live" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Resume Live" })).not.toBeInTheDocument();
  });

  it("shows Edit Result instead of Enter Result once a match is played", async () => {
    mockAdmin();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue({
      ...season,
      matches: [{ ...season.matches[0], status: "played", player1Legs: 3, player2Legs: 1 }],
    });
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));
    expect(screen.getByRole("link", { name: "Edit Result" })).toBeInTheDocument();
  });

  it("cancels a match when the admin clicks Cancel", async () => {
    mockAdmin();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue(season);
    vi.mocked(apiClient.updateMatch).mockResolvedValue({
      id: 101,
      roundNumber: 1,
      date: "2026-08-01",
      status: "cancelled",
      player1Id: 1,
      player2Id: 2,
    });
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(apiClient.updateMatch).toHaveBeenCalledWith(101, { status: "cancelled" });
    });
  });

  it("archives the season when the admin clicks Archive Season", async () => {
    mockAdmin();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue(season);
    vi.mocked(apiClient.archiveSeason).mockResolvedValue({ ...season, status: "archived" });
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));

    await userEvent.click(screen.getByRole("button", { name: "Archive Season" }));

    await waitFor(() => {
      expect(apiClient.archiveSeason).toHaveBeenCalledWith(1);
    });
  });

  it("shows an Add Match form for an admin, hidden for a non-admin", async () => {
    mockAdmin();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue(season);
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));
    expect(screen.getByRole("heading", { name: "Add Match" })).toBeInTheDocument();
  });

  it("hides the Add Match form for a non-admin participant", async () => {
    mockParticipant();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue(season);
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));
    expect(screen.queryByRole("heading", { name: "Add Match" })).not.toBeInTheDocument();
  });

  it("adds a match with the form and reloads", async () => {
    mockAdmin();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue(season);
    vi.mocked(apiClient.addMatch).mockResolvedValue({ ...season.matches[0], id: 999, roundNumber: 0 });
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));

    await userEvent.type(screen.getByLabelText("New match date"), "2026-09-01");
    await userEvent.selectOptions(screen.getByLabelText("Player 1"), "1");
    await userEvent.selectOptions(screen.getByLabelText("Player 2"), "2");
    await userEvent.click(screen.getByRole("button", { name: "Add Match" }));

    await waitFor(() => {
      expect(apiClient.addMatch).toHaveBeenCalledWith(1, { date: "2026-09-01", player1Id: 1, player2Id: 2 });
    });
    expect(apiClient.getSeason).toHaveBeenCalledTimes(2);
  });

  it("shows a selection checkbox per match for an admin, and a disabled Delete Selected button with none selected", async () => {
    mockAdmin();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue(season);
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));

    expect(screen.getByRole("button", { name: "Delete Selected (0)" })).toBeDisabled();
    expect(screen.getByLabelText("Select Administrator vs Bob Smith")).toBeInTheDocument();
  });

  it("deletes the selected matches after confirmation and reloads", async () => {
    mockAdmin();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue(season);
    vi.mocked(apiClient.deleteMatch).mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));

    await userEvent.click(screen.getByLabelText("Select Administrator vs Bob Smith"));
    await userEvent.click(screen.getByRole("button", { name: "Delete Selected (1)" }));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("1 match"));
    await waitFor(() => {
      expect(apiClient.deleteMatch).toHaveBeenCalledWith(101);
    });
    expect(apiClient.getSeason).toHaveBeenCalledTimes(2);
  });

  it("warns about lost results/throw history when a selected match has already been played", async () => {
    mockAdmin();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue({
      ...season,
      matches: [{ ...season.matches[0], status: "played", player1Legs: 3, player2Legs: 1 }],
    });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));

    await userEvent.click(screen.getByLabelText("Select Administrator vs Bob Smith"));
    await userEvent.click(screen.getByRole("button", { name: "Delete Selected (1)" }));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("permanently lost"));
    expect(apiClient.deleteMatch).not.toHaveBeenCalled();
  });
});

describe("SeasonMatches Date view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
  });

  it("defaults to Round view", async () => {
    mockAdmin();
    vi.mocked(apiClient.getSeason).mockResolvedValue(multiDateSeason);
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));

    expect(screen.getByRole("heading", { name: "Round 1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /All Matches/ })).not.toBeInTheDocument();
  });

  it("lists every date with a match count when switching to Date view", async () => {
    mockAdmin();
    vi.mocked(apiClient.getSeason).mockResolvedValue(multiDateSeason);
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));

    await userEvent.click(screen.getByRole("button", { name: "Date view" }));

    expect(screen.getByRole("button", { name: "All Matches (3)" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `${new Date("2026-08-01").toLocaleDateString()} (2 matches)` })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `${new Date("2026-08-08").toLocaleDateString()} (1 match)` })
    ).toBeInTheDocument();
  });

  it("shows every match under All Matches by default in Date view", async () => {
    mockAdmin();
    vi.mocked(apiClient.getSeason).mockResolvedValue(multiDateSeason);
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));

    await userEvent.click(screen.getByRole("button", { name: "Date view" }));

    expect(screen.getByText("Administrator vs Bob Smith")).toBeInTheDocument();
    expect(screen.getByText("Administrator vs Carol Jones")).toBeInTheDocument();
    expect(screen.getByText("Bob Smith vs Carol Jones")).toBeInTheDocument();
  });

  it("filters to only that date's matches when a date is clicked", async () => {
    mockAdmin();
    vi.mocked(apiClient.getSeason).mockResolvedValue(multiDateSeason);
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));

    await userEvent.click(screen.getByRole("button", { name: "Date view" }));
    await userEvent.click(
      screen.getByRole("button", { name: `${new Date("2026-08-08").toLocaleDateString()} (1 match)` })
    );

    expect(screen.getByText("Bob Smith vs Carol Jones")).toBeInTheDocument();
    expect(screen.queryByText("Administrator vs Bob Smith")).not.toBeInTheDocument();
    expect(screen.queryByText("Administrator vs Carol Jones")).not.toBeInTheDocument();
  });

  it("still shows a cancelled match and counts it toward its date's total", async () => {
    mockAdmin();
    vi.mocked(apiClient.getSeason).mockResolvedValue(multiDateSeason);
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));

    await userEvent.click(screen.getByRole("button", { name: "Date view" }));

    expect(screen.getByText("Administrator vs Carol Jones")).toBeInTheDocument();
    expect(screen.getAllByText("cancelled")).toHaveLength(1);
  });

  it("filters both the match list and the date list itself when My matches only is checked", async () => {
    mockAdmin();
    vi.mocked(apiClient.getSeason).mockResolvedValue(multiDateSeason);
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));

    await userEvent.click(screen.getByRole("button", { name: "Date view" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "My matches only" }));

    expect(screen.getByRole("button", { name: "All Matches (2)" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `${new Date("2026-08-01").toLocaleDateString()} (2 matches)` })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: new RegExp(new Date("2026-08-08").toLocaleDateString()) })
    ).not.toBeInTheDocument();
    expect(screen.getByText("Administrator vs Bob Smith")).toBeInTheDocument();
    expect(screen.queryByText("Bob Smith vs Carol Jones")).not.toBeInTheDocument();
  });

  it("shows a No matches message when a selection yields nothing", async () => {
    mockNonParticipant();
    vi.mocked(apiClient.getSeason).mockResolvedValue({ ...season, matches: [season.matches[0]] });
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));

    await userEvent.click(screen.getByRole("button", { name: "Date view" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "My matches only" }));

    expect(screen.getByText("No matches")).toBeInTheDocument();
  });

  it("shows the same admin match actions in Date view as in Round view", async () => {
    mockAdmin();
    vi.mocked(apiClient.getSeason).mockResolvedValue(multiDateSeason);
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));

    await userEvent.click(screen.getByRole("button", { name: "Date view" }));

    expect(screen.getByLabelText("Select Administrator vs Bob Smith")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Cancel" }).length).toBeGreaterThan(0);
  });

  it("switches back to Round view when Round view is clicked", async () => {
    mockAdmin();
    vi.mocked(apiClient.getSeason).mockResolvedValue(multiDateSeason);
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));

    await userEvent.click(screen.getByRole("button", { name: "Date view" }));
    await userEvent.click(screen.getByRole("button", { name: "Round view" }));

    expect(screen.getByRole("heading", { name: "Round 1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /All Matches/ })).not.toBeInTheDocument();
  });
});

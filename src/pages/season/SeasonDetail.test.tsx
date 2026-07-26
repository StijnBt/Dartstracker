import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import SeasonDetail from "./SeasonDetail";
import * as apiClient from "../../lib/api-client";

vi.mock("../../lib/api-client");

function renderWithRouter(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/seasons/${id}`]}>
      <Routes>
        <Route path="/seasons/:id" element={<SeasonDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("SeasonDetail", () => {
  beforeEach(() => {
    vi.mocked(apiClient.getSeasonStats).mockResolvedValue([]);
  });

  it("renders the season's read-only schedule", async () => {
    vi.mocked(apiClient.getSeason).mockResolvedValue({
      id: 1,
      name: "Winter 2025",
      roundType: "single",
      status: "archived",
      participants: [
        { id: 1, displayName: "Administrator" },
        { id: 2, displayName: "Bob Smith" },
      ],
      matches: [
        {
          id: 101,
          roundNumber: 1,
          date: "2025-12-01",
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
    });

    renderWithRouter("1");

    await waitFor(() => expect(screen.getByText("Winter 2025")).toBeInTheDocument());
    expect(screen.getByText("Administrator vs Bob Smith")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("renders a standings table computed from the season's matches", async () => {
    vi.mocked(apiClient.getSeason).mockResolvedValue({
      id: 1,
      name: "Winter 2025",
      roundType: "single",
      status: "archived",
      participants: [
        { id: 1, displayName: "Administrator" },
        { id: 2, displayName: "Bob Smith" },
      ],
      matches: [
        {
          id: 101,
          roundNumber: 1,
          date: "2025-12-01",
          status: "played",
          player1: { id: 1, displayName: "Administrator" },
          player2: { id: 2, displayName: "Bob Smith" },
          player1Legs: 3,
          player2Legs: 0,
          player1Checkout: null,
          player2Checkout: null,
          resultEnteredBy: null,
          resultEnteredAt: null,
        },
      ],
    });

    renderWithRouter("1");

    await waitFor(() => expect(screen.getByText("Winter 2025")).toBeInTheDocument());
    expect(screen.getByText("Legs Won")).toBeInTheDocument();
    const administratorRow = screen.getByText("Administrator").closest("tr")!;
    expect(administratorRow).toHaveTextContent("3");
  });

  it("renders the player stats table computed from the season's throw history", async () => {
    vi.mocked(apiClient.getSeason).mockResolvedValue({
      id: 1,
      name: "Winter 2025",
      roundType: "single",
      status: "archived",
      participants: [
        { id: 1, displayName: "Administrator" },
        { id: 2, displayName: "Bob Smith" },
      ],
      matches: [
        {
          id: 101,
          roundNumber: 1,
          date: "2025-12-01",
          status: "played",
          player1: { id: 1, displayName: "Administrator" },
          player2: { id: 2, displayName: "Bob Smith" },
          player1Legs: 3,
          player2Legs: 0,
          player1Checkout: null,
          player2Checkout: null,
          resultEnteredBy: null,
          resultEnteredAt: null,
        },
      ],
    });
    vi.mocked(apiClient.getSeasonStats).mockResolvedValue([
      { playerId: 1, displayName: "Administrator", threeDartAverage: 72.25, oneEightyCount: 3 },
    ]);

    renderWithRouter("1");

    await waitFor(() => expect(screen.getByText("Winter 2025")).toBeInTheDocument());
    expect(screen.getByText("3-Dart Avg")).toBeInTheDocument();
    const statsTable = screen.getByText("3-Dart Avg").closest("table")!;
    expect(within(statsTable).getByText("Administrator")).toBeInTheDocument();
    expect(within(statsTable).getByText("72.25")).toBeInTheDocument();
  });

  it("renders the highest checkout award computed from the season's matches", async () => {
    vi.mocked(apiClient.getSeason).mockResolvedValue({
      id: 1,
      name: "Winter 2025",
      roundType: "single",
      status: "archived",
      participants: [
        { id: 1, displayName: "Administrator" },
        { id: 2, displayName: "Bob Smith" },
      ],
      matches: [
        {
          id: 101,
          roundNumber: 1,
          date: "2025-12-01",
          status: "played",
          player1: { id: 1, displayName: "Administrator" },
          player2: { id: 2, displayName: "Bob Smith" },
          player1Legs: 3,
          player2Legs: 0,
          player1Checkout: 85,
          player2Checkout: null,
          resultEnteredBy: null,
          resultEnteredAt: null,
        },
      ],
    });

    renderWithRouter("1");

    await waitFor(() => expect(screen.getByText("Winter 2025")).toBeInTheDocument());
    const awardParagraph = screen.getByText(/Highest Checkout:/).closest("p")!;
    expect(awardParagraph).toBeInTheDocument();
    expect(within(awardParagraph).getByText("85")).toBeInTheDocument();
  });

  it("shows an error message when the season doesn't exist", async () => {
    vi.mocked(apiClient.getSeason).mockRejectedValue(new Error("Season not found"));

    renderWithRouter("999");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Season not found");
    });
  });
});

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import NewSeason from "./NewSeason";
import * as apiClient from "../../lib/api-client";

vi.mock("../../lib/api-client");

const members = [
  { id: 1, username: "admin", displayName: "Administrator", role: "admin" as const, isActive: true },
  { id: 2, username: "bsmith", displayName: "Bob Smith", role: "player" as const, isActive: true },
  { id: 3, username: "csmith", displayName: "Carol Smith", role: "player" as const, isActive: true },
  { id: 4, username: "dsmith", displayName: "Dave Smith", role: "player" as const, isActive: true },
  { id: 5, username: "old", displayName: "Old Player", role: "player" as const, isActive: false },
];

function renderWithRouter() {
  return render(
    <MemoryRouter initialEntries={["/season/new"]}>
      <Routes>
        <Route path="/season/new" element={<NewSeason />} />
        <Route path="/season" element={<div>Season page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

async function selectFourPlayers() {
  await userEvent.click(screen.getByLabelText("Administrator"));
  await userEvent.click(screen.getByLabelText("Bob Smith"));
  await userEvent.click(screen.getByLabelText("Carol Smith"));
  await userEvent.click(screen.getByLabelText("Dave Smith"));
}

describe("NewSeason", () => {
  it("lists only active members as selectable participants", async () => {
    vi.mocked(apiClient.listMembers).mockResolvedValue(members);
    renderWithRouter();
    await waitFor(() => expect(screen.getByLabelText("Administrator")).toBeInTheDocument());
    expect(screen.queryByLabelText("Old Player")).not.toBeInTheDocument();
  });

  it("renders 3 date inputs after selecting 4 participants with single round type", async () => {
    vi.mocked(apiClient.listMembers).mockResolvedValue(members);
    renderWithRouter();
    await waitFor(() => screen.getByLabelText("Administrator"));

    await selectFourPlayers();

    expect(screen.getByText("Round 1")).toBeInTheDocument();
    expect(screen.getByText("Round 2")).toBeInTheDocument();
    expect(screen.getByText("Round 3")).toBeInTheDocument();
    expect(screen.queryByText("Round 4")).not.toBeInTheDocument();
  });

  it("renders 6 date inputs after selecting 4 participants with double round type", async () => {
    vi.mocked(apiClient.listMembers).mockResolvedValue(members);
    renderWithRouter();
    await waitFor(() => screen.getByLabelText("Administrator"));

    await userEvent.selectOptions(screen.getByLabelText("Round type"), "double");
    await selectFourPlayers();

    expect(screen.getByText("Round 6")).toBeInTheDocument();
    expect(screen.queryByText("Round 7")).not.toBeInTheDocument();
  });

  it("blocks submission with fewer than 2 participants", async () => {
    vi.mocked(apiClient.listMembers).mockResolvedValue(members);
    renderWithRouter();
    await waitFor(() => screen.getByLabelText("Administrator"));

    await userEvent.type(screen.getByLabelText("Name"), "Spring 2026");
    await userEvent.click(screen.getByLabelText("Administrator"));
    await userEvent.click(screen.getByRole("button", { name: "Create Season" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Select at least 2 participants");
    expect(apiClient.createSeason).not.toHaveBeenCalled();
  });

  it("submits the season with entered dates and navigates to /season", async () => {
    vi.mocked(apiClient.listMembers).mockResolvedValue(members);
    vi.mocked(apiClient.createSeason).mockResolvedValue({
      id: 1,
      name: "Spring 2026",
      roundType: "single",
      status: "active",
      participants: [],
      matches: [],
    });
    renderWithRouter();
    await waitFor(() => screen.getByLabelText("Administrator"));

    await userEvent.type(screen.getByLabelText("Name"), "Spring 2026");
    await selectFourPlayers();
    const dateInputs = screen.getAllByLabelText(/^Round \d date$/);
    expect(dateInputs).toHaveLength(3);
    fireEvent.change(dateInputs[0], { target: { value: "2026-08-01" } });
    fireEvent.change(dateInputs[1], { target: { value: "2026-08-08" } });
    fireEvent.change(dateInputs[2], { target: { value: "2026-08-15" } });

    await userEvent.click(screen.getByRole("button", { name: "Create Season" }));

    await waitFor(() => {
      expect(apiClient.createSeason).toHaveBeenCalledWith({
        name: "Spring 2026",
        roundType: "single",
        participantIds: [1, 2, 3, 4],
        roundDates: ["2026-08-01", "2026-08-08", "2026-08-15"],
      });
    });
    await waitFor(() => expect(screen.getByText("Season page")).toBeInTheDocument());
  });

  it("shows an error message when createSeason rejects", async () => {
    vi.mocked(apiClient.listMembers).mockResolvedValue(members);
    vi.mocked(apiClient.createSeason).mockRejectedValue(new Error("A season is already active"));
    renderWithRouter();
    await waitFor(() => screen.getByLabelText("Administrator"));

    await userEvent.type(screen.getByLabelText("Name"), "Spring 2026");
    await selectFourPlayers();
    for (const input of screen.getAllByLabelText(/^Round \d date$/)) {
      fireEvent.change(input, { target: { value: "2026-08-01" } });
    }
    await userEvent.click(screen.getByRole("button", { name: "Create Season" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("A season is already active");
    });
  });
});

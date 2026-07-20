import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
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
        },
      ],
    });

    renderWithRouter("1");

    await waitFor(() => expect(screen.getByText("Winter 2025")).toBeInTheDocument());
    expect(screen.getByText("Administrator vs Bob Smith")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("shows an error message when the season doesn't exist", async () => {
    vi.mocked(apiClient.getSeason).mockRejectedValue(new Error("Season not found"));

    renderWithRouter("999");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Season not found");
    });
  });
});

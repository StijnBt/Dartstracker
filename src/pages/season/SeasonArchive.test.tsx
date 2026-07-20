import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import SeasonArchive from "./SeasonArchive";
import * as apiClient from "../../lib/api-client";

vi.mock("../../lib/api-client");

describe("SeasonArchive", () => {
  it("lists only archived seasons, linking to their detail page", async () => {
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 2, name: "Summer 2026", roundType: "double", status: "active", createdAt: "2026-06-01" },
      { id: 1, name: "Winter 2025", roundType: "single", status: "archived", createdAt: "2025-11-01" },
    ]);

    render(
      <MemoryRouter>
        <SeasonArchive />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("Winter 2025")).toBeInTheDocument());
    expect(screen.queryByText("Summer 2026")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Winter 2025/ })).toHaveAttribute("href", "/seasons/1");
  });

  it("shows an empty state when there are no archived seasons", async () => {
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 2, name: "Summer 2026", roundType: "double", status: "active", createdAt: "2026-06-01" },
    ]);

    render(
      <MemoryRouter>
        <SeasonArchive />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("No archived seasons yet.")).toBeInTheDocument());
  });

  it("shows an error message when loading fails", async () => {
    vi.mocked(apiClient.listSeasons).mockRejectedValue(new Error("Failed to load seasons"));

    render(
      <MemoryRouter>
        <SeasonArchive />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Failed to load seasons");
    });
  });
});

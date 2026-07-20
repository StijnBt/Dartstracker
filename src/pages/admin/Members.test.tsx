import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import Members from "./Members";
import * as apiClient from "../../lib/api-client";

vi.mock("../../lib/api-client");

describe("Members", () => {
  it("lists all members with their role and active status", async () => {
    vi.mocked(apiClient.listMembers).mockResolvedValue([
      { id: 1, username: "admin", displayName: "Administrator", role: "admin", isActive: true },
      { id: 2, username: "bsmith", displayName: "Bob Smith", role: "player", isActive: false },
    ]);

    render(
      <MemoryRouter>
        <Members />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Administrator")).toBeInTheDocument();
    });
    expect(screen.getByText("Bob Smith")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("inactive")).toBeInTheDocument();
  });

  it("links each row to its edit page", async () => {
    vi.mocked(apiClient.listMembers).mockResolvedValue([
      { id: 2, username: "bsmith", displayName: "Bob Smith", role: "player", isActive: true },
    ]);

    render(
      <MemoryRouter>
        <Members />
      </MemoryRouter>
    );

    await waitFor(() => screen.getByText("Bob Smith"));
    expect(screen.getByRole("link", { name: /Bob Smith/ })).toHaveAttribute("href", "/admin/members/2/edit");
  });

  it("links the Add button to the new-member page", async () => {
    vi.mocked(apiClient.listMembers).mockResolvedValue([]);
    render(
      <MemoryRouter>
        <Members />
      </MemoryRouter>
    );
    await waitFor(() => expect(apiClient.listMembers).toHaveBeenCalled());
    expect(screen.getByRole("link", { name: "+ Add" })).toHaveAttribute("href", "/admin/members/new");
  });

  it("shows an error message when loading fails", async () => {
    vi.mocked(apiClient.listMembers).mockRejectedValue(new Error("Failed to load members"));

    render(
      <MemoryRouter>
        <Members />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Failed to load members");
    });
  });
});

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import EditMember from "./EditMember";
import * as apiClient from "../../lib/api-client";
import { useAuth } from "../../lib/AuthContext";

vi.mock("../../lib/api-client");
vi.mock("../../lib/AuthContext", () => ({
  useAuth: vi.fn(),
}));

const members: apiClient.Member[] = [
  { id: 1, username: "admin", displayName: "Administrator", role: "admin", isActive: true },
  { id: 2, username: "bsmith", displayName: "Bob Smith", role: "player", isActive: true },
];

function renderWithRouter(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/admin/members/${id}/edit`]}>
      <Routes>
        <Route path="/admin/members/:id/edit" element={<EditMember />} />
        <Route path="/admin/members" element={<div>Members list</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("EditMember", () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 1, username: "admin", role: "admin", displayName: "Administrator" },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
  });

  it("pre-fills the form with the matching member's data", async () => {
    vi.mocked(apiClient.listMembers).mockResolvedValue(members);
    renderWithRouter("2");

    await waitFor(() => {
      expect(screen.getByDisplayValue("Bob Smith")).toBeInTheDocument();
    });
    expect(screen.getByText("bsmith")).toBeInTheDocument();
  });

  it("shows an error when no member matches the id", async () => {
    vi.mocked(apiClient.listMembers).mockResolvedValue(members);
    renderWithRouter("999");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Member not found");
    });
  });

  it("disables role and status when editing your own account", async () => {
    vi.mocked(apiClient.listMembers).mockResolvedValue(members);
    renderWithRouter("1");

    await waitFor(() => {
      expect(screen.getByLabelText("Role")).toBeDisabled();
    });
    expect(screen.getByLabelText("Status")).toBeDisabled();
  });

  it("does not disable role and status when editing a different account", async () => {
    vi.mocked(apiClient.listMembers).mockResolvedValue(members);
    renderWithRouter("2");

    await waitFor(() => {
      expect(screen.getByLabelText("Role")).not.toBeDisabled();
    });
  });

  it("updates the member and navigates to the members list on success", async () => {
    vi.mocked(apiClient.listMembers).mockResolvedValue(members);
    vi.mocked(apiClient.updateMember).mockResolvedValue({ ...members[1], displayName: "Robert Smith" });

    renderWithRouter("2");

    await waitFor(() => screen.getByDisplayValue("Bob Smith"));
    await userEvent.clear(screen.getByLabelText("Display name"));
    await userEvent.type(screen.getByLabelText("Display name"), "Robert Smith");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(apiClient.updateMember).toHaveBeenCalledWith(2, {
        displayName: "Robert Smith",
        role: "player",
        isActive: true,
      });
    });
    await waitFor(() => {
      expect(screen.getByText("Members list")).toBeInTheDocument();
    });
  });

  it("includes the new password only when one was entered", async () => {
    vi.mocked(apiClient.listMembers).mockResolvedValue(members);
    vi.mocked(apiClient.updateMember).mockResolvedValue(members[1]);

    renderWithRouter("2");

    await waitFor(() => screen.getByDisplayValue("Bob Smith"));
    await userEvent.type(screen.getByLabelText("New password"), "newsecretpw1");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(apiClient.updateMember).toHaveBeenCalledWith(2, {
        displayName: "Bob Smith",
        role: "player",
        isActive: true,
        password: "newsecretpw1",
      });
    });
  });
});

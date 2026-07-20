import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import NewMember from "./NewMember";
import * as apiClient from "../../lib/api-client";

vi.mock("../../lib/api-client");

function renderWithRouter() {
  return render(
    <MemoryRouter initialEntries={["/admin/members/new"]}>
      <Routes>
        <Route path="/admin/members/new" element={<NewMember />} />
        <Route path="/admin/members" element={<div>Members list</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("NewMember", () => {
  it("creates the member and navigates to the members list on success", async () => {
    vi.mocked(apiClient.createMember).mockResolvedValue({
      id: 2,
      username: "bsmith",
      displayName: "Bob Smith",
      role: "player",
      isActive: true,
    });

    renderWithRouter();

    await userEvent.type(screen.getByLabelText("Username"), "bsmith");
    await userEvent.type(screen.getByLabelText("Display name"), "Bob Smith");
    await userEvent.type(screen.getByLabelText("Password"), "secretpw1");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(apiClient.createMember).toHaveBeenCalledWith({
        username: "bsmith",
        displayName: "Bob Smith",
        role: "player",
        password: "secretpw1",
      });
    });
    await waitFor(() => {
      expect(screen.getByText("Members list")).toBeInTheDocument();
    });
  });
});

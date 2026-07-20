import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import { AdminRoute } from "./AdminRoute";
import { useAuth } from "../lib/AuthContext";

vi.mock("../lib/AuthContext", () => ({
  useAuth: vi.fn(),
}));

function renderWithRouter(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/login" element={<div>Login page</div>} />
        <Route path="/" element={<div>Home page</div>} />
        <Route element={<AdminRoute />}>
          <Route path="/admin/members" element={<div>Admin content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe("AdminRoute", () => {
  it("renders nothing while auth state is loading", () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: true, login: vi.fn(), logout: vi.fn() });
    const { container } = renderWithRouter("/admin/members");
    expect(container).toBeEmptyDOMElement();
  });

  it("redirects to /login when there is no user", () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: false, login: vi.fn(), logout: vi.fn() });
    renderWithRouter("/admin/members");
    expect(screen.getByText("Login page")).toBeInTheDocument();
  });

  it("redirects to / when the logged-in user is not an admin", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 2, username: "bsmith", role: "player", displayName: "Bob Smith" },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    renderWithRouter("/admin/members");
    expect(screen.getByText("Home page")).toBeInTheDocument();
  });

  it("renders the admin content when the logged-in user is an admin", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 1, username: "admin", role: "admin", displayName: "Administrator" },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    renderWithRouter("/admin/members");
    expect(screen.getByText("Admin content")).toBeInTheDocument();
  });
});

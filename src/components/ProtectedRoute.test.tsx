import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import { ProtectedRoute } from "./ProtectedRoute";
import { useAuth } from "../lib/AuthContext";

vi.mock("../lib/AuthContext", () => ({
  useAuth: vi.fn(),
}));

function renderWithRouter(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/login" element={<div>Login page</div>} />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<div>Protected content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe("ProtectedRoute", () => {
  it("renders nothing while auth state is loading", () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: true, login: vi.fn(), logout: vi.fn() });
    const { container } = renderWithRouter("/");
    expect(container).toBeEmptyDOMElement();
  });

  it("redirects to /login when there is no user", () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: false, login: vi.fn(), logout: vi.fn() });
    renderWithRouter("/");
    expect(screen.getByText("Login page")).toBeInTheDocument();
  });

  it("renders the protected content when a user is present", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 1, username: "admin", role: "admin", displayName: "Administrator" },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    renderWithRouter("/");
    expect(screen.getByText("Protected content")).toBeInTheDocument();
  });
});

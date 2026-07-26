import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import NavBar from "./NavBar";
import { branding } from "../branding";
import { useAuth } from "../lib/AuthContext";

vi.mock("../lib/AuthContext", () => ({
  useAuth: vi.fn(),
}));

describe("NavBar", () => {
  it("renders the branded app name using the theme's primary color and heading font", () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: false, login: vi.fn(), logout: vi.fn() });
    render(
      <MemoryRouter>
        <NavBar />
      </MemoryRouter>
    );
    const heading = screen.getByRole("heading", { name: branding.appName });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveClass("text-primary");
    expect(heading).toHaveClass("font-heading");
  });

  it("renders the branded logo", () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: false, login: vi.fn(), logout: vi.fn() });
    render(
      <MemoryRouter>
        <NavBar />
      </MemoryRouter>
    );
    const logo = screen.getByRole("img", { name: branding.appName });
    expect(logo).toHaveAttribute("src", branding.logoSrc);
  });

  it("links the logo/app name to the home page", () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: false, login: vi.fn(), logout: vi.fn() });
    render(
      <MemoryRouter>
        <NavBar />
      </MemoryRouter>
    );
    const link = screen.getByRole("heading", { name: branding.appName }).closest("a");
    expect(link).toHaveAttribute("href", "/");
  });

  it("shows the logged-in user's display name and a logout button", () => {
    const logoutMock = vi.fn();
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 1, username: "admin", role: "admin", displayName: "Administrator" },
      loading: false,
      login: vi.fn(),
      logout: logoutMock,
    });
    render(
      <MemoryRouter>
        <NavBar />
      </MemoryRouter>
    );
    expect(screen.getByText("Administrator")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });

  it("shows no nav links when logged out", () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: false, login: vi.fn(), logout: vi.fn() });
    render(
      <MemoryRouter>
        <NavBar />
      </MemoryRouter>
    );
    expect(screen.queryByRole("link", { name: "Standings" })).not.toBeInTheDocument();
  });
});

describe("NavBar navigation", () => {
  it("shows a Manage Members link for an admin", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 1, username: "admin", role: "admin", displayName: "Administrator" },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    render(
      <MemoryRouter>
        <NavBar />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "Manage Members" })).toHaveAttribute("href", "/admin/members");
  });

  it("does not show a Manage Members link for a player", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 2, username: "bsmith", role: "player", displayName: "Bob Smith" },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    render(
      <MemoryRouter>
        <NavBar />
      </MemoryRouter>
    );
    expect(screen.queryByRole("link", { name: "Manage Members" })).not.toBeInTheDocument();
  });

  it("shows Standings, Matches, and Season Archive links for every logged-in user, admin or player", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 2, username: "bsmith", role: "player", displayName: "Bob Smith" },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    render(
      <MemoryRouter>
        <NavBar />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "Standings" })).toHaveAttribute("href", "/season/standings");
    expect(screen.getByRole("link", { name: "Matches" })).toHaveAttribute("href", "/season/matches");
    expect(screen.getByRole("link", { name: "Season Archive" })).toHaveAttribute("href", "/seasons");
  });
});

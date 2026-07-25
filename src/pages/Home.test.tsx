import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Home from "./Home";
import { branding } from "../branding";
import { useAuth } from "../lib/AuthContext";
import * as apiClient from "../lib/api-client";

vi.mock("../lib/AuthContext", () => ({
  useAuth: vi.fn(),
}));
vi.mock("../lib/api-client");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiClient.getAnnouncements).mockResolvedValue([]);
});

describe("Home", () => {
  it("renders the branded app name using the theme's primary color and heading font", () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: false, login: vi.fn(), logout: vi.fn() });
    render(
      <MemoryRouter>
        <Home />
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
        <Home />
      </MemoryRouter>
    );
    const logo = screen.getByRole("img", { name: branding.appName });
    expect(logo).toHaveAttribute("src", branding.logoSrc);
  });

  it("shows the logged-in user's display name and a logout button", async () => {
    const logoutMock = vi.fn();
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 1, username: "admin", role: "admin", displayName: "Administrator" },
      loading: false,
      login: vi.fn(),
      logout: logoutMock,
    });
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    expect(screen.getByText("Administrator")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
    await waitFor(() => expect(apiClient.getAnnouncements).toHaveBeenCalled());
  });
});

describe("Home navigation", () => {
  it("shows a Manage Members link for an admin", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 1, username: "admin", role: "admin", displayName: "Administrator" },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "Manage Members" })).toHaveAttribute("href", "/admin/members");
    await waitFor(() => expect(apiClient.getAnnouncements).toHaveBeenCalled());
  });

  it("does not show a Manage Members link for a player", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 2, username: "bsmith", role: "player", displayName: "Bob Smith" },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    expect(screen.queryByRole("link", { name: "Manage Members" })).not.toBeInTheDocument();
    await waitFor(() => expect(apiClient.getAnnouncements).toHaveBeenCalled());
  });

  it("shows a Season link for every logged-in user, admin or player", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 2, username: "bsmith", role: "player", displayName: "Bob Smith" },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "Season" })).toHaveAttribute("href", "/season");
    await waitFor(() => expect(apiClient.getAnnouncements).toHaveBeenCalled());
  });
});

describe("Home announcement feed", () => {
  it("renders the announcement feed below the header for a logged-in user", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 2, username: "bsmith", role: "player", displayName: "Bob Smith" },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("No announcements yet")).toBeInTheDocument());
  });

  it("does not render the announcement feed when logged out", () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: false, login: vi.fn(), logout: vi.fn() });
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    expect(apiClient.getAnnouncements).not.toHaveBeenCalled();
  });
});

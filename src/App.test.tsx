import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import App from "./App";
import * as apiClient from "./lib/api-client";

vi.mock("./lib/api-client");

describe("App", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/");
    vi.mocked(apiClient.getAnnouncements).mockResolvedValue([]);
  });

  it("redirects to the login page when there is no active session", async () => {
    vi.mocked(apiClient.fetchCurrentUser).mockResolvedValue(null);
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Log in" })).toBeInTheDocument();
    });
  });

  it("renders the home page when a session is active", async () => {
    vi.mocked(apiClient.fetchCurrentUser).mockResolvedValue({
      id: 1,
      username: "admin",
      role: "admin",
      displayName: "Administrator",
    });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Administrator")).toBeInTheDocument();
    });
  });

  it("navigates to the members list when an admin clicks Manage Members", async () => {
    vi.mocked(apiClient.fetchCurrentUser).mockResolvedValue({
      id: 1,
      username: "admin",
      role: "admin",
      displayName: "Administrator",
    });
    vi.mocked(apiClient.listMembers).mockResolvedValue([]);

    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Administrator")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("link", { name: "Manage Members" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Members" })).toBeInTheDocument();
    });
  });

  it("redirects /season to /season/standings", async () => {
    vi.mocked(apiClient.fetchCurrentUser).mockResolvedValue({
      id: 1,
      username: "admin",
      role: "admin",
      displayName: "Administrator",
    });
    vi.mocked(apiClient.listSeasons).mockResolvedValue([]);
    window.history.pushState({}, "", "/season");

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("No active season.")).toBeInTheDocument();
    });
    expect(window.location.pathname).toBe("/season/standings");
  });
});

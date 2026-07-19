import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";
import * as apiClient from "./api-client";

vi.mock("./api-client");

function Consumer() {
  const { user, loading } = useAuth();
  if (loading) return <div>Loading</div>;
  return <div>{user ? `Logged in as ${user.displayName}` : "Not logged in"}</div>;
}

describe("AuthProvider", () => {
  it("resolves the current user from the api client on mount", async () => {
    vi.mocked(apiClient.fetchCurrentUser).mockResolvedValue({
      id: 1,
      username: "admin",
      role: "admin",
      displayName: "Administrator",
    });
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );
    expect(screen.getByText("Loading")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Logged in as Administrator")).toBeInTheDocument();
    });
  });

  it("treats a null current user as logged out", async () => {
    vi.mocked(apiClient.fetchCurrentUser).mockResolvedValue(null);
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );
    await waitFor(() => {
      expect(screen.getByText("Not logged in")).toBeInTheDocument();
    });
  });

  it("updates the user after a successful login", async () => {
    vi.mocked(apiClient.fetchCurrentUser).mockResolvedValue(null);
    vi.mocked(apiClient.login).mockResolvedValue({
      id: 2,
      username: "player1",
      role: "player",
      displayName: "Player One",
    });

    function LoginConsumer() {
      const { user, login } = useAuth();
      return (
        <div>
          <button onClick={() => void login("player1", "secret")}>Log in</button>
          <span>{user ? user.displayName : "no user"}</span>
        </div>
      );
    }

    render(
      <AuthProvider>
        <LoginConsumer />
      </AuthProvider>
    );

    await waitFor(() => screen.getByText("no user"));
    screen.getByRole("button", { name: "Log in" }).click();
    await waitFor(() => {
      expect(screen.getByText("Player One")).toBeInTheDocument();
    });
  });
});

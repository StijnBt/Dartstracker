import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import Login from "./Login";
import { useAuth } from "../../lib/AuthContext";

vi.mock("../../lib/AuthContext", () => ({
  useAuth: vi.fn(),
}));

describe("Login", () => {
  it("submits the entered credentials", async () => {
    const loginMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: false, login: loginMock, logout: vi.fn() });

    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );

    await userEvent.type(screen.getByLabelText("Username"), "admin");
    await userEvent.type(screen.getByLabelText("Password"), "secret");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(loginMock).toHaveBeenCalledWith("admin", "secret");
  });

  it("shows an error message when login fails", async () => {
    const loginMock = vi.fn().mockRejectedValue(new Error("Invalid username or password"));
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: false, login: loginMock, logout: vi.fn() });

    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );

    await userEvent.type(screen.getByLabelText("Username"), "admin");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Invalid username or password");
    });
  });
});

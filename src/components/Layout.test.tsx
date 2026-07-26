import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import Layout from "./Layout";
import { useAuth } from "../lib/AuthContext";

vi.mock("../lib/AuthContext", () => ({
  useAuth: vi.fn(),
}));

describe("Layout", () => {
  it("renders the NavBar above the routed child content", () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: false, login: vi.fn(), logout: vi.fn() });
    render(
      <MemoryRouter initialEntries={["/child"]}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/child" element={<p>Child content</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByRole("img")).toBeInTheDocument();
    expect(screen.getByText("Child content")).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { login, logout, fetchCurrentUser } from "./api-client";

describe("api-client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("login", () => {
    it("posts credentials and returns the logged-in user", async () => {
      const user = { id: 1, username: "admin", role: "admin", displayName: "Administrator" };
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ user }), { status: 200 }));

      const result = await login("admin", "secret");

      expect(fetch).toHaveBeenCalledWith(
        "/api/auth/login",
        expect.objectContaining({
          method: "POST",
          credentials: "same-origin",
          body: JSON.stringify({ username: "admin", password: "secret" }),
        })
      );
      expect(result).toEqual(user);
    });

    it("throws the server's error message on failed login", async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify({ error: "Invalid credentials" }), { status: 401 })
      );

      await expect(login("admin", "wrong")).rejects.toThrow("Invalid credentials");
    });
  });

  describe("fetchCurrentUser", () => {
    it("returns null when there is no active session", async () => {
      vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }));
      const result = await fetchCurrentUser();
      expect(result).toBeNull();
    });

    it("returns the current user when a session is active", async () => {
      const user = { id: 1, username: "admin", role: "admin", displayName: "Administrator" };
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ user }), { status: 200 }));
      const result = await fetchCurrentUser();
      expect(result).toEqual(user);
    });
  });

  describe("logout", () => {
    it("posts to the logout endpoint", async () => {
      vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));
      await logout();
      expect(fetch).toHaveBeenCalledWith(
        "/api/auth/logout",
        expect.objectContaining({ method: "POST", credentials: "same-origin" })
      );
    });
  });
});

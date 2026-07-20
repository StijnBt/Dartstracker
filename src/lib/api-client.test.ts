import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  login,
  logout,
  fetchCurrentUser,
  listMembers,
  createMember,
  updateMember,
  listSeasons,
  getSeason,
  createSeason,
  archiveSeason,
  updateMatch,
  submitMatchResult,
} from "./api-client";

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

  describe("listMembers", () => {
    it("fetches and returns all members", async () => {
      const users = [
        { id: 1, username: "admin", displayName: "Administrator", role: "admin", isActive: true },
        { id: 2, username: "bsmith", displayName: "Bob Smith", role: "player", isActive: false },
      ];
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ users }), { status: 200 }));

      const result = await listMembers();

      expect(fetch).toHaveBeenCalledWith("/api/users", expect.objectContaining({ credentials: "same-origin" }));
      expect(result).toEqual(users);
    });
  });

  describe("createMember", () => {
    it("posts the new member and returns it", async () => {
      const user = { id: 2, username: "bsmith", displayName: "Bob Smith", role: "player", isActive: true };
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ user }), { status: 201 }));

      const result = await createMember({
        username: "bsmith",
        displayName: "Bob Smith",
        role: "player",
        password: "secretpw1",
      });

      expect(fetch).toHaveBeenCalledWith(
        "/api/users",
        expect.objectContaining({
          method: "POST",
          credentials: "same-origin",
          body: JSON.stringify({
            username: "bsmith",
            displayName: "Bob Smith",
            role: "player",
            password: "secretpw1",
          }),
        })
      );
      expect(result).toEqual(user);
    });

    it("throws the server's error message on failure", async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify({ error: "Username already exists" }), { status: 409 })
      );

      await expect(
        createMember({ username: "admin", displayName: "Dup", role: "player", password: "secretpw1" })
      ).rejects.toThrow("Username already exists");
    });
  });

  describe("updateMember", () => {
    it("patches the member and returns it", async () => {
      const user = { id: 2, username: "bsmith", displayName: "Robert Smith", role: "player", isActive: true };
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ user }), { status: 200 }));

      const result = await updateMember(2, { displayName: "Robert Smith" });

      expect(fetch).toHaveBeenCalledWith(
        "/api/users/2",
        expect.objectContaining({
          method: "PATCH",
          credentials: "same-origin",
          body: JSON.stringify({ displayName: "Robert Smith" }),
        })
      );
      expect(result).toEqual(user);
    });
  });

  describe("listSeasons", () => {
    it("fetches and returns all seasons", async () => {
      const seasons = [
        { id: 2, name: "Summer 2026", roundType: "double", status: "active", createdAt: "2026-06-01T00:00:00.000Z" },
      ];
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ seasons }), { status: 200 }));

      const result = await listSeasons();

      expect(fetch).toHaveBeenCalledWith("/api/seasons", expect.objectContaining({ credentials: "same-origin" }));
      expect(result).toEqual(seasons);
    });
  });

  describe("getSeason", () => {
    it("fetches and returns one season", async () => {
      const season = { id: 1, name: "Spring 2026", roundType: "single", status: "active", participants: [], matches: [] };
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ season }), { status: 200 }));

      const result = await getSeason(1);

      expect(fetch).toHaveBeenCalledWith("/api/seasons/1", expect.objectContaining({ credentials: "same-origin" }));
      expect(result).toEqual(season);
    });
  });

  describe("createSeason", () => {
    it("posts the new season and returns it", async () => {
      const season = { id: 1, name: "Spring 2026", roundType: "single", status: "active", participants: [], matches: [] };
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ season }), { status: 201 }));

      const input = { name: "Spring 2026", roundType: "single" as const, participantIds: [1, 2], roundDates: ["2026-08-01"] };
      const result = await createSeason(input);

      expect(fetch).toHaveBeenCalledWith(
        "/api/seasons",
        expect.objectContaining({ method: "POST", credentials: "same-origin", body: JSON.stringify(input) })
      );
      expect(result).toEqual(season);
    });

    it("throws the server's error message on failure", async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify({ error: "A season is already active" }), { status: 409 })
      );

      await expect(
        createSeason({ name: "X", roundType: "single", participantIds: [1, 2], roundDates: ["2026-08-01"] })
      ).rejects.toThrow("A season is already active");
    });
  });

  describe("archiveSeason", () => {
    it("patches the season status to archived", async () => {
      const season = { id: 1, name: "Spring 2026", roundType: "single", status: "archived", participants: [], matches: [] };
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ season }), { status: 200 }));

      const result = await archiveSeason(1);

      expect(fetch).toHaveBeenCalledWith(
        "/api/seasons/1",
        expect.objectContaining({
          method: "PATCH",
          credentials: "same-origin",
          body: JSON.stringify({ status: "archived" }),
        })
      );
      expect(result).toEqual(season);
    });
  });

  describe("updateMatch", () => {
    it("patches the match and returns it", async () => {
      const match = { id: 101, roundNumber: 1, date: "2026-08-15", status: "scheduled", player1Id: 1, player2Id: 2 };
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ match }), { status: 200 }));

      const result = await updateMatch(101, { date: "2026-08-15" });

      expect(fetch).toHaveBeenCalledWith(
        "/api/matches/101",
        expect.objectContaining({
          method: "PATCH",
          credentials: "same-origin",
          body: JSON.stringify({ date: "2026-08-15" }),
        })
      );
      expect(result).toEqual(match);
    });
  });

  describe("submitMatchResult", () => {
    it("posts the result and returns the updated match", async () => {
      const match = {
        id: 101,
        roundNumber: 1,
        date: "2026-08-01",
        status: "played",
        player1: { id: 1, displayName: "Administrator" },
        player2: { id: 2, displayName: "Bob Smith" },
        player1Legs: 3,
        player2Legs: 1,
        player1Checkout: 82,
        player2Checkout: null,
        resultEnteredBy: { id: 1, displayName: "Administrator" },
        resultEnteredAt: "2026-08-01T20:00:00.000Z",
      };
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ match }), { status: 200 }));

      const result = await submitMatchResult(101, { player1Legs: 3, player2Legs: 1, player1Checkout: 82 });

      expect(fetch).toHaveBeenCalledWith(
        "/api/matches/101/result",
        expect.objectContaining({
          method: "PATCH",
          credentials: "same-origin",
          body: JSON.stringify({ player1Legs: 3, player2Legs: 1, player1Checkout: 82 }),
        })
      );
      expect(result).toEqual(match);
    });

    it("throws the server's error message on failure", async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(
          JSON.stringify({ error: "One player must win exactly 3 legs; the other must have 0-2 legs" }),
          { status: 400 }
        )
      );

      await expect(submitMatchResult(101, { player1Legs: 3, player2Legs: 3 })).rejects.toThrow(
        "One player must win exactly 3 legs; the other must have 0-2 legs"
      );
    });
  });
});

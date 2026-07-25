import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import AnnouncementFeed from "./AnnouncementFeed";
import * as apiClient from "../../lib/api-client";
import { useAuth } from "../../lib/AuthContext";

vi.mock("../../lib/api-client");
vi.mock("../../lib/AuthContext", () => ({
  useAuth: vi.fn(),
}));

const announcement: apiClient.Announcement = {
  id: 1,
  title: "Season kickoff",
  body: "Welcome back everyone!",
  author: { id: 1, displayName: "Administrator" },
  createdAt: "2026-07-25T10:00:00.000Z",
  comments: [],
};

function mockAdmin() {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 1, username: "admin", role: "admin", displayName: "Administrator" },
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
  });
}

function mockPlayer() {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 2, username: "bsmith", role: "player", displayName: "Bob Smith" },
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
  });
}

describe("AnnouncementFeed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows an empty state when there are no announcements", async () => {
    mockPlayer();
    vi.mocked(apiClient.getAnnouncements).mockResolvedValue([]);
    render(<AnnouncementFeed />);
    await waitFor(() => expect(screen.getByText("No announcements yet")).toBeInTheDocument());
  });

  it("renders announcements returned by the API", async () => {
    mockPlayer();
    vi.mocked(apiClient.getAnnouncements).mockResolvedValue([announcement]);
    render(<AnnouncementFeed />);
    await waitFor(() => expect(screen.getByText("Season kickoff")).toBeInTheDocument());
  });

  it("shows a Post Announcement form for an admin", async () => {
    mockAdmin();
    vi.mocked(apiClient.getAnnouncements).mockResolvedValue([]);
    render(<AnnouncementFeed />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Post Announcement" })).toBeInTheDocument());
  });

  it("hides the Post Announcement form for a non-admin", async () => {
    mockPlayer();
    vi.mocked(apiClient.getAnnouncements).mockResolvedValue([]);
    render(<AnnouncementFeed />);
    await waitFor(() => expect(screen.getByText("No announcements yet")).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "Post Announcement" })).not.toBeInTheDocument();
  });

  it("posts a new announcement with the form and reloads", async () => {
    mockAdmin();
    vi.mocked(apiClient.getAnnouncements).mockResolvedValue([]);
    vi.mocked(apiClient.createAnnouncement).mockResolvedValue(announcement);
    render(<AnnouncementFeed />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Post Announcement" })).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText("New announcement title"), "Season kickoff");
    await userEvent.type(screen.getByLabelText("New announcement body"), "Welcome back everyone!");
    await userEvent.click(screen.getByRole("button", { name: "Post" }));

    await waitFor(() => {
      expect(apiClient.createAnnouncement).toHaveBeenCalledWith({
        title: "Season kickoff",
        body: "Welcome back everyone!",
      });
    });
    expect(apiClient.getAnnouncements).toHaveBeenCalledTimes(2);
  });

  it("keeps the reply thread open across a post-comment reload", async () => {
    mockPlayer();
    const withComment: apiClient.Announcement = {
      ...announcement,
      comments: [
        { id: 10, body: "Nice!", author: { id: 2, displayName: "Bob Smith" }, createdAt: "2026-07-25T11:00:00.000Z" },
      ],
    };
    vi.mocked(apiClient.getAnnouncements).mockResolvedValueOnce([announcement]).mockResolvedValueOnce([withComment]);
    vi.mocked(apiClient.addComment).mockResolvedValue(withComment.comments[0]);
    render(<AnnouncementFeed />);
    await waitFor(() => expect(screen.getByText("Season kickoff")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Reply" }));
    await userEvent.type(screen.getByLabelText("Comment on Season kickoff"), "Nice!");
    await userEvent.click(screen.getByRole("button", { name: "Post Comment" }));

    await waitFor(() => expect(screen.getByText("Nice!")).toBeInTheDocument());
    expect(screen.getByLabelText("Comment on Season kickoff")).toBeInTheDocument();
  });

  it("shows an error message when loading fails", async () => {
    mockPlayer();
    vi.mocked(apiClient.getAnnouncements).mockRejectedValue(new Error("Network error"));
    render(<AnnouncementFeed />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Network error"));
  });

  it("shows an error message when deleting an announcement fails", async () => {
    mockAdmin();
    vi.mocked(apiClient.getAnnouncements).mockResolvedValue([announcement]);
    vi.mocked(apiClient.deleteAnnouncement).mockRejectedValue(new Error("Delete failed"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AnnouncementFeed />);
    await waitFor(() => expect(screen.getByText("Season kickoff")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Delete failed"));
  });

  it("deletes an announcement after confirmation and reloads", async () => {
    mockAdmin();
    vi.mocked(apiClient.getAnnouncements).mockResolvedValue([announcement]);
    vi.mocked(apiClient.deleteAnnouncement).mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AnnouncementFeed />);
    await waitFor(() => expect(screen.getByText("Season kickoff")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(apiClient.deleteAnnouncement).toHaveBeenCalledWith(1));
    expect(apiClient.getAnnouncements).toHaveBeenCalledTimes(2);
  });

  it("does not delete when the confirmation is cancelled", async () => {
    mockAdmin();
    vi.mocked(apiClient.getAnnouncements).mockResolvedValue([announcement]);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<AnnouncementFeed />);
    await waitFor(() => expect(screen.getByText("Season kickoff")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(apiClient.deleteAnnouncement).not.toHaveBeenCalled();
  });
});

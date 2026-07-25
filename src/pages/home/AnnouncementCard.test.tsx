import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import AnnouncementCard from "./AnnouncementCard";
import type { Announcement } from "../../lib/api-client";

const announcement: Announcement = {
  id: 1,
  title: "Season kickoff",
  body: "Welcome back everyone!",
  author: { id: 1, displayName: "Administrator" },
  createdAt: "2026-07-25T10:00:00.000Z",
  comments: [
    {
      id: 10,
      body: "Looking forward to it!",
      author: { id: 2, displayName: "Bob Smith" },
      createdAt: "2026-07-25T11:00:00.000Z",
    },
  ],
};

function renderCard(overrides: Partial<Parameters<typeof AnnouncementCard>[0]> = {}) {
  const onUpdate = overrides.onUpdate ?? vi.fn().mockResolvedValue(true);
  const onDelete = overrides.onDelete ?? vi.fn().mockResolvedValue(undefined);
  const onAddComment = overrides.onAddComment ?? vi.fn().mockResolvedValue(true);
  const onDeleteComment = overrides.onDeleteComment ?? vi.fn().mockResolvedValue(undefined);
  render(
    <AnnouncementCard
      announcement={announcement}
      currentUserId={2}
      isAdmin={false}
      onUpdate={onUpdate}
      onDelete={onDelete}
      onAddComment={onAddComment}
      onDeleteComment={onDeleteComment}
      {...overrides}
    />
  );
  return { onUpdate, onDelete, onAddComment, onDeleteComment };
}

describe("AnnouncementCard", () => {
  it("renders the title, body, and author byline", () => {
    renderCard();
    expect(screen.getByText("Season kickoff")).toBeInTheDocument();
    expect(screen.getByText("Welcome back everyone!")).toBeInTheDocument();
    expect(screen.getByText(/Administrator/)).toBeInTheDocument();
  });

  it("shows Edit and Delete for an admin", () => {
    renderCard({ isAdmin: true });
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("hides Edit and Delete for a non-admin", () => {
    renderCard({ isAdmin: false });
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("toggles into an inline edit form and saves changes", async () => {
    const { onUpdate } = renderCard({ isAdmin: true });

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const titleInput = screen.getByLabelText("Edit title");
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, "Season kickoff (updated)");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(1, {
        title: "Season kickoff (updated)",
        body: "Welcome back everyone!",
      });
    });
  });

  it("keeps the edit form open when onUpdate fails", async () => {
    const { onUpdate } = renderCard({ isAdmin: true, onUpdate: vi.fn().mockResolvedValue(false) });

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("discards changes when Cancel is clicked", async () => {
    const { onUpdate } = renderCard({ isAdmin: true });

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByText("Season kickoff")).toBeInTheDocument();
  });

  it("calls onDelete when Delete is clicked", async () => {
    const { onDelete } = renderCard({ isAdmin: true });

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(1));
  });

  it("hides comments until Reply is clicked, then shows them", async () => {
    renderCard();
    expect(screen.queryByText("Looking forward to it!")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Reply" }));

    expect(screen.getByText("Looking forward to it!")).toBeInTheDocument();
    expect(screen.getByText(/Bob Smith/)).toBeInTheDocument();
  });

  it("shows a comment Delete button for the comment's own author", async () => {
    renderCard({ currentUserId: 2, isAdmin: false });
    await userEvent.click(screen.getByRole("button", { name: "Reply" }));

    const comment = screen.getByText("Looking forward to it!").closest("div")!;
    expect(within(comment).getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("shows a comment Delete button for admin even when not the author", async () => {
    renderCard({ currentUserId: 99, isAdmin: true });
    await userEvent.click(screen.getByRole("button", { name: "Reply" }));

    const comment = screen.getByText("Looking forward to it!").closest("div")!;
    expect(within(comment).getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("hides the comment Delete button for a different non-admin member", async () => {
    renderCard({ currentUserId: 99, isAdmin: false });
    await userEvent.click(screen.getByRole("button", { name: "Reply" }));

    const comment = screen.getByText("Looking forward to it!").closest("div")!;
    expect(within(comment).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("calls onDeleteComment when the comment's Delete button is clicked", async () => {
    const { onDeleteComment } = renderCard({ currentUserId: 2, isAdmin: false });
    await userEvent.click(screen.getByRole("button", { name: "Reply" }));

    const comment = screen.getByText("Looking forward to it!").closest("div")!;
    await userEvent.click(within(comment).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(onDeleteComment).toHaveBeenCalledWith(10));
  });

  it("posts a new comment and clears the textarea", async () => {
    const { onAddComment } = renderCard();
    await userEvent.click(screen.getByRole("button", { name: "Reply" }));

    const textarea = screen.getByLabelText("Comment on Season kickoff");
    await userEvent.type(textarea, "Great news!");
    await userEvent.click(screen.getByRole("button", { name: "Post Comment" }));

    await waitFor(() => expect(onAddComment).toHaveBeenCalledWith(1, "Great news!"));
    await waitFor(() => expect(textarea).toHaveValue(""));
  });

  it("keeps the typed comment when onAddComment fails", async () => {
    const { onAddComment } = renderCard({ onAddComment: vi.fn().mockResolvedValue(false) });
    await userEvent.click(screen.getByRole("button", { name: "Reply" }));

    const textarea = screen.getByLabelText("Comment on Season kickoff");
    await userEvent.type(textarea, "Great news!");
    await userEvent.click(screen.getByRole("button", { name: "Post Comment" }));

    await waitFor(() => expect(onAddComment).toHaveBeenCalled());
    expect(textarea).toHaveValue("Great news!");
  });

  it("disables Post Comment when the textarea is empty", async () => {
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: "Reply" }));

    expect(screen.getByRole("button", { name: "Post Comment" })).toBeDisabled();
  });
});

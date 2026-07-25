import { useEffect, useState } from "react";
import { useAuth } from "../../lib/AuthContext";
import {
  getAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  addComment,
  deleteComment,
  type Announcement,
  type UpdateAnnouncementInput,
} from "../../lib/api-client";
import AnnouncementCard from "./AnnouncementCard";

export default function AnnouncementFeed() {
  const { user } = useAuth();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setAnnouncements(await getAnnouncements());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load announcements");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function withErrorHandling(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    }
  }

  async function handlePost() {
    if (!newTitle.trim() || !newBody.trim()) return;
    await withErrorHandling(async () => {
      await createAnnouncement({ title: newTitle, body: newBody });
      setNewTitle("");
      setNewBody("");
    });
  }

  async function handleUpdate(id: number, input: UpdateAnnouncementInput) {
    await withErrorHandling(() => updateAnnouncement(id, input));
  }

  async function handleDelete(id: number) {
    if (!window.confirm("Delete this announcement? This cannot be undone.")) return;
    await withErrorHandling(() => deleteAnnouncement(id));
  }

  async function handleAddComment(announcementId: number, body: string) {
    await withErrorHandling(() => addComment(announcementId, { body }));
  }

  async function handleDeleteComment(commentId: number) {
    if (!window.confirm("Delete this comment? This cannot be undone.")) return;
    await withErrorHandling(() => deleteComment(commentId));
  }

  if (!user) {
    return null;
  }

  if (loading) {
    return <p className="p-4">Loading…</p>;
  }

  return (
    <div className="p-4">
      {error && (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {error}
        </p>
      )}
      {user.role === "admin" && (
        <div className="mb-4 rounded border border-gray-300 p-3">
          <h2 className="font-heading mb-2 font-semibold">Post Announcement</h2>
          <div className="flex flex-col gap-2">
            <input
              aria-label="New announcement title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="rounded border border-gray-300 p-1"
            />
            <textarea
              aria-label="New announcement body"
              value={newBody}
              onChange={(e) => setNewBody(e.target.value)}
              className="rounded border border-gray-300 p-1"
            />
            <button onClick={() => void handlePost()} className="text-primary self-start underline">
              Post
            </button>
          </div>
        </div>
      )}
      {announcements.length === 0 ? (
        <p>No announcements yet</p>
      ) : (
        announcements.map((announcement) => (
          <AnnouncementCard
            key={announcement.id}
            announcement={announcement}
            currentUserId={user.id}
            isAdmin={user.role === "admin"}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
            onAddComment={handleAddComment}
            onDeleteComment={handleDeleteComment}
          />
        ))
      )}
    </div>
  );
}

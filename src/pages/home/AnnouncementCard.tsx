import { useState } from "react";
import type { Announcement, UpdateAnnouncementInput } from "../../lib/api-client";

type AnnouncementCardProps = {
  announcement: Announcement;
  currentUserId: number;
  isAdmin: boolean;
  onUpdate: (id: number, input: UpdateAnnouncementInput) => Promise<boolean>;
  onDelete: (id: number) => Promise<void>;
  onAddComment: (announcementId: number, body: string) => Promise<boolean>;
  onDeleteComment: (commentId: number) => Promise<void>;
};

const MAX_COMMENT_LENGTH = 500;

export default function AnnouncementCard({
  announcement,
  currentUserId,
  isAdmin,
  onUpdate,
  onDelete,
  onAddComment,
  onDeleteComment,
}: AnnouncementCardProps) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(announcement.title);
  const [editBody, setEditBody] = useState(announcement.body);
  const [replyOpen, setReplyOpen] = useState(false);
  const [commentText, setCommentText] = useState("");

  function startEditing() {
    setEditTitle(announcement.title);
    setEditBody(announcement.body);
    setEditing(true);
  }

  async function handleSave() {
    if (!editTitle.trim() || !editBody.trim()) return;
    const success = await onUpdate(announcement.id, { title: editTitle, body: editBody });
    if (success) {
      setEditing(false);
    }
  }

  async function handlePostComment() {
    if (!commentText.trim()) return;
    const success = await onAddComment(announcement.id, commentText);
    if (success) {
      setCommentText("");
    }
  }

  return (
    <article className="mb-4 rounded border border-gray-300 p-3">
      {editing ? (
        <div className="flex flex-col gap-2">
          <input
            aria-label="Edit title"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            className="rounded border border-gray-300 p-1"
          />
          <textarea
            aria-label="Edit body"
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            className="rounded border border-gray-300 p-1"
          />
          <div className="flex gap-2">
            <button onClick={() => void handleSave()} className="text-primary underline">
              Save
            </button>
            <button onClick={() => setEditing(false)} className="text-primary underline">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <h2 className="font-heading text-lg font-semibold">{announcement.title}</h2>
          <p className="whitespace-pre-wrap">{announcement.body}</p>
          <p className="text-sm text-gray-500">
            {announcement.author.displayName} · {new Date(announcement.createdAt).toLocaleString()}
          </p>
          {isAdmin && (
            <div className="mt-2 flex gap-2">
              <button onClick={startEditing} className="text-primary underline">
                Edit
              </button>
              <button onClick={() => void onDelete(announcement.id)} className="text-primary underline">
                Delete
              </button>
            </div>
          )}
        </>
      )}

      <button onClick={() => setReplyOpen((v) => !v)} className="text-primary mt-2 underline">
        Reply
      </button>

      {replyOpen && (
        <div className="mt-2 flex flex-col gap-2">
          {announcement.comments.map((comment) => (
            <div key={comment.id} className="border-t border-gray-200 pt-2 text-sm">
              <p>{comment.body}</p>
              <p className="text-gray-500">
                {comment.author.displayName} · {new Date(comment.createdAt).toLocaleString()}
                {(isAdmin || comment.author.id === currentUserId) && (
                  <button onClick={() => void onDeleteComment(comment.id)} className="text-primary ml-2 underline">
                    Delete
                  </button>
                )}
              </p>
            </div>
          ))}
          <textarea
            aria-label={`Comment on ${announcement.title}`}
            value={commentText}
            maxLength={MAX_COMMENT_LENGTH}
            onChange={(e) => setCommentText(e.target.value)}
            className="rounded border border-gray-300 p-1"
          />
          <p className="text-xs text-gray-500">{MAX_COMMENT_LENGTH - commentText.length} characters remaining</p>
          <button
            onClick={() => void handlePostComment()}
            disabled={!commentText.trim()}
            className="text-primary self-start underline disabled:text-gray-400 disabled:no-underline"
          >
            Post Comment
          </button>
        </div>
      )}
    </article>
  );
}

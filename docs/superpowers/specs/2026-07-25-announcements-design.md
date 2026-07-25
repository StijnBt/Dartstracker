# Announcements — Design

## Overview

GitHub issue #3: admin can post messages, visible to every member, shown newest-first in a list; members can respond with a short comment (max 500 characters). This is a brand-new feature — there's no mention of announcements/messaging anywhere in notes.md, so nothing about it is implied by the existing spec.

This phase adds:
1. **Announcements**: admin-only create/edit/delete of a `title` + `body` message, visible to every logged-in user.
2. **Comments**: any logged-in member can add a short text reply (≤500 chars) under an announcement; a member can delete their own comment, admin can delete any comment. No comment editing.

The Home page (`/`, `src/pages/Home.tsx`) becomes the announcements feed: the existing header (logo, "Season"/"Manage Members" nav links, user name, logout) is untouched, and the feed renders below it, gated behind the same `{user && ...}` check the header's nav already uses. No new route is introduced.

Out of scope for this phase: pagination/infinite scroll (the whole list loads at once, same as Standings/Season Stats — this league's scale doesn't need it yet), comment editing, read/unread tracking, and any notification mechanism.

## Section 1: Data Model

No changes to any existing model. Two new Prisma models, following this schema's existing relational style (`Match`/`Leg`/`Throw`, `Season`/`SeasonParticipant`):

```prisma
model Announcement {
  id        Int      @id @default(autoincrement())
  authorId  Int
  title     String
  body      String   @db.NVarChar(Max)
  createdAt DateTime @default(now())

  author   User      @relation("AnnouncementAuthor", fields: [authorId], references: [id], onDelete: NoAction, onUpdate: NoAction)
  comments Comment[]
}

model Comment {
  id             Int      @id @default(autoincrement())
  announcementId Int
  authorId       Int
  body           String
  createdAt      DateTime @default(now())

  announcement Announcement @relation(fields: [announcementId], references: [id])
  author       User         @relation("CommentAuthor", fields: [authorId], references: [id], onDelete: NoAction, onUpdate: NoAction)
}
```

Two new back-relations on `User`: `announcementsPosted Announcement[] @relation("AnnouncementAuthor")`, `commentsPosted Comment[] @relation("CommentAuthor")`.

Deliberate deviation from convention: every existing `String` field in this schema relies on Prisma's SQL Server default (`nvarchar(1000)`) — nothing has ever needed more. Since announcement bodies are unlimited length (only comments have the 500-char cap), `Announcement.body` gets an explicit `@db.NVarChar(Max)` so a long league update can't be silently truncated or rejected by the column. `Comment.body` stays on the plain default, comfortably above its 500-char application-level cap.

## Section 2: Backend

All new endpoints live under `api/src/functions/announcements/` and `api/src/functions/comments/`, following the existing `requireAuth`/error-shape conventions from `matches`/`seasons`/`users`.

**`GET /api/announcements`**
- `requireAuth(request)` — any authenticated user.
- Returns every `Announcement`, newest first (`orderBy: { createdAt: "desc" }`), each with `author` (id, displayName) and its `comments` (each with `author` id/displayName, `body`, `createdAt`), comments ordered oldest-first within an announcement (natural reply order).

**`POST /api/announcements`**
- `requireAuth(request, "admin")`.
- Body: `{ title: string; body: string }`. Validates both non-empty (400 otherwise).
- Creates the `Announcement` with `authorId` from the JWT claims. Returns `201` with the created announcement (empty `comments: []`).

**`PATCH /api/announcements/{id}`**
- `requireAuth(request, "admin")`.
- Body: `{ title?: string; body?: string }`, at least one field. Validates the announcement exists (404 otherwise) and that any provided field is non-empty.
- Returns `200` with the updated announcement (including its existing comments, same shape as `GET`).

**`DELETE /api/announcements/{id}`**
- `requireAuth(request, "admin")`.
- Validates the announcement exists (404 otherwise).
- Deletes in a `prisma.$transaction`, dependency order: all `Comment` rows for this announcement, then the `Announcement` row itself (no cascading delete configured in the schema, same reasoning as the existing match-delete transaction).
- Returns `200` with `{ success: true }`.

**`POST /api/announcements/{id}/comments`**
- `requireAuth(request)` — any authenticated user.
- Body: `{ body: string }`. Validates the announcement exists (404 otherwise), `body` is non-empty and ≤500 characters (400 otherwise, message states the limit).
- Creates the `Comment` with `authorId` from JWT claims. Returns `201` with the created comment (including `author` id/displayName).

**`DELETE /api/comments/{id}`**
- `requireAuth(request)` — any authenticated user, then an admin-or-owner check: the caller must either have `role === "admin"` or be the comment's `authorId` (same shape as the existing admin-or-participant check on match results, checking `authorId` instead of `player1Id`/`player2Id`); otherwise `403`.
- Validates the comment exists (404 otherwise).
- Returns `200` with `{ success: true }`.

## Section 3: Frontend

`src/lib/api-client.ts` gets six additions, following the existing `getSeason`/`addMatch`/`deleteMatch` conventions:
- `getAnnouncements(): Promise<Announcement[]>` — `GET /api/announcements`.
- `createAnnouncement(input: { title: string; body: string }): Promise<Announcement>` — `POST /api/announcements`.
- `updateAnnouncement(id: number, input: { title?: string; body?: string }): Promise<Announcement>` — `PATCH /api/announcements/${id}`.
- `deleteAnnouncement(id: number): Promise<void>` — `DELETE /api/announcements/${id}`.
- `addComment(announcementId: number, input: { body: string }): Promise<Comment>` — `POST /api/announcements/${announcementId}/comments`.
- `deleteComment(id: number): Promise<void>` — `DELETE /api/comments/${id}`.

**`Home.tsx`**: existing header markup is untouched. Below it, when `user` is present, renders a new `AnnouncementFeed` component that fetches `getAnnouncements()` on mount.

**New component `src/pages/AnnouncementFeed.tsx`** (or `src/pages/home/` sub-folder, matching the `src/pages/season/` convention):
- **Post form** (admin only): `title` input + `body` textarea + submit button, rendered above the list. On submit, calls `createAnnouncement`, then reloads the list (same reload-after-mutation pattern as `Season.tsx`).
- **List**, newest first (server already returns this order). Each card shows `title`, `body`, `author.displayName`, formatted `createdAt`.
  - Admin-only **Edit**/**Delete** per card. Edit toggles the card into an inline editable form (title/body fields, Save/Cancel) — same in-place-edit pattern `Season.tsx` uses for reschedule, not a separate route. Save calls `updateAnnouncement`; Delete goes behind `window.confirm()`, then `deleteAnnouncement`, then reload.
  - **"Reply" button** per card, collapsed by default. Expanding shows the announcement's comments (author display name, timestamp, body) plus a textarea with a live remaining-character count against 500, and a submit button that calls `addComment` then reloads.
  - Each comment shows a **Delete** control when the current user is its author or an admin (mirrors the backend admin-or-owner check); confirms via `window.confirm()`, then calls `deleteComment`, then reloads.
- **Empty state**: "No announcements yet" when the list is empty.
- New handlers use `try/catch` with an inline error message state on failure (a deliberate improvement over the known pre-existing gap on `Season.tsx`, where every mutation handler is fire-and-forget with no error surfacing — not fixed here since it's out of scope, but not repeated in this new code either).

## Section 4: Error Handling & Testing

**Error handling:** every new endpoint reuses the existing response shape (`401` via `AuthError`, `403` for wrong role/non-owner, `404` for a missing announcement/comment, `400` for validation failures including the 500-char comment limit, `500` with a logged error otherwise). On the frontend, the new `AnnouncementFeed` component surfaces any failed mutation via an inline error message (see Section 3) rather than silently failing.

**Testing:**
- `api/test/functions/announcements/{list,create,update,delete}.test.ts` and `api/test/functions/announcements/addComment.test.ts`: 401 unauthenticated, 403 non-admin (for admin-only ones), 400 for empty/invalid input and the 500-char comment cap, 404 for unknown announcement, success-path response shapes including `createdAt`-descending order on list and comment array ordering.
- `api/test/functions/comments/delete.test.ts`: 401 unauthenticated, 403 for a non-admin non-owner, 200 success for both the comment's own author and an admin deleting someone else's comment, 404 unknown comment.
- `src/pages/AnnouncementFeed.test.tsx`: post form admin-only visibility and submit payload; inline edit/delete admin-only visibility and calls; reply expand/collapse, character count, submit payload, and the 500-char client-side guard; comment delete visibility (own comment or admin) and call; empty state; error message shown on a failed mutation. Uses one shared `beforeEach` default mock + `vi.clearAllMocks()` per test file, per the established fix for cross-test mock bleed from the Additional Playing Days phase.
- `src/pages/Home.test.tsx`: existing header tests untouched; new test that the feed renders below the header for a logged-in user and not at all when logged out.

export type CurrentUser = {
  id: number;
  username: string;
  role: "admin" | "player";
  displayName: string;
};

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) {
    const message = typeof data?.error === "string" ? data.error : "Request failed";
    throw new Error(message);
  }
  return data as T;
}

export async function login(username: string, password: string): Promise<CurrentUser> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ username, password }),
  });
  const data = await parseJsonResponse<{ user: CurrentUser }>(response);
  return data.user;
}

export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  const response = await fetch("/api/auth/me", { credentials: "same-origin" });
  if (response.status === 401) {
    return null;
  }
  const data = await parseJsonResponse<{ user: CurrentUser }>(response);
  return data.user;
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
}

export type Member = {
  id: number;
  username: string;
  displayName: string;
  role: "admin" | "player";
  isActive: boolean;
};

export type CreateMemberInput = {
  username: string;
  displayName: string;
  role: "admin" | "player";
  password: string;
};

export type UpdateMemberInput = {
  displayName?: string;
  role?: "admin" | "player";
  isActive?: boolean;
  password?: string;
};

export async function listMembers(): Promise<Member[]> {
  const response = await fetch("/api/users", { credentials: "same-origin" });
  const data = await parseJsonResponse<{ users: Member[] }>(response);
  return data.users;
}

export async function createMember(input: CreateMemberInput): Promise<Member> {
  const response = await fetch("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(input),
  });
  const data = await parseJsonResponse<{ user: Member }>(response);
  return data.user;
}

export async function updateMember(id: number, input: UpdateMemberInput): Promise<Member> {
  const response = await fetch(`/api/users/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(input),
  });
  const data = await parseJsonResponse<{ user: Member }>(response);
  return data.user;
}

export type SeasonParticipantSummary = {
  id: number;
  displayName: string;
};

export type SeasonMatch = {
  id: number;
  roundNumber: number;
  date: string;
  status: "scheduled" | "cancelled" | "played";
  player1: SeasonParticipantSummary;
  player2: SeasonParticipantSummary;
  player1Legs: number | null;
  player2Legs: number | null;
  player1Checkout: number | null;
  player2Checkout: number | null;
  resultEnteredBy: SeasonParticipantSummary | null;
  resultEnteredAt: string | null;
};

export type Season = {
  id: number;
  name: string;
  roundType: "single" | "double";
  status: "active" | "archived";
  participants: SeasonParticipantSummary[];
  matches: SeasonMatch[];
};

export type SeasonSummary = {
  id: number;
  name: string;
  roundType: "single" | "double";
  status: "active" | "archived";
  createdAt: string;
};

export type CreateSeasonInput = {
  name: string;
  roundType: "single" | "double";
  participantIds: number[];
  roundDates: string[];
};

export type UpdateMatchInput = {
  date?: string;
  status?: "scheduled" | "cancelled";
};

export type MatchUpdateResult = {
  id: number;
  roundNumber: number;
  date: string;
  status: "scheduled" | "cancelled" | "played";
  player1Id: number;
  player2Id: number;
};

export type SubmitMatchResultResponse = MatchUpdateResult & {
  player1Legs: number | null;
  player2Legs: number | null;
  player1Checkout: number | null;
  player2Checkout: number | null;
  resultEnteredBy: SeasonParticipantSummary | null;
  resultEnteredAt: string | null;
};

export async function listSeasons(): Promise<SeasonSummary[]> {
  const response = await fetch("/api/seasons", { credentials: "same-origin" });
  const data = await parseJsonResponse<{ seasons: SeasonSummary[] }>(response);
  return data.seasons;
}

export async function getSeason(id: number): Promise<Season> {
  const response = await fetch(`/api/seasons/${id}`, { credentials: "same-origin" });
  const data = await parseJsonResponse<{ season: Season }>(response);
  return data.season;
}

export async function createSeason(input: CreateSeasonInput): Promise<Season> {
  const response = await fetch("/api/seasons", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(input),
  });
  const data = await parseJsonResponse<{ season: Season }>(response);
  return data.season;
}

export async function archiveSeason(id: number): Promise<Season> {
  const response = await fetch(`/api/seasons/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ status: "archived" }),
  });
  const data = await parseJsonResponse<{ season: Season }>(response);
  return data.season;
}

export async function updateMatch(id: number, input: UpdateMatchInput): Promise<MatchUpdateResult> {
  const response = await fetch(`/api/matches/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(input),
  });
  const data = await parseJsonResponse<{ match: MatchUpdateResult }>(response);
  return data.match;
}

export type SubmitMatchResultInput = {
  player1Legs: number;
  player2Legs: number;
  player1Checkout?: number;
  player2Checkout?: number;
};

export async function submitMatchResult(
  id: number,
  input: SubmitMatchResultInput
): Promise<SubmitMatchResultResponse> {
  const response = await fetch(`/api/matches/${id}/result`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(input),
  });
  const data = await parseJsonResponse<{ match: SubmitMatchResultResponse }>(response);
  return data.match;
}

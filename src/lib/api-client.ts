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

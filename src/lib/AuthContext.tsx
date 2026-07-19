import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchCurrentUser, login as apiLogin, logout as apiLogout, type CurrentUser } from "./api-client";

type AuthContextValue = {
  user: CurrentUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCurrentUser()
      .then(setUser)
      .finally(() => setLoading(false));
  }, []);

  async function login(username: string, password: string) {
    const loggedInUser = await apiLogin(username, password);
    setUser(loggedInUser);
  }

  async function logout() {
    await apiLogout();
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

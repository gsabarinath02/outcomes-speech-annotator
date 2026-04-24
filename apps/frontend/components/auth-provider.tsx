"use client";

import type { User } from "@outcomes/shared-types";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { login as loginRequest } from "@/lib/api";
import { SESSION_CHANGED_EVENT, clearSession, readSession, writeSession } from "@/lib/session";

interface AuthContextValue {
  user: User | null;
  accessToken: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  useEffect(() => {
    function syncSession() {
      const session = readSession();
      setUser(session.user);
      setAccessToken(session.accessToken);
    }
    syncSession();
    setIsLoading(false);
    window.addEventListener(SESSION_CHANGED_EVENT, syncSession);
    window.addEventListener("storage", syncSession);
    return () => {
      window.removeEventListener(SESSION_CHANGED_EVENT, syncSession);
      window.removeEventListener("storage", syncSession);
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      accessToken,
      isLoading,
      login: async (email: string, password: string) => {
        const data = await loginRequest(email, password);
        writeSession(data.access_token, data.refresh_token, data.user);
        setUser(data.user);
        setAccessToken(data.access_token);
      },
      logout: () => {
        clearSession();
        setUser(null);
        setAccessToken(null);
      }
    }),
    [user, accessToken, isLoading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}

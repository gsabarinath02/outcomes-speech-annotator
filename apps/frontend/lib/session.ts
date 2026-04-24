import type { User } from "@outcomes/shared-types";

const ACCESS_TOKEN_KEY = "outcomes_ai_access_token";
const REFRESH_TOKEN_KEY = "outcomes_ai_refresh_token";
const USER_KEY = "outcomes_ai_user";
export const SESSION_CHANGED_EVENT = "outcomes_ai_session_changed";

export interface SessionState {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
}

export function readSession(): SessionState {
  if (typeof window === "undefined") {
    return { accessToken: null, refreshToken: null, user: null };
  }
  const accessToken = localStorage.getItem(ACCESS_TOKEN_KEY);
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
  const userRaw = localStorage.getItem(USER_KEY);
  let user: User | null = null;
  if (userRaw) {
    try {
      user = JSON.parse(userRaw) as User;
    } catch {
      user = null;
    }
  }
  return { accessToken, refreshToken, user };
}

export function writeSession(accessToken: string, refreshToken: string, user: User): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  notifySessionChanged();
}

export function clearSession(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  notifySessionChanged();
}

export function notifySessionChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
}

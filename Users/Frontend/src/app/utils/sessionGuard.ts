/**
 * Ends a sign-in when it should not last any longer, so a session left open overnight is gone in the morning.
 *
 * Three rules, checked on load, on every return to the tab, and every 15 seconds:
 *   1. the token's own expiry (`exp`) has passed;
 *   2. the token is older than the longest session the server allows (12 hours, 8 for staff), as the server also refuses it;
 *   3. nobody touched the page for too long (60 minutes, 20 for staff). Closing the tab, or a laptop going to sleep, counts as idle.
 * "Staff" means admin, super admin and guard. The last-activity time is shared by the user and admin apps on the same site.
 *
 * The browser cannot be trusted to enforce this (someone can copy a token), so the server enforces the maximum age too
 * (`JWTService.verify_token`). This module is what makes the ordinary case feel right and clears the stored sign-in.
 * Keep this file in step with Admin/Frontend/src/utils/sessionGuard.ts.
 */
export type SessionEndReason = "idle" | "expired";

export const SESSION_NOTICE_KEY = "ebalik_session_notice";
export const ACTIVITY_KEY = "ebalik_last_activity";
export const USER_IDLE_MS = 60 * 60_000;
export const STAFF_IDLE_MS = 20 * 60_000;
export const USER_MAX_AGE_MS = 12 * 3_600_000;
export const STAFF_MAX_AGE_MS = 8 * 3_600_000;
const STAFF_LEVELS = ["admin", "super_admin", "guard"];
const CHECK_EVERY_MS = 15_000;
const WRITE_EVERY_MS = 10_000;

interface Claims { exp?: number; iat?: number; access_level?: string }

export function readClaims(token: string): Claims | null {
  try {
    const body = token.split(".")[1];
    if (!body) return null;
    const json = atob(body.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(body.length / 4) * 4, "="));
    return JSON.parse(json) as Claims;
  } catch {
    return null;
  }
}

const safeGet = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const safeSet = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* storage blocked: the server still enforces the limits */ } };

export function markActive(now = Date.now()) {
  safeSet(ACTIVITY_KEY, String(now));
}

/** Why this sign-in should end now, or null when it is fine. Pure apart from reading storage and (for a brand-new sign-in) stamping activity. */
export function sessionEndReason(tokenKey: string, now = Date.now()): SessionEndReason | null {
  const token = safeGet(tokenKey);
  if (!token) return null;
  const claims = readClaims(token);
  if (!claims) return null;   // not a token we understand: leave it to the server
  const staff = STAFF_LEVELS.includes(String(claims.access_level || "").toLowerCase());
  if (claims.exp && claims.exp * 1000 <= now) return "expired";
  if (claims.iat && now - claims.iat * 1000 > (staff ? STAFF_MAX_AGE_MS : USER_MAX_AGE_MS)) return "expired";
  const limit = staff ? STAFF_IDLE_MS : USER_IDLE_MS;
  // Idle time counts from the later of the last interaction and the moment this token was issued, so a fresh sign-in is never
  // judged by the stamp left over from yesterday, and a sign-in from before stamps existed is judged by its age.
  const last = Math.max(Number(safeGet(ACTIVITY_KEY)) || 0, (claims.iat || 0) * 1000);
  if (!last) { markActive(now); return null; }
  return now - last > limit ? "idle" : null;
}

export const SESSION_MESSAGES: Record<SessionEndReason, string> = {
  idle: "You were signed out because you were inactive for a while. Sign in again to continue.",
  expired: "Your session ended for your security. Sign in again to continue.",
};

export interface GuardOptions { tokenKey: string; onEnd: (reason: SessionEndReason) => void }

/** Start watching. Returns a function that stops. `onEnd` runs at most once. */
export function startSessionGuard({ tokenKey, onEnd }: GuardOptions): () => void {
  let ended = false;
  let lastWrite = 0;
  const end = (reason: SessionEndReason) => {
    if (ended) return;
    ended = true;
    onEnd(reason);
  };
  const evaluate = () => {
    const reason = sessionEndReason(tokenKey);
    if (reason) end(reason);
    return reason;
  };
  const onInteraction = () => {
    const now = Date.now();
    if (now - lastWrite < WRITE_EVERY_MS) return;
    // An interaction after a long idle gap must not quietly revive the session: check first, then stamp.
    if (evaluate()) return;
    lastWrite = now;
    markActive(now);
  };
  const onVisible = () => { if (!document.hidden) evaluate(); };
  const onStorage = (event: StorageEvent) => {
    if (event.key === tokenKey && !event.newValue && !ended) { ended = true; window.location.reload(); }   // signed out in another tab
  };

  if (evaluate()) return () => undefined;
  const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "touchstart", "wheel"];
  events.forEach((name) => window.addEventListener(name, onInteraction, { passive: true }));
  window.addEventListener("scroll", onInteraction, { passive: true, capture: true });
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
  window.addEventListener("storage", onStorage);
  const timer = window.setInterval(evaluate, CHECK_EVERY_MS);
  return () => {
    window.clearInterval(timer);
    events.forEach((name) => window.removeEventListener(name, onInteraction));
    window.removeEventListener("scroll", onInteraction, true);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onVisible);
    window.removeEventListener("storage", onStorage);
  };
}

const EXPIRED_MESSAGE = /token has expired|invalid token|session was revoked/i;

/**
 * When any request to the API answers 401 "Token has expired", the sign-in is over: end it at once instead of showing
 * a page full of errors. Wraps fetch once; the returned function puts the original back.
 */
export function watchForExpiredSessions({ apiUrl, tokenKey, onEnd }: GuardOptions & { apiUrl: string }): () => void {
  const original = window.fetch;
  let fired = false;
  const wrapped: typeof window.fetch = async (input, init) => {
    const response = await original.call(window, input, init);
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (response.status === 401 && !fired && url.startsWith(apiUrl) && safeGet(tokenKey)) {
        void response.clone().json().then((body: { error?: unknown }) => {
          if (!fired && EXPIRED_MESSAGE.test(String(body?.error ?? ""))) { fired = true; onEnd("expired"); }
        }).catch(() => undefined);
      }
    } catch { /* never let the watcher break a request */ }
    return response;
  };
  window.fetch = wrapped;
  return () => { if (window.fetch === wrapped) window.fetch = original; };
}

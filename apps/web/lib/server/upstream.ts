/**
 * Server-side access to the Lift API.
 *
 * The browser never talks to the API directly. Sign-in goes through
 * `app/api/auth`, which keeps the session token in an httpOnly cookie on this
 * origin, and sync goes through `app/api/sync`, which attaches it. Two things
 * follow: the token is out of reach of page scripts, and the API does not have
 * to list this app's origin in `TRUSTED_ORIGINS`, because every request it sees
 * comes from this server.
 */

import "server-only";

import { cookies } from "next/headers";

export const SESSION_COOKIE = "lift_session";

/** Sixty days, matching the API's own session lifetime. */
const SESSION_MAX_AGE = 60 * 60 * 24 * 60;

export function apiUrl(): string {
  const value = process.env.LIFT_API_URL;
  if (!value) {
    throw new Error("LIFT_API_URL is not set. Point it at the Lift API, e.g. https://lift-api.example.com");
  }
  return value.replace(/\/+$/, "");
}

/**
 * better-auth refuses a state-changing request without an Origin it trusts.
 * The API's own origin is always trusted, and this server is acting on the
 * API's behalf, so that is the one it sends.
 */
function upstreamOrigin(): string {
  return new URL(apiUrl()).origin;
}

export async function readToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

export async function storeToken(token: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function clearToken(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function upstream(
  path: string,
  init: { method?: string; body?: unknown; token?: string | null; forwardedFor?: string | null } = {},
): Promise<Response> {
  const headers: Record<string, string> = { origin: upstreamOrigin() };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.forwardedFor) headers["x-forwarded-for"] = init.forwardedFor;

  return fetch(`${apiUrl()}${path}`, {
    method: init.method ?? "POST",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
}

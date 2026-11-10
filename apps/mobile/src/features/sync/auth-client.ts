/**
 * better-auth client for React Native.
 *
 * The Expo plugin keeps the session token in platform storage and handles the
 * deep-link round-trip that OAuth requires. Which storage that is depends on
 * where the app is running. See `token-storage`, which is also the reason this
 * module no longer touches `expo-secure-store` directly.
 */

import { expoClient } from '@better-auth/expo/client';
import Constants from 'expo-constants';
import { createAuthClient } from 'better-auth/react';
import { Platform } from 'react-native';

import { readToken, tokenStorage } from './token-storage';

/**
 * API base URL.
 *
 * Falls back to the LAN address Metro is served from, so a physical device can
 * reach a dev machine without anyone hardcoding an IP: `localhost` on a phone
 * resolves to the phone itself, which is the classic wasted afternoon here.
 * Set `EXPO_PUBLIC_API_URL` to point at a deployed instance.
 */
export function resolveApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv;

  const configured = Constants.expoConfig?.extra?.apiUrl;
  if (typeof configured === 'string' && configured.length > 0) return configured;

  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const host = hostUri.split(':')[0];
    if (host) return `http://${host}:3000`;
  }

  /*
   * In a browser, the page's own host is a better guess than `localhost`.
   *
   * The reasoning is the mirror image of the phone case above: there, the
   * device and the dev machine are different computers, so `localhost` is
   * wrong. Here the tab and the API may well be on the same machine, but if
   * the app is being reached over the LAN at `192.168.1.20:8081`, `localhost`
   * once again means "this computer" and points at the wrong one.
   */
  if (Platform.OS === 'web' && typeof location !== 'undefined' && location.hostname) {
    return `${location.protocol}//${location.hostname}:3000`;
  }

  return 'http://localhost:3000';
}

export const API_URL = resolveApiUrl();

/**
 * Where the signed session token is kept, for the Authorization header.
 *
 * The Expo plugin does not put it here, or anywhere, on the web. Its storage
 * hook opens with `if (isWeb) return`, because in a browser it expects the
 * cookie jar to do the job, so `getCookie()` there returns an empty string
 * forever. The server's `bearer()` plugin hands the same token back in a
 * `set-auth-token` response header on any response that sets the session
 * cookie, and that header *is* readable cross-origin. It adds itself to
 * `Access-Control-Expose-Headers`. So this is where it gets kept.
 */
const SESSION_TOKEN_KEY = 'lift_session_token';

export const authClient = createAuthClient({
  baseURL: `${API_URL}/api/auth`,
  fetchOptions: {
    onSuccess: (context) => {
      // Cleared on the way out rather than left to expire, so a shared browser
      // does not keep a usable token in localStorage after someone signs out.
      if (context.request.url.toString().includes('/sign-out')) {
        tokenStorage.setItem(SESSION_TOKEN_KEY, '');
        return;
      }

      const token = context.response.headers.get('set-auth-token');
      if (token) tokenStorage.setItem(SESSION_TOKEN_KEY, token);
    },
  },
  plugins: [
    expoClient({
      scheme: 'lift',
      storagePrefix: 'lift',
      storage: tokenStorage,
    }),
  ],
});

export const { signIn, signUp, signOut, useSession, getSession } = authClient;

/**
 * The stored session token, for use as a Bearer header on sync requests.
 * Returns null when signed out. Sync then stays local-only.
 */
export async function getSessionToken(): Promise<string | null> {
  return (await readToken(SESSION_TOKEN_KEY)) || null;
}

/**
 * Authenticated fetch against the sync API.
 *
 * Three ways of proving who is calling, because the platforms do not agree on
 * which of them exists.
 *
 * **Bearer** is the one that works everywhere, and it is why the server enables
 * better-auth's `bearer` plugin. It is also the only one that survives the app
 * and the API being on unrelated domains.
 *
 * **`credentials: 'include'`** is what lets a browser attach the session cookie
 * it already holds for the API's origin. Every call the auth client makes has
 * had this from the start (better-auth's own config sets it) and this one
 * request did not, which is the whole reason a signed-in browser was getting
 * 401s from sync while sign-in itself worked.
 *
 * **The `Cookie` header** is native-only, and not by preference: `Cookie` is a
 * forbidden header name in browsers, so `fetch` strips it without a word.
 * React Native's fetch is not a browser's and does send it, which is what has
 * been authenticating the phone app all along.
 */
export async function apiFetch<T>(path: string, body: unknown): Promise<T> {
  return apiRequest<T>('POST', path, body);
}

/**
 * The same, for any method. A 204 resolves with `undefined`.
 *
 * The three ways of proving who is calling are the ones described above, for
 * the same reasons.
 */
export async function apiRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const token = await getSessionToken();
  const cookie = Platform.OS === 'web' ? null : authClient.getCookie();

  const response = await fetch(`${API_URL}${path}`, {
    method,
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new SyncHttpError(response.status, text || response.statusText);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export class SyncHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(`Sync failed (${status}): ${message}`);
    this.name = 'SyncHttpError';
  }

  /** 401 means the session expired. The user must sign in again. */
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

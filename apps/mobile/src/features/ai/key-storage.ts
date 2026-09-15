/**
 * Where the model API key lives.
 *
 * The same two-target problem `features/sync/token-storage.ts` solves, and
 * deliberately the same shape, because the reasoning transfers exactly: a phone
 * gets the OS keychain through `expo-secure-store`, and a browser gets
 * `localStorage`, because `expo-secure-store`'s web build is `export default {}`
 * and every call into it throws at import time rather than degrading to null.
 * The try/catch around `localStorage` is not defensive noise either: this app
 * exports with `output: 'static'` and its route tree is rendered in Node once at
 * build time, where the global does not exist at all.
 *
 * It is a separate module from the session token rather than a second key in the
 * same one, and the difference is worth stating. A session token is the app's
 * own credential, replaceable by signing in again, and losing it costs backup.
 * This is the user's credential for somebody else's paid account. It is never
 * read back into a text field, never written to a log, never included in a
 * backup, and deleting it is offered as a plain action rather than buried in a
 * reset.
 */

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const isWeb = Platform.OS === 'web';

/**
 * One key per provider.
 *
 * Someone trying Claude, then a local model, then coming back should not have to
 * paste a key twice. Switching providers in settings is then a change to one
 * setting rather than a re-authentication.
 */
const KEY_PREFIX = 'lift.ai.key.';

function storageKey(provider: string): string {
  return `${KEY_PREFIX}${provider}`;
}

function webStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Reads the stored key, or null when there is none. */
export async function readApiKey(provider: string): Promise<string | null> {
  try {
    if (isWeb) return webStorage()?.getItem(storageKey(provider)) || null;
    return (await SecureStore.getItemAsync(storageKey(provider))) || null;
  } catch {
    // A locked keychain, blocked site data, private mode. All of them mean the
    // same thing to the caller: there is no key to use, which is the state the
    // app already handles as "AI is not set up".
    return null;
  }
}

/**
 * Stores a key, or clears it when handed an empty string.
 *
 * Returns whether the write actually landed. The settings screen needs to know:
 * silently accepting a key that will not survive a restart is how someone ends
 * up convinced the feature is broken rather than that storage is unavailable.
 */
export async function writeApiKey(provider: string, key: string): Promise<boolean> {
  const trimmed = key.trim();

  try {
    if (trimmed.length === 0) {
      await deleteApiKey(provider);
      return true;
    }

    if (isWeb) {
      const storage = webStorage();
      if (!storage) return false;
      storage.setItem(storageKey(provider), trimmed);
      return true;
    }

    await SecureStore.setItemAsync(storageKey(provider), trimmed);
    return true;
  } catch {
    return false;
  }
}

export async function deleteApiKey(provider: string): Promise<void> {
  try {
    if (isWeb) webStorage()?.removeItem(storageKey(provider));
    else await SecureStore.deleteItemAsync(storageKey(provider));
  } catch {
    // Nothing useful to do. The caller is either signing the user out of the
    // feature or overwriting the value anyway.
  }
}

/**
 * What a stored key looks like on screen.
 *
 * Enough of the tail to recognise which of two keys is loaded, and never enough
 * to use. The head is the provider's own prefix and is not a secret, but it is
 * dropped anyway: it varies in length between providers, and a mask whose shape
 * leaks the length of what it hides is not much of a mask.
 */
export function maskApiKey(key: string): string {
  const tail = key.trim().slice(-4);
  return tail.length === 4 ? `••••••••${tail}` : '••••••••';
}

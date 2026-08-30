/**
 * Opens a YouTube search for how to perform a lift.
 *
 * Tries the YouTube app first (`youtube://` / `vnd.youtube://`) so a phone
 * with the app installed lands in it rather than in a browser tab. The https
 * search is the fallback: App Links often open the app anyway, and a browser
 * is what is left when it is not installed.
 */

import { Linking, Platform } from 'react-native';

export function youtubeHowToQuery(name: string): string {
  return `How to do ${name}`;
}

export function youtubeHowToWebUrl(name: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(youtubeHowToQuery(name))}`;
}

export async function openYoutubeHowTo(name: string): Promise<void> {
  const encoded = encodeURIComponent(youtubeHowToQuery(name));
  const web = youtubeHowToWebUrl(name);
  const app =
    Platform.OS === 'ios'
      ? `youtube://www.youtube.com/results?search_query=${encoded}`
      : `vnd.youtube://results?search_query=${encoded}`;

  try {
    await Linking.openURL(app);
  } catch {
    await Linking.openURL(web);
  }
}

/** Everything the page links out to, and the few facts it states as numbers. */

export const repo = "https://github.com/pawan67/lift";

/*
 * The web app: statistics, the library, routines and measurements in a
 * browser, reading the same log the phone syncs.
 *
 * Read at build time like the site's own URL, so a self-hosted copy of this
 * page can point at its own `web` service with `NEXT_PUBLIC_WEB_APP_URL`. `||`
 * rather than `??`, because the compose file passes the variable through and
 * an unset one arrives as an empty string.
 */
export const webApp =
  process.env.NEXT_PUBLIC_WEB_APP_URL || "https://liftapp.000427.xyz";

/** The web app's address as a person would type it. */
export const webAppHost = webApp.replace(/^https?:\/\//, "").replace(/\/$/, "");

export const links = {
  repo,
  webApp,
  /** GitHub redirects this to whatever the newest tag published. */
  release: `${repo}/releases/latest`,
  releases: `${repo}/releases`,
  readme: `${repo}#readme`,
  licence: `${repo}/blob/main/LICENSE`,
  notices: `${repo}/blob/main/NOTICE.md`,

  /*
   * Deep links into the README and the tree, for the two sections that make
   * claims a reader is entitled to check. Each one points at the file that
   * settles the claim rather than at the repository root: `dependencies` is
   * what backs "no analytics SDK", `api` is the server the self-hosting
   * section describes, and `updates` is where the one call the app makes to
   * somebody else's server is written up in full.
   *
   * Nothing unreferenced lives in here. The footer used to carry the issue
   * tracker, the compose file and the build workflow as a third column of
   * links nobody had asked for, and when that column went those three had no
   * call site left. A links map with dead entries in it stops being the answer
   * to what this page points at.
   */
  selfHosting: `${repo}#self-hosting`,
  api: `${repo}/tree/main/apps/api`,
  dependencies: `${repo}/blob/main/apps/mobile/package.json`,
  updates: `${repo}#over-the-air-updates`,
} as const;

/*
 * There is deliberately no `version` constant here any more. See
 * `lib/release.ts`: the only version this page is entitled to print is the one
 * GitHub is currently serving, and a string in this file cannot be that.
 */

import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import localFont from "next/font/local";

import "./globals.css";

/*
 * The page is set in Eina 03, and the app is not.
 *
 * That is a deliberate split rather than drift. Everything else on this page is
 * the app's own material: its palette hex for hex, its screenshots, its
 * arithmetic. The typeface used to be as well, which sounded right and read
 * flat: JetBrains Sans is drawn for code, its job is to keep forty characters
 * of dense UI legible at eleven points, and asked to set a 4.5rem headline it
 * does the honest engineering thing and stays out of the way. A page whose only
 * job is a headline wants a face with an opinion.
 *
 * Eina is that face: geometric, wide-countered, quiet, and Swiss enough to sit
 * over a photograph of an app without arguing with it. The screenshots still
 * carry the app's own typeface, which is the correct division. The picture is
 * in the app's voice, and the page is in the page's.
 *
 * 03 rather than 01, 02 or 04. All four were set side by side at display and
 * body size before choosing: 04 is too wide for a headline that is already
 * uppercase, 01 and 02 differ from 03 mostly in the tail of the `y` and the
 * terminal of the `t`, and 03 is the most even of them at 17px, which is the
 * size most of this page is actually read at.
 *
 * Four weights, no italics, because the page sets none. The Light is here for
 * the display sizes: Eina Bold at 4.5rem uppercase is a wall, and the same
 * words in the Light with the tracking opened read as designed rather than as
 * shouted.
 *
 * **The licence is not established, and this one is worse than the last.** The
 * archive is from a free-font aggregator and the `License.txt` inside it is a
 * generic Fontspring *desktop* EULA whose own permalink points at a different
 * family. Eina is a commercial face sold by Textaxis; a desktop licence does
 * not cover serving a webfont to the public, and that is exactly what this
 * does. Settle it, or swap the family, before this page is anything but
 * sideloading's front door. `apps/landing/components/site/phone.tsx` carries
 * the same warning about the device mockup.
 */
const eina = localFont({
  variable: "--font-eina",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
  /*
   * Four files, five weights, and the duplicate is the point. `font-medium` is
   * asking for 500, and CSS font matching resolves a missing 500 *downwards* to
   * 400, so a label set in it would come out indistinguishable from the
   * paragraph beside it. Registering the SemiBold at both 500 and 600 is what
   * stops that. One file, declared twice: the browser fetches it once.
   *
   * The Light is registered at 300 and used in one place, `.display`.
   */
  src: [
    { path: "./fonts/Eina03-Light.woff2", weight: "300", style: "normal" },
    { path: "./fonts/Eina03-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Eina03-SemiBold.woff2", weight: "500", style: "normal" },
    { path: "./fonts/Eina03-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "./fonts/Eina03-Bold.woff2", weight: "700", style: "normal" },
  ],
});

/*
 * The mono, for labels and for anything printed as a figure.
 *
 * It stays JetBrains Mono now that the sans beside it is not JetBrains Sans,
 * and the pairing is better for the change rather than in spite of it. The two
 * are no longer siblings, which was the old argument for it; what they are now
 * is a geometric sans and an engineer's monospace, and the distance between
 * them is what makes a tracked-out mono label read as a different kind of
 * thing from the sentence under it rather than as the same voice in a
 * different width. It is also the only one of the three faces on this page
 * whose licence is settled: the OFL, with nothing outstanding.
 */
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

/*
 * Where this page is served from, which is not where its source lives.
 *
 * `metadataBase` is what Next resolves `opengraph-image.png` against, so
 * pointing it at the repository would hand Slack and Twitter a github.com URL
 * that answers 404. It has to be the site's own origin, it has to be absolute,
 * and nothing in the build can work it out on its own.
 *
 * The fallback is localhost rather than a guessed domain: a card that fails to
 * load while you are developing is obvious, and a card that loads the wrong
 * site's image is not. Set `NEXT_PUBLIC_SITE_URL` when deploying. It is read at
 * build time, so changing it means rebuilding rather than restarting.
 */
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: "Lift: a workout tracker that lives on your phone",
  description:
    "Every workout, set, routine and record in a real database on the phone. " +
    "Works with no account and no network. No analytics, no trackers and no " +
    "ads in the build. Sync is optional, the server behind it is in the " +
    "repository for you to run yourself, and a web app puts your statistics, " +
    "routines and exercise library on a bigger screen.",
  applicationName: "Lift",
  keywords: [
    "workout tracker",
    "local-first",
    "offline workout tracker",
    "open source",
    "Android",
    "web app",
    "gym log",
    "self-hosted",
    "self-hosted sync",
    "private workout tracker",
    "no tracking",
    "AGPL",
  ],
  openGraph: {
    title: "Lift: a workout tracker that lives on your phone",
    description:
      "Local-first, offline by design, no account and no trackers. Sync is " +
      "optional and self-hostable. AGPL-3.0.",
    type: "website",
    siteName: "Lift",
  },
  twitter: {
    card: "summary_large_image",
    title: "Lift: a workout tracker that lives on your phone",
    description:
      "Local-first, offline by design, no account and no trackers. Sync is " +
      "optional and self-hostable. AGPL-3.0.",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${eina.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-ink text-fg">{children}</body>
    </html>
  );
}

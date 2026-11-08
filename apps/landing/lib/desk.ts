import type { StaticImageData } from "next/image";

import dashboardShot from "../../../screenshots/web/dashboard.png";
import exercisesShot from "../../../screenshots/web/exercises.png";
import measurementsShot from "../../../screenshots/web/measurements.png";
import routineShot from "../../../screenshots/web/routine.png";
import statisticsShot from "../../../screenshots/web/statistics.png";

/**
 * The web app's screens, for the browser frame in `components/sections/web.tsx`.
 *
 * Captured at 1440x900 and twice the density, against the same generated year
 * the phone screenshots use (`scripts/screenshots/sample-log.mjs`), pushed to a
 * local server through the sync API. So the 44,282 kg on the dashboard here is
 * the 44,282 kg on the phone's home tab further up the page: the same log, read
 * in two places, which is the claim the section is making.
 *
 * Imported rather than served from `public` for the reason `lib/screens.ts`
 * gives: Next reads the real dimensions off the file. **An alt text that quotes
 * a number means re-reading it off the new screen** when the set is retaken.
 */
export interface DeskScreen {
  id: string;
  /** The path shown in the frame's address bar. */
  path: string;
  label: string;
  /** One line under the label: what you sit down at this screen to do. */
  line: string;
  src: StaticImageData;
  alt: string;
}

export const deskScreens: DeskScreen[] = [
  {
    id: "dashboard",
    path: "/",
    label: "Dashboard",
    line: "The week against the last, twelve weeks of volume and the whole training year.",
    src: dashboardShot,
    alt: "The web dashboard: 4 sessions and 44,282 kg this week, a 34-week streak, a twelve week volume chart beside sets by body part, and the training year as a grid of days",
  },
  {
    id: "statistics",
    path: "/stats",
    label: "Statistics",
    line: "Any window from a week to all time, broken down by muscle, lift and month.",
    src: statisticsShot,
    alt: "Statistics for the last 30 days: 17 sessions, 164,432 kg, 286 sets and 23 records, with weekly volume charted against the average",
  },
  {
    id: "routines",
    path: "/routines",
    label: "Routines",
    line: "Build next week with a keyboard. Last session's sets sit under every exercise.",
    src: routineShot,
    alt: "The routine editor open on Push A: set rows with weight and reps, last session's numbers above them, and sets per muscle totalled down the side",
  },
  {
    id: "exercises",
    path: "/exercises",
    label: "Library",
    line: "6,847 exercises with pictures, searchable by name, muscle and equipment.",
    src: exercisesShot,
    alt: "The exercise library: 6,847 exercises, each with an illustration, the muscle it trains, how many sessions it has been in and when it was last trained",
  },
  {
    id: "measurements",
    path: "/measurements",
    label: "Body",
    line: "Bodyweight with its trend line, and every tape measurement beside it.",
    src: measurementsShot,
    alt: "Measurements: bodyweight at 83.7 kg with its trend over three months, body fat, lean mass, waist to hip, and each tape measurement with a sparkline",
  },
];

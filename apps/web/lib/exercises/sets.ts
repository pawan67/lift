import { TRACKING_FIELDS, type SetType, type TrackingType } from "@lift/shared";

import type { Formatter } from "@/lib/format";

interface SetValues {
  weightKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
  distanceKm: number | null;
}

/**
 * One set as the phone prints it: "80 kg × 5", "+20 kg × 8", "1:30", "5 km in 25:00".
 *
 * The weight column means different things by tracking type: added load on a
 * weighted pull-up, assistance on an assisted one. The sign says which.
 */
export function describeSet(set: SetValues, trackingType: TrackingType, f: Formatter): string {
  const fields = TRACKING_FIELDS[trackingType];
  const parts: string[] = [];

  if (fields.weight && set.weightKg !== null) {
    const weight = f.weight(set.weightKg);
    parts.push(trackingType === "weighted_bodyweight" ? `+${weight}` : trackingType === "assisted_bodyweight" ? `−${weight}` : weight);
  } else if (trackingType === "bodyweight_reps") {
    parts.push("BW");
  }

  if (fields.reps && set.reps !== null) parts.push(`${set.reps} rep${set.reps === 1 ? "" : "s"}`);
  const head = parts.join(" × ");

  const tail: string[] = [];
  if (fields.distance && set.distanceKm !== null) tail.push(f.distance(set.distanceKm));
  if (fields.duration && set.durationSeconds !== null) tail.push(f.duration(set.durationSeconds));

  if (head && tail.length > 0) return `${head}, ${tail.join(" in ")}`;
  return head || tail.join(" in ") || "No values";
}

/** "1", "2"… for working sets; W, D, F for the rest, like the phone's set badges. */
export function setLabels(sets: readonly { setType: SetType }[]): string[] {
  let working = 0;
  return sets.map((set) => {
    if (set.setType === "warmup") return "W";
    working += 1;
    if (set.setType === "drop") return "D";
    if (set.setType === "failure") return "F";
    return String(working);
  });
}

/**
 * Colours for the volume zones, the web's version of the phone's landmark ramp
 * (`apps/mobile/src/features/analytics/volume-landmarks.ts`): quiet below the
 * minimum, the accent where growth happens, warm past the recoverable ceiling.
 */

import type { VolumeZone } from "@lift/shared";

export const ZONE_COLORS: Record<VolumeZone, string> = {
  untrained: "#3a3a46",
  maintenance: "#84848f",
  growth: "#b6d634",
  optimal: "#d2f34b",
  overreaching: "#e8913c",
};

export const ZONE_DESCRIPTIONS: Record<VolumeZone, string> = {
  untrained: "No sets",
  maintenance: "Below the minimum for growth",
  growth: "Past the minimum, still climbing",
  optimal: "In the most productive band",
  overreaching: "Past what most can recover from",
};

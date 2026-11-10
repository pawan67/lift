/**
 * Colours for the volume zones, the web's version of the phone's landmark ramp
 * (`apps/mobile/src/features/analytics/volume-landmarks.ts`): quiet below the
 * minimum, the accent where growth happens, warm past the recoverable ceiling.
 */

import type { VolumeZone } from "@lift/shared";

import { color } from "@/components/ui/tokens";

export const ZONE_COLORS: Record<VolumeZone, string> = {
  untrained: color.lineStrong,
  maintenance: color.fg3,
  growth: color.voltDeep,
  optimal: color.volt,
  overreaching: color.warn,
};

export const ZONE_DESCRIPTIONS: Record<VolumeZone, string> = {
  untrained: "No sets",
  maintenance: "Below the minimum for growth",
  growth: "Past the minimum, still climbing",
  optimal: "In the most productive band",
  overreaching: "Past what most can recover from",
};

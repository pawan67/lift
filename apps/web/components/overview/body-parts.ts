import { BODY_PARTS, type BodyPart } from "@lift/shared";

import { CHART_COLORS, SERIES_COLORS } from "@/components/charts/charts";

/** One fixed colour per body part, so chest is the same colour on every chart. */
export function bodyPartColor(part: BodyPart): string {
  if (part === "other") return CHART_COLORS.muted;
  return SERIES_COLORS[BODY_PARTS.indexOf(part) % SERIES_COLORS.length]!;
}

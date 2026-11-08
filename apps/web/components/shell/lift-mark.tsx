/** The Lift mark, same geometry as `apps/landing/components/site/mark.tsx`. */

import { useId } from "react";

import { cn } from "@/lib/cn";

const STEM = { x: 16, y: 8, width: 22, height: 68, rx: 7.5 };
const BAR = { x: 16, y: 54, width: 62, height: 22, rx: 7.5 };
const PLATE = { x: 56, y: 33, width: 24, height: 64, rx: 8.5 };
const HALO = { x: 52.5, y: 29.5, width: 31, height: 71, rx: 12 };
const BOX = { x: 16, y: 8, width: 64, height: 89 };

export function LiftMark({ className }: { className?: string }) {
  const seam = `lift-seam-${useId().replace(/:/g, "")}`;
  return (
    <svg
      viewBox={`${BOX.x} ${BOX.y} ${BOX.width} ${BOX.height}`}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={cn("w-auto text-volt", className)}
    >
      <defs>
        <mask id={seam} maskUnits="userSpaceOnUse" {...BOX}>
          <rect {...BOX} fill="#fff" />
          <rect {...HALO} fill="#000" />
        </mask>
      </defs>
      <g mask={`url(#${seam})`}>
        <rect {...STEM} />
        <rect {...BAR} />
      </g>
      <rect {...PLATE} />
    </svg>
  );
}

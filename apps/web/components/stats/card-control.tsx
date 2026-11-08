/**
 * A card's control (a metric toggle, say) that sits in the header on a wide
 * screen and drops into the body on a phone, where beside the title it would
 * squeeze the title into a column one word wide.
 */

import type { ReactNode } from "react";

export function HeaderControl({ children }: { children: ReactNode }) {
  return <div className="hidden sm:block">{children}</div>;
}

export function BodyControl({ children }: { children: ReactNode }) {
  return <div className="-mx-1 mb-4 overflow-x-auto px-1 sm:hidden">{children}</div>;
}

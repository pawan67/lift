/** A row inside a Card, with dividers between siblings. A link, a button or plain. */

import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export function ListRow({
  href,
  onClick,
  children,
  className,
}: {
  href?: string;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  const classes = cn(
    "flex w-full items-center gap-3 border-t border-line px-5 py-3 text-left first:border-t-0",
    href || onClick ? "transition-colors duration-150 hover:bg-surface-2/70 active:bg-surface-2" : "",
    className,
  );
  if (href) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes}>
        {children}
      </button>
    );
  }
  return <div className={classes}>{children}</div>;
}

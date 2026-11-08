/**
 * A section that sits straight on the page: a plain heading over a hairline,
 * for content that reads fine without a card around it (rankings, tables).
 */

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export function Section({
  title,
  meta,
  action,
  className,
  children,
}: {
  title: ReactNode;
  /** Quiet text after the title, e.g. a unit or a count. */
  meta?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("min-w-0", className)}>
      <div className="mb-1 flex items-baseline justify-between gap-3 border-b border-line pb-2.5">
        <h2 className="min-w-0 truncate text-sm font-semibold tracking-tight text-fg">
          {title}
          {meta ? <span className="ml-2 font-normal text-fg-3">{meta}</span> : null}
        </h2>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** A small text link with a trailing arrow, for a section header or a footer. */
export function MoreLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="group inline-flex items-center gap-1 text-[13px] text-fg-3 transition-colors duration-150 hover:text-fg">
      {children}
      <ArrowRight size={13} className="transition-transform duration-150 ease-out group-hover:translate-x-0.5 motion-reduce:transition-none" />
    </Link>
  );
}

/** Sentence-case column header cell text, shared by the stats tables. */
export const TH = "py-2 text-xs font-normal text-fg-3";

/** A screen's title block: optional back link, title, subtitle and actions. */

import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Shows a back link above the title. */
  back?: { href: string; label: string };
}) {
  return (
    <header className="mb-6">
      {back ? (
        <Link href={back.href} className="group mb-3 inline-flex items-center gap-1 text-[13px] text-fg-3 transition-colors hover:text-fg">
          <span aria-hidden className="transition-transform duration-150 ease-out group-hover:-translate-x-0.5">←</span> {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.02em] text-fg sm:text-[30px]">{title}</h1>
          {subtitle ? <p className="mt-1.5 text-sm text-fg-3">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

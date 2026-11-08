/** Tabs across the Statistics section, so its five screens read as one place. */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";

const TABS = [
  { href: "/stats", label: "Overview" },
  { href: "/stats/muscles", label: "Muscles" },
  { href: "/stats/lifts", label: "Lifts" },
  { href: "/stats/monthly", label: "Monthly" },
  { href: "/stats/report", label: "Report" },
];

export function StatsNav() {
  const pathname = usePathname();
  return (
    <nav className="-mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b border-line">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                className={cn(
                  "-mb-px inline-flex h-10 items-center border-b-2 px-3 text-sm transition-colors",
                  active ? "border-volt font-medium text-fg" : "border-transparent text-fg-3 hover:text-fg",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

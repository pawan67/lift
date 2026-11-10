/** What a list or chart shows when there is nothing in it, and loading placeholders. */

import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      {icon ? <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-line text-fg-3">{icon}</div> : null}
      <p className="text-sm font-medium text-fg">{title}</p>
      {body ? <p className="mt-1 max-w-sm text-sm text-fg-3">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-surface-2", className)} />;
}

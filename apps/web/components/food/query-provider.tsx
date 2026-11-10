/**
 * TanStack Query for the food tracker, the one part of the web app that reads
 * from the API on demand rather than from the synced IndexedDB copy.
 */

"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { queryClient } from "@/lib/nutrition/queries";

export function FoodQueryProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

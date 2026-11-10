/**
 * Everything the design system needs mounted once, at the root: the tooltip
 * and toast providers, the toast stack, the confirm prompt and the theme.
 */

"use client";

import type { ReactNode } from "react";

import { ConfirmHost } from "./alert-dialog";
import { ThemeSync } from "./theme";
import { ToastProvider, Toaster } from "./toast";
import { TooltipProvider } from "./tooltip";

export function UIProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <ToastProvider>
        {children}
        <Toaster />
        <ConfirmHost />
        <ThemeSync />
      </ToastProvider>
    </TooltipProvider>
  );
}

import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";

import { UIProvider } from "@/components/ui/provider";
import { ThemeScript } from "@/components/ui/theme";

import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Lift", template: "%s · Lift" },
  description: "Your Lift training log on the web: statistics, exercises, routines and body measurements.",
};

export const viewport: Viewport = {
  // `ThemeSync` updates this when the light theme is on.
  themeColor: "#000000",
  colorScheme: "dark light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // `data-theme` is rewritten by `ThemeScript` before paint, hence the warning suppression.
    <html lang="en" className={geist.variable} data-theme="dark" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-dvh antialiased">
        <UIProvider>{children}</UIProvider>
      </body>
    </html>
  );
}

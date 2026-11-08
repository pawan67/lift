import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";

import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Lift", template: "%s · Lift" },
  description: "Your Lift training log on the web: statistics, exercises, routines and body measurements.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={geist.variable}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}

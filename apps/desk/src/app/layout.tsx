import { Radar } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Jev Desk",
  description: "Watch and run Jev's paper trading",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-line bg-page/80 sticky top-0 z-10 border-b backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
            <Link
              href="/"
              className="flex items-center gap-2 hover:no-underline"
            >
              <Radar className="text-accent size-5" aria-hidden />
              <span className="from-accent to-accent-2 bg-linear-to-r bg-clip-text font-mono text-base font-bold tracking-[0.2em] text-transparent">
                JEV DESK
              </span>
            </Link>
            <span className="border-line text-muted rounded-full border px-2 py-0.5 text-xs">
              paper trading · local
            </span>
          </div>
        </header>
        <main className="mx-auto max-w-7xl p-4">{children}</main>
      </body>
    </html>
  );
}

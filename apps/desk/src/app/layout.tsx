import { Radar } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import "./globals.css";

const metadata: Metadata = {
  title: "Jev Desk",
  description: "Watch and run Jev's paper trading",
};

const RootLayout = ({ children }: { children: ReactNode }) => (
  <html lang="en">
    <body>
      <header className="sticky top-0 z-10 border-b border-line bg-page/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 hover:no-underline">
            <Radar className="size-5 text-accent" aria-hidden />
            <span className="bg-linear-to-r from-accent to-accent-2 bg-clip-text font-mono text-base font-bold tracking-[0.2em] text-transparent">
              JEV DESK
            </span>
          </Link>
          <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">
            paper trading · local
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-7xl p-4">{children}</main>
    </body>
  </html>
);

export { metadata };
export default RootLayout;

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
        <header className="border-line bg-card flex items-baseline gap-3 border-b px-4 py-3">
          <Link href="/" className="text-ink font-bold">
            Jev Desk
          </Link>
          <span className="text-muted">paper trading · local only</span>
        </header>
        <main className="mx-auto max-w-275 p-4">{children}</main>
      </body>
    </html>
  );
}

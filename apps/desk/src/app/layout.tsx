import type { Metadata } from "next";
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
        <header className="topbar">
          <a href="/" className="brand">
            Jev Desk
          </a>
          <span className="muted">paper trading · local only</span>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Фигуры для спортивных кайтов",
    template: "%s — Фигуры для спортивных кайтов",
  },
  description: "Каталог обязательных фигур соревнований по спортивному кайту.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <header className="site-header">
          <Link href="/">Фигуры для спортивных кайтов</Link>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { Search } from "@/components/Search";

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
      <head>
        {/* Счётчик посещений Umami. data-domains — чтобы заход считался только на
            самом сайте: локальная сборка и любое зеркало несут тот же тег, но
            скрипт на чужом хосте ничего не шлёт. Идентификатор сайта публичен,
            он и так стоит в разметке. Переходы без перезагрузки скрипт считает
            сам. */}
        <script
          defer
          src="https://stats.malaev.net/script.js"
          data-website-id="9120e1c7-dac4-4664-8719-91f6d56ecbb1"
          data-domains="kites.malaev.net"
        />
      </head>
      <body>
        <header className="site-header">
          <Link href="/">Фигуры для спортивных кайтов</Link>
          <Search />
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}

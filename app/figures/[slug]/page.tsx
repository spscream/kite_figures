import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { figureTitle, getFigure, listFigures } from "@/lib/figures";

type Props = { params: Promise<{ slug: string }> };

// Страницы строятся по каталогу `data/figures/`: по странице на файл. Адреса
// вне каталога не существует — при статическом экспорте его некому отдать.
export const dynamicParams = false;

export function generateStaticParams() {
  return listFigures().map((figure) => ({ slug: figure.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const figure = getFigure((await params).slug);
  return figure ? { title: figureTitle(figure), description: figure.summary } : {};
}

export default async function FigurePage({ params }: Props) {
  const figure = getFigure((await params).slug);
  if (!figure) {
    notFound();
  }
  return (
    <article>
      <h1>{figureTitle(figure)}</h1>
      <p>{figure.summary}</p>
      <p className="note">
        Точная формулировка и официальная схема —{" "}
        <a className="source" href={figure.sourceUrl} rel="noreferrer">
          в первоисточнике, страница {figure.source.page}
        </a>
        .
      </p>
      <p>
        <Link href="/">Все фигуры</Link>
      </p>
    </article>
  );
}

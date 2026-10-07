import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getFigure, listFigures } from "@/lib/figures";

type Props = { params: Promise<{ slug: string }> };

// Страницы строятся по каталогу `data/figures/`: по странице на файл. Адреса
// вне каталога не существует — при статическом экспорте его некому отдать.
export const dynamicParams = false;

export function generateStaticParams() {
  return listFigures().map((figure) => ({ slug: figure.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const figure = getFigure((await params).slug);
  return figure ? { title: figure.title, description: figure.summary } : {};
}

export default async function FigurePage({ params }: Props) {
  const figure = getFigure((await params).slug);
  if (!figure) {
    notFound();
  }
  return (
    <article>
      <h1>{figure.title}</h1>
      {figure.fictional && (
        <p className="fictional">
          Вымышленная запись: она проверяет шаблон страницы и не описывает фигуру из правил.
        </p>
      )}
      <p>{figure.summary}</p>
      <p>
        <Link href="/">Все фигуры</Link>
      </p>
    </article>
  );
}

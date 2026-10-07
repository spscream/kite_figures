import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { figurePath, getSection, neighbours, sectionPath } from "@/lib/catalog";
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
  const section = getSection(figure.discipline);
  if (!section) {
    notFound();
  }
  const { previous, next } = neighbours(section, figure.slug);
  return (
    <article>
      <nav className="crumbs" aria-label="Положение в каталоге">
        <Link href="/">Все разделы</Link>
        {" / "}
        <Link href={sectionPath(section.discipline)}>{section.title}</Link>
      </nav>
      <h1>{figureTitle(figure)}</h1>
      {figure.status === "obsolete" && (
        <p className="status">Фигура выведена из действующей редакции правил.</p>
      )}
      <p>{figure.summary}</p>
      <p className="note">
        Точная формулировка и официальная схема —{" "}
        <a className="source" href={figure.sourceUrl} rel="noreferrer">
          {`в первоисточнике, страница ${figure.source.page}`}
        </a>
        .
      </p>
      <nav className="neighbours" aria-label="Соседние фигуры раздела">
        {previous && (
          <Link className="previous" href={figurePath(previous.slug)} rel="prev">
            {`← ${figureTitle(previous)}`}
          </Link>
        )}
        {next && (
          <Link className="next" href={figurePath(next.slug)} rel="next">
            {`${figureTitle(next)} →`}
          </Link>
        )}
      </nav>
    </article>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FigureDiagrams } from "@/components/FigureDiagram";
import { figurePath, getSection, neighbours, sectionPath } from "@/lib/catalog";
import { figureTitle, getFigure, listFigures, sourcePageUrl } from "@/lib/figures";
import { loadSources } from "@/lib/sources";

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

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

// «2011-12-05» → «5 декабря 2011 года»: дата редакции, как её читает человек.
function longDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year} года`;
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
  // Действующая редакция — первый документ реестра. Фигура, снятая с другой
  // редакции, говорит об этом на странице: её схема — не из действующих правил.
  const sources = loadSources();
  const current = sources[0];
  const edition = sources.find((item) => item.id === figure.source.document && item.version === figure.source.version);
  const earlier = edition !== undefined && edition !== current ? edition : undefined;
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
      {earlier && (
        <p className="edition">
          {`Схема и шаги сняты с прежней редакции книги фигур — версии ${earlier.version} от ${longDate(earlier.dated)}: в действующей версии ${current.version} страницы этой фигуры нет.`}
        </p>
      )}
      <p>{figure.summary}</p>
      {figure.geometry.status === "ok" ? (
        <>
          <FigureDiagrams
            title={figureTitle(figure)}
            variants={figure.geometry.variants}
            pageUrl={(page) => sourcePageUrl(figure, page)}
            multiline={figure.discipline.startsWith("multi-line")}
          />
          {figure.geometry.notes.length > 0 && (
            <section className="notes">
              <h2>Как снята геометрия</h2>
              <ul>
                {figure.geometry.notes.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      ) : (
        <p className="no-diagram">
          <strong>Схемы нет.</strong> {figure.geometry.reason}
        </p>
      )}
      <p className="note">
        Точная формулировка и официальная схема —{" "}
        <a className="source" href={figure.sourceUrl} rel="noreferrer">
          {`в первоисточнике${earlier ? ` версии ${earlier.version}` : ""}, страница ${figure.source.page}`}
        </a>
        .
      </p>
      {(previous || next) && (
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
      )}
    </article>
  );
}

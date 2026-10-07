import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { countFigures, figurePath, getSection, listSections } from "@/lib/catalog";
import { type Figure, figureTitle } from "@/lib/figures";

type Props = { params: Promise<{ discipline: string }> };

// Страницы разделов строятся по тем же файлам, что и страницы фигур: раздел
// есть, пока в каталоге лежит хотя бы одна его фигура.
export const dynamicParams = false;

export function generateStaticParams() {
  return listSections().map((section) => ({ discipline: section.discipline }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const section = getSection((await params).discipline);
  return section
    ? {
        title: section.title,
        description: `Раздел ${section.title} (${section.prefix}) каталога обязательных фигур: ${countFigures(section.figures.length)}.`,
      }
    : {};
}

function FigureList({ figures }: { figures: Figure[] }) {
  return (
    <ul className="figure-list">
      {figures.map((figure) => (
        <li key={figure.slug}>
          <Link href={figurePath(figure.slug)}>{figureTitle(figure)}</Link>
          {figure.level && <span className="note">{figure.level}</span>}
        </li>
      ))}
    </ul>
  );
}

export default async function SectionPage({ params }: Props) {
  const section = getSection((await params).discipline);
  if (!section) {
    notFound();
  }
  return (
    <>
      <nav className="crumbs" aria-label="Положение в каталоге">
        <Link href="/">Все разделы</Link>
      </nav>
      <h1>{section.title}</h1>
      <p className="note">
        {`Раздел ${section.prefix} книги фигур: `}
        <span className="count">{countFigures(section.figures.length)}</span>.
      </p>
      {section.current.length > 0 && (
        <section id="current">
          <h2>{`Действующие — ${section.current.length}`}</h2>
          <FigureList figures={section.current} />
        </section>
      )}
      {section.obsolete.length > 0 && (
        <section id="obsolete">
          <h2>{`Выведены из действующей редакции — ${section.obsolete.length}`}</h2>
          <FigureList figures={section.obsolete} />
        </section>
      )}
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { RoutineView } from "@/components/RoutineView";
import { sectionPath, sectionTitle } from "@/lib/catalog";
import { listFigures } from "@/lib/figures";
import { storyboard } from "@/lib/frames";
import { getRoutine, listRoutines } from "@/lib/routines";
import { routineTempoPath } from "@/lib/paths";
import { loadSources } from "@/lib/sources";

type Props = { params: Promise<{ slug: string }> };

// Страницы строятся по каталогу `data/routines/`: по странице на файл.
export const dynamicParams = false;

export function generateStaticParams() {
  return listRoutines().map((routine) => ({ slug: routine.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const routine = getRoutine((await params).slug);
  return routine ? { title: routine.name, description: routine.summary } : {};
}

export default async function RoutinePage({ params }: Props) {
  const routine = getRoutine((await params).slug);
  if (!routine) {
    notFound();
  }
  const board = storyboard(routine, listFigures());
  // Что правила называют технической рутиной, сайт не пересказывает: ссылка
  // ведёт на официальный документ.
  const rules = loadSources().find((item) => item.id === "iskrb");
  return (
    <article>
      <nav className="crumbs" aria-label="Положение на сайте">
        <Link href="/">Все разделы</Link>
        {" / Рутины"}
      </nav>
      <h1>{routine.name}</h1>
      {routine.summary && <p>{routine.summary}</p>}
      <p className="note">
        {"Раздел "}
        <Link href={sectionPath(routine.discipline)}>{sectionTitle(routine.discipline)}</Link>
        {routine.kites.length > 1 ? `, кайтов — ${routine.kites.length}` : ""}
        {". Рутина — своя запись программы полёта: в книге фигур её нет. Время шагов записал автор рутины — ни книга фигур, ни правила длительности шага не называют."}
      </p>
      <p className="note r-edit">
        <Link href={routineTempoPath(routine.slug)}>Редактор длительностей</Link>
        {" — задать время каждого шага и получить файл рутины обратно; редактору нужен JavaScript."}
      </p>
      <RoutineView name={routine.name} board={board} multiline={routine.discipline.startsWith("multi-line")} />
      {rules && (
        <p className="note">
          Что называют технической рутиной правила и как её судят —{" "}
          <a className="source" href={rules.url} rel="noreferrer">
            {`в первоисточнике: ${rules.title}, версия ${rules.version}`}
          </a>
          .
        </p>
      )}
    </article>
  );
}

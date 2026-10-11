import fs from "node:fs";
import path from "node:path";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { TempoEditor } from "@/components/TempoEditor";
import { figureTitle, listFigures } from "@/lib/figures";
import { routinePath } from "@/lib/paths";
import { getRoutine, listRoutines, ROUTINES_DIR } from "@/lib/routines";

type Props = { params: Promise<{ slug: string }> };

// Редактор длительностей — по странице на рутину каталога `data/routines/`.
export const dynamicParams = false;

export function generateStaticParams() {
  return listRoutines().map((routine) => ({ slug: routine.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const routine = getRoutine((await params).slug);
  return routine ? { title: `Длительности: ${routine.name}`, description: `Редактор длительностей шагов рутины «${routine.name}».` } : {};
}

const ORIGIN_TEXT = { own: "своя работа", link: "связка" } as const;

export default async function TempoPage({ params }: Props) {
  const { slug } = await params;
  const routine = getRoutine(slug);
  if (!routine) {
    notFound();
  }
  const fileName = `${slug}.json`;
  // Автору возвращается его же файл: редактор меняет в нём одни длительности.
  const file: unknown = JSON.parse(fs.readFileSync(path.join(ROUTINES_DIR, fileName), "utf8"));
  const figures = listFigures();
  const parts = routine.segments.map((segment, index) => {
    const figure = segment.origin === "figure" ? figures.find((item) => item.slug === segment.figure) : undefined;
    return `Часть ${index + 1}: ${segment.origin === "figure" ? `фигура ${figure ? figureTitle(figure) : segment.figure}` : ORIGIN_TEXT[segment.origin]}`;
  });
  return (
    <article>
      <nav className="crumbs" aria-label="Положение на сайте">
        <Link href="/">Все разделы</Link>
        {" / Рутины / "}
        <Link href={routinePath(slug)}>{routine.name}</Link>
      </nav>
      <h1>{`Длительности: ${routine.name}`}</h1>
      <p className="note">
        Темп рутины задаёт её автор: ни книга фигур, ни правила длительности шага не называют. Поэтому редактор чисел не
        предлагает — пустое поле остаётся пустым, и шаг с ним остаётся шагом, чей темп не задан. Длительность есть у всего,
        что занимает время: у пролёта, у остановки, у поворота на месте, у посадки. У старта и вызовов IN и OUT её нет.
      </p>
      <p className="note">
        Редактор ничего не сохраняет: сайт — статические файлы. Правки живут, пока открыта страница; внизу — текст файла
        рутины с ними, его сохраняет сам автор. Проверки под полями — подсказки по условиям правил, а не судейская оценка.
      </p>
      <noscript>
        <p className="te-nojs">
          Редактору нужен JavaScript: без него поля ввода не показаны. Сама рутина со схемами и шагами читается и без него —
          на <a href={routinePath(slug)}>её странице</a>.
        </p>
      </noscript>
      <TempoEditor routine={routine} file={file} fileName={fileName} parts={parts} />
    </article>
  );
}

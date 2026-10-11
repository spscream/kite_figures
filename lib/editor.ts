import fs from "node:fs";
import path from "node:path";

import { type Figure, figureTitle, listFigures } from "./figures";
import { getRoutine, type Routine, ROUTINES_DIR } from "./routines";

// Что страница редактора рутины отдаёт клиентскому коду. Собрано здесь, а не в
// шаблоне страницы, чтобы тест шёл тем же путём, что и страница: по этим
// данным редактор ставит элемент в рутину и читает её разбором.
export type EditorProps = {
  routine: Routine;
  // Разобранный JSON файла рутины: он возвращается автору с правками.
  file: unknown;
  fileName: string;
  // Заголовок каждой части рутины, по её номеру в файле.
  parts: string[];
  // Фигуры каталога, на которые рутина ссылается: без них разбор в браузере
  // ссылку не развернёт, а всего каталога там нет.
  figures: Figure[];
};

const ORIGIN_TEXT = { own: "своя работа", link: "связка" } as const;

export function editorProps(slug: string, dir: string = ROUTINES_DIR): EditorProps | undefined {
  const routine = getRoutine(slug, dir);
  if (!routine) {
    return undefined;
  }
  const fileName = `${slug}.json`;
  const used = new Set(routine.segments.flatMap((segment) => (segment.origin === "figure" ? [segment.figure] : [])));
  const figures = listFigures().filter((figure) => used.has(figure.slug));
  const parts = routine.segments.map((segment, index) => {
    const figure = segment.origin === "figure" ? figures.find((item) => item.slug === segment.figure) : undefined;
    return `Часть ${index + 1}: ${segment.origin === "figure" ? `фигура ${figure ? figureTitle(figure) : segment.figure}` : ORIGIN_TEXT[segment.origin]}`;
  });
  return { routine, file: JSON.parse(fs.readFileSync(path.join(dir, fileName), "utf8")), fileName, parts, figures };
}

import fs from "node:fs";
import path from "node:path";

import { type Figure, listFigures } from "./figures";
import { EXTENSION, parseRoutine, type Routine } from "./routine-format";

// Каталог рутин — файлы в `data/routines/`. Сам формат и его проверка — в
// `lib/routine-format.ts`: тот модуль с диска не читает и исполняется и в
// браузере; здесь — чтение каталога, и всё, что знало рутину по этому модулю,
// находит её здесь же.
export * from "./routine-format";

export const ROUTINES_DIR = path.join(process.cwd(), "data", "routines");

function fail(where: string, message: string): never {
  throw new Error(`${where}: ${message}`);
}

// Рутины каталога по имени файла. Каталога может не быть вовсе — чтению это
// не мешает, а сборку страниц пустой каталог роняет. Битый файл роняет чтение с именем файла — и тест
// каталога, и сборку: страницы рутин строятся по этому списку.
export function listRoutines(dir: string = ROUTINES_DIR, catalog?: Figure[]): Routine[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const figures = catalog ?? listFigures();
  const names: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.name.toLowerCase().endsWith(EXTENSION)) {
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(EXTENSION)) {
      fail(entry.name, `рутина — обычный файл с расширением «${EXTENSION}» строчными буквами`);
    }
    names.push(entry.name);
  }
  return names.sort().map((name) => parseRoutine(name, fs.readFileSync(path.join(dir, name), "utf8"), figures));
}

export function getRoutine(slug: string, dir: string = ROUTINES_DIR): Routine | undefined {
  return listRoutines(dir).find((routine) => routine.slug === slug);
}

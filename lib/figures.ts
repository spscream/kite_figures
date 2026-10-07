import fs from "node:fs";
import path from "node:path";

// Данные фигур — файлы в `data/figures/`, по одному на фигуру. Сайт читает
// каталог целиком при сборке: добавить фигуру значит положить файл, список
// фигур в коде не ведётся.
//
// Поля ниже — временный минимум каркаса, а не формат каталога: формат
// описывает задача, которая заводит настоящие фигуры, и она же меняет этот
// модуль под него.
export const FIGURES_DIR = path.join(process.cwd(), "data", "figures");

const EXTENSION = ".json";
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KEYS = new Set(["title", "summary", "fictional"]);

export type Figure = {
  // Имя файла без расширения; оно же адрес страницы `/figures/<slug>/`.
  slug: string;
  title: string;
  summary: string;
  // Вымышленная запись для проверки шаблона, не фигура из правил.
  fictional: boolean;
};

function parseFigure(file: string, text: string): Figure {
  const slug = path.basename(file, EXTENSION);
  if (!SLUG.test(slug)) {
    throw new Error(
      `${file}: имя файла становится адресом страницы и должно состоять из строчных латинских букв, цифр и дефисов`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file}: не JSON (${(error as Error).message})`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${file}: ожидается объект`);
  }
  const record = raw as Record<string, unknown>;
  // Незнакомый ключ — почти всегда опечатка в знакомом, и молча пропущенный
  // он меняет страницу: `fictonal` снял бы плашку с вымышленной записи.
  for (const key of Object.keys(record)) {
    if (!KEYS.has(key)) {
      throw new Error(`${file}: незнакомое поле «${key}»`);
    }
  }
  for (const key of ["title", "summary"] as const) {
    const value = record[key];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`${file}: поле «${key}» должно быть непустой строкой`);
    }
  }
  if (record.fictional !== undefined && typeof record.fictional !== "boolean") {
    throw new Error(`${file}: поле «fictional» должно быть true или false`);
  }
  return {
    slug,
    title: record.title as string,
    summary: record.summary as string,
    fictional: record.fictional === true,
  };
}

// Все фигуры каталога, по алфавиту адресов. Битый файл роняет сборку с именем
// файла: молча пропущенная фигура — это страница, которой нет на сайте.
export function listFigures(dir: string = FIGURES_DIR): Figure[] {
  const names: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.name.toLowerCase().endsWith(EXTENSION)) {
      continue;
    }
    // Выглядит как фигура, но ею не станет: подкаталог, симлинк, `.JSON`.
    if (!entry.isFile() || !entry.name.endsWith(EXTENSION)) {
      throw new Error(
        `${entry.name}: фигура — обычный файл с расширением «${EXTENSION}» строчными буквами`,
      );
    }
    names.push(entry.name);
  }
  return names
    .map((name) => parseFigure(name, fs.readFileSync(path.join(dir, name), "utf8")))
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

export function getFigure(slug: string, dir: string = FIGURES_DIR): Figure | undefined {
  return listFigures(dir).find((figure) => figure.slug === slug);
}

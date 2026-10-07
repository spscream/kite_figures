import fs from "node:fs";
import path from "node:path";

import disciplines from "./disciplines.json";
import { type Geometry, parseGeometry, parsePage } from "./geometry";
import { isDate, loadSources, type SourceDocument } from "./sources";

// Данные фигур — файлы в `data/figures/`, по одному на фигуру. Сайт читает
// каталог целиком при сборке: добавить фигуру значит положить файл, список
// фигур в коде не ведётся.
//
// Формат файла описан в `data/figures/README.md`; здесь — его проверка. Меняя
// одно, меняй другое: описание читают те, кто кладёт данные, а этот модуль —
// те, кто по ним рисует схемы и строит страницы.
export const FIGURES_DIR = path.join(process.cwd(), "data", "figures");

export const SCHEMA = 1;

const EXTENSION = ".json";
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KEYS = ["schema", "discipline", "number", "name", "level", "status", "source", "summary", "geometry"];
const SOURCE_KEYS = ["document", "version", "page", "read_on", "page_version"];

// Разделы книги фигур в её порядке; значение — префикс, которым книга нумерует
// фигуры раздела («DI 02»). Список один на весь репозиторий и лежит в
// `lib/disciplines.json`: его же читает `scripts/check-export.mjs`, а тест
// `lib/disciplines.test.ts` падает, когда в данных встречается раздел, которого
// в списке нет.
export const DISCIPLINES = disciplines;
export type Discipline = keyof typeof DISCIPLINES;

export const STATUSES = ["current", "obsolete"] as const;
export type Status = (typeof STATUSES)[number];

export type FigureSource = {
  // Документ из `data/sources.json`: его id и версия.
  document: string;
  version: string;
  page: number;
  // День, когда страница была прочитана и по ней записаны данные.
  read_on: string;
  // Дата редакции самой фигуры, как она напечатана в тексте её страницы.
  page_version?: string;
};

export type Figure = {
  // Имя файла без расширения; оно же адрес страницы `/figures/<slug>/`.
  slug: string;
  discipline: Discipline;
  number: number;
  // Обозначение фигуры в книге: префикс раздела и номер в две цифры.
  code: string;
  // Официальное название, как в книге, без перевода.
  name: string;
  // Уровень сложности, которым книга помечает многострочные фигуры.
  level?: string;
  status: Status;
  source: FigureSource;
  // Адрес официального документа, открытого на странице фигуры.
  sourceUrl: string;
  // Своя формулировка: что это за фигура. Не выдержка из правил.
  summary: string;
  geometry: Geometry;
};

export function figureCode(discipline: Discipline, number: number): string {
  return `${DISCIPLINES[discipline]} ${String(number).padStart(2, "0")}`;
}

export function figureTitle(figure: Pick<Figure, "code" | "name">): string {
  return `${figure.code} — ${figure.name}`;
}

// Адрес того же документа, открытого на другой странице: у варианта фигуры
// схема бывает на своей.
export function sourcePageUrl(figure: Pick<Figure, "sourceUrl">, page: number): string {
  return `${figure.sourceUrl.slice(0, figure.sourceUrl.lastIndexOf("#"))}#page=${page}`;
}

function text(file: string, key: string, value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${file}: поле «${key}» должно быть непустой строкой`);
  }
  return value;
}

function parseFigure(file: string, content: string, sources: SourceDocument[]): Figure {
  const slug = path.basename(file, EXTENSION);
  if (!SLUG.test(slug)) {
    throw new Error(
      `${file}: имя файла становится адресом страницы и должно состоять из строчных латинских букв, цифр и дефисов`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (error) {
    throw new Error(`${file}: не JSON (${(error as Error).message})`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${file}: ожидается объект`);
  }
  const record = raw as Record<string, unknown>;
  // Незнакомый ключ — почти всегда опечатка в знакомом, и молча пропущенный
  // он меняет страницу: `staus` оставил бы фигуру без статуса.
  for (const key of Object.keys(record)) {
    if (!KEYS.includes(key)) {
      throw new Error(`${file}: незнакомое поле «${key}»`);
    }
  }
  if (record.schema !== SCHEMA) {
    throw new Error(`${file}: поле «schema» должно быть равно ${SCHEMA}`);
  }
  if (typeof record.discipline !== "string" || !Object.hasOwn(DISCIPLINES, record.discipline)) {
    throw new Error(`${file}: поле «discipline» — одно из: ${Object.keys(DISCIPLINES).join(", ")}`);
  }
  const discipline = record.discipline as Discipline;
  const number = record.number;
  if (typeof number !== "number" || !Number.isInteger(number) || number < 1 || number > 99) {
    throw new Error(`${file}: поле «number» должно быть целым числом от 1 до 99`);
  }
  const code = figureCode(discipline, number);
  // Адрес страницы начинается с обозначения фигуры: по имени файла видно,
  // какая это фигура, и два файла на одну фигуру сразу заметны.
  const prefix = `${code.toLowerCase().replace(" ", "-")}-`;
  if (!slug.startsWith(prefix)) {
    throw new Error(`${file}: имя файла фигуры ${code} должно начинаться с «${prefix}»`);
  }
  if (typeof record.status !== "string" || !STATUSES.includes(record.status as Status)) {
    throw new Error(`${file}: поле «status» — одно из: ${STATUSES.join(", ")}`);
  }

  if (typeof record.source !== "object" || record.source === null || Array.isArray(record.source)) {
    throw new Error(`${file}: поле «source» должно быть объектом`);
  }
  const rawSource = record.source as Record<string, unknown>;
  for (const key of Object.keys(rawSource)) {
    if (!SOURCE_KEYS.includes(key)) {
      throw new Error(`${file}: незнакомое поле «source.${key}»`);
    }
  }
  const documentId = text(file, "source.document", rawSource.document);
  const version = text(file, "source.version", rawSource.version);
  const document = sources.find((item) => item.id === documentId && item.version === version);
  if (!document) {
    throw new Error(`${file}: документа ${documentId}@${version} нет в data/sources.json`);
  }
  const page = parsePage(`${file}: source.page`, rawSource.page, document.pages);
  if (!isDate(rawSource.read_on)) {
    throw new Error(`${file}: поле «source.read_on» должно быть датой ГГГГ-ММ-ДД`);
  }
  const source: FigureSource = { document: documentId, version, page, read_on: rawSource.read_on };
  if (rawSource.page_version !== undefined) {
    if (!isDate(rawSource.page_version)) {
      throw new Error(`${file}: поле «source.page_version» должно быть датой ГГГГ-ММ-ДД`);
    }
    source.page_version = rawSource.page_version;
  }

  const figure: Figure = {
    slug,
    discipline,
    number,
    code,
    name: text(file, "name", record.name),
    status: record.status as Status,
    source,
    sourceUrl: `${document.url}#page=${page}`,
    summary: text(file, "summary", record.summary),
    geometry: parseGeometry(`${file}: geometry`, record.geometry, document.pages),
  };
  if (record.level !== undefined) {
    figure.level = text(file, "level", record.level);
  }
  return figure;
}

const ORDER = Object.keys(DISCIPLINES);

// Все фигуры каталога: по разделам в порядке книги, внутри раздела по номеру.
// Битый файл роняет сборку с именем файла: молча пропущенная фигура — это
// страница, которой нет на сайте.
export function listFigures(
  dir: string = FIGURES_DIR,
  sources: SourceDocument[] = loadSources(),
): Figure[] {
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
  const figures = names
    .sort()
    .map((name) => parseFigure(name, fs.readFileSync(path.join(dir, name), "utf8"), sources));
  const byCode = new Map<string, string>();
  for (const figure of figures) {
    const other = byCode.get(figure.code);
    if (other !== undefined) {
      throw new Error(`${figure.slug}${EXTENSION}: фигура ${figure.code} уже описана в ${other}${EXTENSION}`);
    }
    byCode.set(figure.code, figure.slug);
  }
  return figures.sort(
    (a, b) => ORDER.indexOf(a.discipline) - ORDER.indexOf(b.discipline) || a.number - b.number,
  );
}

export function getFigure(slug: string, dir: string = FIGURES_DIR): Figure | undefined {
  return listFigures(dir).find((figure) => figure.slug === slug);
}

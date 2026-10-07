import fs from "node:fs";
import path from "node:path";

// Реестр первоисточников — `data/sources.json`. Фигура ссылается на документ
// парой «id + версия» и номером страницы; адрес, число страниц и дата проверки
// адреса лежат здесь один раз, а не в каждом файле фигуры.
export const SOURCES_FILE = path.join(process.cwd(), "data", "sources.json");

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEYS = ["id", "version", "title", "dated", "publisher", "url", "landing", "pages", "bytes", "sha256", "checked_on"];

export type SourceDocument = {
  id: string;
  version: string;
  title: string;
  // Дата редакции, как она стоит на титуле документа.
  dated: string;
  publisher: string;
  // Прямой адрес файла и страница сайта, с которой он выложен.
  url: string;
  landing: string;
  pages: number;
  // Размер и хеш файла на день проверки: по ним видно, что файл подменили.
  bytes: number;
  sha256: string;
  checked_on: string;
};

export function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function parseSources(file: string, text: string): SourceDocument[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file}: не JSON (${(error as Error).message})`);
  }
  const documents = (raw as { documents?: unknown } | null)?.documents;
  if (!Array.isArray(documents) || documents.length === 0) {
    throw new Error(`${file}: ожидается объект с непустым списком «documents»`);
  }
  for (const key of Object.keys(raw as object)) {
    if (key !== "documents") {
      throw new Error(`${file}: незнакомое поле «${key}»`);
    }
  }
  const seen = new Set<string>();
  return documents.map((item, index) => {
    const where = `${file}: documents[${index}]`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error(`${where}: ожидается объект`);
    }
    const value = item as Record<string, unknown>;
    for (const key of Object.keys(value)) {
      if (!KEYS.includes(key)) {
        throw new Error(`${where}: незнакомое поле «${key}»`);
      }
    }
    for (const key of ["id", "version", "title", "publisher"]) {
      if (typeof value[key] !== "string" || (value[key] as string).trim() === "") {
        throw new Error(`${where}: поле «${key}» должно быть непустой строкой`);
      }
    }
    for (const key of ["url", "landing"]) {
      // Без «#»: к адресу документа дописывается `#page=N`.
      if (typeof value[key] !== "string" || !/^https?:\/\/[^\s#]+$/.test(value[key] as string)) {
        throw new Error(`${where}: поле «${key}» должно быть адресом http(s) без «#»`);
      }
    }
    if (typeof value.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.sha256)) {
      throw new Error(`${where}: поле «sha256» — 64 шестнадцатеричные цифры строчными`);
    }
    for (const key of ["dated", "checked_on"]) {
      if (!isDate(value[key])) {
        throw new Error(`${where}: поле «${key}» должно быть датой ГГГГ-ММ-ДД`);
      }
    }
    for (const key of ["pages", "bytes"]) {
      if (!Number.isInteger(value[key]) || (value[key] as number) < 1) {
        throw new Error(`${where}: поле «${key}» должно быть целым числом не меньше 1`);
      }
    }
    const document = value as unknown as SourceDocument;
    const key = `${document.id}@${document.version}`;
    if (seen.has(key)) {
      throw new Error(`${where}: документ ${key} уже есть в реестре`);
    }
    seen.add(key);
    return document;
  });
}

export function loadSources(file: string = SOURCES_FILE): SourceDocument[] {
  return parseSources(path.basename(file), fs.readFileSync(file, "utf8"));
}

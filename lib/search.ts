import type { Figure } from "./figures";

// Поиск по каталогу. Сервера у сайта нет, поэтому ищет браузер — по индексу,
// который сборка кладёт отдельным файлом. В индексе только то, что нужно
// строке выдачи: адрес, обозначение, название и статус. Ни описаний, ни
// геометрии в нём нет.
//
// Модуль исполняется и при сборке, и в браузере: `node:fs` и всё, что читает
// каталог с диска, сюда не импортируется.
export const SEARCH_INDEX_PATH = "/search-index.json";

export type SearchEntry = {
  slug: string;
  // Обозначение фигуры в книге: «DI 02».
  code: string;
  name: string;
  // Есть только у фигур, выведенных из действующей редакции.
  obsolete?: true;
};

export function buildSearchIndex(figures: Figure[]): SearchEntry[] {
  return figures.map((figure) => {
    const entry: SearchEntry = { slug: figure.slug, code: figure.code, name: figure.name };
    if (figure.status === "obsolete") {
      entry.obsolete = true;
    }
    return entry;
  });
}

// Индекс приходит по сети, и под его адресом может оказаться что угодно:
// ответ другой страницы, обрезанный файл. Всё, что не список записей, —
// ошибка загрузки, а не данные.
export function parseSearchIndex(raw: unknown): SearchEntry[] {
  if (!Array.isArray(raw)) {
    throw new Error("индекс поиска — не список");
  }
  for (const entry of raw as unknown[]) {
    const fields = entry as Record<string, unknown> | null;
    if (
      typeof fields !== "object" ||
      fields === null ||
      typeof fields.slug !== "string" ||
      typeof fields.code !== "string" ||
      typeof fields.name !== "string"
    ) {
      throw new Error("в индексе поиска запись без адреса, обозначения или названия");
    }
  }
  return raw as SearchEntry[];
}

// Регистр и пунктуация при поиске не значат ничего: «Pick-up Sticks» находится
// по «pick up», «Launch, Circle, and Land 2P» — по «launch circle».
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

type Prepared = {
  name: string;
  // Название без пробелов: «Pick-up Sticks» ищут и как «pickup sticks».
  joined: string;
  // Написания обозначения: «di», «02», «2», затем целиком — «di02», «di2».
  keys: string[];
};

function prepare(entry: SearchEntry): Prepared {
  const [prefix = "", digits = ""] = normalize(entry.code).split(" ");
  const number = Number.parseInt(digits, 10);
  const bare = Number.isNaN(number) ? digits : String(number);
  const name = normalize(entry.name);
  return {
    name,
    joined: name.replaceAll(" ", ""),
    keys: [prefix, digits, bare, prefix + digits, prefix + bare],
  };
}

// Насколько хорошо запись отвечает запросу; чем меньше, тем выше в выдаче.
// `null` — не отвечает: подойти должно каждое слово запроса, началом одного из
// написаний обозначения либо куском названия.
//
// 0 — обозначение или название целиком;
// 1 — каждое слово запроса — часть обозначения целиком: «di», «02», «di 2»;
// 2 — каждое слово — начало части обозначения: «d», «di 1»;
// 3 — название начинается с запроса;
// 4 — слова запроса нашлись где-то в названии.
//
// Обозначение идёт раньше названия: набирая «di», ищут раздел DI, а не
// «Diamond» и «Pyramid».
function rank(item: Prepared, tokens: string[]): number | null {
  const wanted = tokens.join(" ");
  const compact = tokens.join("");
  const inCode = tokens.map((token) => item.keys.some((key) => key.startsWith(token)));
  const matches = tokens.every(
    (token, at) => inCode[at] || item.name.includes(token) || item.joined.includes(token),
  );
  if (!matches) {
    return null;
  }
  if (item.name === wanted || item.joined === compact || item.keys.slice(3).includes(compact)) {
    return 0;
  }
  if (tokens.every((token) => item.keys.includes(token))) {
    return 1;
  }
  if (inCode.every(Boolean)) {
    return 2;
  }
  return item.name.startsWith(wanted) || item.joined.startsWith(compact) ? 3 : 4;
}

// Фигуры, подходящие под запрос: лучшие попадания первыми, равные — в порядке
// каталога.
export function searchFigures(index: SearchEntry[], query: string): SearchEntry[] {
  const wanted = normalize(query);
  if (wanted === "") {
    return [];
  }
  const tokens = wanted.split(" ");
  const ranked: { entry: SearchEntry; rank: number; order: number }[] = [];
  index.forEach((entry, order) => {
    const found = rank(prepare(entry), tokens);
    if (found !== null) {
      ranked.push({ entry, rank: found, order });
    }
  });
  return ranked.sort((a, b) => a.rank - b.rank || a.order - b.order).map((item) => item.entry);
}

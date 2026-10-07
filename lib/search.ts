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

// Регистр и пунктуация при поиске не значат ничего: «Pick-up Sticks» находится
// по «pick up», «Launch, Circle, and Land 2P» — по «launch circle».
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

type Prepared = {
  entry: SearchEntry;
  name: string;
  number: number;
  // Написания обозначения: «di», «02», «2», «di02», «di2».
  keys: string[];
};

function prepare(entry: SearchEntry): Prepared {
  const [prefix = "", digits = ""] = normalize(entry.code).split(" ");
  const number = Number.parseInt(digits, 10);
  const bare = Number.isNaN(number) ? digits : String(number);
  return {
    entry,
    name: normalize(entry.name),
    number,
    keys: [prefix, digits, bare, prefix + digits, prefix + bare],
  };
}

// Фигуры, подходящие под запрос. Запрос делится на слова, и подойти должно
// каждое: началом одного из написаний обозначения либо куском названия.
// Сначала идут точные попадания — обозначение или название целиком, потом
// совпавший номер и названия, начинающиеся с запроса, остальное — в порядке
// каталога.
export function searchFigures(index: SearchEntry[], query: string): SearchEntry[] {
  const wanted = normalize(query);
  if (wanted === "") {
    return [];
  }
  const tokens = wanted.split(" ");
  const compact = tokens.join("");
  const ranked: { entry: SearchEntry; rank: number; order: number }[] = [];
  index.forEach((entry, order) => {
    const item = prepare(entry);
    const matches = tokens.every(
      (token) => item.name.includes(token) || item.keys.some((key) => key.startsWith(token)),
    );
    if (!matches) {
      return;
    }
    let rank = 2;
    if (item.name === wanted || item.keys.slice(3).includes(compact)) {
      rank = 0;
    } else if (
      item.name.startsWith(wanted) ||
      tokens.some((token) => /^\d+$/.test(token) && Number.parseInt(token, 10) === item.number)
    ) {
      rank = 1;
    }
    ranked.push({ entry, rank, order });
  });
  return ranked.sort((a, b) => a.rank - b.rank || a.order - b.order).map((item) => item.entry);
}

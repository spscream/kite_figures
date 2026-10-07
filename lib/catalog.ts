import { DISCIPLINES, type Discipline, type Figure, listFigures } from "./figures";

export { figurePath, sectionPath } from "./paths";

// Разделы каталога. Они выводятся из самих фигур: раздел есть, пока в
// `data/figures/` лежит хотя бы одна его фигура, и отдельного списка разделов
// для страниц нигде нет. Новая дисциплина в данных даёт и карточку на главной,
// и свою страницу без правок в страницах; завести её в формате — значит
// назвать её префикс в `DISCIPLINES`, без этого файл с ней не пройдёт проверку.
export type Section = {
  discipline: Discipline;
  // Префикс, которым книга нумерует фигуры раздела («DI»).
  prefix: string;
  title: string;
  // Все фигуры раздела по номеру, затем они же по статусу.
  figures: Figure[];
  current: Figure[];
  obsolete: Figure[];
};

// Название раздела, как его пишет книга: «Dual-line Individual». В формате
// данных его нет — есть только значение поля `discipline`, из него название и
// собирается.
export function sectionTitle(discipline: string): string {
  return discipline
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
    .replace(/^(\S+) Line\b/, "$1-line");
}

// Разделы в том порядке, в каком идут фигуры: `listFigures` отдаёт их по
// разделам книги и по номеру внутри раздела.
export function listSections(figures: Figure[] = listFigures()): Section[] {
  const sections = new Map<Discipline, Section>();
  for (const figure of figures) {
    let section = sections.get(figure.discipline);
    if (!section) {
      section = {
        discipline: figure.discipline,
        prefix: DISCIPLINES[figure.discipline],
        title: sectionTitle(figure.discipline),
        figures: [],
        current: [],
        obsolete: [],
      };
      sections.set(figure.discipline, section);
    }
    section.figures.push(figure);
    section[figure.status].push(figure);
  }
  return [...sections.values()];
}

export function getSection(discipline: string, figures?: Figure[]): Section | undefined {
  return listSections(figures).find((section) => section.discipline === discipline);
}

// Соседи фигуры в её разделе, по номеру. Статус не учитывается: выведенная
// фигура стоит в ряду на своём месте.
export function neighbours(
  section: Pick<Section, "figures">,
  slug: string,
): { previous?: Figure; next?: Figure } {
  const at = section.figures.findIndex((figure) => figure.slug === slug);
  if (at === -1) {
    return {};
  }
  return { previous: section.figures[at - 1], next: section.figures[at + 1] };
}

function plural(count: number, one: string, few: string, many: string): string {
  const tens = count % 100;
  const units = count % 10;
  if (units === 1 && tens !== 11) {
    return one;
  }
  if (units >= 2 && units <= 4 && (tens < 12 || tens > 14)) {
    return few;
  }
  return many;
}

export function countFigures(count: number): string {
  return `${count} ${plural(count, "фигура", "фигуры", "фигур")}`;
}

export function countObsolete(count: number): string {
  return `${count} ${plural(count, "выведена", "выведены", "выведены")} из действующей редакции`;
}

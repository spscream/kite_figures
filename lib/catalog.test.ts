import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  countFigures,
  countObsolete,
  figurePath,
  getSection,
  listSections,
  neighbours,
  sectionPath,
  sectionTitle,
} from "./catalog";
import { type Discipline, type Figure, FIGURES_DIR, listFigures, type Status } from "./figures";

function figure(discipline: Discipline, number: number, status: Status = "current"): Figure {
  return {
    slug: `${discipline}-${number}`,
    discipline,
    number,
    code: `X ${number}`,
    name: `Figure ${number}`,
    status,
    source: { document: "book", version: "1.0", page: 1, read_on: "2026-10-07" },
    sourceUrl: "https://example.org/book.pdf#page=1",
    summary: "Фигура.",
    geometry: { status: "not_found", reason: "нет" } as Figure["geometry"],
  };
}

describe("sectionTitle", () => {
  it("собирает название раздела из значения поля discipline", () => {
    expect(sectionTitle("dual-line-individual")).toBe("Dual-line Individual");
    expect(sectionTitle("multi-line-pair")).toBe("Multi-line Pair");
    expect(sectionTitle("multi-line-team")).toBe("Multi-line Team");
  });

  it("даёт название и разделу, которого в книге пока нет", () => {
    expect(sectionTitle("single-line-individual")).toBe("Single-line Individual");
    expect(sectionTitle("freestyle")).toBe("Freestyle");
  });
});

describe("listSections", () => {
  const figures = [
    figure("dual-line-individual", 2),
    figure("dual-line-individual", 5, "obsolete"),
    figure("dual-line-individual", 7),
    figure("multi-line-team", 1),
  ];

  it("группирует фигуры по разделам в порядке каталога", () => {
    const sections = listSections(figures);
    expect(sections.map((section) => section.discipline)).toEqual([
      "dual-line-individual",
      "multi-line-team",
    ]);
    expect(sections.map((section) => section.prefix)).toEqual(["DI", "MT"]);
    expect(sections[0].title).toBe("Dual-line Individual");
    expect(sections[0].figures.map((item) => item.number)).toEqual([2, 5, 7]);
  });

  it("делит раздел на действующие и выведенные фигуры", () => {
    const [section] = listSections(figures);
    expect(section.current.map((item) => item.number)).toEqual([2, 7]);
    expect(section.obsolete.map((item) => item.number)).toEqual([5]);
  });

  it("не заводит раздел, в котором нет фигур", () => {
    expect(listSections([])).toEqual([]);
    expect(getSection("dual-line-pair", figures)).toBeUndefined();
    expect(getSection("multi-line-team", figures)?.figures).toHaveLength(1);
  });
});

describe("neighbours", () => {
  const [section] = listSections([
    figure("dual-line-individual", 2),
    figure("dual-line-individual", 5, "obsolete"),
    figure("dual-line-individual", 7),
  ]);

  it("отдаёт соседей по номеру, не пропуская выведенную фигуру", () => {
    const { previous, next } = neighbours(section, "dual-line-individual-2");
    expect(previous).toBeUndefined();
    expect(next?.number).toBe(5);
    expect(neighbours(section, "dual-line-individual-5").previous?.number).toBe(2);
    expect(neighbours(section, "dual-line-individual-5").next?.number).toBe(7);
    expect(neighbours(section, "dual-line-individual-7").next).toBeUndefined();
  });

  it("у фигуры не из этого раздела соседей нет", () => {
    expect(neighbours(section, "multi-line-team-1")).toEqual({});
  });
});

describe("счёт фигур словами", () => {
  it("склоняет «фигура» по числу", () => {
    expect([1, 2, 3, 4, 5, 11, 12, 13, 14, 15, 21, 22, 24, 25, 30, 111, 112, 114].map(countFigures)).toEqual([
      "1 фигура",
      "2 фигуры",
      "3 фигуры",
      "4 фигуры",
      "5 фигур",
      "11 фигур",
      "12 фигур",
      "13 фигур",
      "14 фигур",
      "15 фигур",
      "21 фигура",
      "22 фигуры",
      "24 фигуры",
      "25 фигур",
      "30 фигур",
      "111 фигур",
      "112 фигур",
      "114 фигур",
    ]);
  });

  it("склоняет «выведена» по числу", () => {
    expect(countObsolete(1)).toBe("1 выведена из действующей редакции");
    expect(countObsolete(2)).toBe("2 выведены из действующей редакции");
    expect(countObsolete(11)).toBe("11 выведены из действующей редакции");
  });
});

describe("разделы каталога в data/figures/", () => {
  // Сверка идёт с самими файлами данных, а не с тем, что из них вычитал
  // `listFigures`.
  const raw = fs
    .readdirSync(FIGURES_DIR)
    .filter((name) => name.endsWith(".json"))
    .map(
      (name) =>
        JSON.parse(fs.readFileSync(path.join(FIGURES_DIR, name), "utf8")) as {
          discipline: string;
          status: string;
        },
    );
  const sections = listSections(listFigures());

  it("на каждую дисциплину в данных приходится ровно один раздел", () => {
    const disciplines = [...new Set(raw.map((item) => item.discipline))].sort();
    expect(sections.map((section) => section.discipline).sort()).toEqual(disciplines);
  });

  it("в разделе столько фигур, сколько файлов с его дисциплиной", () => {
    for (const section of sections) {
      const own = raw.filter((item) => item.discipline === section.discipline);
      expect([section.discipline, section.figures.length]).toEqual([section.discipline, own.length]);
      expect([section.discipline, section.obsolete.length]).toEqual([
        section.discipline,
        own.filter((item) => item.status === "obsolete").length,
      ]);
      expect(section.current.length + section.obsolete.length).toBe(section.figures.length);
    }
    expect(sections.reduce((sum, section) => sum + section.figures.length, 0)).toBe(raw.length);
  });

  it("у разделов разные адреса", () => {
    const paths = sections.map((section) => sectionPath(section.discipline));
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("префикс раздела — тот, которым обозначены его фигуры", () => {
    for (const section of sections) {
      for (const item of section.figures) {
        expect([item.slug, item.code.split(" ")[0]]).toEqual([item.slug, section.prefix]);
      }
    }
  });
});

describe("адреса страниц", () => {
  it("раздел живёт в /disciplines/, фигура — в /figures/", () => {
    expect(sectionPath("dual-line-team")).toBe("/disciplines/dual-line-team/");
    expect(figurePath("di-02-circle")).toBe("/figures/di-02-circle/");
  });
});

import { describe, expect, it } from "vitest";

import { listFigures } from "./figures";
import { buildSearchIndex, type SearchEntry, searchFigures } from "./search";

const INDEX: SearchEntry[] = [
  { slug: "di-02-circle", code: "DI 02", name: "Circle" },
  { slug: "di-12-stops", code: "DI 12", name: "Stops" },
  { slug: "di-19-launch-circle-and-land-2p", code: "DI 19", name: "Launch, Circle, and Land 2P" },
  { slug: "di-20-boomerang", code: "DI 20", name: "Boomerang" },
  { slug: "dp-07-h", code: "DP 07", name: "H" },
  { slug: "dt-02-pick-up-sticks", code: "DT 02", name: "Pick-up Sticks" },
  { slug: "dt-15-solaris", code: "DT 15", name: "Solaris", obsolete: true },
  { slug: "mi-34-circle", code: "MI 34", name: "Circle" },
];

function slugs(query: string): string[] {
  return searchFigures(INDEX, query).map((entry) => entry.slug);
}

describe("searchFigures", () => {
  it("на пустой запрос не отдаёт ничего", () => {
    expect(slugs("")).toEqual([]);
    expect(slugs("  , ")).toEqual([]);
  });

  it("находит по названию без учёта регистра", () => {
    expect(slugs("boomerang")).toEqual(["di-20-boomerang"]);
    expect(slugs("BOOM")).toEqual(["di-20-boomerang"]);
  });

  it("находит по куску названия и ставит точное название первым", () => {
    expect(slugs("circle")).toEqual([
      "di-02-circle",
      "mi-34-circle",
      "di-19-launch-circle-and-land-2p",
    ]);
  });

  it("не спотыкается о пунктуацию в названии и в запросе", () => {
    expect(slugs("pick up")).toEqual(["dt-02-pick-up-sticks"]);
    expect(slugs("pick-up sticks")).toEqual(["dt-02-pick-up-sticks"]);
    expect(slugs("launch circle land")).toEqual(["di-19-launch-circle-and-land-2p"]);
  });

  it("находит по обозначению в любом написании", () => {
    for (const query of ["DI 02", "di 02", "di02", "DI-02", "di 2", "di2"]) {
      expect([query, slugs(query)[0]]).toEqual([query, "di-02-circle"]);
    }
    expect(slugs("DI 02")).toEqual(["di-02-circle"]);
  });

  it("находит по номеру: сначала точный, потом начинающиеся с него", () => {
    expect(slugs("02")).toEqual(["di-02-circle", "dt-02-pick-up-sticks"]);
    expect(slugs("2")).toEqual([
      "di-02-circle",
      "dt-02-pick-up-sticks",
      "di-19-launch-circle-and-land-2p",
      "di-20-boomerang",
    ]);
    expect(slugs("15")).toEqual(["dt-15-solaris"]);
  });

  it("находит по префиксу раздела", () => {
    expect(slugs("dt")).toEqual(["dt-02-pick-up-sticks", "dt-15-solaris"]);
  });

  it("однобуквенное название находится и стоит первым", () => {
    expect(slugs("h")[0]).toBe("dp-07-h");
  });

  it("требует совпадения каждого слова запроса", () => {
    expect(slugs("mi circle")).toEqual(["mi-34-circle"]);
    expect(slugs("circle 99")).toEqual([]);
  });
});

describe("индекс поиска по каталогу", () => {
  const figures = listFigures();
  const index = buildSearchIndex(figures);

  it("несёт запись на каждую фигуру и ничего, кроме строки выдачи", () => {
    expect(index.map((entry) => entry.slug)).toEqual(figures.map((figure) => figure.slug));
    const allowed = ["slug", "code", "name", "obsolete"];
    for (const entry of index) {
      expect(Object.keys(entry).filter((key) => !allowed.includes(key))).toEqual([]);
    }
  });

  it("помечает выведенные фигуры, и только их", () => {
    expect(index.filter((entry) => entry.obsolete).map((entry) => entry.slug)).toEqual(
      figures.filter((figure) => figure.status === "obsolete").map((figure) => figure.slug),
    );
  });

  it("каждая фигура каталога первой находится по своему обозначению", () => {
    for (const figure of figures) {
      const compact = figure.code.replace(" ", "").toLowerCase();
      expect([figure.code, searchFigures(index, figure.code)[0]?.slug]).toEqual([figure.code, figure.slug]);
      expect([compact, searchFigures(index, compact)[0]?.slug]).toEqual([compact, figure.slug]);
    }
  });

  it("каждая фигура каталога находится по своему названию", () => {
    for (const figure of figures) {
      const found = searchFigures(index, figure.name);
      expect([figure.slug, found.map((entry) => entry.slug).includes(figure.slug)]).toEqual([
        figure.slug,
        true,
      ]);
      // Первой идёт фигура с этим названием целиком — эта или её тёзка из
      // другого раздела.
      expect([figure.slug, found[0]?.name]).toEqual([figure.slug, figure.name]);
    }
  });
});

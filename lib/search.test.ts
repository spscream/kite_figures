import { describe, expect, it } from "vitest";

import { listFigures } from "./figures";
import { buildSearchIndex, parseSearchIndex, type SearchEntry, searchFigures } from "./search";

const INDEX: SearchEntry[] = [
  { slug: "di-02-circle", code: "DI 02", name: "Circle" },
  { slug: "di-12-stops", code: "DI 12", name: "Stops" },
  { slug: "di-19-launch-circle-and-land-2p", code: "DI 19", name: "Launch, Circle, and Land 2P" },
  { slug: "di-20-boomerang", code: "DI 20", name: "Boomerang" },
  { slug: "dp-07-h", code: "DP 07", name: "H" },
  { slug: "dp-12-pair-stops", code: "DP 12", name: "Pair Stops" },
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
      "di-20-boomerang",
      "di-19-launch-circle-and-land-2p",
    ]);
    expect(slugs("15")).toEqual(["dt-15-solaris"]);
  });

  it("находит по префиксу раздела", () => {
    expect(slugs("dt")).toEqual(["dt-02-pick-up-sticks", "dt-15-solaris"]);
  });

  it("ставит раздел выше названий, в которых нашлись те же буквы", () => {
    // «dp» — раздел DP; в «Pick-up Sticks» те же буквы стоят в середине слова.
    const index: SearchEntry[] = [
      { slug: "di-08-pyramid", code: "DI 08", name: "Pyramid" },
      { slug: "mi-02-ladder-up", code: "MI 02", name: "Ladder Up" },
      { slug: "mi-21-diamond", code: "MI 21", name: "Diamond" },
      { slug: "mi-22-the-felix", code: "MI 22", name: "The Felix" },
    ];
    const found = (query: string) => searchFigures(index, query).map((entry) => entry.slug);
    expect(found("mi")).toEqual(["mi-02-ladder-up", "mi-21-diamond", "mi-22-the-felix", "di-08-pyramid"]);
    expect(found("di")).toEqual(["di-08-pyramid", "mi-21-diamond"]);
    expect(found("d")).toEqual(["di-08-pyramid", "mi-21-diamond", "mi-02-ladder-up"]);
  });

  it("название, начинающееся с запроса, стоит выше названия, где запрос в середине", () => {
    expect(slugs("stop")).toEqual(["di-12-stops", "dp-12-pair-stops"]);
    expect(slugs("12 stops")).toEqual(["di-12-stops", "dp-12-pair-stops"]);
  });

  it("находит название с дефисом и в слитном написании", () => {
    expect(slugs("pickup sticks")).toEqual(["dt-02-pick-up-sticks"]);
    expect(slugs("pickup")).toEqual(["dt-02-pick-up-sticks"]);
    expect(slugs("pickupsticks")).toEqual(["dt-02-pick-up-sticks"]);
  });

  it("однобуквенное название находится и стоит первым", () => {
    expect(slugs("h")[0]).toBe("dp-07-h");
  });

  it("требует совпадения каждого слова запроса", () => {
    expect(slugs("mi circle")).toEqual(["mi-34-circle"]);
    expect(slugs("circle 99")).toEqual([]);
  });
});

describe("parseSearchIndex", () => {
  it("пропускает список записей", () => {
    expect(parseSearchIndex(INDEX)).toBe(INDEX);
    expect(parseSearchIndex([])).toEqual([]);
  });

  it("отвергает всё, что не список записей", () => {
    for (const raw of [{ error: "x" }, null, "text", 5, [null], ["x"], [{ slug: "a", code: "A 01" }], [{ slug: 1, code: "A 01", name: "A" }]]) {
      expect(() => parseSearchIndex(raw), JSON.stringify(raw)).toThrow(/индекс/);
    }
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

  it("по префиксу раздела первыми идут все его фигуры, по номеру", () => {
    for (const prefix of new Set(figures.map((figure) => figure.code.split(" ")[0]))) {
      const own = figures.filter((figure) => figure.code.startsWith(`${prefix} `));
      expect([prefix, searchFigures(index, prefix).slice(0, own.length).map((entry) => entry.slug)]).toEqual([
        prefix,
        own.map((figure) => figure.slug),
      ]);
    }
  });

  it("каждая фигура каталога находится по названию без пунктуации и пробелов", () => {
    for (const figure of figures) {
      const joined = figure.name.replace(/[^A-Za-z0-9]/g, "");
      expect([joined, searchFigures(index, joined)[0]?.name]).toEqual([joined, figure.name]);
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

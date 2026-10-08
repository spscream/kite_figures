import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FIGURES_DIR, figureTitle, getFigure, listFigures } from "./figures";
import { loadSources, type SourceDocument } from "./sources";

let dir: string;

const SOURCES: SourceDocument[] = [
  {
    id: "book",
    version: "1.0",
    title: "Книга",
    dated: "2020-01-01",
    publisher: "Издатель",
    url: "https://example.org/book.pdf",
    landing: "https://example.org/",
    pages: 125,
    bytes: 1,
    sha256: "00",
    checked_on: "2026-10-07",
  },
];

// Полная запись фигуры; тест портит в ней ровно одно место.
function figure(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 2,
    discipline: "dual-line-individual",
    number: 2,
    name: "Circle",
    status: "current",
    source: { document: "book", version: "1.0", page: 16, read_on: "2026-10-07" },
    summary: "Круг в центре окна.",
    geometry: {
      status: "ok",
      variants: [
        {
          id: "main",
          kites: [
            {
              id: "1",
              path: [
                { kind: "start", at: [-10, 50] },
                { kind: "mark", mark: "in" },
                { kind: "line", to: [10, 50] },
                { kind: "mark", mark: "out" },
              ],
            },
          ],
          grid: { x: [0], y: [50] },
          guides: { status: "not_found", reason: "на схеме их нет" },
        },
      ],
    },
    ...over,
  };
}

function without(key: string): Record<string, unknown> {
  const record = figure();
  delete record[key];
  return record;
}

function source(over: Record<string, unknown>): Record<string, unknown> {
  return figure({ source: { ...(figure().source as object), ...over } });
}

function put(name: string, content: unknown) {
  const text = typeof content === "string" ? content : JSON.stringify(content);
  fs.writeFileSync(path.join(dir, name), text);
}

const list = () => listFigures(dir, SOURCES);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "figures-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("listFigures", () => {
  it("читает фигуру и достраивает обозначение, заголовок и адрес первоисточника", () => {
    put("di-02-circle.json", figure());
    const [read] = list();
    expect(read).toMatchObject({
      slug: "di-02-circle",
      code: "DI 02",
      name: "Circle",
      status: "current",
      sourceUrl: "https://example.org/book.pdf#page=16",
    });
    expect(figureTitle(read)).toBe("DI 02 — Circle");
  });

  it("порядок — разделы как в книге, внутри раздела по номеру", () => {
    put("mi-03-b.json", figure({ discipline: "multi-line-individual", number: 3 }));
    put("di-11-a.json", figure({ number: 11 }));
    put("di-02-z.json", figure());
    put("dp-01-c.json", figure({ discipline: "dual-line-pair", number: 1 }));
    expect(list().map((item) => item.code)).toEqual(["DI 02", "DI 11", "DP 01", "MI 03"]);
  });

  it("новый файл в каталоге становится фигурой без правки кода", () => {
    put("di-02-one.json", figure());
    expect(list().map((item) => item.slug)).toEqual(["di-02-one"]);
    put("di-03-two.json", figure({ number: 3 }));
    expect(list().map((item) => item.slug)).toEqual(["di-02-one", "di-03-two"]);
  });

  it("пустой каталог — пустой список", () => {
    expect(list()).toEqual([]);
  });

  it("не считает фигурами подкаталоги и файлы других типов", () => {
    put("di-02-real.json", figure());
    put("README.md", "# заметки");
    fs.mkdirSync(path.join(dir, "nested"));
    expect(list().map((item) => item.slug)).toEqual(["di-02-real"]);
  });

  it("отвергает то, что выглядит как фигура, но страницей не станет", () => {
    put("di-02-real.json", figure());
    fs.mkdirSync(path.join(dir, "nested.json"));
    expect(list).toThrow(/nested\.json: фигура — обычный файл/);
    fs.rmdirSync(path.join(dir, "nested.json"));
    fs.symlinkSync(path.join(dir, "di-02-real.json"), path.join(dir, "linked.json"));
    expect(list).toThrow(/linked\.json: фигура — обычный файл/);
    fs.unlinkSync(path.join(dir, "linked.json"));
    put("upper.JSON", figure());
    expect(list).toThrow(/upper\.JSON: фигура — обычный файл/);
  });

  it("битый файл роняет обход и называет файл", () => {
    put("di-02-good.json", figure());
    put("broken.json", "{ не json");
    expect(list).toThrow(/broken\.json: не JSON/);
  });

  it.each(["schema", "discipline", "number", "name", "status", "source", "summary", "geometry"])(
    "отвергает фигуру без обязательного поля «%s»",
    (key) => {
      put("di-02-circle.json", without(key));
      expect(list).toThrow(new RegExp(`di-02-circle\\.json: .*${key}`));
    },
  );

  it.each(["document", "version", "page", "read_on"])(
    "отвергает фигуру без обязательного поля «source.%s»",
    (key) => {
      const record = figure();
      delete (record.source as Record<string, unknown>)[key];
      put("di-02-circle.json", record);
      expect(list).toThrow(new RegExp(`di-02-circle\\.json: .*source\\.${key}`));
    },
  );

  it.each([0, 126, -1, 16.5, "16", null])("отвергает страницу %s — вне 1..125 или не целую", (page) => {
    put("di-02-circle.json", source({ page }));
    expect(list).toThrow(/source\.page: страница должна быть целым числом от 1 до 125/);
  });

  it.each([1, 16, 125])("принимает страницу %s", (page) => {
    put("di-02-circle.json", source({ page }));
    expect(list()[0].source.page).toBe(page);
  });

  it.each([
    ["schema", figure({ schema: 1 }), /поле «schema» должно быть равно 2/],
    ["discipline", figure({ discipline: "kiteboarding" }), /поле «discipline» — одно из/],
    ["discipline из прототипа", figure({ discipline: "toString" }), /поле «discipline» — одно из/],
    ["number", figure({ number: 0 }), /поле «number»/],
    ["number больше 99", figure({ number: 100 }), /поле «number»/],
    ["дробный number", figure({ number: 2.5 }), /поле «number»/],
    ["name", figure({ name: "  " }), /поле «name»/],
    ["status", figure({ status: "retired" }), /поле «status» — одно из: current, obsolete/],
    ["summary", figure({ summary: "" }), /поле «summary»/],
    ["level", figure({ level: 3 }), /поле «level»/],
    ["список", [], /ожидается объект/],
    ["опечатка в поле", figure({ staus: "current" }), /незнакомое поле «staus»/],
    ["опечатка в source", source({ pge: 3 }), /незнакомое поле «source\.pge»/],
    ["read_on", source({ read_on: "07.10.2026" }), /source\.read_on» должно быть датой/],
    ["несуществующая дата", source({ read_on: "2026-02-30" }), /source\.read_on» должно быть датой/],
    ["page_version", source({ page_version: "2005" }), /source\.page_version» должно быть датой/],
    ["документ вне реестра", source({ document: "other" }), /документа other@1\.0 нет в data\/sources\.json/],
    ["версия вне реестра", source({ version: "2.0" }), /документа book@2\.0 нет в data\/sources\.json/],
    ["геометрия без статуса", figure({ geometry: {} }), /geometry\.status/],
    ["not_found без причины", figure({ geometry: { status: "not_found" } }), /geometry\.reason/],
  ])("отвергает неверное: %s", (_label, content, message) => {
    put("di-02-circle.json", content);
    expect(list).toThrow(message);
  });

  it("принимает фигуру без геометрии, если названо, чего не хватило", () => {
    put("di-02-circle.json", figure({ geometry: { status: "not_found", reason: "нет подписей сетки" } }));
    expect(list()[0].geometry).toEqual({ status: "not_found", reason: "нет подписей сетки" });
  });

  it.each(["Upper.json", "with space.json", "кириллица.json", "-edge.json", "a--b.json"])(
    "отвергает имя файла %s, непригодное как адрес",
    (name) => {
      put(name, figure());
      expect(list).toThrow(/имя файла становится адресом/);
    },
  );

  it("имя файла начинается с обозначения фигуры", () => {
    put("circle.json", figure());
    expect(list).toThrow(/имя файла фигуры DI 02 должно начинаться с «di-02-»/);
  });

  it("одна фигура — один файл", () => {
    put("di-02-circle.json", figure());
    put("di-02-round.json", figure());
    expect(list).toThrow(/di-02-round\.json: фигура DI 02 уже описана в di-02-circle\.json/);
  });
});

describe("getFigure", () => {
  it("отдаёт undefined для адреса, которого нет в каталоге", () => {
    expect(getFigure("unknown")).toBeUndefined();
  });
});

// Проверка самих данных репозитория: то, что лежит в `data/figures/`, читается
// тем же кодом, которым их читает сборка, и сверено с реестром источников.
describe("каталог репозитория", () => {
  // Чтение — внутри тестов, а не в теле describe: битый файл данных должен
  // ронять названный тест, а не сбор всего файла.
  const read = () => listFigures(FIGURES_DIR);
  const [book, earlier] = loadSources();

  it("читается без ошибок: у каждой фигуры все обязательные поля, страницы в пределах документа", () => {
    expect(read().length).toBeGreaterThan(0);
  });

  it("реестр источников называет книгу фигур версии 3.0 на 125 страниц", () => {
    expect(book).toMatchObject({ id: "iskcb", version: "3.0", pages: 125, dated: "2017-04-01" });
  });

  it("вторым в реестре стоит прежняя редакция — версия 2.2.1 на 108 страниц", () => {
    expect(loadSources()).toHaveLength(2);
    expect(earlier).toMatchObject({ id: "iskcb", version: "2.2.1", pages: 108, dated: "2011-12-05" });
  });

  // Версия 3.0 главная: прежняя редакция годится только там, где у версии 3.0
  // схемы нет, то есть у фигур, которые она вывела из обязательных.
  it("с прежней редакции сняты только выведенные фигуры, и у каждой из них есть схема", () => {
    const fromEarlier = read().filter((item) => item.source.version !== book.version);
    expect(fromEarlier.map((item) => item.slug)).toEqual([
      "dt-14-have-fun",
      "dt-15-solaris",
      "mi-18-roman-ten",
      "mp-05-sticky-wicket",
    ]);
    for (const item of fromEarlier) {
      expect(item.status, item.slug).toBe("obsolete");
      expect(item.geometry.status, item.slug).toBe("ok");
    }
    expect(read().filter((item) => item.status === "current").map((item) => item.source.version)).not.toContain("2.2.1");
  });

  it("раздел Dual-line Individual — шестнадцать фигур книги версии 3.0", () => {
    const section = read().filter((item) => item.discipline === "dual-line-individual");
    expect(section.map((item) => item.number)).toEqual([2, 3, 5, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(section.map((item) => item.source.page)).toEqual(section.map((_, index) => 16 + index));
  });

  it("у каждой фигуры все обязательные сведения на месте", () => {
    for (const item of read()) {
      expect(item.name.trim(), item.slug).not.toBe("");
      expect(["current", "obsolete"], item.slug).toContain(item.status);
      const document = [book, earlier].find((source) => source.version === item.source.version);
      expect(document, item.slug).toBeDefined();
      expect(item.source.page, item.slug).toBeGreaterThanOrEqual(1);
      expect(item.source.page, item.slug).toBeLessThanOrEqual(document!.pages);
      expect(item.source.read_on, item.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(item.sourceUrl, item.slug).toBe(`${document!.url}#page=${item.source.page}`);
      expect(item.summary.trim(), item.slug).not.toBe("");
      if (item.geometry.status === "ok") {
        expect(item.geometry.variants.length, item.slug).toBeGreaterThan(0);
      } else {
        expect(item.geometry.reason.trim(), item.slug).not.toBe("");
      }
    }
  });
});

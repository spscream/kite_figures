import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FIGURES_DIR, getFigure, listFigures } from "./figures";

let dir: string;

function put(name: string, content: unknown) {
  const text = typeof content === "string" ? content : JSON.stringify(content);
  fs.writeFileSync(path.join(dir, name), text);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "figures-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("listFigures", () => {
  it("обходит каталог: каждая фигура — свой файл, порядок по адресу", () => {
    put("b-second.json", { title: "Вторая", summary: "два" });
    put("a-first.json", { title: "Первая", summary: "один", fictional: true });
    expect(listFigures(dir)).toEqual([
      { slug: "a-first", title: "Первая", summary: "один", fictional: true },
      { slug: "b-second", title: "Вторая", summary: "два", fictional: false },
    ]);
  });

  it("новый файл в каталоге становится фигурой без правки кода", () => {
    put("one.json", { title: "Одна", summary: "текст" });
    expect(listFigures(dir).map((figure) => figure.slug)).toEqual(["one"]);
    put("two.json", { title: "Две", summary: "текст" });
    expect(listFigures(dir).map((figure) => figure.slug)).toEqual(["one", "two"]);
  });

  it("пустой каталог — пустой список", () => {
    expect(listFigures(dir)).toEqual([]);
  });

  it("порядок — по адресу, а не по имени файла с расширением", () => {
    put("circle-over-square.json", { title: "Длинная", summary: "текст" });
    put("circle.json", { title: "Короткая", summary: "текст" });
    expect(listFigures(dir).map((figure) => figure.slug)).toEqual([
      "circle",
      "circle-over-square",
    ]);
  });

  it("не считает фигурами подкаталоги и файлы других типов", () => {
    put("real.json", { title: "Настоящая", summary: "текст" });
    put("README.md", "# заметки");
    fs.mkdirSync(path.join(dir, "nested"));
    expect(listFigures(dir).map((figure) => figure.slug)).toEqual(["real"]);
  });

  it("отвергает то, что выглядит как фигура, но страницей не станет", () => {
    put("real.json", { title: "Настоящая", summary: "текст" });
    fs.mkdirSync(path.join(dir, "nested.json"));
    expect(() => listFigures(dir)).toThrow(/nested\.json: фигура — обычный файл/);
    fs.rmdirSync(path.join(dir, "nested.json"));
    fs.symlinkSync(path.join(dir, "real.json"), path.join(dir, "linked.json"));
    expect(() => listFigures(dir)).toThrow(/linked\.json: фигура — обычный файл/);
    fs.unlinkSync(path.join(dir, "linked.json"));
    put("upper.JSON", { title: "Имя", summary: "текст" });
    expect(() => listFigures(dir)).toThrow(/upper\.JSON: фигура — обычный файл/);
  });

  it("битый файл роняет обход и называет файл", () => {
    put("good.json", { title: "Хорошая", summary: "текст" });
    put("broken.json", "{ не json");
    expect(() => listFigures(dir)).toThrow(/broken\.json: не JSON/);
  });

  it.each([
    ["no-title.json", { summary: "текст" }, /no-title\.json: поле «title»/],
    ["blank-title.json", { title: "  ", summary: "текст" }, /поле «title»/],
    ["no-summary.json", { title: "Имя" }, /поле «summary»/],
    ["list.json", [], /list\.json: ожидается объект/],
    ["flag.json", { title: "Имя", summary: "текст", fictional: "да" }, /поле «fictional»/],
    ["typo.json", { title: "Имя", summary: "текст", fictonal: true }, /незнакомое поле «fictonal»/],
  ])("отвергает %s", (name, content, message) => {
    put(name, content);
    expect(() => listFigures(dir)).toThrow(message);
  });

  it.each(["Upper.json", "with space.json", "кириллица.json", "-edge.json", "a--b.json"])(
    "отвергает имя файла %s, непригодное как адрес",
    (name) => {
      put(name, { title: "Имя", summary: "текст" });
      expect(() => listFigures(dir)).toThrow(/имя файла становится адресом/);
    },
  );
});

describe("getFigure", () => {
  it("находит фигуру по адресу и отдаёт undefined для неизвестного", () => {
    put("known.json", { title: "Известная", summary: "текст" });
    expect(getFigure("known", dir)?.title).toBe("Известная");
    expect(getFigure("unknown", dir)).toBeUndefined();
  });
});

describe("каталог репозитория", () => {
  it("читается без ошибок и не пуст — иначе у сайта нет ни одной страницы фигуры", () => {
    expect(listFigures(FIGURES_DIR).length).toBeGreaterThan(0);
  });
});

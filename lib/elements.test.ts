import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { elementBy, type ElementId, ELEMENT_IDS, elementOf, ELEMENTS, expand, fieldsOf, OUTSIDE, readValues, type Values } from "./elements";
import { listFigures } from "./figures";
import { type OwnStep, parseOwnStep, type Point, type Pose } from "./geometry";

// Строки таблицы разбора под заголовком `heading`: ячейки как записаны.
function docTable(heading: string): string[][] {
  const doc = fs.readFileSync(path.join(process.cwd(), "docs", "routine-elements.md"), "utf8");
  const from = doc.indexOf(`### ${heading}\n`);
  expect(from, `в разборе нет раздела «${heading}»`).toBeGreaterThan(-1);
  const rows = doc
    .slice(from)
    .split("\n")
    .slice(1)
    .filter((line, index, lines) => line.startsWith("|") && lines.slice(0, index).every((other) => other.startsWith("|") || other.trim() === ""));
  return rows.slice(2).map((row) =>
    row
      .slice(1, -1)
      .split("|")
      .map((item) => item.trim()),
  );
}

// Кайт стоит в середине окна носом вверх; у взлёта и посадки — на земле.
const AT: Point = [0, 50];
const GROUND: Point = [0, 0];
const UP: Pose = { position: AT, heading: [0, 1] };

// По набору параметров на каждый элемент — и не по одному.
const SAMPLES: Record<ElementId, { values: Values; from?: Point }[]> = {
  forward: [{ values: { x: 30, y: 50 } }, { values: { x: 0, y: 80 } }, { values: { x: -40, y: 20 } }],
  backward: [{ values: { x: 30, y: 50 } }, { values: { x: 0, y: 10 } }, { values: { x: 25, y: 75 } }],
  "slide-horizontal": [{ values: { x: 40 } }, { values: { x: -40 } }],
  "slide-vertical": [{ values: { y: 80, nose: "90" } }, { values: { y: 80, nose: "270" } }, { values: { y: 10, nose: "270" } }],
  "slide-inverted": [{ values: { x: 40 } }, { values: { x: -40 } }],
  diagonal: [{ values: { x: 30, y: 80, nose: 0 } }, { values: { x: -30, y: 20, nose: 90 } }, { values: { x: 30, y: 80, nose: 200 } }],
  arc: [
    { values: { cx: 20, cy: 50, direction: "cw", sweep: 180, nose: "forward" } },
    { values: { cx: 20, cy: 50, direction: "ccw", sweep: 90, nose: "backward" } },
    { values: { cx: 0, cy: 70, direction: "cw", sweep: 360, nose: "in" } },
    { values: { cx: 0, cy: 70, direction: "ccw", sweep: 45, nose: "out" } },
    { values: { cx: -20, cy: 50, direction: "cw", sweep: 120, nose: "course", course: 0 } },
  ],
  spin: [{ values: { degrees: 90, direction: "cw" } }, { values: { degrees: 720, direction: "ccw" } }],
  "tip-spin": [{ values: { degrees: 180, direction: "cw", about: "left-tip", x: -8, y: 50 } }, { values: { degrees: 180, direction: "ccw", about: "right-tip", x: 40, y: 50 } }],
  stop: [{ values: { nose: 0 } }, { values: { nose: 270 } }],
  launch: [{ values: {}, from: GROUND }],
  landing: [{ values: { style: "none" }, from: GROUND }, { values: { style: "leading-edge" }, from: GROUND }],
};

describe("словарь элементов и разбор docs/routine-elements.md", () => {
  it("элементов двенадцать, и каждый — строка таблицы «Что вошло» слово в слово", () => {
    const rows = docTable("Что вошло: двенадцать элементов");
    expect(ELEMENTS).toHaveLength(12);
    expect(ELEMENTS.map((item, index) => [String(index + 1), item.name, item.source, item.into, item.asks])).toEqual(rows);
    expect(ELEMENTS.map((item) => item.id)).toEqual([...ELEMENT_IDS]);
    expect(new Set(ELEMENTS.map((item) => item.name)).size).toBe(12);
  });

  it("чего в словаре нет — строки таблицы «Что осталось снаружи и почему» слово в слово", () => {
    expect(OUTSIDE.map((item) => [item.what, item.why, item.back])).toEqual(docTable("Что осталось снаружи и почему"));
  });

  it("ни одно из оставшегося снаружи элементом не стало", () => {
    const names = ELEMENTS.map((item) => `${item.id} ${item.name}`.toLowerCase()).join(" | ");
    for (const word of ["pivot", "hover", "axel", "аксел", "push", "snap", "two-point", "belly", "inverted flight", "ground", "turn", "slack", "на ходу", "рывк"]) {
      expect(names, word).not.toContain(word);
    }
  });
});

describe("элемент → шаги", () => {
  it("каждый элемент разворачивается в шаг, который принимает разбор своего шага", () => {
    for (const id of ELEMENT_IDS) {
      expect(SAMPLES[id].length, id).toBeGreaterThan(0);
      for (const sample of SAMPLES[id]) {
        const position = sample.from ?? AT;
        const steps = expand(id, sample.values, position);
        expect(steps, id).toHaveLength(1);
        for (const step of steps) {
          expect(() => parseOwnStep(id, step, { ...UP, position }), `${id} ${JSON.stringify(step)}`).not.toThrow();
        }
      }
    }
  });

  it("шаги записаны так, как их называет таблица разбора", () => {
    expect(expand("forward", { x: 30, y: 50 }, AT)).toEqual([{ kind: "line", to: [30, 50] }]);
    expect(expand("backward", { x: 30, y: 50 }, AT)).toEqual([{ kind: "line", to: [30, 50], nose: "backward" }]);
    expect(expand("slide-horizontal", { x: 40 }, AT)).toEqual([{ kind: "line", to: [40, 50], nose: 0 }]);
    expect(expand("slide-vertical", { y: 80, nose: "270" }, AT)).toEqual([{ kind: "line", to: [0, 80], nose: 270 }]);
    expect(expand("slide-vertical", { y: 80, nose: "90" }, AT)).toEqual([{ kind: "line", to: [0, 80], nose: 90 }]);
    expect(expand("slide-inverted", { x: -40 }, AT)).toEqual([{ kind: "line", to: [-40, 50], nose: 180 }]);
    expect(expand("diagonal", { x: 30, y: 80, nose: 0 }, AT)).toEqual([{ kind: "line", to: [30, 80], nose: 0 }]);
    expect(expand("spin", { degrees: 90, direction: "cw" }, AT)).toEqual([{ kind: "rotate", degrees: 90, direction: "cw", about: "center" }]);
    expect(expand("tip-spin", { degrees: 180, direction: "cw", about: "left-tip", x: -8, y: 50 }, AT)).toEqual([
      { kind: "rotate", degrees: 180, direction: "cw", about: "left-tip", to: [-8, 50] },
    ]);
    expect(expand("stop", { nose: 90 }, AT)).toEqual([{ kind: "mark", mark: "stall", nose: 90 }]);
    expect(expand("launch", {}, GROUND)).toEqual([{ kind: "mark", mark: "launch" }]);
    expect(expand("landing", { style: "none" }, GROUND)).toEqual([{ kind: "mark", mark: "landing" }]);
    expect(expand("landing", { style: "leading-edge" }, GROUND)).toEqual([{ kind: "mark", mark: "landing", style: "leading-edge" }]);
  });

  it("конец дуги следует из центра, стороны и угла, а круг кончается там же, где начался", () => {
    expect(expand("arc", { cx: 20, cy: 50, direction: "cw", sweep: 180, nose: "forward" }, AT)).toEqual([{ kind: "arc", to: [40, 50], center: [20, 50], direction: "cw", sweep: 180 }]);
    expect(expand("arc", { cx: 20, cy: 50, direction: "ccw", sweep: 90, nose: "in" }, AT)).toEqual([{ kind: "arc", to: [20, 30], center: [20, 50], direction: "ccw", sweep: 90, nose: "in" }]);
    expect(expand("arc", { cx: 7, cy: 61, direction: "cw", sweep: 360, nose: "course", course: 90 }, AT)).toEqual([
      { kind: "arc", to: [0, 50], center: [7, 61], direction: "cw", sweep: 360, nose: 90 },
    ]);
    // Точка с долями пишется с двумя знаками, как координаты каталога.
    expect(expand("arc", { cx: 20, cy: 50, direction: "cw", sweep: 45, nose: "out" }, AT)[0].to).toEqual([5.86, 64.14]);
    expect(() => expand("arc", { cx: 20, cy: 50, direction: "cw", sweep: 400, nose: "forward" }, AT)).toThrow("не больше 360");
  });

  it("параметр, которого нет, шагом не становится: значения по умолчанию нет ни у одного", () => {
    for (const def of ELEMENTS) {
      const read = readValues(def, {});
      expect(read.values, def.id).toEqual({});
      expect(read.missing, def.id).toEqual(fieldsOf(def, {}).map((field) => field.key));
      if (def.fields.length > 0) {
        expect(() => expand(def.id, {}, def.id === "landing" ? GROUND : AT), def.id).toThrow();
      }
      // Без каждого параметра по отдельности шага тоже нет.
      const full = SAMPLES[def.id][0];
      for (const key of Object.keys(full.values)) {
        const rest = { ...full.values };
        delete rest[key];
        expect(() => expand(def.id, rest, full.from ?? AT), `${def.id} без ${key}`).toThrow();
      }
    }
  });

  it("поле читается как набрано: число с запятой и минусом, выбор — только из названного", () => {
    const diagonal = elementBy("diagonal")!;
    expect(readValues(diagonal, { x: "-30,5", y: " 20 ", nose: "90" })).toEqual({ values: { x: -30.5, y: 20, nose: 90 }, missing: [], bad: [] });
    expect(readValues(diagonal, { x: "−30", y: "20,", nose: "" })).toEqual({ values: { x: -30, y: 20 }, missing: ["nose"], bad: [] });
    expect(readValues(diagonal, { x: "тридцать", y: "1e2", nose: "0,123" }).bad).toEqual(["x", "y", "nose"]);
    expect(Object.is(readValues(diagonal, { x: "-0", y: "1", nose: "0" }).values.x, 0)).toBe(true);
    const arc = elementBy("arc")!;
    expect(fieldsOf(arc, {}).map((field) => field.key)).toEqual(["cx", "cy", "direction", "sweep", "nose"]);
    expect(fieldsOf(arc, { nose: "course" }).map((field) => field.key)).toEqual(["cx", "cy", "direction", "sweep", "nose", "course"]);
    expect(readValues(arc, { cx: "0", cy: "0", direction: "по часовой", sweep: "90", nose: "forward" }).bad).toEqual(["direction"]);
  });

  it("взлёт и посадку к земле привязывает словарь", () => {
    expect(() => expand("launch", {}, AT)).toThrow("взлёт — на земле (ISKCB II.K, стр. 8), а кайт стоит в [0, 50]");
    expect(() => expand("landing", { style: "none" }, AT)).toThrow("посадка — на земле");
    expect(elementOf({ kind: "mark", mark: "launch" }, AT)).toBeNull();
    expect(elementOf({ kind: "mark", mark: "landing" }, AT)).toBeNull();
  });

  it("диагональ — не горизонталь и не вертикаль, и нос на ней не лежит на линии хода", () => {
    expect(() => expand("diagonal", { x: 30, y: 50, nose: 0 }, AT)).toThrow("не диагональ, точка лежит на той же высоте");
    expect(() => expand("diagonal", { x: 0, y: 80, nose: 90 }, AT)).toThrow("на той же вертикали");
    expect(() => expand("diagonal", { x: 30, y: 80, nose: 45 }, AT)).toThrow("это полёт вперёд");
    expect(() => expand("diagonal", { x: 30, y: 80, nose: 225 }, AT)).toThrow("это полёт назад");
  });
});

describe("шаг → элемент", () => {
  it("обращает разворот на каждом шаге, который словарь порождает", () => {
    for (const id of ELEMENT_IDS) {
      for (const sample of SAMPLES[id]) {
        const position = sample.from ?? AT;
        for (const raw of expand(id, sample.values, position)) {
          const step = parseOwnStep(id, raw, { ...UP, position });
          expect(elementOf(step, position), `${id} ${JSON.stringify(raw)}`).toBe(id);
        }
      }
    }
  });

  it("нос числом на линии хода — тот же полёт, что нос словом", () => {
    expect(elementOf({ kind: "line", to: [0, 80], nose: 0 }, AT)).toBe("forward");
    expect(elementOf({ kind: "line", to: [0, 80], nose: 180 }, AT)).toBe("backward");
    expect(elementOf({ kind: "line", to: [30, 80], nose: 45 }, AT)).toBe("forward");
    expect(elementOf({ kind: "line", to: [30, 80], nose: "forward" }, AT)).toBe("forward");
  });

  it("высота и вертикаль — те же с тем же запасом, с каким разбор прощает вход в фигуру", () => {
    // Отступ ровно в запас: слайд, а не диагональ.
    expect(elementOf({ kind: "line", to: [AT[0] + 30, AT[1] + 0.05], nose: 0 }, AT)).toBe("slide-horizontal");
    expect(elementOf({ kind: "line", to: [AT[0] + 0.05, AT[1] + 30], nose: 90 }, AT)).toBe("slide-vertical");
    expect(elementOf({ kind: "line", to: [AT[0] + 30, AT[1] + 0.06], nose: 0 }, AT)).toBe("diagonal");
  });

  it("отрезок, которому определения имени не дают, — не элемент", () => {
    expect(elementOf({ kind: "line", to: [30, 50], nose: 45 }, AT)).toBeNull();
    expect(elementOf({ kind: "line", to: [0, 80], nose: 30 }, AT)).toBeNull();
    expect(elementOf({ kind: "line", to: [30, 50], nose: 0 }, null)).toBeNull();
  });

  it("оставшееся снаружи элементом не названо", () => {
    const outside: OwnStep[] = [
      { kind: "mark", mark: "in" },
      { kind: "mark", mark: "out" },
      { kind: "mark", mark: "axel" },
      { kind: "mark", mark: "half-axel" },
      { kind: "mark", mark: "stall", nose: 0, style: "push" },
      { kind: "mark", mark: "stall", nose: 0, style: "snap" },
      { kind: "mark", mark: "landing", style: "two-point" },
      { kind: "mark", mark: "landing", style: "belly" },
      { kind: "start", at: [0, 0] },
    ];
    for (const step of outside) {
      expect(elementOf(step, GROUND), JSON.stringify(step)).toBeNull();
    }
  });

  // Числа — из разбора, раздел 4.1: 373 отрезка, 73 дуги, 163 поворота и 155
  // отметок 54 мультистропных фигур, из них 46 шагов с записью «книга не
  // говорит». Четыре отрезка MP 05 с носом числом на линии хода — полёт
  // вперёд и назад, по два.
  it("каждый шаг мультистропных фигур каталога — один из двенадцати, кроме 46 с записью «книга не говорит»", () => {
    const counts: Record<string, number> = {};
    const unnamed: Record<string, number> = {};
    let figures = 0;
    for (const figure of listFigures()) {
      if (!figure.discipline.startsWith("multi-line") || figure.geometry.status !== "ok") {
        continue;
      }
      figures += 1;
      for (const kite of figure.geometry.variants.flatMap((variant) => variant.kites)) {
        let position: Point | null = null;
        for (const step of kite.path) {
          const called = step.kind === "start" || (step.kind === "mark" && (step.mark === "in" || step.mark === "out"));
          const id = elementOf(step, position);
          if (id !== null) {
            counts[id] = (counts[id] ?? 0) + 1;
          } else if (!called) {
            unnamed[step.kind] = (unnamed[step.kind] ?? 0) + 1;
          }
          position = step.kind === "start" ? step.at : step.kind === "line" || step.kind === "arc" ? step.to : step.kind === "rotate" ? (step.to ?? position) : position;
        }
      }
    }
    expect(figures).toBe(54);
    expect(counts).toEqual({
      forward: 165 + 2,
      backward: 79 + 2,
      "slide-horizontal": 19,
      "slide-vertical": 39,
      "slide-inverted": 43,
      diagonal: 23,
      arc: 73,
      spin: 124,
      stop: 84,
      launch: 31,
      landing: 34,
    });
    // 35 поворотов без названной точки и 4 с незаданным смещением, 6 остановок
    // без курса метки, отрезок с незаданной координатой.
    expect(unnamed).toEqual({ rotate: 35 + 4, mark: 6, line: 1 });
  });
});

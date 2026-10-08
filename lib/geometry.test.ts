import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { listFigures } from "./figures";
import { arcPoint, isSwing, parseGeometry, pivotOf, REV_SPAN } from "./geometry";

type Raw = Record<string, unknown>;

const start: Raw = { kind: "start", at: [0, 10] };
const markIn: Raw = { kind: "mark", mark: "in" };
const markOut: Raw = { kind: "mark", mark: "out" };

function geometry(path: unknown[], over: Raw = {}): Raw {
  return { status: "ok", variants: [{ id: "main", kites: [{ id: "1", path }], grid: GRID_LINES, guides: NO_GUIDES }], ...over };
}

const NO_GUIDES: Raw = { status: "not_found", reason: "на схеме их нет" };
// Оси окна; линий сетки у схемы теста нет.
const GRID_LINES: Raw = { x: [0], y: [50] };
const CENTER: Raw = { about: "center", about_basis: "text" };
const MISSING: Raw = { status: "not_found", reason: "страница точку поворота не называет" };

const parse = (raw: unknown) => parseGeometry("g", raw, 125);
const parsePath = (path: unknown[], over: Raw = {}) => parse(geometry(path, over));

describe("arcPoint", () => {
  it("против часовой стрелки угол растёт: с правого края круга четверть оборота ведёт наверх", () => {
    const [x, y] = arcPoint([10, 50], [0, 50], "ccw", 90);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(60);
  });

  it("по часовой стрелке та же четверть ведёт вниз", () => {
    const [x, y] = arcPoint([10, 50], [0, 50], "cw", 90);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(40);
  });
});

describe("parseGeometry", () => {
  it("читает путь и подставляет умолчания: basis «grid», нос вперёд", () => {
    const read = parsePath([start, markIn, { kind: "line", to: [0, 50] }, markOut]);
    expect(read).toEqual({
      status: "ok",
      notes: [],
      variants: [
        {
          id: "main",
          kites: [
            {
              id: "1",
              path: [
                { kind: "start", at: [0, 10], basis: "grid" },
                { kind: "mark", mark: "in" },
                { kind: "line", to: [0, 50], basis: "grid", nose: "forward" },
                { kind: "mark", mark: "out" },
              ],
            },
          ],
          grid: GRID_LINES,
          guides: NO_GUIDES,
        },
      ],
    });
  });

  it("принимает полный круг: дуга на 360° возвращается в свою же точку", () => {
    const arc = { kind: "arc", to: [0, 10], center: [0, 30], direction: "cw", sweep: 360 };
    expect(parsePath([start, markIn, arc, markOut]).status).toBe("ok");
  });

  it.each([
    ["конец не на окружности", { to: [25, 30], center: [0, 30], direction: "ccw", sweep: 90 }],
    ["направление перепутано", { to: [20, 30], center: [0, 30], direction: "cw", sweep: 90 }],
    ["угол не тот", { to: [20, 30], center: [0, 30], direction: "ccw", sweep: 180 }],
  ])("отвергает дугу, которая не сходится: %s", (_label, arc) => {
    expect(() => parsePath([start, markIn, { kind: "arc", ...arc }, markOut])).toThrow(/дуга не сходится/);
  });

  it("центр пологой дуги может лежать за краем окна, сама дуга — нет", () => {
    const from = { kind: "start", at: [-30, 20] };
    const flat = { kind: "arc", to: [30, 20], center: [0, -20], direction: "cw", sweep: 73.7398 };
    expect(parsePath([from, markIn, flat, markOut]).status).toBe("ok");
    // Радиус 100, концы на самой верхней линии: середина дуги выше окна.
    const top = { kind: "start", at: [-4.36, 100] };
    const over = { kind: "arc", to: [4.36, 100], center: [0, 0.1], direction: "cw", sweep: 5 };
    expect(() => parsePath([top, markIn, over, markOut])).toThrow(/дуга выходит за сетку окна/);
  });

  it("пустой список заметок — то же, что его отсутствие", () => {
    expect(parsePath([start, markIn, { kind: "line", to: [0, 50] }, markOut], { notes: [] })).toMatchObject({
      notes: [],
    });
    expect(() => parsePath([start, markIn, { kind: "line", to: [0, 50] }, markOut], { notes: "текст" })).toThrow(
      /notes: ожидается список строк/,
    );
  });

  it("принимает ту же дугу, записанную верно", () => {
    const arc = { kind: "arc", to: [20, 30], center: [0, 30], direction: "ccw", sweep: 90 };
    expect(parsePath([start, markIn, arc, markOut]).status).toBe("ok");
  });

  it.each([
    [{ kind: "arc", to: [0, 40], center: [0, 60], direction: "cw", sweep: 0 }, /sweep: угол дуги/],
    [{ kind: "arc", to: [0, 40], center: [0, 60], direction: "cw", sweep: 361 }, /sweep: угол дуги/],
    [{ kind: "arc", to: [0, 40], center: [0, 60], direction: "left", sweep: 360 }, /direction: ожидается одно из: cw, ccw/],
    [{ kind: "arc", to: [0, 40], center: [0, 40], direction: "cw", sweep: 360 }, /центр дуги совпадает с её началом/],
    [{ kind: "arc", to: [0, 40], center: [0, 15], direction: "cw", sweep: 360 }, /дуга выходит за сетку окна/],
    [{ kind: "line", to: [0, 40] }, /отрезок нулевой длины/],
    [{ kind: "arc", to: [0, 40], center: [0, 60], direction: "cw", sweep: 0.01 }, /дуга нулевой длины/],
    [{ kind: "line", to: [101, 10] }, /вне сетки окна/],
    [{ kind: "line", to: [0, -1] }, /вне сетки окна/],
    [{ kind: "line", to: [0, 101] }, /вне сетки окна/],
    [{ kind: "line", to: [0] }, /ожидается точка \[x, y\]/],
    [{ kind: "line", to: [0, "50"] }, /ожидается точка \[x, y\]/],
    [{ kind: "line", to: [0, 50], basis: "guess" }, /basis: ожидается одно из: grid, text, derived, measured/],
    [{ kind: "line", to: [0, 50], nose: "sideways" }, /nose: ожидается одно из/],
    [{ kind: "line", to: [0, 50], nose: 360 }, /nose: курс носа/],
    [{ kind: "line", to: [0, 50], nose: "out" }, /имеют смысл только на дуге/],
    [{ kind: "line", to: [0, 50], unmarked: false }, /unmarked: поле либо отсутствует, либо равно true/],
    [{ kind: "line", to: [0, 50], colour: "red" }, /незнакомое поле «colour»/],
    [{ kind: "curve", to: [0, 50] }, /kind: ожидается одно из: start, line, arc, mark, rotate/],
    [{ kind: "mark", mark: "loop" }, /mark: ожидается одно из/],
    [{ kind: "mark", mark: "stall", style: "two-point", nose: 0 }, /style: ожидается одно из: push, snap/],
    [{ kind: "mark", mark: "launch", style: "push" }, /style: ожидается одно из/],
    [{ kind: "rotate", degrees: 0, direction: "cw", ...CENTER }, /degrees: угол поворота/],
    [{ kind: "rotate", degrees: 90, direction: "cw", about: "nose", about_basis: "text" }, /about: ожидается одно из/],
    // Молчаливого «вокруг центра» нет: точка названа либо признана ненайденной.
    [{ kind: "rotate", degrees: 90, direction: "cw" }, /about: обязательна точка поворота/],
    [{ kind: "rotate", degrees: 90, direction: "cw", about: "center" }, /about_basis: у названной точки поворота обязательно/],
    [{ kind: "rotate", degrees: 90, direction: "cw", about: "center", about_basis: "guess" }, /about_basis: ожидается одно из: text, diagram, derived/],
    [{ kind: "rotate", degrees: 90, direction: "cw", about: { status: "not_found" } }, /about\.reason: должно быть непустой строкой/],
    [{ kind: "rotate", degrees: 90, direction: "cw", about: MISSING, about_basis: "text" }, /about_basis: записывается только у названной/],
    // Смещение принадлежит повороту: вокруг законцовки оно обязано быть
    // сказано, вокруг центра его нет.
    [{ kind: "rotate", degrees: 180, direction: "ccw", about: "left-tip", about_basis: "text" }, /to: поворот вокруг законцовки перемещает кайт/],
    [{ kind: "rotate", degrees: 180, direction: "ccw", ...CENTER, to: [0, 46.5] }, /to: поворот вокруг центра кайт не перемещает/],
    [{ kind: "rotate", degrees: 180, direction: "ccw", ...CENTER, basis: "measured" }, /basis: записывается только вместе с точкой «to»/],
    [{ kind: "rotate", degrees: 180, direction: "ccw", about: MISSING, to: [0, 40] }, /to: поворот не смещает кайт/],
    [{ kind: "rotate", degrees: 360, direction: "ccw", about: MISSING, to: [0, 46.5] }, /degrees: поворот со смещением — меньше полного оборота/],
    [{ kind: "rotate", degrees: 180, direction: "ccw", about: MISSING, to: [0, 101] }, /вне сетки окна/],
    [{ kind: "rotate", degrees: 270, direction: "ccw", about: MISSING, to: [0, 95] }, /поворот выводит кайт за сетку окна/],
    [{ kind: "start", at: [0, 20] }, /путь начинается шагом «start», и такой шаг в нём один/],
  ])("отвергает шаг %j", (step, message) => {
    expect(() => parsePath([start, markIn, { kind: "line", to: [0, 40] }, step, markOut])).toThrow(message);
  });

  it("принимает поля многострочных фигур: курс носа, полёт назад, поворот на месте", () => {
    const read = parsePath([
      start,
      markIn,
      { kind: "line", to: [40, 10], nose: 0 },
      { kind: "rotate", degrees: 180, direction: "cw", ...CENTER },
      { kind: "line", to: [40, 50], nose: "backward" },
      { kind: "arc", to: [40, 50], center: [40, 70], direction: "ccw", sweep: 360, nose: "out", sync: "a" },
      markOut,
    ]);
    expect(read.status).toBe("ok");
  });

  it.each([
    ["путь не с start", [markIn, { kind: "line", to: [0, 50] }, markOut], /путь начинается шагом «start»/],
    ["нет ни одного отрезка", [start, markIn, markOut], /между «in» и «out» нет ни одного отрезка или дуги/],
    ["отрезок только после out", [start, markIn, markOut, { kind: "line", to: [0, 50] }], /между «in» и «out» нет/],
    ["отрезок только до in", [start, { kind: "line", to: [0, 50] }, markIn, { kind: "mark", mark: "stall", nose: 0 }, markOut], /между «in» и «out» нет/],
    ["нет in", [start, { kind: "line", to: [0, 50] }, markOut], /ровно одна отметка «in»/],
    ["нет out", [start, markIn, { kind: "line", to: [0, 50] }], /ровно одна отметка «in»/],
    ["out раньше in", [start, markOut, { kind: "line", to: [0, 50] }, markIn], /ровно одна отметка «in»/],
    ["два in", [start, markIn, markIn, { kind: "line", to: [0, 50] }, markOut], /ровно одна отметка «in»/],
    ["пустой путь", [], /path: ожидается непустой список/],
  ])("отвергает путь: %s", (_label, path, message) => {
    expect(() => parsePath(path)).toThrow(message);
  });

  describe("поворот со смещением", () => {
    // Кайт пришёл в центр окна слева, нос вправо: верхняя законцовка — левая.
    const climb = (turn: Raw, over: Raw = {}) =>
      parsePath([{ kind: "start", at: [-60, 10] }, markIn, { kind: "line", to: [0, 10] }, turn, markOut], over);
    const up: Raw = { kind: "rotate", degrees: 180, direction: "ccw", about: "left-tip", about_basis: "diagram", to: [0, 16.5] };

    it("точка поворота следует из смещения, угла и стороны", () => {
      const [mx, my] = pivotOf([0, 10], [0, 16.5], "ccw", 180);
      expect(mx).toBeCloseTo(0);
      expect(my).toBeCloseTo(13.25);
      const [x, y] = pivotOf([10, 50], [0, 60], "ccw", 90);
      expect(x).toBeCloseTo(0);
      expect(y).toBeCloseTo(50);
      // Та же хорда в другую сторону — центр по другую сторону от неё.
      const [cx, cy] = pivotOf([10, 50], [0, 60], "cw", 90);
      expect(cx).toBeCloseTo(10);
      expect(cy).toBeCloseTo(60);
    });

    it("принимает поворот вокруг законцовки с точкой, куда он привёл нос", () => {
      const read = climb(up);
      const turn = read.status === "ok" && read.variants[0].kites[0].path[3];
      expect(turn).toMatchObject({ kind: "rotate", about: "left-tip", about_basis: "diagram", to: [0, 16.5], basis: "grid" });
      expect(turn && isSwing(turn)).toBe(true);
    });

    it("следующий шаг идёт уже из новой точки: отрезок в неё же — нулевой длины", () => {
      const path = [{ kind: "start", at: [-60, 10] }, markIn, { kind: "line", to: [0, 10] }, up, { kind: "line", to: [0, 16.5] }, markOut];
      expect(() => parsePath(path)).toThrow(/path\[4\]: отрезок нулевой длины/);
    });

    it.each([
      ["не та законцовка", { ...up, about: "right-tip" }, /about: смещение в \[0, 16.5\].*это «left-tip», а записано «right-tip»/],
      ["четверть оборота по часовой идёт вокруг нижней законцовки", { ...up, degrees: 90, direction: "cw", to: [3.25, 6.75] }, /это «right-tip», а записано «left-tip»/],
      ["смещение вдоль курса, а не вбок", { ...up, to: [6.5, 10] }, /не сбоку от носа, это не законцовка/],
    ])("сверяет законцовку со смещением и курсом носа: %s", (_label, turn, message) => {
      expect(() => climb(turn)).toThrow(message);
    });

    it("курс носа ведёт через повороты: вторая ступень — вокруг другой законцовки", () => {
      const second: Raw = { kind: "rotate", degrees: 180, direction: "cw", about: "right-tip", about_basis: "diagram", to: [0, 23] };
      const path = (turn: Raw) => [{ kind: "start", at: [-60, 10] }, markIn, { kind: "line", to: [0, 10] }, up, turn, markOut];
      expect(parsePath(path(second)).status).toBe("ok");
      expect(() => parsePath(path({ ...second, about: "left-tip" }))).toThrow(/path\[4\]\.about: .*это «right-tip», а записано «left-tip»/);
    });

    it("выведенная точка поворота требует заметки, прочитанная — нет", () => {
      expect(() => climb({ ...up, about_basis: "derived" })).toThrow(/notes: есть шаги.*выведенная точка поворота/);
      expect(climb({ ...up, about_basis: "derived" }, { notes: ["Законцовка выведена из смещения."] }).status).toBe("ok");
      expect(climb({ ...up, about_basis: "text" }).status).toBe("ok");
    });

    it("замер точки, куда привёл поворот, требует заметки, как замер конца отрезка", () => {
      expect(() => climb({ ...up, basis: "measured" })).toThrow(/notes: есть шаги/);
    });

    it("ненайденным смещение не записать: за таким поворотом отрезок снова понёс бы его сам", () => {
      expect(() => climb({ ...up, to: { status: "not_found", reason: "схема не показывает, куда пришёл кайт" } })).toThrow(/path\[3\]\.to/);
    });

    // Книга объявляет положение после поворота незаданным: числа в данных
    // нет, нос уходит вокруг названной законцовки на размах значка кайта.
    describe("положение, которое книга объявила незаданным", () => {
      const OPEN: Raw = { status: "unspecified", reason: "стр. 71: высота после поворота не задана" };
      const open: Raw = { kind: "rotate", degrees: 180, direction: "ccw", about: "left-tip", about_basis: "diagram", to: OPEN };
      const notes = { notes: ["Высота книгой не задана."] };

      it("поворот уводит нос на размах значка вокруг названной законцовки и помечен «unspecified»", () => {
        const read = climb(open, notes);
        const turn = read.status === "ok" && read.variants[0].kites[0].path[3];
        expect(turn).toMatchObject({ kind: "rotate", to: [0, 10 + REV_SPAN], basis: "unspecified" });
        expect(turn && isSwing(turn)).toBe(true);
        // Четверть оборота — тоже вокруг законцовки: нос уходит вперёд и вбок.
        const quarter = climb({ ...open, degrees: 90 }, notes);
        expect(quarter.status === "ok" && quarter.variants[0].kites[0].path[3]).toMatchObject({ to: [REV_SPAN / 2, 10 + REV_SPAN / 2] });
      });

      it("сторону смещения задаёт законцовка: вокруг правой нос уходит вниз", () => {
        const down = parsePath(
          [{ kind: "start", at: [-60, 50] }, markIn, { kind: "line", to: [0, 50] }, { ...open, direction: "cw", about: "right-tip" }, markOut],
          notes,
        );
        expect(down.status === "ok" && down.variants[0].kites[0].path[3]).toMatchObject({ to: [0, 50 - REV_SPAN] });
      });

      it("требует заметки: читатель данных обязан узнать, что числа нет", () => {
        expect(() => climb(open)).toThrow(/notes: есть шаги.*объявила незаданной/);
      });

      it.each([
        ["происхождение рядом с незаданным положением", { ...open, basis: "measured" }, /path\[3\]\.basis: у незаданного положения/],
        ["точка поворота не названа", { ...open, about: MISSING, about_basis: undefined }, /path\[3\]\.to: .*нужна названная законцовка/],
        ["причина не названа", { ...open, to: { status: "unspecified" } }, /path\[3\]\.to\.reason/],
        ["полный оборот", { ...open, degrees: 360 }, /меньше полного оборота/],
      ])("отвергает: %s", (_label, turn, message) => {
        expect(() => climb(turn, notes)).toThrow(message);
      });

      it("без курса носа из пути положение не вывести", () => {
        expect(() => parsePath([{ kind: "start", at: [0, 10] }, markIn, open, { kind: "line", to: [60, 30] }, markOut], notes)).toThrow(
          /path\[2\]\.to: .*из курса носа/,
        );
      });

      it("у вершины лестницы, упёршейся в край окна, поворот отвергается", () => {
        const path = [{ kind: "start", at: [-60, 97] }, markIn, { kind: "line", to: [0, 97] }, open, markOut];
        expect(() => parsePath(path, notes)).toThrow(/за сетку окна/);
      });

      it("отрезок с null на месте координаты остаётся на ней и запоминает, какая не задана", () => {
        const path = [{ kind: "start", at: [-60, 10] }, markIn, { kind: "line", to: [0, 10] }, open, { kind: "line", to: [60, null], basis: "unspecified" }, markOut];
        const flown = parsePath(path, notes);
        expect(flown.status === "ok" && flown.variants[0].kites[0].path[4]).toMatchObject({ kind: "line", to: [60, 10 + REV_SPAN], unset: 1, basis: "unspecified" });
        const across = parsePath([start, markIn, { kind: "line", to: [null, 80], basis: "unspecified" }, markOut], notes);
        expect(across.status === "ok" && across.variants[0].kites[0].path[2]).toMatchObject({ to: [0, 80], unset: 0 });
      });

      it.each([
        ["null без «unspecified»", { kind: "line", to: [60, null] }, /basis: у точки с незаданной координатой/],
        ["«unspecified» без null", { kind: "line", to: [60, 30], basis: "unspecified" }, /basis: «unspecified» пишется только у точки/],
        ["обе координаты null", { kind: "line", to: [null, null], basis: "unspecified" }, /basis: «unspecified» пишется только у точки/],
        ["отрезок на месте", { kind: "line", to: [-50, null], basis: "unspecified" }, /отрезок нулевой длины/],
      ])("отвергает отрезок: %s", (_label, step, message) => {
        expect(() => parsePath([{ kind: "start", at: [-50, 20] }, markIn, step, markOut], notes)).toThrow(message);
      });

      it("у старта, дуги и вспомогательной линии «unspecified» не пишется", () => {
        expect(() => parsePath([{ kind: "start", at: [0, 10], basis: "unspecified" }, markIn, { kind: "line", to: [0, 50] }, markOut], notes)).toThrow(/path\[0\]\.basis/);
        const arc = { kind: "arc", to: [0, 70], center: [0, 45], direction: "cw", sweep: 180, basis: "unspecified" };
        expect(() => parsePath([{ kind: "start", at: [0, 20] }, markIn, arc, markOut], notes)).toThrow(/path\[2\]\.basis/);
        const guides = { status: "ok", lines: [{ from: [0, 10], to: [50, 10], basis: "unspecified" }] };
        expect(() =>
          parse({ status: "ok", variants: [{ id: "main", kites: [{ id: "1", path: [{ kind: "start", at: [0, 10] }, markIn, { kind: "line", to: [0, 50] }, markOut] }], grid: GRID_LINES, guides }], notes }),
        ).toThrow(/guides\.lines\[0\]\.basis/);
      });

      it("после шага «unmarked» курс носа из пути не следует — незаданное положение не считается", () => {
        const open = { kind: "rotate", degrees: 180, direction: "ccw", about: "left-tip", about_basis: "diagram", to: { status: "unspecified", reason: "стр. 71" } };
        const path = (unmarked: boolean) => [
          { kind: "start", at: [-60, 10] },
          markIn,
          { kind: "line", to: [0, 10], ...(unmarked ? { unmarked: true } : {}) },
          open,
          { kind: "line", to: [60, null], basis: "unspecified" },
          markOut,
        ];
        expect(parsePath(path(false), notes).status).toBe("ok");
        expect(() => parsePath(path(true), notes)).toThrow(/path\[3\]\.to.*курса носа/);
      });
    });

    it("книга точку поворота не называет, а смещение показывает — принимается без сверки законцовки", () => {
      expect(climb({ kind: "rotate", degrees: 180, direction: "cw", about: MISSING, to: [0, 16.5] }).status).toBe("ok");
    });
  });

  // Старый способ — поворот вокруг законцовки, а смещение отрезком после
  // него — в формате больше не записать: у такого поворота «to» обязательно.
  // Что каталог не держит его в обход, проверяется по самим файлам.
  describe("повороты каталога", () => {
    const turns = listFigures().flatMap((figure) =>
      figure.geometry.status !== "ok"
        ? []
        : figure.geometry.variants.flatMap((variant) =>
            variant.kites.flatMap((kite) =>
              kite.path.flatMap((step, index) => (step.kind === "rotate" ? [{ slug: figure.slug, step, next: kite.path[index + 1] }] : [])),
            ),
          ),
    );

    it("у каждого поворота точка названа с источником либо признана ненайденной", () => {
      expect(turns.length).toBeGreaterThan(100);
      for (const { slug, step } of turns) {
        expect(typeof step.about === "string" ? step.about_basis : step.about.reason, slug).toBeTruthy();
      }
    });

    it("отрезок сразу после поворота — пролёт: поворот перед ним либо на месте, либо своё смещение несёт сам", () => {
      const carried = turns.filter(
        ({ step, next }) => next?.kind === "line" && (step.about === "left-tip" || step.about === "right-tip") && !isSwing(step),
      );
      expect(carried.map(({ slug }) => slug)).toEqual([]);
    });

    // Поворот на месте и поворот вокруг неназванной точки формат от отрезка
    // со смещением не отличит: это видно только на странице книги. У
    // перечитанных фигур самый короткий отрезок после поворота — 10 единиц,
    // а смещение поворота вокруг законцовки не больше размаха кайта (метка
    // на схемах книги — около 6,5). Короче этого порога отрезок после
    // поворота — повод перечитать страницу, прежде чем поднимать число.
    it("отрезок сразу после поворота длиннее размаха кайта: смещение поворота под отрезок не замаскировано", () => {
      const short = listFigures().flatMap((figure) =>
        figure.geometry.status !== "ok"
          ? []
          : figure.geometry.variants.flatMap((variant) =>
              variant.kites.flatMap((kite) => {
                let here: readonly number[] = [];
                return kite.path.flatMap((step, index) => {
                  const from = here;
                  here = step.kind === "start" ? step.at : step.kind === "line" || step.kind === "arc" || isSwing(step) ? step.to : here;
                  const after = kite.path[index - 1]?.kind === "rotate" && step.kind === "line";
                  return after && Math.hypot(step.to[0] - from[0], step.to[1] - from[1]) < 10 ? [figure.slug] : [];
                });
              }),
            ),
      );
      expect(short).toEqual([]);
    });

    it("MI 02 поднимается четырьмя поворотами со смещением, без единого вертикального отрезка", () => {
      const ladder = listFigures().find((figure) => figure.slug === "mi-02-ladder-up")!;
      const path = ladder.geometry.status === "ok" ? ladder.geometry.variants[0].kites[0].path : [];
      // Высоты ступеней книга объявляет незаданными: чисел в файле нет, ступень — размах значка.
      expect(path.filter(isSwing).map((step) => step.to)).toEqual([1, 2, 3, 4].map((rung) => [0, Math.round((10 + rung * REV_SPAN) * 100) / 100]));
      expect(path.filter(isSwing).map((step) => `${step.about} ${step.about_basis} ${step.basis}`)).toEqual([
        "left-tip diagram unspecified",
        "right-tip diagram unspecified",
        "left-tip diagram unspecified",
        "right-tip diagram unspecified",
      ]);
      const lines = path.filter((step) => step.kind === "line");
      expect(lines.map((step) => step.to[0])).toEqual([0, 60]);
      expect(lines.map((step) => `${step.basis} ${step.unset}`)).toEqual(["grid undefined", "unspecified 1"]);
      const raw = readFileSync(join(process.cwd(), "data/figures/mi-02-ladder-up.json"), "utf8");
      expect(raw).not.toMatch(/"measured"|16\.5|18\.4|43\.6/);
    });
  });

  it.each([{ basis: "measured" }, { basis: "derived" }, { unmarked: true }])(
    "шаг с %j требует заметки, откуда значение",
    (extra) => {
      const path = [start, markIn, { kind: "line", to: [0, 50], ...extra }, markOut];
      expect(() => parsePath(path)).toThrow(/notes: есть шаги/);
      expect(parsePath(path, { notes: ["Высота снята замером по схеме."] }).status).toBe("ok");
    },
  );

  it("измеренная точка старта тоже требует заметки", () => {
    const path = [{ kind: "start", at: [0, 5], basis: "measured" }, markIn, { kind: "line", to: [0, 50] }, markOut];
    expect(() => parsePath(path)).toThrow(/notes: есть шаги/);
  });

  it("несколько кайтов и вариантов: id не повторяются", () => {
    const path = [start, markIn, { kind: "line", to: [0, 50] }, markOut];
    const kites = [
      { id: "1", path },
      { id: "2", path },
    ];
    const read = parse({
      status: "ok",
      variants: [
        { id: "four", team_size: 4, page: 51, kites, grid: GRID_LINES, guides: NO_GUIDES },
        { id: "five", team_size: 5, kites, grid: GRID_LINES, guides: NO_GUIDES },
      ],
    });
    expect(read.status === "ok" && read.variants.map((variant) => variant.kites.length)).toEqual([2, 2]);
    expect(() => parse({ status: "ok", variants: [{ id: "a", kites: [kites[0], kites[0]], grid: GRID_LINES, guides: NO_GUIDES }] })).toThrow(
      /повторяется id «1»/,
    );
    expect(() =>
      parse({ status: "ok", variants: [{ id: "a", kites, grid: GRID_LINES, guides: NO_GUIDES }, { id: "a", kites, grid: GRID_LINES, guides: NO_GUIDES }] }),
    ).toThrow(/повторяется id «a»/);
  });

  it.each([
    [{ id: "a", team_size: 1 }, /team_size: состав команды/],
    [{ id: "a", page: 126 }, /page: страница должна быть целым числом от 1 до 125/],
    [{ id: "a", page: 0 }, /page: страница должна быть целым числом от 1 до 125/],
    [{ id: "" }, /id: должно быть непустой строкой/],
    [{ id: "a", colour: "red" }, /незнакомое поле «colour»/],
  ])("отвергает вариант %j", (over, message) => {
    const kites = [{ id: "1", path: [start, markIn, { kind: "line", to: [0, 50] }, markOut] }];
    expect(() => parse({ status: "ok", variants: [{ kites, grid: GRID_LINES, guides: NO_GUIDES, ...over }] })).toThrow(message);
  });

  // Курс носа в остановке не выводится из пути: его называет книга либо
  // данные прямо говорят, что она его не показывает.
  it("у остановки читает курс носа с метки книги либо запись, что метки нет", () => {
    const missing = { status: "not_found", reason: "На схеме (стр. 112) метки нет." };
    const read = parsePath([
      start,
      markIn,
      { kind: "line", to: [0, 50] },
      { kind: "mark", mark: "stall", style: "snap", nose: 270 },
      { kind: "mark", mark: "stall", nose: missing },
      markOut,
    ]);
    const marks = read.status === "ok" ? read.variants[0].kites[0].path.filter((step) => step.kind === "mark") : [];
    expect(marks.slice(1, 3)).toEqual([
      { kind: "mark", mark: "stall", style: "snap", nose: 270 },
      { kind: "mark", mark: "stall", nose: missing },
    ]);
  });

  it.each([
    [{ kind: "mark", mark: "stall" }, /nose: у остановки обязателен курс носа/],
    [{ kind: "mark", mark: "stall", nose: 360 }, /nose: курс носа — от 0 до 360/],
    [{ kind: "mark", mark: "stall", nose: -90 }, /nose: курс носа — от 0 до 360/],
    [{ kind: "mark", mark: "stall", nose: "forward" }, /nose: ожидается объект/],
    [{ kind: "mark", mark: "stall", nose: { status: "not_found" } }, /nose\.reason: должно быть непустой строкой/],
    [{ kind: "mark", mark: "stall", nose: { status: "ok", reason: "есть" } }, /nose\.status: ожидается одно из: not_found/],
    [{ kind: "mark", mark: "stall", nose: { status: "not_found", reason: "нет", page: 1 } }, /незнакомое поле «page»/],
    [{ kind: "mark", mark: "launch", nose: 0 }, /nose: курс носа записывается только у остановки/],
    [{ kind: "mark", mark: "half-axel", nose: 0 }, /nose: курс носа записывается только у остановки/],
  ])("отвергает курс носа в отметке %j", (step, message) => {
    expect(() => parsePath([start, markIn, { kind: "line", to: [0, 40] }, step, markOut])).toThrow(message);
  });

  describe("вспомогательные линии", () => {
    const kites = [{ id: "1", path: [start, markIn, { kind: "line", to: [0, 50] }, markOut] }];
    const withGuides = (guides: unknown, notes: string[] = ["линия снята замером"]) =>
      parse({ status: "ok", variants: [{ id: "a", kites, grid: GRID_LINES, ...(guides === undefined ? {} : { guides }) }], notes });

    it("читает линии и подставляет basis «grid»", () => {
      const read = withGuides({
        status: "ok",
        lines: [
          { from: [-20, 10], to: [40, 87.5], basis: "measured" },
          { from: [0, 0], to: [0, 100] },
        ],
      });
      expect(read.status === "ok" && read.variants[0].guides).toEqual({
        status: "ok",
        lines: [
          { from: [-20, 10], to: [40, 87.5], basis: "measured" },
          { from: [0, 0], to: [0, 100], basis: "grid" },
        ],
      });
    });

    it("читает запись о том, что книга линий не рисует", () => {
      const read = withGuides({ status: "not_found", reason: "На схеме (стр. 16) их нет." });
      expect(read.status === "ok" && read.variants[0].guides).toEqual({ status: "not_found", reason: "На схеме (стр. 16) их нет." });
    });

    it.each([
      [undefined, /guides: ожидается объект: линии либо запись «not_found» с причиной/],
      [[], /guides: ожидается объект/],
      [{ status: "not_found" }, /guides\.reason: должно быть непустой строкой/],
      [{ status: "none", reason: "нет" }, /guides\.status: ожидается одно из: not_found/],
      [{ status: "ok" }, /guides\.lines: ожидается непустой список/],
      [{ status: "ok", lines: [] }, /guides\.lines: ожидается непустой список/],
      [{ status: "ok", lines: [{ from: [0, 0] }] }, /lines\[0\]\.to: ожидается точка/],
      [{ status: "ok", lines: [{ from: [0, 0], to: [0, 101] }] }, /вне сетки окна/],
      [{ status: "ok", lines: [{ from: [5, 5], to: [5, 5] }] }, /линия нулевой длины/],
      [{ status: "ok", lines: [{ from: [0, 0], to: [5, 5], basis: "guess" }] }, /basis: ожидается одно из/],
      [{ status: "ok", lines: [{ from: [0, 0], to: [5, 5], colour: "grey" }] }, /незнакомое поле «colour»/],
      [{ status: "ok", lines: [{ from: [0, 0], to: [5, 5] }], reason: "есть" }, /незнакомое поле «reason»/],
    ])("отвергает %j", (guides, message) => {
      expect(() => withGuides(guides)).toThrow(message);
    });

    it("линия, снятая замером, требует заметки, как и шаг", () => {
      const measured = { status: "ok", lines: [{ from: [0, 0], to: [5, 5], basis: "measured" }] };
      expect(() => withGuides(measured, [])).toThrow(/нужна заметка/);
      expect(() => withGuides({ status: "ok", lines: [{ from: [0, 0], to: [5, 5] }] }, [])).not.toThrow();
    });
  });

  it.each([
    [{ status: "not_found" }, /reason: должно быть непустой строкой/],
    [{ status: "not_found", reason: " " }, /reason: должно быть непустой строкой/],
    [{ status: "not_found", reason: "нет сетки", variants: [] }, /незнакомое поле «variants»/],
    [{ status: "ok", variants: [] }, /variants: ожидается непустой список/],
    [{ status: "ok" }, /variants: ожидается непустой список/],
    [{ status: "unknown" }, /status: ожидается одно из: ok, not_found/],
    [[], /ожидается объект/],
    [null, /ожидается объект/],
  ])("отвергает геометрию %j", (raw, message) => {
    expect(() => parse(raw)).toThrow(message);
  });

  describe("сетка, значки и подписи, снятые с книги", () => {
    const path = [start, markIn, { kind: "line", to: [0, 50] }, markOut];
    const one = (over: Raw, steps: unknown[] = path) =>
      parse({ status: "ok", variants: [{ id: "main", kites: [{ id: "1", path: steps }], grid: GRID_LINES, guides: NO_GUIDES, ...over }], notes: ["для теста"] });
    const two = (first: Raw, second: Raw, marks: [Raw, Raw] = [{}, {}]) =>
      parse({
        status: "ok",
        variants: [
          {
            id: "main",
            kites: [
              { id: "1", path: [start, { ...markIn, ...marks[0] }, { kind: "line", to: [0, 50] }, markOut], ...first },
              { id: "2", path: [{ kind: "start", at: [20, 10] }, { ...markIn, ...marks[1] }, { kind: "line", to: [20, 50] }, markOut], ...second },
            ],
            grid: GRID_LINES,
            guides: NO_GUIDES,
          },
        ],
      });

    it("линии сетки читает как записаны: оси окна — такие же строки списка", () => {
      const read = one({ grid: { x: [-60, 0, 30], y: [10, 50, 70] } });
      expect(read.status === "ok" && read.variants[0].grid).toEqual({ x: [-60, 0, 30], y: [10, 50, 70] });
      // Схема без оси: её просто нет в списке.
      expect(one({ grid: { x: [0], y: [10] } }).status).toBe("ok");
    });

    it.each([
      [undefined, /grid: обязательны линии сетки/],
      [{ x: [0] }, /grid\.y: ожидается список значений сетки/],
      [{ x: [0, 12], y: [50] }, /grid\.x\[1\]: линия сетки — число, кратное пяти/],
      [{ x: [0, 100], y: [50] }, /grid\.x\[1\]: линия сетки — число, кратное пяти/],
      [{ x: [0], y: [0, 50] }, /grid\.y\[0\]: линия сетки — число, кратное пяти/],
      [{ x: [20, 0], y: [50] }, /grid\.x\[1\]: линии сетки идут по возрастанию и не повторяются/],
      [{ x: [0, 0], y: [50] }, /grid\.x\[1\]: линии сетки идут по возрастанию и не повторяются/],
      [{ x: [0], y: [50], z: [] }, /незнакомое поле «z»/],
    ])("отвергает сетку %j", (grid, message) => {
      expect(() => one({ grid })).toThrow(message);
    });

    it("число значков на шаге читает только в варианте, где значки сняты с книги", () => {
      const counted = [start, markIn, { kind: "line", to: [0, 50], kites: 2 }, markOut];
      const read = one({ path_kites: "book" }, counted);
      expect(read.status === "ok" && read.variants[0].path_kites).toBe("book");
      expect(read.status === "ok" && read.variants[0].kites[0].path[2]).toMatchObject({ kites: 2 });
      expect(() => one({}, counted)).toThrow(/kites: значки кайта на шаге записываются только в варианте с path_kites «book»/);
      expect(() => one({ path_kites: "auto" }, path)).toThrow(/path_kites: ожидается одно из: book/);
    });

    it.each([0, 5, 1.5, "1"])("отвергает число значков %j", (count) => {
      expect(() => one({ path_kites: "book" }, [start, markIn, { kind: "line", to: [0, 50], kites: count }, markOut])).toThrow(/kites/);
    });

    it("на шаге без показанного направления значок требует курса носа, не зависящего от обхода", () => {
      const hidden = (extra: Raw) => [start, markIn, { kind: "line", to: [0, 50], unmarked: true, kites: 1, ...extra }, markOut];
      expect(() => one({ path_kites: "book" }, hidden({}))).toThrow(/на шаге «unmarked» значок кайта возможен только при курсе носа/);
      expect(one({ path_kites: "book" }, hidden({ nose: 90 })).status).toBe("ok");
    });

    it("слово In или Out принимает у одного кайта из нескольких", () => {
      expect(two({}, {}, [{}, { word: true }]).status).toBe("ok");
      expect(() => two({}, {}, [{ word: true }, { word: true }])).toThrow(/отметка «word» у «in» — у одного кайта из нескольких/);
      expect(() => one({}, [start, { ...markIn, word: true }, { kind: "line", to: [0, 50] }, markOut])).toThrow(/отметка «word» у «in»/);
      expect(() => one({}, [start, markIn, { kind: "line", to: [0, 50] }, { kind: "mark", mark: "launch", word: true }, markOut])).toThrow(/word/);
      expect(() => two({}, {}, [{}, { word: false }])).toThrow(/word: поле либо отсутствует, либо равно true/);
    });

    it("цвет кайта — номер от 1 до 5, без повторов на схеме", () => {
      const read = two({ color: 2 }, { color: 1 });
      expect(read.status === "ok" && read.variants[0].kites.map((kite) => kite.color)).toEqual([2, 1]);
      expect(() => two({ color: 0 }, {})).toThrow(/color: номер цвета кайта — целое от 1 до 5/);
      expect(() => two({ color: 6 }, {})).toThrow(/color: номер цвета кайта — целое от 1 до 5/);
      // Первому отдан цвет второго, а второй остался при своём по месту.
      expect(() => two({ color: 2 }, {})).toThrow(/цвета кайтов повторяются/);
    });
  });

  // Проводка: правила выше ничего не стоят, если каталог ими не пользуется.
  describe("каталог: снятое с книги", () => {
    const variants = listFigures().flatMap((figure) =>
      figure.geometry.status === "ok" ? figure.geometry.variants.map((variant) => ({ figure, variant })) : [],
    );

    it("значки в пути сняты с книги у всех двухстропных индивидуальных и командных фигур и у MI 16", () => {
      const booked = variants.filter(({ variant }) => variant.path_kites === "book").map(({ figure, variant }) => `${figure.slug} ${variant.id}`);
      const due = variants
        .filter(({ figure }) => figure.discipline === "dual-line-individual" || figure.discipline === "dual-line-team" || figure.slug === "mi-16-lollypop")
        .map(({ figure, variant }) => `${figure.slug} ${variant.id}`);
      expect(booked).toEqual(due);
      // И хотя бы где-то значки действительно записаны.
      expect(variants.filter(({ variant }) => variant.kites.some((kite) => kite.path.some((step) => (step.kind === "line" || step.kind === "arc") && step.kites))).length).toBeGreaterThan(40);
    });

    // Числа сняты со страниц книги (docs/verification/di.md, dt.md, mi-16-30.md):
    // сколько значков кайта в пути на схеме каждого состава.
    const BOOK_KITES: Record<string, number[]> = {
      "di-02-circle": [0],
      "di-03-circle-over-diamond": [3],
      "di-05-lap-and-snap": [0],
      "di-07-jump": [0],
      "di-08-pyramid": [1],
      "di-09-octagon": [1],
      "di-11-split-figure-eight": [0],
      "di-12-stops": [0],
      "di-13-steps": [0],
      "di-14-register": [6],
      "di-15-lsi": [0],
      "di-16-two-squares-and-stalls": [3],
      "di-17-wedge": [1],
      "di-18-square-cuts": [1],
      "di-19-launch-circle-and-land-2p": [1],
      "di-20-boomerang": [1],
      "dt-02-pick-up-sticks": [9, 10, 10],
      "dt-03-follow-flank-up-and-square": [3, 4, 5],
      "dt-04-team-hairpin": [6, 8, 10],
      "dt-05-arch-de-triomph": [3, 4, 5],
      "dt-07-sorted-rectangle": [6, 8, 10],
      "dt-08-the-basket": [3, 4, 5],
      "dt-10-team-diamonds": [0, 0, 0],
      "dt-11-cascade": [3, 4, 5],
      "dt-12-loops-and-vertical-threads": [3, 4, 5],
      "dt-14-have-fun": [15, 20, 25],
      "dt-15-solaris": [3, 4, 0],
      "dt-16-team-square-cuts": [9, 12, 15],
      "dt-17-boomerang": [3, 4, 5],
      "mi-16-lollypop": [4],
    };

    it("число значков в пути у каждого состава — то, что прочитано со страницы", () => {
      const counted: Record<string, number[]> = {};
      for (const { figure, variant } of variants.filter((item) => item.variant.path_kites === "book")) {
        const sum = variant.kites.reduce((all, kite) => all + kite.path.reduce((part, step) => part + ((step.kind === "line" || step.kind === "arc") && step.kites ? step.kites : 0), 0), 0);
        (counted[figure.slug] ??= []).push(sum);
      }
      expect(counted).toEqual(BOOK_KITES);
    });

    it("точка, записанная как стоящая на подписанных линиях, стоит на линиях сетки варианта или на рамке", () => {
      // Набор линий из пути не выводится, но обратное обязано держаться:
      // потерянная в `grid` линия сняла бы со схемы подпись точки пути.
      // MI 35: конец первого кольца (0; 30) записан без метки, а линии 30 на
      // странице 97 нет — об этом говорит заметка фигуры; основание точки —
      // вопрос данных, этой проверкой он только назван.
      const KNOWN = ["mi-35-two-rings main 1 y=30"];
      const off = variants.flatMap(({ figure, variant }) =>
        variant.kites.flatMap((kite) =>
          kite.path.flatMap((step) => {
            const point = step.kind === "start" ? step.at : step.kind === "line" || step.kind === "arc" || isSwing(step) ? step.to : undefined;
            if (!point || !("basis" in step) || step.basis !== "grid") {
              return [];
            }
            const unset = step.kind === "line" ? step.unset : undefined;
            const onX = unset === 0 || variant.grid.x.includes(point[0]) || Math.abs(point[0]) === 100;
            const onY = unset === 1 || variant.grid.y.includes(point[1]) || point[1] === 0 || point[1] === 100;
            return [...(onX ? [] : [`${figure.slug} ${variant.id} ${kite.id} x=${point[0]}`]), ...(onY ? [] : [`${figure.slug} ${variant.id} ${kite.id} y=${point[1]}`])];
          }),
        ),
      );
      expect([...new Set(off)]).toEqual(KNOWN);
    });

    it("оси окна есть на каждой схеме, кроме MI 02, где книга не проводит ось 50", () => {
      const bare = variants.filter(({ variant }) => !variant.grid.x.includes(0) || !variant.grid.y.includes(50)).map(({ figure, variant }) => `${figure.slug} ${variant.id}`);
      expect(bare).toEqual(["mi-02-ladder-up main"]);
    });

    it("метка «measured» или «derived» не стоит на пересечении подписанных линий сетки", () => {
      // DP 07: линии схемы идут в двух единицах от подписанных, и «derived»
      // там говорит не о точности, а о том, какое чтение взято, — см. заметки.
      const marked = variants
        .filter(({ figure }) => figure.slug !== "dp-07-h")
        .flatMap(({ figure, variant }) =>
          variant.kites.flatMap((kite) =>
            kite.path.flatMap((step, index) => {
              const point = step.kind === "start" ? step.at : step.kind === "line" || step.kind === "arc" || isSwing(step) ? step.to : undefined;
              const basis = "basis" in step ? step.basis : undefined;
              return point && (basis === "measured" || basis === "derived") && variant.grid.x.includes(point[0]) && variant.grid.y.includes(point[1])
                ? [`${figure.slug} ${variant.id} ${kite.id}:${index}`]
                : [];
            }),
          ),
        );
      expect(marked).toEqual([]);
    });

    it("слово у входа или выхода и свой цвет записаны там, где книга ставит их не по общему правилу", () => {
      const worded = variants.flatMap(({ figure, variant }) =>
        variant.kites.flatMap((kite) => kite.path.flatMap((step) => (step.kind === "mark" && step.word ? [`${figure.slug} ${kite.id} ${step.mark}`] : []))),
      );
      expect(worded).toEqual(["mp-05-sticky-wicket 2 out", "mp-09-lollypops 2 out", "mp-10-parallel-boxes 2 out", "mp-13-pair-pivots 2 in"]);
      const colored = variants.flatMap(({ figure, variant }) => variant.kites.flatMap((kite) => (kite.color ? [`${figure.slug} ${kite.id}=${kite.color}`] : [])));
      expect(colored).toEqual(["mp-13-pair-pivots 1=2", "mp-13-pair-pivots 2=1"]);
    });
  });
});

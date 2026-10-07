import { describe, expect, it } from "vitest";

import { arcPoint, parseGeometry } from "./geometry";

type Raw = Record<string, unknown>;

const start: Raw = { kind: "start", at: [0, 10] };
const markIn: Raw = { kind: "mark", mark: "in" };
const markOut: Raw = { kind: "mark", mark: "out" };

function geometry(path: unknown[], over: Raw = {}): Raw {
  return { status: "ok", variants: [{ id: "main", kites: [{ id: "1", path }], guides: NO_GUIDES }], ...over };
}

const NO_GUIDES: Raw = { status: "not_found", reason: "на схеме их нет" };

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
    [{ kind: "rotate", degrees: 0, direction: "cw" }, /degrees: угол поворота/],
    [{ kind: "rotate", degrees: 90, direction: "cw", about: "nose" }, /about: ожидается одно из/],
    [{ kind: "start", at: [0, 20] }, /путь начинается шагом «start», и такой шаг в нём один/],
  ])("отвергает шаг %j", (step, message) => {
    expect(() => parsePath([start, markIn, { kind: "line", to: [0, 40] }, step, markOut])).toThrow(message);
  });

  it("принимает поля многострочных фигур: курс носа, полёт назад, поворот на месте", () => {
    const read = parsePath([
      start,
      markIn,
      { kind: "line", to: [40, 10], nose: 0 },
      { kind: "rotate", degrees: 180, direction: "cw" },
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
        { id: "four", team_size: 4, page: 51, kites, guides: NO_GUIDES },
        { id: "five", team_size: 5, kites, guides: NO_GUIDES },
      ],
    });
    expect(read.status === "ok" && read.variants.map((variant) => variant.kites.length)).toEqual([2, 2]);
    expect(() => parse({ status: "ok", variants: [{ id: "a", kites: [kites[0], kites[0]], guides: NO_GUIDES }] })).toThrow(
      /повторяется id «1»/,
    );
    expect(() =>
      parse({ status: "ok", variants: [{ id: "a", kites, guides: NO_GUIDES }, { id: "a", kites, guides: NO_GUIDES }] }),
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
    expect(() => parse({ status: "ok", variants: [{ kites, guides: NO_GUIDES, ...over }] })).toThrow(message);
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
      parse({ status: "ok", variants: [{ id: "a", kites, ...(guides === undefined ? {} : { guides }) }], notes });

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
});

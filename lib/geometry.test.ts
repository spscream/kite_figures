import { describe, expect, it } from "vitest";

import { arcPoint, parseGeometry } from "./geometry";

type Raw = Record<string, unknown>;

const start: Raw = { kind: "start", at: [0, 10] };
const markIn: Raw = { kind: "mark", mark: "in" };
const markOut: Raw = { kind: "mark", mark: "out" };

function geometry(path: unknown[], over: Raw = {}): Raw {
  return { status: "ok", variants: [{ id: "main", kites: [{ id: "1", path }] }], ...over };
}

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
    [{ kind: "mark", mark: "stall", style: "two-point" }, /style: ожидается одно из: push, snap/],
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
    ["нет ни одного отрезка", [start, markIn, markOut], /в пути нет ни одного отрезка или дуги/],
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
        { id: "four", team_size: 4, page: 51, kites },
        { id: "five", team_size: 5, kites },
      ],
    });
    expect(read.status === "ok" && read.variants.map((variant) => variant.kites.length)).toEqual([2, 2]);
    expect(() => parse({ status: "ok", variants: [{ id: "a", kites: [kites[0], kites[0]] }] })).toThrow(
      /повторяется id «1»/,
    );
    expect(() =>
      parse({ status: "ok", variants: [{ id: "a", kites }, { id: "a", kites }] }),
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
    expect(() => parse({ status: "ok", variants: [{ kites, ...over }] })).toThrow(message);
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

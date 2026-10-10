import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DISCIPLINES, type Discipline, type Figure, listFigures } from "./figures";
import { parseGeometry } from "./geometry";
import { crewOf, kiteSteps, listRoutines, parseRoutine, ROUTINES_DIR } from "./routines";

type Raw = Record<string, unknown>;

// Каталог читается один раз и тем же кодом, что на сборке: ссылки рутины
// разворачиваются в шаги настоящих фигур.
const figures = listFigures();

const start = (at: [number, number]): Raw => ({ kind: "start", at });
const markIn: Raw = { kind: "mark", mark: "in" };
const markOut: Raw = { kind: "mark", mark: "out" };
const line = (to: [number, number], over: Raw = {}): Raw => ({ kind: "line", to, ...over });
const own = (steps: unknown[], over: Raw = {}): Raw => ({ origin: "own", paths: { "1": steps }, ...over });

// Своя работа одного четырёхстропного кайта: слайд, поворот на месте, остановка.
function routine(over: Raw = {}): Raw {
  return {
    schema: 1,
    name: "Проба",
    discipline: "multi-line-individual",
    kites: ["1"],
    segments: [
      own([
        start([-50, 20]),
        markIn,
        line([0, 20], { nose: 0, seconds: 4 }),
        { kind: "rotate", degrees: 90, direction: "cw", about: "center", seconds: 1.5 },
        { kind: "mark", mark: "stall", nose: 90, seconds: 2 },
        { kind: "arc", to: [0, 70], center: [0, 45], direction: "ccw", sweep: 180 },
        markOut,
      ]),
    ],
    ...over,
  };
}

const parse = (raw: unknown, file = "proba.json") => parseRoutine(file, JSON.stringify(raw), figures);
const segments = (list: unknown[], over: Raw = {}) => parse(routine({ segments: list, ...over }));

// MI 28 — квадрат одного кайта: вход в (−30; 10).
const SQUARE = "mi-28-square";

describe("parseRoutine", () => {
  it("читает рутину из своих шагов: состав, шаги, длительности", () => {
    const result = parse(routine({ summary: "Слайд и полукруг." }));
    expect(result).toMatchObject({
      slug: "proba",
      name: "Проба",
      summary: "Слайд и полукруг.",
      discipline: "multi-line-individual",
      kites: ["1"],
    });
    expect(result.segments).toEqual([
      {
        origin: "own",
        paths: {
          "1": [
            { kind: "start", at: [-50, 20] },
            { kind: "mark", mark: "in" },
            { kind: "line", to: [0, 20], nose: 0, seconds: 4 },
            { kind: "rotate", degrees: 90, direction: "cw", about: "center", seconds: 1.5 },
            { kind: "mark", mark: "stall", nose: 90, seconds: 2 },
            { kind: "arc", to: [0, 70], center: [0, 45], direction: "ccw", sweep: 180, nose: "forward" },
            { kind: "mark", mark: "out" },
          ],
        },
      },
    ]);
  });

  it("свой шаг происхождения из книги не несёт: поля basis в разобранном шаге нет", () => {
    for (const { step } of kiteSteps(parse(routine()), "1")) {
      expect(step).not.toHaveProperty("basis");
    }
  });

  it.each([
    ["basis у отрезка", line([0, 20], { basis: "measured" }), /\.basis: поле говорит о странице книги/],
    ["basis у старта", { ...start([0, 20]), basis: "grid" }, /\.basis: поле говорит о странице книги/],
    ["unmarked", line([0, 20], { unmarked: true }), /\.unmarked: поле говорит о странице книги/],
    ["kites", line([0, 20], { kites: 1 }), /\.kites: поле говорит о странице книги/],
    ["word", { ...markIn, word: true }, /\.word: поле говорит о странице книги/],
    [
      "about_basis",
      { kind: "rotate", degrees: 90, direction: "cw", about: "center", about_basis: "text" },
      /\.about_basis: поле говорит о странице книги/,
    ],
    [
      "точка поворота «not_found»",
      { kind: "rotate", degrees: 90, direction: "cw", about: { status: "not_found", reason: "нет" } },
      /\.about: ожидается одно из: center, left-tip, right-tip/,
    ],
    [
      "положение после поворота «unspecified»",
      { kind: "rotate", degrees: 180, direction: "ccw", about: "left-tip", to: { status: "unspecified", reason: "нет" } },
      /\.to: ожидается точка/,
    ],
    ["незаданная координата", line([0, null] as unknown as [number, number]), /незаданной бывает только величина книги/],
    [
      "курс носа в остановке «not_found»",
      { kind: "mark", mark: "stall", nose: { status: "not_found", reason: "нет" } },
      /курс носа в остановке, записанной не со страницы книги, — число/,
    ],
  ])("отвергает в своём шаге то, что говорит о странице книги: %s", (_label, step, message) => {
    expect(() => segments([own([start([-50, 20]), markIn, line([-40, 20]), step, markOut])])).toThrow(message);
  });

  it("геометрию своего шага проверяет тот же код, что у фигуры: дуга обязана сходиться", () => {
    const arc = { kind: "arc", to: [0, 71], center: [0, 45], direction: "ccw", sweep: 180 };
    expect(() => segments([own([start([0, 20]), markIn, arc, markOut])])).toThrow(
      /segments\[0\]\.paths\.1\[2\]: дуга не сходится/,
    );
    expect(() => segments([own([start([0, 20]), markIn, line([0, 120]), markOut])])).toThrow(/вне сетки окна/);
    expect(() => segments([own([start([0, 20]), markIn, { kind: "jump" }, markOut])])).toThrow(/\.kind: ожидается одно из/);
  });

  it.each([
    ["ноль", line([0, 20], { seconds: 0 }), /\.seconds: длительность — положительное число секунд/],
    ["строка", line([0, 20], { seconds: "4" }), /\.seconds: длительность/],
    ["null", line([0, 20], { seconds: null }), /\.seconds: длительность/],
    ["отрицательная", line([0, 20], { seconds: -1 }), /\.seconds: длительность/],
    ["у «out»", { ...markOut, seconds: 1 }, /\.seconds: у старта и у вызовов «in» и «out» длительности нет/],
  ])("отвергает длительность: %s", (_label, step, message) => {
    expect(() => segments([own([start([-50, 20]), markIn, step, line([10, 30]), markOut])])).toThrow(message);
  });

  it("у вызова «in» длительности нет", () => {
    expect(() => segments([own([start([0, 20]), { ...markIn, seconds: 1 }, line([10, 20]), markOut])])).toThrow(
      /\.seconds: у старта и у вызовов/,
    );
  });

  it("у первого шага «start» длительности нет", () => {
    expect(() => segments([own([{ ...start([0, 20]), seconds: 1 }, markIn, line([10, 20]), markOut])])).toThrow(
      /\.seconds: у старта и у вызовов/,
    );
  });

  it.each([
    ["путь не со старта", [markIn, line([10, 20]), markOut], /путь кайта начинается шагом «start»/],
    ["второй старт", [start([0, 20]), markIn, start([5, 20]), line([10, 20]), markOut], /путь кайта начинается шагом «start»/],
    ["нет «in»", [start([0, 20]), line([10, 20]), markOut], /ровно одна отметка «in» и после неё ровно одна «out»/],
    ["два «out»", [start([0, 20]), markIn, line([10, 20]), markOut, markOut], /ровно одна отметка «in»/],
    ["«out» раньше «in»", [start([0, 20]), markOut, line([10, 20]), markIn], /ровно одна отметка «in»/],
    ["между вызовами пусто", [start([0, 20]), markIn, markOut, line([10, 20])], /между «in» и «out» нет ни одного отрезка или дуги/],
  ])("отвергает путь: %s", (_label, steps, message) => {
    expect(() => segments([own(steps)])).toThrow(message);
  });

  it("вызовы «in» и «out» считаются по всей рутине, а не по части", () => {
    const result = segments([own([start([0, 20]), markIn]), own([line([10, 20])]), own([markOut])]);
    expect(kiteSteps(result, "1").map((item) => item.segment)).toEqual([0, 0, 1, 2]);
    expect(() => segments([own([start([0, 20]), markIn, line([10, 20]), markOut]), own([markIn, line([20, 20]), markOut])])).toThrow(
      /кайт «1»: в рутине должна быть ровно одна отметка «in»/,
    );
  });

  it.each([
    ["schema", { schema: 2 }, /поле «schema» должно быть равно 1/],
    ["name", { name: " " }, /name: должно быть непустой строкой/],
    ["summary", { summary: "" }, /summary: должно быть непустой строкой/],
    ["discipline", { discipline: "multi-line" }, /поле «discipline» — одно из/],
    ["kites не список", { kites: "1" }, /kites: ожидается непустой список/],
    ["kites пуст", { kites: [] }, /kites: ожидается непустой список/],
    ["кайт «__proto__»", { kites: ["__proto__"] }, /kites\[0\]: номер кайта — строка из латинских букв и цифр/],
    ["кайт числом", { kites: [1] }, /kites\[0\]: номер кайта/],
    ["повтор кайта", { discipline: "multi-line-pair", kites: ["1", "1"] }, /номера кайтов повторяются/],
    ["двое в одиночном разделе", { kites: ["1", "2"] }, /кайтов ровно 1, а записано 2/],
    ["один в паре", { discipline: "multi-line-pair" }, /кайтов ровно 2, а записано 1/],
    ["двое в команде", { discipline: "dual-line-team", kites: ["1", "2"] }, /кайтов не меньше 3, а записано 2/],
    ["segments пуст", { segments: [] }, /segments: ожидается непустой список частей/],
    ["незнакомое поле", { duration: 60 }, /незнакомое поле «duration»/],
    ["часть без origin", { segments: [{ paths: { "1": [] } }] }, /segments\[0\]\.origin: ожидается одно из: figure, link, own/],
    ["origin из basis", { segments: [{ origin: "measured", paths: { "1": [] } }] }, /segments\[0\]\.origin: ожидается одно из/],
    ["незнакомое поле части", { segments: [own([start([0, 20])], { figure: SQUARE })] }, /segments\[0\]: незнакомое поле «figure»/],
    ["путь чужого кайта", { segments: [{ origin: "own", paths: { "2": [] } }] }, /segments\[0\]\.paths: незнакомое поле «2»/],
    ["кайт без пути", { segments: [{ origin: "own", paths: {} }] }, /segments\[0\]\.paths\.1: ожидается список шагов кайта/],
    ["часть без шагов", { segments: [own([])] }, /segments\[0\]\.paths: в части нет ни одного шага/],
  ])("отвергает запись: %s", (_label, over, message) => {
    expect(() => parse(routine(over))).toThrow(message);
  });

  it("отвергает не JSON и имя файла не из строчных букв, цифр и дефисов", () => {
    expect(() => parseRoutine("proba.json", "{", figures)).toThrow(/proba\.json: не JSON/);
    expect(() => parseRoutine("proba.json", "[]", figures)).toThrow(/proba\.json: ожидается объект/);
    expect(() => parse(routine(), "Proba 1.json")).toThrow(/имя файла рутины/);
  });

  it("в паре путь в каждой части записан у каждого кайта; кайт, который не летит, получает пустой список", () => {
    const result = parse(
      routine({
        discipline: "multi-line-pair",
        kites: ["1", "2"],
        segments: [
          { origin: "own", paths: { "1": [start([-50, 20]), markIn], "2": [start([50, 20]), markIn] } },
          { origin: "own", paths: { "1": [line([-10, 20], { sync: "a" })], "2": [] } },
          { origin: "own", paths: { "1": [markOut], "2": [line([10, 20], { sync: "a" }), markOut] } },
        ],
      }),
    );
    expect(kiteSteps(result, "2").map((item) => item.step.kind)).toEqual(["start", "mark", "line", "mark"]);
    expect(() =>
      parse(
        routine({
          discipline: "multi-line-pair",
          kites: ["1", "2"],
          segments: [{ origin: "own", paths: { "1": [start([-50, 20]), markIn, line([0, 20]), markOut], "2": [] } }],
        }),
      ),
    ).toThrow(/кайт «2»: в рутине нет ни одного шага этого кайта/);
  });
});

describe("ссылка на фигуру каталога", () => {
  const square = figures.find((item) => item.slug === SQUARE)!;
  const squarePath = square.geometry.status === "ok" ? square.geometry.variants[0].kites[0].path : [];
  const body = squarePath.slice(2, -1);
  const lead = own([start([-50, 10]), markIn]);
  const link = { origin: "link", paths: { "1": [line([-30, 10], { nose: 0 })] } };
  const tail = own([markOut]);
  const ref = (over: Raw = {}): Raw => ({ origin: "figure", figure: SQUARE, ...over });

  it("фигура для теста — та, на которую он рассчитан: один вариант, вход в (−30; 10), вызовы по краям пути", () => {
    expect(square.code).toBe("MI 28");
    expect(square.geometry.status === "ok" && square.geometry.variants.map((item) => item.id)).toEqual(["main"]);
    expect(squarePath[0]).toMatchObject({ kind: "start", at: [-30, 10] });
    expect(squarePath[1]).toMatchObject({ mark: "in" });
    expect(squarePath.at(-1)).toMatchObject({ mark: "out" });
    expect(body.length).toBeGreaterThan(0);
  });

  it("разворачивается в шаги фигуры между её «in» и «out»; вызовы и старт фигуры в рутину не идут", () => {
    const result = segments([lead, link, ref(), tail]);
    expect(result.segments[2]).toEqual({ origin: "figure", figure: SQUARE, variant: "main", paths: { "1": body } });
    const steps = kiteSteps(result, "1");
    expect(steps.filter((item) => item.step.kind === "start")).toHaveLength(1);
    expect(steps.filter((item) => item.step.kind === "mark" && item.step.mark === "in")).toHaveLength(1);
    expect(steps.filter((item) => item.step.kind === "mark" && item.step.mark === "out")).toHaveLength(1);
  });

  it("каждый шаг знает, откуда взят: своя работа, связка, фигура", () => {
    const steps = kiteSteps(segments([lead, link, ref(), tail]), "1");
    expect(steps.map((item) => item.origin)).toEqual(["own", "own", "link", ...body.map(() => "figure"), "own"]);
    // Происхождение координаты из книги остаётся у шагов фигуры и только у них.
    for (const { step, origin } of steps) {
      expect("basis" in step, `${origin} ${step.kind}`).toBe(origin === "figure" && step.kind !== "mark" && !(step.kind === "rotate" && step.to === undefined));
    }
  });

  it("длительности шагов фигуры записаны списком у ссылки, по одной на шаг; null — темп не задан", () => {
    const given = body.map((_, index) => (index === 1 ? null : index + 1));
    const result = segments([lead, link, ref({ seconds: { "1": given } }), tail]);
    expect(result.segments[2].paths["1"].map((step) => step.seconds ?? null)).toEqual(given);
    // Записи каталога длительность не достаётся.
    expect(squarePath.some((step) => "seconds" in step)).toBe(false);
  });

  it.each([
    ["короче пути", (size: number) => ({ "1": Array(size - 1).fill(1) }), /seconds\.1: ожидается список из \d+ значений — по одному на шаг фигуры MI 28/],
    ["не список", () => ({ "1": 30 }), /seconds\.1: ожидается список из/],
    ["ноль", (size: number) => ({ "1": Array(size).fill(0) }), /seconds\.1\[0\]: длительность — положительное число/],
    ["чужой кайт", () => ({ "2": [] }), /seconds: незнакомое поле «2»/],
  ])("отвергает длительности фигуры: %s", (_label, make, message) => {
    expect(() => segments([lead, link, ref({ seconds: make(body.length) }), tail])).toThrow(message);
  });

  it("отвергает фигуру, до входа которой кайт не долетел: нужна связка", () => {
    expect(() => segments([lead, ref(), tail])).toThrow(
      /segments\[1\]: кайт «1» стоит в \[-50, 10\], а фигура MI 28 начинается в \[-30, 10\]: между ними нужна связка/,
    );
    expect(() => segments([ref(), tail])).toThrow(/кайт «1» ещё не стоит в окне: до фигуры нужна своя часть с шагом «start»/);
  });

  it("после фигуры кайт стоит в её выходе: следующий шаг идёт оттуда", () => {
    const out = squarePath.findLast((step) => step.kind === "line" || step.kind === "arc")!;
    const result = segments([lead, link, ref(), own([line([out.to[0] + 10, out.to[1]]), markOut])]);
    expect(result.segments).toHaveLength(4);
    expect(() => segments([lead, link, ref(), own([line([out.to[0], out.to[1]]), markOut])])).toThrow(/отрезок нулевой длины/);
  });

  it.each([
    ["фигуры нет в каталоге", ref({ figure: "mi-99-none" }), /figure: фигуры «mi-99-none» нет в каталоге/],
    ["фигура другого раздела", ref({ figure: "di-02-circle" }), /фигура DI 02 — из раздела «dual-line-individual», а рутина — «multi-line-individual»/],
    ["варианта нет", ref({ variant: "team-3" }), /variant: у фигуры MI 28 варианты: main — нужен один из них/],
    ["шаги вместо ссылки", ref({ paths: { "1": [] } }), /segments\[2\]: незнакомое поле «paths»/],
    ["фигура без имени", { origin: "figure" }, /figure: должно быть непустой строкой/],
  ])("отвергает ссылку: %s", (_label, segment, message) => {
    expect(() => segments([lead, link, segment, tail])).toThrow(message);
  });

  it("у фигуры с несколькими вариантами вариант назван, и кайты рутины — кайты варианта", () => {
    const team = figures.find((item) => item.discipline === "dual-line-team" && item.geometry.status === "ok" && item.geometry.variants.length > 1)!;
    const variants = team.geometry.status === "ok" ? team.geometry.variants : [];
    const three = variants.find((item) => item.kites.length === 3)!;
    const kites = three.kites.map((kite) => kite.id);
    const at = (id: string) => three.kites.find((kite) => kite.id === id)!.path[0] as unknown as { at: [number, number] };
    const open = { origin: "own", paths: Object.fromEntries(kites.map((id) => [id, [start(at(id).at), markIn]])) };
    const close = { origin: "own", paths: Object.fromEntries(kites.map((id) => [id, [markOut]])) };
    const make = (segment: Raw, list = kites) => parse(routine({ discipline: "dual-line-team", kites: list, segments: [open, segment, close] }));
    expect(make({ origin: "figure", figure: team.slug, variant: three.id }).segments[1]).toMatchObject({ variant: three.id });
    expect(() => make({ origin: "figure", figure: team.slug })).toThrow(/variant: у фигуры .* варианты: .*нужен один из них/);
    const other = variants.find((item) => item.kites.length !== 3)!;
    expect(() => make({ origin: "figure", figure: team.slug, variant: other.id })).toThrow(/кайты варианта «.*» фигуры .* — .*, а кайты рутины — 1, 2, 3/);
  });

  it("связка стоит рядом с фигурой; путь без фигуры рядом — своя работа", () => {
    const loose = { origin: "link", paths: { "1": [line([0, 40])] } };
    expect(() => segments([lead, loose, tail])).toThrow(/segments\[1\]\.origin: связка стоит рядом с фигурой каталога/);
    expect(segments([lead, link, ref(), { origin: "link", paths: { "1": [line([0, 90])] } }, tail]).segments.map((item) => item.origin)).toEqual([
      "own",
      "link",
      "figure",
      "link",
      "own",
    ]);
  });

  // Разворачивание проверено на всех данных каталога, а не на одной фигуре:
  // рутина «встать во вход, фигура, выйти» читается для каждого варианта.
  it("каждый вариант каждой фигуры каталога встаёт в рутину целиком", () => {
    let count = 0;
    for (const figure of figures) {
      if (figure.geometry.status !== "ok") {
        continue;
      }
      for (const variant of figure.geometry.variants) {
        const kites = variant.kites.map((kite) => kite.id);
        const [least, most] = crewOf(figure.discipline);
        if (kites.length < least || kites.length > most) {
          continue;
        }
        const starts = Object.fromEntries(
          variant.kites.map((kite) => [kite.id, [start((kite.path[0] as unknown as { at: [number, number] }).at), markIn]]),
        );
        const result = parse({
          schema: 1,
          name: figure.code,
          discipline: figure.discipline,
          kites,
          segments: [
            { origin: "own", paths: starts },
            { origin: "figure", figure: figure.slug, variant: variant.id },
            { origin: "own", paths: Object.fromEntries(kites.map((id) => [id, [markOut]])) },
          ],
        });
        for (const kite of variant.kites) {
          expect(result.segments[1].paths[kite.id], `${figure.slug} ${variant.id} #${kite.id}`).toEqual(kite.path.slice(2, -1));
        }
        count += 1;
      }
    }
    // Ни один вариант не пропущен: геометрия снята у всех, состав в границах раздела.
    expect(count).toBe(figures.reduce((sum, item) => sum + (item.geometry.status === "ok" ? item.geometry.variants.length : 0), 0));
    expect(count).toBeGreaterThanOrEqual(figures.length);
  });
});

// Каталог из своих фигур: в настоящем у каждого пути «in» стоит сразу за
// стартом, «out» — последним, и срез ссылки на нём не отличить от «всё, кроме
// краёв». Здесь до входа и после выхода есть пролёты, а вход и выход — в
// разных точках.
describe("ссылка на фигуру: срез, вход и выход", () => {
  const fake = (slug: string, number: number, geometry: Raw): Figure => ({
    slug,
    discipline: "multi-line-pair",
    number,
    code: `MP ${number}`,
    name: slug,
    status: "current",
    source: { document: "book", version: "1.0", page: 1, read_on: "2026-10-10" },
    sourceUrl: "https://example.org/book.pdf#page=1",
    summary: "Фигура теста.",
    geometry: parseGeometry(slug, geometry, 10),
  });
  const kite = (id: string, x: number): Raw => ({
    id,
    path: [start([x, 10]), line([x, 30]), markIn, line([x, 50]), { kind: "mark", mark: "stall", nose: 0 }, line([x + 10, 50], { nose: 0 }), markOut, line([x + 10, 80])],
  });
  const variant = (ids: string[]): Raw => ({ id: "main", kites: ids.map((id, index) => kite(id, index * 40 - 40)), grid: { x: [0], y: [50] }, guides: { status: "not_found", reason: "нет" } });
  const catalog = [
    fake("mp-90-proba", 90, { status: "ok", variants: [variant(["1", "2"])] }),
    fake("mp-91-chuzhie", 91, { status: "ok", variants: [variant(["1", "3"])] }),
    fake("mp-92-pusto", 92, { status: "not_found", reason: "схемы нет" }),
  ];
  const pair = (list: unknown[]) =>
    parseRoutine("para.json", JSON.stringify(routine({ discipline: "multi-line-pair", kites: ["1", "2"], segments: list })), catalog);
  const open = (first: [number, number] = [-40, 30]) => ({ origin: "own", paths: { "1": [start(first), markIn], "2": [start([0, 30]), markIn] } });
  const close = (steps: unknown[] = []) => ({ origin: "own", paths: { "1": [...steps, markOut], "2": [markOut] } });
  const ref = (over: Raw = {}): Raw => ({ origin: "figure", figure: "mp-90-proba", ...over });

  it("берутся только шаги между «in» и «out» фигуры", () => {
    const result = pair([open(), ref(), close()]);
    expect(result.segments[1].paths["1"]).toMatchObject([{ kind: "line", to: [-40, 50] }, { mark: "stall" }, { kind: "line", to: [-30, 50] }]);
    expect(result.segments[1].paths["2"]).toMatchObject([{ kind: "line", to: [0, 50] }, { mark: "stall" }, { kind: "line", to: [10, 50] }]);
  });

  it("вход — точка, где кайт стоит на «in» фигуры, а не её старт; сверяются обе координаты", () => {
    expect(() => pair([open([-40, 10]), ref(), close()])).toThrow(/кайт «1» стоит в \[-40, 10\], а фигура MP 90 начинается в \[-40, 30\]/);
    expect(() => pair([open([-39, 30]), ref(), close()])).toThrow(/нужна связка/);
  });

  it("расхождение со входом до 0,05 единицы прощается на любой координате, больше — нет", () => {
    expect(pair([open([-40.05, 30]), ref(), close()]).segments).toHaveLength(3);
    expect(pair([open([-40, 30.05]), ref(), close()]).segments).toHaveLength(3);
    expect(() => pair([open([-40.06, 30]), ref(), close()])).toThrow(/нужна связка/);
    expect(() => pair([open([-40, 29.94]), ref(), close()])).toThrow(/нужна связка/);
  });

  it("после фигуры кайт стоит в её выходе, а не во входе и не в конце её пути", () => {
    expect(() => pair([open(), ref(), close([line([-30, 50])])])).toThrow(/отрезок нулевой длины/);
    expect(pair([open(), ref(), close([line([-40, 30])])]).segments).toHaveLength(3);
    expect(pair([open(), ref(), close([line([-30, 80])])]).segments).toHaveLength(3);
  });

  it("курс носа после фигуры и после своего шага известен: законцовка поворота сверяется с ним", () => {
    // Фигура кончается слайдом вправо носом вверх: левая законцовка — слева.
    const swing = (about: string) => ({ kind: "rotate", degrees: 180, direction: "ccw", about, to: [-38, 50] });
    expect(pair([open(), ref(), close([swing("left-tip")])]).segments).toHaveLength(3);
    expect(() => pair([open(), ref(), close([swing("right-tip")])])).toThrow(/это «left-tip», а записано «right-tip»/);
    expect(() => pair([open(), ref(), close([line([-30, 60]), { kind: "rotate", degrees: 180, direction: "ccw", about: "right-tip", to: [-38, 60] }])])).toThrow(
      /это «left-tip», а записано «right-tip»/,
    );
  });

  it("длительности фигуры у каждого кайта свои; список длиннее пути отвергается", () => {
    const result = pair([open(), ref({ seconds: { "1": [1, 2, 3], "2": [4, null, 6] } }), close()]);
    expect(result.segments[1].paths["1"].map((step) => step.seconds)).toEqual([1, 2, 3]);
    expect(result.segments[1].paths["2"].map((step) => step.seconds)).toEqual([4, undefined, 6]);
    expect(pair([open(), ref({ seconds: { "2": [4, 5, 6] } }), close()]).segments[1].paths["1"].some((step) => "seconds" in step)).toBe(false);
    expect(() => pair([open(), ref({ seconds: { "1": [1, 2, 3, 4] } }), close()])).toThrow(/seconds\.1: ожидается список из 3 значений/);
    expect(() => pair([open(), ref({ seconds: { "1": [1, -2, 3] } }), close()])).toThrow(/seconds\.1\[1\]: длительность/);
  });

  it("отвергает фигуру, чьи кайты — не кайты рутины, и фигуру без снятой геометрии", () => {
    expect(() => pair([open(), ref({ figure: "mp-91-chuzhie" }), close()])).toThrow(/кайты варианта «main» фигуры MP 91 — 1, 3, а кайты рутины — 1, 2/);
    expect(() => pair([open(), ref({ figure: "mp-92-pusto" }), close()])).toThrow(/у фигуры MP 92 геометрия не снята/);
  });

  it("свой шаг без точки поворота или курса в остановке получает подсказку без «not_found»", () => {
    const bad = (step: Raw) => () => pair([open(), ref(), close([step])]);
    expect(bad({ kind: "rotate", degrees: 90, direction: "cw" })).toThrow(/\.about: обязательна точка поворота: center, left-tip, right-tip$/);
    expect(bad({ kind: "mark", mark: "stall" })).toThrow(/\.nose: у остановки обязателен курс носа числом$/);
  });
});

// Примеры в описании формата — то, с чего автор рутины начнёт: они обязаны
// читаться тем же разбором.
describe("docs/routines.md", () => {
  const doc = fs.readFileSync(path.join(process.cwd(), "docs", "routines.md"), "utf8");

  it("пример записи читается, и пример длительностей фигуры встаёт на место её ссылки", () => {
    const example = JSON.parse(/```json\n([\s\S]*?)```/.exec(doc)![1]) as { segments: Raw[] };
    expect(parse(example).segments.map((item) => item.origin)).toEqual(["own", "link", "figure", "own"]);
    const timed = JSON.parse(/`(\{"origin": "figure"[^`]*\})`/.exec(doc)![1]) as Raw;
    const result = parse({ ...example, segments: example.segments.map((item) => (item.origin === "figure" ? timed : item)) });
    expect(result.segments[2].paths["1"].map((step) => step.seconds)).toEqual([6, 1, 6, 6, 6]);
  });
});

describe("время остаётся в рутине", () => {
  it("шаг фигуры длительности не принимает", () => {
    const path = [start([0, 20]), markIn, line([10, 20], { seconds: 4 }), markOut];
    const geometry = {
      status: "ok",
      variants: [{ id: "main", kites: [{ id: "1", path }], grid: { x: [0], y: [50] }, guides: { status: "not_found", reason: "нет" } }],
    };
    expect(() => parseGeometry("g", geometry, 125)).toThrow(/незнакомое поле «seconds»/);
  });
});

describe("crewOf", () => {
  it("состав определён у каждого раздела из списка", () => {
    expect((Object.keys(DISCIPLINES) as Discipline[]).map((item) => crewOf(item))).toEqual([
      [1, 1],
      [2, 2],
      [3, Infinity],
      [1, 1],
      [2, 2],
      [3, Infinity],
    ]);
  });
});

describe("listRoutines", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "routines-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("читает рутины каталога по имени файла", () => {
    fs.writeFileSync(path.join(dir, "b-vtoraya.json"), JSON.stringify(routine()));
    fs.writeFileSync(path.join(dir, "a-pervaya.json"), JSON.stringify(routine()));
    fs.writeFileSync(path.join(dir, "README.md"), "не рутина");
    expect(listRoutines(dir, figures).map((item) => item.slug)).toEqual(["a-pervaya", "b-vtoraya"]);
  });

  it("роняет чтение на битом файле с его именем и на том, что рутиной только выглядит", () => {
    fs.writeFileSync(path.join(dir, "bitaya.json"), JSON.stringify(routine({ schema: 0 })));
    expect(() => listRoutines(dir, figures)).toThrow(/bitaya\.json: поле «schema»/);
    fs.rmSync(path.join(dir, "bitaya.json"));
    fs.mkdirSync(path.join(dir, "papka.json"));
    expect(() => listRoutines(dir, figures)).toThrow(/papka\.json: рутина — обычный файл/);
  });

  it("каталога рутин может не быть: тогда рутин нет", () => {
    expect(listRoutines(path.join(dir, "net"), figures)).toEqual([]);
  });

  it("каталог репозитория читается", () => {
    expect(() => listRoutines(ROUTINES_DIR, figures)).not.toThrow();
  });
});

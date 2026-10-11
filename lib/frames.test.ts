import { describe, expect, it } from "vitest";

import { drawVariant, frameLabel, shape } from "./diagram";
import { listFigures } from "./figures";
import { clockText, overviewOf, spanText, storyboard } from "./frames";
import { listRoutines, parseRoutine } from "./routines";
import { describeKite } from "./steps";

type Raw = Record<string, unknown>;

// Каталог читается один раз и тем же кодом, что на сборке.
const figures = listFigures();

const start = (at: readonly [number, number]): Raw => ({ kind: "start", at });
const markIn: Raw = { kind: "mark", mark: "in" };
const markOut: Raw = { kind: "mark", mark: "out" };
const line = (to: [number, number], over: Raw = {}): Raw => ({ kind: "line", to, ...over });
const own = (steps: unknown[], origin = "own"): Raw => ({ origin, paths: { "1": steps } });

const board = (segments: unknown[], over: Raw = {}) =>
  storyboard(
    parseRoutine(
      "proba.json",
      JSON.stringify({ schema: 1, name: "Проба", discipline: "multi-line-individual", kites: ["1"], segments, ...over }),
      figures,
    ),
    figures,
  );

// MI 28 — квадрат одного кайта: вход и выход в (−30; 10), пять шагов.
const SQUARE = "mi-28-square";

// Номера кадров на обзоре не лежат друг на друге: у каждой пары либо зазор по
// горизонтали, либо разные строки.
function overlaps(labels: { x: number; y: number; text: string }[]): number {
  let count = 0;
  labels.forEach((a, index) => {
    for (const b of labels.slice(index + 1)) {
      if (Math.abs(a.x - b.x) < (a.text.length + b.text.length) * 1.9 && Math.abs(a.y - b.y) < 6) {
        count += 1;
      }
    }
  });
  return count;
}

describe("кадры рутины", () => {
  it("кадр — часть, в которой кайт перемещается; часть без перемещения показана в соседнем кадре", () => {
    const { frames } = board([
      own([start([-60, 10]), markIn]),
      own([line([-30, 10], { nose: 0, seconds: 3 })], "link"),
      { origin: "figure", figure: SQUARE },
      own([{ kind: "mark", mark: "stall", nose: 90, seconds: 2 }]),
      own([line([0, 10], { nose: 90 }), markOut]),
    ]);
    expect(frames.map((frame) => frame.parts.map((part) => `${part.segment}:${part.origin}`))).toEqual([
      // Старт и вызов до первого пролёта — в кадре после них.
      ["0:own", "1:link"],
      // Остановка после фигуры — в кадре фигуры: она в точке, куда фигура привела.
      ["2:figure", "3:own"],
      ["4:own"],
    ]);
    expect(frames.map((frame) => frame.number)).toEqual([1, 2, 3]);
    expect(frames[1].parts[0].figure).toEqual({ slug: SQUARE, title: "MI 28 — Square" });
  });

  it("кадр продолжает путь: начинается в точке, где кайт стоит, и его шаги — шаги части", () => {
    const { frames } = board([own([start([-60, 10]), markIn, line([-30, 10], { nose: 0 })]), { origin: "figure", figure: SQUARE }, own([markOut])]);
    const path = frames[1].variant.kites[0].path;
    expect(path[0]).toEqual({ kind: "start", at: [-30, 10], basis: "grid" });
    // Пять шагов фигуры между её «in» и «out» и вызов рутины; вызовов фигуры нет.
    expect(path.slice(1).map((step) => (step.kind === "mark" ? step.mark : step.kind))).toEqual(["line", "rotate", "line", "line", "line", "out"]);
    // Длительность — поле рутины: чертёж её не видит.
    expect(path.every((step) => !("seconds" in step))).toBe(true);
  });

  it("у кадра фигуры линии сетки — со страницы книги, у своего — через точки пути", () => {
    const { frames } = board([own([start([-60, 10]), markIn, line([-30, 10], { nose: 0 })]), { origin: "figure", figure: SQUARE }, own([markOut])]);
    expect(frames[0].variant.grid).toEqual({ x: [-60, -30], y: [10] });
    const square = figures.find((figure) => figure.slug === SQUARE)!;
    expect(square.geometry.status === "ok" && frames[1].variant.grid).toEqual(square.geometry.status === "ok" && square.geometry.variants[0].grid);
  });

  it("на схеме кадра стоят номер кадра и номер следующего; у последнего кадра следующего нет", () => {
    const { frames } = board([own([start([-60, 10]), markIn, line([-30, 10], { nose: 0 })]), { origin: "figure", figure: SQUARE }, own([line([0, 10], { nose: 90 }), markOut])]);
    const marks = frames.map((frame) => frame.drawing.labels.filter((label) => label.tone === "t-frame").map((label) => label.text));
    expect(marks).toEqual([
      ["№1", "→№2"],
      ["№2", "→№3"],
      ["№3"],
    ]);
    // Вход и выход рутины — там, где они записаны, и только там.
    const words = frames.map((frame) => frame.drawing.labels.filter((label) => label.text === "In" || label.text === "Out").map((label) => label.text));
    expect(words).toEqual([["In"], [], ["Out"]]);
  });

  it("стрелки кадра цвета не несут: первый проход кадра — не от входа, последний — не к выходу", () => {
    const { frames } = board([own([start([-60, 10]), markIn, line([-30, 10], { nose: 0 })]), { origin: "figure", figure: SQUARE }, own([markOut])]);
    expect(frames.flatMap((frame) => frame.drawing.arrows.map((arrow) => arrow.tone))).toEqual(["mid", "mid"]);
    // На странице фигуры та же фигура цвет несёт: правка кадра её не задела.
    const square = figures.find((figure) => figure.slug === SQUARE)!;
    const drawing = square.geometry.status === "ok" ? drawVariant(square.geometry.variants[0], true) : undefined;
    expect(drawing?.arrows.map((arrow) => arrow.tone).sort()).toEqual(["in", "mid", "out"]);
    expect(drawing?.labels.some((label) => label.tone === "t-frame")).toBe(false);
  });

  it("кайт приходит в кадр с курсом носа из предыдущего: значок в начале кадра смотрит по нему", () => {
    // Кадр 2 начинается выходом: значок выхода стоит до первого пролёта кадра.
    const { frames } = board([own([start([-60, 10]), markIn, line([-30, 10], { nose: 90 })]), own([markOut, line([-30, 40], { nose: 0 })])]);
    const out = frames[1].drawing.shapes.out;
    expect(out).toEqual([{ tone: "", d: shape("out", -30, 90, [1, 0], 1, true, true) }]);
    // Без курса на входе тот же вариант нарисовал бы выход носом вверх.
    expect(drawVariant(frames[1].variant, true).shapes.out?.[0].d).toBe(shape("out", -30, 90, [0, 1], 1, true, true));
  });

  it("остановка, записанная автором, о схеме книги не говорит; остановка фигуры — говорит", () => {
    const { frames } = board([own([start([-60, 10]), markIn, line([-30, 10], { nose: 0 }), { kind: "mark", mark: "stall", nose: 90 }, markOut])]);
    expect(frames[0].kites[0].lines.map((item) => item.text)).toEqual(["Точка (−60; 10) — вход (IN)", "Прямая до (−30; 10), нос вверх — остановка, кайт носом вправо, выход (OUT)"]);
    // MI 20 — фигура с остановками: вход в (0; 0).
    const lift = board([own([start([0, 0]), markIn]), { origin: "figure", figure: "mi-20-lift" }, own([markOut])]);
    expect(lift.frames[0].kites[0].lines.some((item) => item.text.includes("на схеме книги кайт носом"))).toBe(true);
  });

  it("строка начала кадра есть, только когда в этой точке что-то происходит; счёт строк сквозной", () => {
    const { frames } = board([
      own([start([-60, 10]), markIn, line([-30, 10], { nose: 0 })]),
      own([{ kind: "rotate", degrees: 90, direction: "cw", about: "center" }, line([0, 10], { nose: 90 })]),
      own([line([0, 40], { nose: 90 }), markOut]),
    ]);
    expect(frames.map((frame) => frame.kites[0].lines.map((item) => item.text))).toEqual([
      ["Точка (−60; 10) — вход (IN)", "Прямая до (−30; 10), нос вверх"],
      ["Точка (−30; 10) — поворот на 90° по часовой стрелке вокруг центра", "Прямая до (0; 10), нос вправо"],
      ["Прямая до (0; 40), нос вправо — выход (OUT)"],
    ]);
    expect(frames.map((frame) => frame.kites[0].first)).toEqual([1, 3, 5]);
  });
});

describe("кадры пары", () => {
  // Кайт 2 появляется первым и стоит, пока стартует кайт 1; потом летят оба.
  const pair = () =>
    storyboard(
      parseRoutine(
        "proba.json",
        JSON.stringify({
          schema: 1,
          name: "Проба",
          discipline: "multi-line-pair",
          kites: ["1", "2"],
          segments: [
            { origin: "own", paths: { "1": [], "2": [start([40, 10]), markIn, line([40, 50], { nose: 90, seconds: 2 })] } },
            { origin: "own", paths: { "1": [start([-40, 10]), markIn, line([-40, 50], { nose: 90, seconds: 3 })], "2": [] } },
            {
              origin: "own",
              paths: { "1": [line([-40, 80], { nose: 90, seconds: 1 }), markOut], "2": [line([40, 80], { nose: 90, seconds: 1 }), markOut] },
            },
          ],
        }),
        figures,
      ),
      figures,
    );

  it("кайт несёт свой цвет и номер и в кадре, где он один; кайт, который в кадре стоит, в него не входит", () => {
    const { frames, clocks } = pair();
    expect(frames.map((frame) => frame.variant.kites.map((kite) => `${kite.id}:${kite.color}`))).toEqual([["2:2"], ["1:1"], ["1:1", "2:2"]]);
    expect(frames.map((frame) => frame.kites.map((kite) => `${kite.id}:${kite.first}+${kite.lines.length}`))).toEqual([
      ["2:1+2"],
      ["1:1+2"],
      ["1:3+1", "2:3+1"],
    ]);
    expect(frames[0].drawing.shapes.in?.map((item) => item.tone)).toEqual(["k2"]);
    expect(frames[2].drawing.shapes.out?.map((item) => item.tone)).toEqual(["k1", "k2"]);
    expect(overviewOf(frames).tracks.map((track) => `${track.frame}:${track.color}`)).toEqual(["1:2", "2:1", "3:1", "3:2"]);
    // Часы у каждого кайта свои: от его первого шага.
    expect(clocks.map((clock) => clock.total)).toEqual([4, 3]);
  });
});

describe("время рутины", () => {
  it("строка начинается, когда кончились шаги до неё, и длится, сколько её шаги", () => {
    const { frames, clocks } = board([
      own([start([-60, 10]), line([-50, 10], { nose: 0, seconds: 2 }), markIn, line([-30, 10], { nose: 0, seconds: 3 }), { kind: "mark", mark: "stall", nose: 0, seconds: 1.5 }]),
      { origin: "figure", figure: SQUARE, seconds: { "1": [6, 1, 6, 6, 6] } },
      own([markOut, line([0, 10], { nose: 90, seconds: 4 })]),
    ]);
    expect(frames.map((frame) => frame.at)).toEqual([0, 6.5, 31.5]);
    expect(frames[0].kites[0].lines.map(({ at, seconds }) => [at, seconds])).toEqual([
      [0, 0],
      [0, 2],
      [2, 4.5],
    ]);
    expect(frames[1].kites[0].lines.map(({ at, seconds }) => [at, seconds])).toEqual([
      [6.5, 7],
      [13.5, 6],
      [19.5, 6],
      [25.5, 6],
    ]);
    // От «in» до «out» — без подлёта до вызова и без ухода после него.
    expect(clocks).toEqual([{ kite: "1", total: 35.5, judged: 29.5, untimed: 0 }]);
  });

  it("шаг без темпа числа не получает, и накопленное время после него не считается", () => {
    const { frames, clocks } = board([
      own([start([-60, 10]), markIn, line([-30, 10], { nose: 0, seconds: 3 })]),
      { origin: "figure", figure: SQUARE, seconds: { "1": [6, null, 6, 6, 6] } },
      own([line([0, 10], { nose: 90, seconds: 4 }), markOut]),
    ]);
    expect(frames[1].kites[0].lines.map(({ at, seconds }) => [at, seconds])).toEqual([
      [3, null],
      [null, 6],
      [null, 6],
      [null, 6],
    ]);
    expect(frames[2].at).toBeNull();
    expect(clocks).toEqual([{ kite: "1", total: null, judged: null, untimed: 1 }]);
  });

  it("время от IN до OUT копится своим счётом: шаг без темпа до IN или после OUT его не портит", () => {
    const timed = (before: Raw, after: Raw) =>
      board([
        own([start([-60, 10]), line([-50, 10], { nose: 0, ...before }), markIn, line([-30, 10], { nose: 0, seconds: 4 }), markOut]),
        own([line([0, 10], { nose: 0, ...after })]),
      ]).clocks[0];
    expect(timed({}, { seconds: 2 })).toEqual({ kite: "1", total: null, judged: 4, untimed: 1 });
    expect(timed({ seconds: 1 }, {})).toEqual({ kite: "1", total: null, judged: 4, untimed: 1 });
    expect(timed({ seconds: 1 }, { seconds: 2 })).toEqual({ kite: "1", total: 7, judged: 4, untimed: 0 });
  });

  it("время пишется минутами и секундами, с десятыми, когда они есть", () => {
    expect([0, 7, 43.5, 60, 187.25].map(clockText)).toEqual(["0:00", "0:07", "0:43,5", "1:00", "3:07,3"]);
    expect([4, 1.5].map(spanText)).toEqual(["4 с", "1,5 с"]);
  });
});

describe("обзорная схема", () => {
  it("несёт линию каждого кадра и номер у его начала", () => {
    const { frames } = board([own([start([-60, 10]), markIn, line([-30, 10], { nose: 0 })]), { origin: "figure", figure: SQUARE }, own([line([0, 10], { nose: 90 }), markOut])]);
    const overview = overviewOf(frames);
    expect(overview.tracks.map((track) => track.frame)).toEqual([1, 2, 3]);
    expect(overview.tracks.map((track) => track.d)).toEqual(frames.map((frame) => frame.drawing.tracks[0].d));
    expect(overview.labels.map((label) => label.text)).toEqual([1, 2, 3].map(frameLabel));
  });

  it("номера кадров не ложатся друг на друга, даже когда все кадры начинаются в одной точке", () => {
    // Двадцать кадров из одной точки: каждый улетает и возвращается.
    const rays = Array.from({ length: 20 }, (_, index): [number, number] => [-80 + index * 8, 90]);
    const { frames } = board([
      own([start([0, 50]), markIn]),
      ...rays.map((ray, index) => own([line(ray, { nose: 0 }), line([0, 50], { nose: 0 }), ...(index === rays.length - 1 ? [markOut] : [])])),
    ]);
    const { labels } = overviewOf(frames);
    expect(labels).toHaveLength(20);
    expect(overlaps(labels)).toBe(0);
    // Все номера — внутри схемы.
    expect(labels.every((label) => Math.abs(label.x) <= 110 && label.y >= -10 && label.y <= 110)).toBe(true);
  });
});

describe("раскадровка на каталоге", () => {
  // Рендерер настроен на одну фигуру; кадр обязан рисовать любую фигуру
  // каталога — с шагами без направления, незаданными величинами, поворотами со
  // смещением, парой и командой.
  it("каждая фигура каталога встаёт в кадр: линии те же, что на её странице, шагов столько же", () => {
    let drawn = 0;
    for (const figure of figures) {
      if (figure.geometry.status !== "ok") {
        continue;
      }
      for (const variant of figure.geometry.variants) {
        const kites = variant.kites.map((kite) => kite.id);
        const at = (id: string) => {
          const first = variant.kites.find((kite) => kite.id === id)!.path[0];
          return first.kind === "start" ? first.at : ([0, 0] as const);
        };
        const routine = parseRoutine(
          "proba.json",
          JSON.stringify({
            schema: 1,
            name: "Проба",
            discipline: figure.discipline,
            kites,
            segments: [
              { origin: "own", paths: Object.fromEntries(kites.map((id) => [id, [start(at(id)), markIn]])) },
              { origin: "figure", figure: figure.slug, variant: variant.id },
              { origin: "own", paths: Object.fromEntries(kites.map((id) => [id, [markOut]])) },
            ],
          }),
          figures,
        );
        const rev = figure.discipline.startsWith("multi-line");
        const { frames } = storyboard(routine, figures);
        const where = `${figure.code}, вариант «${variant.id}»`;
        expect(frames, where).toHaveLength(1);
        expect(frames[0].drawing.tracks, where).toEqual(drawVariant(variant, rev).tracks);
        // Своя часть без перемещения, показанная в кадре фигуры, линий сетки
        // не добавляет: сетка кадра — сетка страницы книги.
        expect(frames[0].variant.grid, where).toEqual({
          x: [...variant.grid.x].sort((p, q) => p - q),
          y: [...variant.grid.y].sort((p, q) => p - q),
        });
        expect(frames[0].variant.guides, where).toEqual(variant.guides.status === "ok" ? variant.guides : frames[0].variant.guides);
        expect(frames[0].variant.path_kites, where).toBe(variant.path_kites);
        expect(frames[0].kites.map((kite) => kite.lines.length), where).toEqual(variant.kites.map((kite) => describeKite(kite).length));
        expect(overviewOf(frames).labels, where).toHaveLength(1);
        drawn += 1;
      }
    }
    expect(drawn).toBeGreaterThan(96);
    // Каждый вариант рисуется дважды — кадром и схемой фигуры, — и на это
    // уходит около 3 секунд, а на раннере CI — больше пяти.
  }, 30_000);

  it("каждая рутина каталога раскадровывается, и номера кадров на её обзоре не накладываются", () => {
    const routines = listRoutines(undefined, figures);
    // Страница рутины строится по этому каталогу: пустой он оставил бы
    // маршрут без единой страницы.
    expect(routines.length).toBeGreaterThan(0);
    for (const routine of routines) {
      const { frames, clocks } = storyboard(routine, figures);
      const { labels, tracks } = overviewOf(frames);
      expect(labels, routine.slug).toHaveLength(frames.length);
      expect(overlaps(labels), routine.slug).toBe(0);
      expect(tracks.length, routine.slug).toBe(frames.reduce((sum, frame) => sum + frame.variant.kites.length, 0));
      expect(clocks.map((clock) => clock.kite), routine.slug).toEqual(routine.kites);
    }
  });
});

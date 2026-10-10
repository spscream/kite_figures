import { describe, expect, it } from "vitest";

import { listFigures } from "./figures";
import { isSwing, parseGeometry, REV_SPAN, type Point, type Step } from "./geometry";
import * as pose from "./pose";
import { poseOn, sharesOf, type Leg, type Pose } from "./pose";

// Пути этих тестов — четырёхстропные, если тест не говорит иного.
const legsOf = (steps: Step[], rev = true) => pose.legsOf(steps, rev);
const poseAt = (steps: Step[], fraction: number, weigh?: (leg: Leg) => number, rev = true) => pose.poseAt(steps, fraction, rev, weigh);

const start = { kind: "start", at: [-50, 20] };
const markIn = { kind: "mark", mark: "in" };
const markOut = { kind: "mark", mark: "out" };
const CENTER = { about: "center", about_basis: "text" };
const UNNAMED = { about: { status: "not_found", reason: "страница точку поворота не называет" } };

// Путь разбирается так же, как путь фигуры каталога: с умолчаниями и проверкой.
function path(...steps: unknown[]): Step[] {
  const raw = {
    status: "ok",
    variants: [
      {
        id: "main",
        kites: [{ id: "1", path: steps }],
        grid: { x: [0], y: [50] },
        guides: { status: "not_found", reason: "на схеме их нет" },
      },
    ],
    notes: ["для теста"],
  };
  const read = parseGeometry("g", raw, 125);
  if (read.status !== "ok") {
    throw new Error("геометрия не разобрана");
  }
  return read.variants[0].kites[0].path;
}

function catalogPath(code: string, variant = 0, kite = 0): Step[] {
  const figure = listFigures().find((item) => item.code === code);
  if (figure === undefined || figure.geometry.status !== "ok") {
    throw new Error(`нет фигуры ${code} с геометрией`);
  }
  return figure.geometry.variants[variant].kites[kite].path;
}

const UP: Point = [0, 1];
const RIGHT: Point = [1, 0];
const DOWN: Point = [0, -1];
const LEFT: Point = [-1, 0];

function expectAt(pose: Pose, point: Point | null, nose: Point | null) {
  for (const [got, want] of [[pose.point, point], [pose.nose, nose]] as const) {
    if (want === null || got === null) {
      expect(got).toBe(want);
    } else {
      expect(got[0]).toBeCloseTo(want[0], 6);
      expect(got[1]).toBeCloseTo(want[1], 6);
    }
  }
}

// Доля пути, с которой начинается шаг `index`.
const shareOf = (steps: Step[], index: number, weigh?: (leg: Leg) => number) => {
  const legs = legsOf(steps);
  return sharesOf(legs, weigh)[legs.findIndex((leg) => leg.index === index)][0];
};

describe("положение в доле пути", () => {
  it("идёт по отрезку и дуге пропорционально длине", () => {
    // Отрезок 50 и четверть круга радиуса 25: всего 50 + 12,5π.
    const steps = path(start, markIn, { kind: "line", to: [0, 20] }, { kind: "arc", to: [25, 45], center: [0, 45], direction: "ccw", sweep: 90 }, markOut);
    const total = 50 + 12.5 * Math.PI;
    expectAt(poseAt(steps, 0), [-50, 20], RIGHT);
    expectAt(poseAt(steps, 25 / total), [-25, 20], RIGHT);
    const middle = poseAt(steps, (50 + 6.25 * Math.PI) / total);
    expectAt(middle, [25 * Math.SQRT1_2, 45 - 25 * Math.SQRT1_2], [Math.SQRT1_2, Math.SQRT1_2]);
    expect(middle.step).toBe(3);
    expectAt(poseAt(steps, 1), [25, 45], UP);
    expect(poseAt(steps, 1).step).toBe(4);
    expect(poseAt(steps, 0.3).doubts).toEqual([]);
  });

  it("берёт курс носа у шага: назад, числом, наружу круга", () => {
    const steps = path(
      start,
      markIn,
      { kind: "line", to: [-30, 20], nose: "backward" },
      { kind: "line", to: [-30, 40], nose: 270 },
      { kind: "arc", to: [-30, 60], center: [-30, 50], direction: "cw", sweep: 180, nose: "out" },
      markOut,
    );
    const legs = legsOf(steps);
    expectAt(poseOn(legs[1], 0.5), [-40, 20], LEFT);
    expectAt(poseOn(legs[2], 0.5), [-30, 30], LEFT);
    // Середина полукруга по часовой от нижней точки — слева от центра.
    expectAt(poseOn(legs[3], 0.5), [-40, 50], LEFT);
  });

  it("не принимает долю вне отрезка от 0 до 1", () => {
    const steps = path(start, markIn, { kind: "line", to: [0, 20] }, markOut);
    for (const fraction of [-0.01, 1.01, Number.NaN, Infinity]) {
      expect(() => poseAt(steps, fraction)).toThrow("доля пути");
    }
    for (const t of [-0.1, 1.5, Number.NaN]) {
      expect(() => poseOn(legsOf(steps)[1], t)).toThrow("доля шага");
    }
  });

  it("кончается там, где кончается последний шаг с весом", () => {
    // За выходом — ещё пролёт: формат шаги после «out» допускает.
    const steps = path(start, markIn, { kind: "line", to: [0, 20] }, markOut, { kind: "line", to: [0, 60] });
    expectAt(poseAt(steps, 1), [0, 60], UP);
  });

  it("отвергает веса, по которым долю не посчитать", () => {
    const steps = path(start, markIn, { kind: "line", to: [0, 20] }, markOut);
    expect(() => poseAt(steps, 0.5, () => 0)).toThrow("нет ни одного шага с весом");
    expect(() => poseAt(steps, 0.5, () => -1)).toThrow("шаг 1: вес шага");
    expect(() => poseAt(steps, 0.5, () => Number.NaN)).toThrow("вес шага");
    expect(() => poseAt(steps, 0.5, () => Infinity)).toThrow("вес шага");
    // Каждый вес — число, а сумма уже нет.
    const far = path(start, markIn, { kind: "line", to: [0, 20] }, { kind: "line", to: [0, 60] }, markOut);
    expect(() => poseAt(far, 0.5, () => 1e308)).toThrow("сумма весов");
  });
});

describe("нос на стыке шагов без поворота", () => {
  // Угол: вправо, потом вверх, оба шага носом по ходу, `rotate` между ними нет.
  const corner = path(start, markIn, { kind: "line", to: [-40, 20] }, { kind: "line", to: [-40, 50] }, markOut);

  it("меняет курс скачком: до стыка курс первого шага, на стыке — второго", () => {
    expectAt(poseAt(corner, 0.25 - 1e-9), [-40, 20], RIGHT);
    expectAt(poseAt(corner, 0.25), [-40, 20], UP);
    expect(poseAt(corner, 0.25).step).toBe(3);
  });

  it("промежуточного курса не выдаёт ни в одной доле", () => {
    for (let i = 0; i <= 1000; i += 1) {
      const { nose } = poseAt(corner, i / 1000);
      expect(nose![0] === 1 || nose![1] === 1).toBe(true);
    }
  });

  it("курс шага главнее поворота перед ним", () => {
    // Поворот на 90° оставил бы нос вниз, а шаг записан с носом вправо.
    const steps = path(start, markIn, { kind: "line", to: [-40, 20] }, { kind: "rotate", degrees: 90, direction: "cw", ...CENTER }, { kind: "line", to: [-40, 50], nose: 90 }, markOut);
    expectAt(poseAt(steps, 0.25), [-40, 20], RIGHT);
  });
});

describe("поворот на месте", () => {
  const turn = (about: object, degrees = 90) =>
    path(start, markIn, { kind: "line", to: [-40, 20] }, { kind: "rotate", degrees, direction: "cw", ...about }, { kind: "line", to: [-40, 10] }, markOut);
  // Повороту дана доля пути, равная доле каждого из двух пролётов.
  const timed = (leg: Leg) => (leg.step.kind === "rotate" ? 10 : leg.length);

  it("без веса доли не занимает: курс сразу после поворота", () => {
    const steps = turn(CENTER);
    expectAt(poseAt(steps, 0.5 - 1e-9), [-40, 20], RIGHT);
    expectAt(poseAt(steps, 0.5), [-40, 20], DOWN);
    expect(sharesOf(legsOf(steps))[2]).toEqual([0.5, 0.5]);
  });

  it("с весом ведёт курс от начального к конечному, нос стоит в точке", () => {
    const steps = turn(CENTER);
    const half = poseAt(steps, 0.5, timed);
    expectAt(half, [-40, 20], [Math.SQRT1_2, -Math.SQRT1_2]);
    expect(half.step).toBe(3);
    expect(half.doubts).toEqual([]);
    expectAt(poseAt(steps, 1 / 3, timed), [-40, 20], RIGHT);
  });

  it("вокруг неназванной точки показан так же, но с сомнением «pivot»", () => {
    const steps = turn(UNNAMED);
    const half = poseAt(steps, 0.5, timed);
    expectAt(half, [-40, 20], [Math.SQRT1_2, -Math.SQRT1_2]);
    expect(half.doubts).toEqual(["pivot"]);
    // Сомнение — про сам поворот: пролёты до и после него прочитаны.
    expect(poseAt(steps, 0.2, timed).doubts).toEqual([]);
    expect(poseAt(steps, 0.8, timed).doubts).toEqual([]);
  });

  it("на оборот и больше проходит все курсы по порядку", () => {
    const steps = turn(CENTER, 720);
    const legs = legsOf(steps);
    expectAt(poseOn(legs[2], 0.125), [-40, 20], DOWN);
    expectAt(poseOn(legs[2], 0.25), [-40, 20], LEFT);
    expectAt(poseOn(legs[2], 0.75), [-40, 20], LEFT);
    expectAt(poseOn(legs[2], 1), [-40, 20], RIGHT);
  });

  it("со смещением вокруг неназванной точки ведёт нос по дуге поворота", () => {
    // Полуоборот против часовой из (0; 10) в (0; 20): точка поворота (0; 15).
    const steps = path(
      { kind: "start", at: [-20, 10] },
      markIn,
      { kind: "line", to: [0, 10] },
      { kind: "rotate", degrees: 180, direction: "ccw", ...UNNAMED, to: [0, 20] },
      { kind: "line", to: [-20, 20] },
      markOut,
    );
    const legs = legsOf(steps);
    expect(legs[2].length).toBeCloseTo(5 * Math.PI, 9);
    const half = poseOn(legs[2], 0.5);
    expectAt(half, [5, 15], UP);
    // Точка поворота следует из смещения: сомневаться тут не в чем.
    expect(half.doubts).toEqual([]);
  });

  it("со смещением не на полуоборот идёт вокруг точки поворота, а не вокруг середины хорды", () => {
    // Четверть оборота против часовой из (0; 10) в (5; 15): точка поворота (0; 15).
    const steps = path(
      { kind: "start", at: [-20, 10] },
      markIn,
      { kind: "line", to: [0, 10] },
      { kind: "rotate", degrees: 90, direction: "ccw", ...UNNAMED, to: [5, 15] },
      { kind: "line", to: [5, 40], nose: 0 },
      markOut,
    );
    const leg = legsOf(steps)[2];
    expect(leg.length).toBeCloseTo(2.5 * Math.PI, 9);
    expectAt(poseOn(leg, 0.5), [5 * Math.SQRT1_2, 15 - 5 * Math.SQRT1_2], [Math.SQRT1_2, Math.SQRT1_2]);
  });
});

describe("остановки", () => {
  it("MI 15: в остановке нос — курс, с которым кайт пришёл, а не метка книги", () => {
    const steps = catalogPath("MI 15");
    const stall = steps[4];
    // Метка книги в первой остановке нарисована уже после поворота — носом вниз.
    expect(stall).toMatchObject({ kind: "mark", mark: "stall", nose: 180 });
    const legs = legsOf(steps);
    const leg = legs.find((item) => item.index === 4)!;
    expectAt(poseOn(leg, 0.5), [-80, 30], UP);
    // Все шесть пролётов — 220 единиц; остановки и повороты доли не занимают.
    expect(shareOf(steps, 4)).toBeCloseTo(30 / 220, 9);
    expectAt(poseAt(steps, 30 / 220 - 1e-9), [-80, 30], UP);
    // На самой доле остановки кайт уже за поворотом: слайд вправо носом вниз.
    const after = poseAt(steps, 30 / 220);
    expectAt(after, [-80, 30], DOWN);
    expect(after.step).toBe(6);
  });

  it("MI 15: с весом кайт стоит в остановке и доворачивается после неё", () => {
    const steps = catalogPath("MI 15");
    const held = (leg: Leg) => (leg.step.kind === "mark" && leg.step.mark === "stall" ? 10 : leg.step.kind === "rotate" ? 5 : leg.length);
    const from = shareOf(steps, 4, held);
    const to = shareOf(steps, 5, held);
    expect(to - from).toBeCloseTo(10 / 295, 9);
    for (const fraction of [from, (from + to) / 2, to - 1e-9]) {
      const pose = poseAt(steps, fraction, held);
      expectAt(pose, [-80, 30], UP);
      expect(pose.step).toBe(4);
    }
    // Полуоборот против часовой с носа вверх: на середине нос влево.
    const turning = poseAt(steps, to + 2.5 / 295, held);
    expectAt(turning, [-80, 30], LEFT);
    expect(turning.doubts).toEqual(["pivot"]);
  });

  it("MI 26: три остановки стоят на своих долях пути", () => {
    const steps = catalogPath("MI 26");
    const total = 50 + 15 * Math.PI + 15 * Math.PI + 50;
    const stalls = legsOf(steps).filter((leg) => leg.step.kind === "mark" && leg.step.mark === "stall");
    expect(stalls.map((leg) => leg.from)).toEqual([[-30, 50], [0, 80], [30, 50]]);
    const shares = stalls.map((leg) => shareOf(steps, leg.index));
    [50, 50 + 15 * Math.PI, 50 + 30 * Math.PI].forEach((passed, at) => expect(shares[at]).toBeCloseTo(passed / total, 9));
    expectAt(poseAt(steps, shares[1]), [0, 80], RIGHT);
    expectAt(poseOn(stalls[1], 0), [0, 80], RIGHT);
  });

  it("DI 16: двухстропный кайт в остановке стоит носом вверх, откуда бы ни пришёл", () => {
    const steps = catalogPath("DI 16");
    // Кайт пришёл в остановку пролётом вправо.
    expect(steps.slice(2, 4)).toMatchObject([{ kind: "line", nose: "forward" }, { kind: "mark", mark: "stall", nose: 0 }]);
    const held = (leg: Leg) => (leg.step.kind === "mark" && leg.step.mark === "stall" ? 10 : leg.length);
    const legs = legsOf(steps, false);
    const [from, to] = sharesOf(legs, held)[legs.findIndex((leg) => leg.index === 3)];
    expectAt(poseAt(steps, from - 1e-9, held, false), legs[2].from, RIGHT);
    const standing = poseAt(steps, (from + to) / 2, held, false);
    expectAt(standing, legs[2].from, UP);
    expect(standing.step).toBe(3);
    // Тот же путь у четырёхстропного оставил бы курс прихода.
    expectAt(poseAt(steps, (from + to) / 2, held, true), legs[2].from, RIGHT);
  });

  it("DI 19: севший на оба конца крыла двухстропный кайт стоит носом вверх", () => {
    const steps = catalogPath("DI 19");
    expect(steps.at(-2)).toMatchObject({ kind: "mark", mark: "landing", style: "two-point" });
    const down = poseAt(steps, 1 - 1e-9, undefined, false);
    expect(down.nose![1]).toBeLessThan(-0.99);
    const landed = poseAt(steps, 1, undefined, false);
    expectAt(landed, down.point && [down.point[0], 0], UP);
  });

  it("DI 12: после остановки двухстропный кайт стоит носом вверх и на выходе", () => {
    const steps = catalogPath("DI 12");
    expect(steps.slice(-3)).toMatchObject([{ kind: "line" }, { mark: "stall" }, { mark: "out" }]);
    expectAt(poseAt(steps, 1 - 1e-9, undefined, false), [-60, 40], LEFT);
    expectAt(poseAt(steps, 1, undefined, false), [-60, 40], UP);
  });

  it("каждая двухстропная остановка каталога помечена книгой носом вверх", () => {
    // На этом стоит правило позы: метку двухстропной остановки она не читает.
    const marks = listFigures()
      .filter((figure) => figure.discipline.startsWith("dual-line-") && figure.geometry.status === "ok")
      .flatMap((figure) => (figure.geometry.status === "ok" ? figure.geometry.variants : []))
      .flatMap((variant) => variant.kites.flatMap((kite) => kite.path))
      .flatMap((step) => (step.kind === "mark" && step.mark === "stall" ? [step.nose] : []));
    expect(marks.length).toBeGreaterThan(10);
    expect(marks.every((nose) => nose === 0)).toBe(true);
  });

  it("посадка двухстропного не на концы крыла курса не меняет", () => {
    const steps = path(start, markIn, { kind: "line", to: [-50, 0] }, { kind: "mark", mark: "landing", style: "leading-edge" }, markOut);
    expectAt(poseAt(steps, 1, undefined, false), [-50, 0], DOWN);
  });

  it("MI 26: посадка четырёхстропного курса не меняет", () => {
    const steps = catalogPath("MI 26");
    expect(steps.at(-2)).toMatchObject({ kind: "mark", mark: "landing" });
    expectAt(poseAt(steps, 1), [30, 0], DOWN);
  });
});

describe("MI 02: подъём поворотами вокруг законцовок", () => {
  const steps = catalogPath("MI 02");
  const legs = legsOf(steps);
  const swing = (REV_SPAN / 2) * Math.PI;
  const total = 60 + 4 * swing + 60;

  it("пять силуэтов стоят один над другим через размах значка, носом по очереди вправо и влево", () => {
    const silhouettes = [0, 1, 2, 3, 4].map((turns) => poseAt(steps, (60 + turns * swing) / total));
    silhouettes.forEach((pose, turns) => {
      // Размах в данных не записан: разбор округляет место до двух знаков.
      expect(pose.point![0]).toBeCloseTo(0, 6);
      expect(pose.point![1]).toBeCloseTo(10 + turns * REV_SPAN, 6);
    });
    expect(silhouettes.map((pose) => Math.round(pose.nose![0]))).toEqual([1, -1, 1, -1, 1]);
  });

  it("между силуэтами нос идёт по дуге вокруг законцовки, а кайт поворачивается", () => {
    // Первый полуоборот — против часовой вокруг левой законцовки (0; 14,2).
    const half = poseAt(steps, (60 + swing / 2) / total);
    expectAt(half, [REV_SPAN / 2, 10 + REV_SPAN / 2], UP);
    expect(half.step).toBe(3);
    // Второй — по часовой вокруг правой (0; 22,6): нос обходит её с другой стороны.
    expectAt(poseAt(steps, (60 + 1.5 * swing) / total), [-REV_SPAN / 2, 10 + 1.5 * REV_SPAN], UP);
    // Нос всё время в полуразмахе от законцовки: кайт не растягивается.
    for (let i = 0; i <= 20; i += 1) {
      const { point } = poseOn(legs[2], i / 20);
      expect(Math.hypot(point![0], point![1] - (10 + REV_SPAN / 2))).toBeCloseTo(REV_SPAN / 2, 6);
    }
  });

  it("незаданное книгой место показано с сомнением «span», и только оно", () => {
    expect(poseAt(steps, 0.1).doubts).toEqual([]);
    for (const fraction of [(60 + swing / 2) / total, (60 + 2 * swing) / total, (60 + 4 * swing + 30) / total, 1]) {
      expect(poseAt(steps, fraction).doubts).toEqual(["span"]);
    }
    expectAt(poseAt(steps, 1), [60, 10 + 4 * REV_SPAN], RIGHT);
    // Первый поворот начинается ещё из точки книги.
    expect(poseAt(steps, 60 / total).doubts).toEqual([]);
    expectAt(poseAt(steps, 60 / total), [0, 10], RIGHT);
  });

  it("сомнение «span» кончается с первым шагом, который приходит в точку книги", () => {
    const tip = { kind: "rotate", degrees: 180, direction: "ccw", about: "left-tip", about_basis: "diagram" };
    const open = { to: { status: "unspecified", reason: "книга высоту не задаёт" } };
    const steps = path(
      { kind: "start", at: [-20, 10] },
      markIn,
      { kind: "line", to: [0, 10] },
      { ...tip, ...open },
      { kind: "line", to: [-20, 30] },
      { kind: "line", to: [-40, 30] },
      markOut,
    );
    const legs = legsOf(steps);
    expect([legs[2], legs[3], legs[4]].map((leg) => poseOn(leg, 0.5).doubts)).toEqual([["span"], ["span"], []]);
    // Отрезок из незаданного места приходит в точку книги.
    expect([0, 1].map((t) => poseOn(legs[3], t).doubts)).toEqual([["span"], []]);
    // Поворот в записанную точку сомнения за собой не оставляет.
    const read = path(
      { kind: "start", at: [-20, 10] },
      markIn,
      { kind: "line", to: [0, 10] },
      { ...tip, ...open },
      { ...tip, direction: "cw", about: "right-tip", to: [0, 30], basis: "measured" },
      { kind: "line", to: [20, 30] },
      markOut,
    );
    expect(legsOf(read).slice(2, 5).map((leg) => poseOn(leg, 0.5).doubts)).toEqual([["span"], ["span"], []]);
  });

  it("повороты занимают долю пути по длине дуги носа", () => {
    const shares = sharesOf(legs);
    expect(shares[2][0]).toBeCloseTo(60 / total, 9);
    expect(shares[2][1] - shares[2][0]).toBeCloseTo(swing / total, 4);
    expect(shares[5][1]).toBeCloseTo((60 + 4 * swing) / total, 4);
  });
});

describe("шаги без показанного направления", () => {
  it("MI 16: на круге точки нет, а курс числом известен", () => {
    const steps = catalogPath("MI 16");
    const legs = legsOf(steps);
    const circle = legs.find((leg) => leg.step.kind === "arc")!;
    expect(circle.step).toMatchObject({ unmarked: true, nose: 180 });
    expect(circle.ends).toEqual([true, true]);
    const [from, to] = sharesOf(legs)[legs.indexOf(circle)];
    const inside = poseAt(steps, (from + to) / 2);
    expectAt(inside, null, DOWN);
    expect(inside.doubts).toContain("order");
    expect(inside.step).toBe(circle.index);
    // Края круга — точка пути при любом обходе: там кайт виден.
    expectAt(poseAt(steps, from), [-55.55, 55.72], DOWN);
    expectAt(poseAt(steps, to), [-55.55, 55.72], DOWN);
    expect(poseAt(steps, from).doubts).not.toContain("order");
    expectAt(poseAt(steps, to - 1e-9), null, DOWN);
  });

  it("DT 10: на ромбе нет ни точки, ни курса, а стыки внутри него не выданы за известные", () => {
    const steps = catalogPath("DT 10");
    const legs = legsOf(steps, false);
    const sides = legs.filter((leg) => leg.ends !== undefined);
    expect(sides.map((leg) => leg.ends)).toEqual([[true, false], [false, false], [false, false], [false, true]]);
    const shares = sharesOf(legs);
    const [from] = shares[legs.indexOf(sides[0])];
    const [, to] = shares[legs.indexOf(sides[3])];
    for (let i = 1; i < 40; i += 1) {
      const pose = poseAt(steps, from + ((to - from) * i) / 40, undefined, false);
      expectAt(pose, null, null);
      expect(pose.doubts).toEqual(["order"]);
    }
    // Вход в ромб известен точкой, но не курсом: курс зависит от обхода.
    expectAt(poseAt(steps, from), [50, 10], null);
    expect(poseAt(steps, from).doubts).toEqual(["order"]);
    // Выход — уже следующий шаг, нос по ходу вправо.
    expectAt(poseAt(steps, to), [50, 10], RIGHT);
    // Стык двух сторон ромба: при обратном обходе кайт в эту долю в другом месте.
    expectAt(poseOn(sides[0], 1), null, null);
    expectAt(poseOn(sides[1], 0), null, null);
  });

  it("MT 02: нос наружу круга известен на его краях и неизвестен внутри", () => {
    const steps = catalogPath("MT 02");
    const circle = legsOf(steps).find((leg) => leg.step.kind === "arc")!;
    expect(circle.step).toMatchObject({ unmarked: true, nose: "out" });
    expectAt(poseOn(circle, 0), [30, 10], DOWN);
    expectAt(poseOn(circle, 0.25), null, null);
    expectAt(poseOn(circle, 1), [30, 10], DOWN);
  });

  // Петля: вход снизу, три стороны треугольника слайдами, выход вверх.
  const triangle = (...sides: unknown[]) =>
    path({ kind: "start", at: [-40, 20] }, markIn, { kind: "line", to: [0, 20] }, ...sides, { kind: "mark", mark: "launch" }, { kind: "line", to: [0, 60], nose: 0 }, markOut);
  const held = (leg: Leg) => leg.length || 20;

  it("пробег из нескольких шагов: курс числом зависит от записанного порядка и не выдаётся", () => {
    const there = triangle(
      { kind: "line", to: [40, 20], nose: 0, unmarked: true },
      { kind: "line", to: [20, 50], nose: 90, unmarked: true },
      { kind: "line", to: [0, 20], nose: 270, unmarked: true },
    );
    const back = triangle(
      { kind: "line", to: [20, 50], nose: 270, unmarked: true },
      { kind: "line", to: [40, 20], nose: 90, unmarked: true },
      { kind: "line", to: [0, 20], nose: 0, unmarked: true },
    );
    // Одна и та же петля в двух записях даёт одни и те же позы.
    for (const steps of [there, back]) {
      const legs = legsOf(steps);
      const shares = sharesOf(legs, held);
      const [from] = shares[2];
      const [, to] = shares[4];
      const enter = poseAt(steps, from, held);
      expectAt(enter, [0, 20], null);
      expect(enter.doubts).toEqual(["order"]);
      expectAt(poseAt(steps, (from + to) / 2, held), null, null);
      // Отметка за пробегом: точка известна, курс — нет.
      const after = poseAt(steps, to + 1e-9, held);
      expectAt(after, [0, 20], null);
      expect(after.step).toBe(6);
      expect(after.doubts).toEqual([]);
    }
  });

  it("пробег из одного шага: курс числом и нос наружу круга переходят на отметку за ним", () => {
    const slide = path(start, markIn, { kind: "line", to: [-20, 20] }, { kind: "line", to: [-20, 50], nose: 90, unmarked: true }, { kind: "mark", mark: "launch" }, { kind: "line", to: [0, 50] }, markOut);
    expectAt(poseOn(legsOf(slide)[3], 0), [-20, 50], RIGHT);
    // Незамкнутая дуга: наружу в её конце — не то же, что в начале.
    const arc = path(start, markIn, { kind: "line", to: [-20, 20] }, { kind: "arc", to: [-20, 40], center: [-20, 30], direction: "ccw", sweep: 180, nose: "out", unmarked: true }, { kind: "mark", mark: "launch" }, { kind: "line", to: [-40, 40] }, markOut);
    const legs = legsOf(arc);
    expectAt(poseOn(legs[2], 0), [-20, 20], DOWN);
    expectAt(poseOn(legs[2], 1), [-20, 40], UP);
    expectAt(poseOn(legs[3], 0), [-20, 40], UP);
  });

  it("нос против хода на шаге без направления так же неизвестен, как нос по ходу", () => {
    const steps = path(start, markIn, { kind: "line", to: [-20, 20] }, { kind: "line", to: [-20, 50], nose: "backward", unmarked: true }, { kind: "mark", mark: "launch" }, { kind: "line", to: [0, 50] }, markOut);
    const legs = legsOf(steps);
    expectAt(poseOn(legs[2], 0), [-20, 20], null);
    expectAt(poseOn(legs[2], 0.5), null, null);
    expectAt(poseOn(legs[3], 0), [-20, 50], null);
  });

  it("отметка и поворот внутри пробега точки не получают", () => {
    // Петля как у DI 12, но на её вершине — остановка и поворот.
    const steps = path(
      { kind: "start", at: [0, 10] },
      markIn,
      { kind: "line", to: [0, 40] },
      { kind: "line", to: [0, 80], unmarked: true },
      { kind: "mark", mark: "stall", nose: { status: "not_found", reason: "метки нет" } },
      { kind: "rotate", degrees: 90, direction: "cw", ...UNNAMED },
      { kind: "arc", to: [0, 40], center: [0, 60], direction: "cw", sweep: 180, unmarked: true },
      { kind: "mark", mark: "launch" },
      { kind: "line", to: [-30, 40] },
      markOut,
    );
    const legs = legsOf(steps);
    expect(legs.filter((leg) => leg.ends).map((leg) => leg.ends)).toEqual([[true, false], [false, true]]);
    for (const leg of [legs[3], legs[4]]) {
      const inside = poseOn(leg, 0.5);
      expectAt(inside, null, null);
      expect(inside.doubts).toEqual(["order"]);
    }
    // Отметка за пробегом стоит уже в точке пути.
    expectAt(poseOn(legs[6], 0.5), [0, 40], null);
    expect(poseOn(legs[6], 0.5).doubts).toEqual([]);
    // Двухстропный в остановке стоит носом вверх — но стоит ли он в эту долю,
    // внутри пробега неизвестно.
    expectAt(poseOn(legsOf(steps, false)[3], 0.5), null, null);
    expectAt(poseOn(legsOf(steps, false)[4], 0.5), null, null);
  });

  it("поворот со смещением рвёт пробег: шаги по обе его стороны — каждый свой пробег", () => {
    const steps = path(
      { kind: "start", at: [-20, 10] },
      markIn,
      { kind: "line", to: [0, 10], nose: 90, unmarked: true },
      { kind: "rotate", degrees: 180, direction: "ccw", ...UNNAMED, to: [0, 20] },
      { kind: "line", to: [-20, 20], nose: 270, unmarked: true },
      markOut,
    );
    expect(legsOf(steps).filter((leg) => leg.ends).map((leg) => leg.ends)).toEqual([[true, true], [true, true]]);
  });

  it("края пробега ищутся по месту шага в пути, а не по его объекту", () => {
    const loop = path(start, markIn, { kind: "arc", to: [-50, 20], center: [-50, 40], direction: "cw", sweep: 360, nose: 0, unmarked: true }, markOut)[2];
    const steps = path(start, markIn, { kind: "line", to: [-30, 20] }, markOut);
    // Один и тот же разобранный шаг стоит в пути дважды подряд.
    const twice = [steps[0], steps[1], loop, loop, steps[3]];
    expect(legsOf(twice).filter((leg) => leg.ends).map((leg) => leg.ends)).toEqual([[true, false], [false, true]]);
  });
});

describe("фигура, где нос нигде не задан", () => {
  it("DI 02: поля nose нет ни у одного шага — нос идёт по ходу и известен везде", () => {
    const steps = catalogPath("DI 02");
    expect(steps.some((step) => (step.kind === "line" || step.kind === "arc") && step.nose !== "forward")).toBe(false);
    for (let i = 0; i <= 360; i += 1) {
      const pose = poseAt(steps, i / 360, undefined, false);
      // Круг радиуса 40 по часовой от правой точки: нос — касательная.
      const angle = (i * Math.PI) / 180;
      expectAt(pose, [Math.cos(angle) * 40, 50 - Math.sin(angle) * 40], [-Math.sin(angle), -Math.cos(angle)]);
      expect(pose.doubts).toEqual([]);
    }
  });

  it("путь из одних шагов без направления: курса нет нигде, точка — только на краях пути", () => {
    const steps = path(
      start,
      markIn,
      { kind: "line", to: [-30, 20], unmarked: true },
      { kind: "mark", mark: "stall", nose: { status: "not_found", reason: "метки нет" } },
      { kind: "rotate", degrees: 90, direction: "cw", ...UNNAMED },
      { kind: "arc", to: [-30, 40], center: [-30, 30], direction: "ccw", sweep: 180, unmarked: true },
      markOut,
    );
    // Остановке и повороту дан вес: курс не появляется и на них.
    const weigh = (leg: Leg) => leg.length || 5;
    for (let i = 0; i <= 200; i += 1) {
      expect(poseAt(steps, i / 200, weigh).nose).toBeNull();
    }
    expectAt(poseAt(steps, 0), [-50, 20], null);
    expectAt(poseAt(steps, 1), [-30, 40], null);
    expectAt(poseAt(steps, 0.1), null, null);
  });

  it("до первого пролёта курс из пути не следует", () => {
    const steps = path(start, markIn, { kind: "line", to: [0, 20] }, markOut);
    const waiting = poseAt(steps, 0.05, (leg) => (leg.step.kind === "mark" ? 10 : leg.length));
    expectAt(waiting, [-50, 20], null);
    expect(waiting.step).toBe(1);
  });
});

describe("каждый путь каталога", () => {
  const paths = listFigures().flatMap((figure) =>
    figure.geometry.status === "ok"
      ? figure.geometry.variants.flatMap((variant) =>
          variant.kites.map((kite) => ({ name: `${figure.code} ${variant.id} #${kite.id}`, steps: kite.path, rev: figure.discipline.startsWith("multi-line-") })),
        )
      : [],
  );
  const SAMPLES = 400;
  // Допуск, с которым разбор сводит дугу с её записанным концом.
  const JOINT = 0.05;

  it("проходится от старта до конца без разрывов, с курсом единичной длины", () => {
    expect(paths.length).toBeGreaterThan(200);
    for (const { name, steps, rev } of paths) {
      const legs = legsOf(steps, rev);
      const total = legs.reduce((sum, leg) => sum + leg.length, 0);
      const first = steps[0];
      // Конец пути — точка последнего шага, который перемещает кайт.
      const last = steps.findLast((step) => step.kind === "line" || step.kind === "arc" || isSwing(step));
      expect(first.kind === "start" && poseAt(steps, 0, undefined, rev).point, name).toEqual(first.kind === "start" && first.at);
      expect(last !== undefined && "to" in last && poseAt(steps, 1, undefined, rev).point, name).toEqual(last !== undefined && "to" in last && last.to);
      let before: Point | null = null;
      for (let i = 0; i <= SAMPLES; i += 1) {
        const pose = poseAt(steps, i / SAMPLES, undefined, rev);
        const step = steps[pose.step];
        if (pose.point === null) {
          expect(step.kind !== "start" && step.kind !== "mark" && step.kind !== "rotate" && step.unmarked, name).toBe(true);
        } else if (before !== null) {
          // Хорда не длиннее пройденного по пути; на стыке к ней добавляется
          // допуск формата: конец дуги записан с двумя знаками.
          expect(Math.hypot(pose.point[0] - before[0], pose.point[1] - before[1]), name).toBeLessThanOrEqual(total / SAMPLES + JOINT);
        }
        if (pose.nose !== null) {
          expect(Math.hypot(pose.nose[0], pose.nose[1]), name).toBeCloseTo(1, 9);
        }
        before = pose.point;
      }
    }
  });

  it("без точки остаются только шаги unmarked, сомнение «span» — только у MI 02", () => {
    const doubted = (doubt: string) =>
      paths
        .filter(({ steps, rev }) => Array.from({ length: SAMPLES + 1 }, (_, i) => poseAt(steps, i / SAMPLES, undefined, rev)).some((pose) => pose.doubts.includes(doubt as never)))
        .map(({ name }) => name.slice(0, 5));
    expect([...new Set(doubted("order"))]).toEqual(["DI 12", "DT 10", "DT 15", "MI 16", "MT 02"]);
    expect([...new Set(doubted("span"))]).toEqual(["MI 02"]);
    // Поворотов на месте в долях по длине не видно: у них нет веса.
    expect(doubted("pivot")).toEqual([]);
  });

  it("с весом у поворотов сомнение «pivot» — ровно у фигур, где книга точку поворота не называет", () => {
    const unnamed = (steps: Step[]) => steps.some((step) => step.kind === "rotate" && typeof step.about !== "string");
    const doubted = paths.filter(({ steps, rev }) =>
      Array.from({ length: SAMPLES + 1 }, (_, i) => poseAt(steps, i / SAMPLES, (leg) => leg.length || 5, rev)).some((pose) => pose.doubts.includes("pivot")),
    );
    expect(doubted.length).toBeGreaterThan(0);
    expect(doubted.map(({ name }) => name)).toEqual(paths.filter(({ steps }) => unnamed(steps)).map(({ name }) => name));
  });

  it("двухстропный кайт в конце пути после посадки на оба конца крыла стоит носом вверх", () => {
    const landed = paths.filter(({ steps, rev }) => !rev && steps.some((step) => step.kind === "mark" && step.mark === "landing"));
    expect(landed.length).toBeGreaterThan(20);
    for (const { name, steps } of landed) {
      expect(poseAt(steps, 1, undefined, false).nose, name).toEqual(UP);
    }
  });
});

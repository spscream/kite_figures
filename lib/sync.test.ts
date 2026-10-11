import { describe, expect, it } from "vitest";

import { listFigures } from "./figures";
import { parseGeometry, type Step } from "./geometry";
import { parseRoutine } from "./routines";
import { syncOf } from "./sync";

type Raw = Record<string, unknown>;

const markIn: Raw = { kind: "mark", mark: "in" };
const markOut: Raw = { kind: "mark", mark: "out" };
const line = (to: [number, number], sync?: string): Raw => ({ kind: "line", to, ...(sync === undefined ? {} : { sync }) });

// Вариант из путей кайтов: разбирается тем же кодом, что фигура каталога.
function variant(...paths: unknown[][]): Raw {
  return {
    status: "ok",
    variants: [
      {
        id: "main",
        kites: paths.map((path, index) => ({ id: String(index + 1), path })),
        grid: { x: [0], y: [50] },
        guides: { status: "not_found", reason: "на схеме их нет" },
      },
    ],
  };
}

const parse = (...paths: unknown[][]) => parseGeometry("g", variant(...paths), 125);

// Путь кайта по прямой вверх с метками на пролётах, по порядку.
const climb = (x: number, ...labels: (string | undefined)[]) => [
  { kind: "start", at: [x, 10] },
  markIn,
  ...labels.map((label, index) => line([x, 20 + 10 * index], label)),
  markOut,
];

function kites(...paths: unknown[][]): { id: string; path: Step[] }[] {
  const read = parseGeometry("g", variant(...paths), 125);
  if (read.status !== "ok") {
    throw new Error("геометрия не разобрана");
  }
  return read.variants[0].kites;
}

describe("syncOf", () => {
  it("называет моменты каждого кайта и общий порядок меток", () => {
    const { meets, order } = syncOf(kites(climb(-10, "a", undefined, "b"), climb(10, "a", "b")));
    expect(order).toEqual(["a", "b"]);
    expect(meets).toEqual([
      [
        { label: "a", step: 2 },
        { label: "b", step: 4 },
      ],
      [
        { label: "a", step: 2 },
        { label: "b", step: 3 },
      ],
    ]);
  });

  it("пролёт и событие в точке, куда он привёл, несут одну метку: момент — конец последнего такого шага", () => {
    const landed = (x: number) => [{ kind: "start", at: [x, 30] }, markIn, line([x, 0], "down"), { kind: "mark", mark: "landing", sync: "down" }, markOut];
    expect(syncOf(kites(landed(-10), landed(10))).meets[0]).toEqual([{ label: "down", step: 3 }]);
  });

  it("метка не у каждого кайта команды допустима, пока она парная: порядок собирается по всем кайтам", () => {
    const { order } = syncOf(kites(climb(-20, "a", "b"), climb(0, "b", "c"), climb(20, "a", "c")));
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("у варианта без меток моментов нет", () => {
    expect(syncOf(kites(climb(-10, undefined), climb(10, undefined)))).toEqual({ meets: [[], []], order: [] });
  });
});

describe("разбор фигуры сверяет метки одновременности", () => {
  it("принимает парные метки в одном порядке", () => {
    expect(parse(climb(-10, "a", "b"), climb(10, "a", "b")).status).toBe("ok");
  });

  it.each([
    ["метка только у одного кайта пары", [climb(-10, "a", "b"), climb(10, "a", undefined)], /g\.variants\[0\]\.kites: метка «b» стоит только у кайта «1»/],
    ["метка у единственного кайта", [climb(0, "a")], /метка «a» стоит только у кайта «1»/],
    ["порядок меток у кайтов разный", [climb(-10, "a", "b"), climb(10, "b", "a")], /метки «a» и «b» у кайта «1» идут в этом порядке, а у кайта «2» — в обратном/],
    ["метка дважды у одного кайта, между ними пролёт", [climb(-10, "a", "a"), climb(10, "a", undefined)], /метка «a» у кайта «1» стоит на шагах 2 и 3/],
    [
      "метка дважды у одного кайта, между ними другая метка",
      [
        [{ kind: "start", at: [-10, 10] }, { ...markIn, sync: "a" }, line([-10, 20], "b"), { ...markOut, sync: "a" }],
        [{ kind: "start", at: [10, 10] }, { ...markIn, sync: "a" }, line([10, 20], "b"), markOut],
      ],
      /метка «a» у кайта «1» стоит на шагах 1 и 3/,
    ],
    [
      "порядок не сходится по кругу у трёх кайтов",
      [climb(-20, "a", "b"), climb(0, "b", "c"), climb(20, "c", "a")],
      /порядок меток «a», «b», «c» у кайтов не сходится/,
    ],
  ])("отвергает запись: %s", (_label, paths, message) => {
    expect(() => parse(...(paths as unknown[][]))).toThrow(message);
  });
});

describe("разбор рутины сверяет метки своей части", () => {
  const figures = listFigures();
  const routine = (first: unknown[], second: unknown[]) =>
    JSON.stringify({
      schema: 1,
      name: "Проба",
      discipline: "multi-line-pair",
      kites: ["1", "2"],
      segments: [{ origin: "own", paths: { "1": first, "2": second } }],
    });
  const path = (x: number, ...labels: (string | undefined)[]) => climb(x, ...labels);

  it("принимает парные метки в одном порядке", () => {
    expect(parseRoutine("proba.json", routine(path(-10, "a", "b"), path(10, "a", "b")), figures).kites).toEqual(["1", "2"]);
  });

  it("отвергает непарную метку и разный порядок меток", () => {
    expect(() => parseRoutine("proba.json", routine(path(-10, "a"), path(10, undefined)), figures)).toThrow(
      /proba\.json: segments\[0\]\.paths: метка «a» стоит только у кайта «1»/,
    );
    expect(() => parseRoutine("proba.json", routine(path(-10, "a", "b"), path(10, "b", "a")), figures)).toThrow(/segments\[0\]\.paths: метки «a» и «b»/);
  });
});

// Замер каталога: числа держат и сам обход, и то, что новая проверка каталогу
// ничего не запретила.
describe("метки одновременности в каталоге", () => {
  const teams = listFigures().flatMap((figure) =>
    figure.geometry.status === "ok" ? figure.geometry.variants.filter((item) => item.kites.length > 1).map((item) => ({ code: figure.code, variant: item })) : [],
  );
  const steps = teams.flatMap(({ variant }) => variant.kites.flatMap((kite) => kite.path));
  const labelled = (step: Step) => "sync" in step && step.sync !== undefined;
  const flown = (step: Step) => step.kind === "line" || step.kind === "arc";

  it("вариантов с несколькими кайтами 76; метку несут 676 шагов из 2057, из них пролётов — 260 из 1285", () => {
    expect(teams).toHaveLength(76);
    expect(steps.filter((step) => step.kind !== "start")).toHaveLength(2057);
    expect(steps.filter(labelled)).toHaveLength(676);
    expect(steps.filter(flown)).toHaveLength(1285);
    expect(steps.filter((step) => flown(step) && labelled(step))).toHaveLength(260);
  });

  it("разных меток 205, и каждая стоит у каждого кайта своего варианта", () => {
    const counts = teams.map(({ variant }) => {
      const { meets, order } = syncOf(variant.kites);
      expect(meets.map((list) => list.map((meet) => meet.label))).toEqual(variant.kites.map(() => order));
      return order.length;
    });
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(205);
  });

  it("у одного кайта метка повторяется только на пролёте и событии в его конце — посадке или остановке, 28 раз", () => {
    const repeats = teams.flatMap(({ variant }) =>
      variant.kites.flatMap((kite) =>
        kite.path.flatMap((step, index) => {
          const before = kite.path[index - 1];
          return index > 0 && labelled(step) && "sync" in before && before.sync === ("sync" in step && step.sync) ? [`${before.kind} ${step.kind === "mark" ? step.mark : step.kind}`] : [];
        }),
      ),
    );
    expect(repeats.filter((item) => item === "line landing")).toHaveLength(16);
    expect(repeats.filter((item) => item === "line stall")).toHaveLength(12);
    expect(repeats).toHaveLength(28);
  });

  it("метка на каждом пролёте — у 13 вариантов, без единой метки — у пяти: MT 02, 03, 05, 06, 12", () => {
    const every = teams.filter(({ variant }) => variant.kites.every((kite) => kite.path.filter(flown).every(labelled)));
    expect(every.map((item) => item.code)).toEqual(["MP 01", "MP 03", "MP 04", "MP 06", "MP 07", "MP 08", "MP 09", "MP 10", "MP 11", "MP 12", "MP 13", "MP 14", "MT 08"]);
    const none = teams.filter(({ variant }) => !variant.kites.some((kite) => kite.path.some(labelled)));
    expect(none.map((item) => item.code)).toEqual(["MT 02", "MT 03", "MT 05", "MT 06", "MT 12"]);
  });

  it("у варианта с одним кайтом меток нет", () => {
    const solo = listFigures().flatMap((figure) => (figure.geometry.status === "ok" ? figure.geometry.variants.filter((item) => item.kites.length === 1) : []));
    expect(solo).toHaveLength(46);
    expect(solo.flatMap((item) => item.kites[0].path).filter(labelled)).toHaveLength(0);
  });
});

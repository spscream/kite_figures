import { describe, expect, it } from "vitest";

import { listFigures } from "./figures";
import { arcPoint, type Point } from "./geometry";
import {
  CHECKS,
  checkRoutine,
  CITED,
  clock,
  type Finding,
  findingText,
  judgedExtent,
  judgedTimes,
  STANDINGS,
  TEAM_MOST,
  TIME_LIMITS,
} from "./routine-checks";
import { listRoutines, parseRoutine, type Routine } from "./routines";
import { loadSources } from "./sources";

type Raw = Record<string, unknown>;

// Рутины проходят тот же разбор, что и файл: проверка получает то, что получит
// от каталога.
const figures = listFigures();
const parse = (raw: Raw): Routine => parseRoutine("proba.json", JSON.stringify({ schema: 1, name: "Проба", ...raw }), figures);

const A: Point = [-50, 20];
const B: Point = [0, 20];
const markIn: Raw = { kind: "mark", mark: "in" };
const markOut: Raw = { kind: "mark", mark: "out" };

// Слайды туда и обратно, по одному на каждую длительность; `null` — темп не
// задан.
function slides(seconds: (number | null)[], from: Point = A, to: Point = B): Raw[] {
  return seconds.map((value, index) => ({
    kind: "line",
    to: index % 2 === 0 ? to : from,
    nose: 0,
    ...(value === null ? {} : { seconds: value }),
  }));
}

const flight = (seconds: (number | null)[], from: Point = A, to: Point = B): Raw[] => [
  { kind: "start", at: from },
  markIn,
  ...slides(seconds, from, to),
  markOut,
];

const solo = (seconds: (number | null)[]) =>
  parse({ discipline: "multi-line-individual", kites: ["1"], segments: [{ origin: "own", paths: { "1": flight(seconds) } }] });

// Кайты летят один над другим; длительности — по списку на кайт.
function crew(discipline: string, seconds: (number | null)[][]): Routine {
  const kites = seconds.map((_, index) => String(index + 1));
  const paths = Object.fromEntries(
    seconds.map((list, index) => [kites[index], flight(list, [-50, 10 + index * 10], [0, 10 + index * 10])]),
  );
  return parse({ discipline, kites, segments: [{ origin: "own", paths }] });
}

const find = (routine: Routine, check: Finding["check"]) => checkRoutine(routine).filter((finding) => finding.check === check);
const one = (routine: Routine, check: Finding["check"]) => {
  const found = find(routine, check);
  expect(found).toHaveLength(1);
  return found[0];
};

describe("длительность", () => {
  it.each([
    ["ровно минута — наименьшее время входит", [60], "duration.ok", "ok"],
    ["ровно три минуты — наибольшее время входит", [90, 90], "duration.ok", "ok"],
    ["между границами", [45, 50], "duration.ok", "ok"],
    ["на тысячную короче минуты", [59.999], "duration.short", "violation"],
    ["короче минуты", [20, 35], "duration.short", "violation"],
    ["на тысячную дольше трёх минут", [90, 90.001], "duration.long", "violation"],
    ["дольше трёх минут", [100, 100], "duration.long", "violation"],
  ])("одиночник: %s", (_, seconds, code, state) => {
    expect(one(solo(seconds), "duration")).toMatchObject({ code, state, standing: "rule" });
  });

  it("сумма десятых сравнивается с границей без ошибки двоичной записи", () => {
    // В числах с плавающей точкой первая сумма меньше 60, вторая больше 180.
    expect(8.2 + 23.9 + 27.9).toBeLessThan(60);
    expect(38.2 + 89.9 + 51.9).toBeGreaterThan(180);
    expect(one(solo([8.2, 23.9, 27.9]), "duration").code).toBe("duration.ok");
    expect(one(solo([38.2, 89.9, 51.9]), "duration").code).toBe("duration.ok");
  });

  it.each([
    ["multi-line-pair", 2],
    ["dual-line-pair", 2],
    ["multi-line-team", 3],
    ["dual-line-team", 4],
  ])("%s: от двух до четырёх минут, обе границы входят", (discipline, size) => {
    const code = (total: number) => one(crew(discipline, Array.from({ length: size }, () => [total / 2, total / 2])), "duration").code;
    expect(code(119)).toBe("duration.short");
    expect(code(120)).toBe("duration.ok");
    expect(code(180.5)).toBe("duration.ok");
    expect(code(240)).toBe("duration.ok");
    expect(code(241)).toBe("duration.long");
  });

  it("у границы время названо с той же точностью, с какой сравнивается", () => {
    expect(one(solo([59.999]), "duration").text).toContain("в записи от IN до OUT 59,999 с — меньше");
    expect(one(solo([90, 90.001]), "duration").text).toContain("в записи от IN до OUT 3 мин 0,001 с — больше");
    expect(one(crew("multi-line-pair", [[119.999], [119.999]]), "duration").text).toContain("в записи от IN до OUT 1 мин 59,999 с — меньше");
  });

  it("границы — те, что в своде правил", () => {
    expect(TIME_LIMITS).toEqual({ individual: [60, 180], pair: [120, 240], team: [120, 240] });
  });

  it("называет нарушенное условие и место в правилах, а следствие — словами без чисел", () => {
    const short = one(solo([55]), "duration");
    expect(short.text).toContain("от 1 мин до 3 мин");
    expect(short.text).toContain("55 с");
    expect(short.text).toContain("непролётанным (ISKJB XI.A.2.a, стр. 24)");
    expect(short.sources).toEqual([CITED.times, CITED.short]);
    const long = one(solo([100, 95]), "duration");
    expect(long.text).toContain("3 мин 15 с");
    expect(long.text).toContain("до отметки наибольшего времени");
    expect(long.text).toContain("единогласным решением судей");
    expect(long.sources).toEqual([CITED.times, CITED.long]);
  });

  it("считает только шаги между IN и OUT — и остановки с поворотами тоже", () => {
    const routine = parse({
      discipline: "multi-line-individual",
      kites: ["1"],
      segments: [
        {
          origin: "own",
          paths: {
            "1": [
              { kind: "start", at: A },
              { kind: "line", to: B, nose: 0, seconds: 500 },
              markIn,
              { kind: "line", to: A, nose: 0, seconds: 40 },
              { kind: "mark", mark: "stall", nose: 0, seconds: 15 },
              { kind: "rotate", degrees: 90, direction: "cw", about: "center", seconds: 10 },
              markOut,
              { kind: "line", to: B, nose: 90, seconds: 500 },
            ],
          },
        },
      ],
    });
    expect(judgedTimes(routine)).toEqual([{ kite: "1", seconds: 65, untimed: 0 }]);
    expect(one(routine, "duration").code).toBe("duration.ok");
  });

  it("шаг без длительности: время не выдумывается, вывода нет", () => {
    const finding = one(solo([30, null, 20, null]), "duration");
    expect(finding).toMatchObject({ code: "duration.untimed", state: "unknown" });
    expect(finding.text).toContain("без длительности — 2");
    expect(finding.text).toContain("50 с");
    // Меньше минимума заданные шаги ещё не значат: остальные добавят времени.
    expect(one(solo([10, null]), "duration").code).toBe("duration.untimed");
  });

  it("шаг без длительности, а заданные уже дольше наибольшего времени — нарушение", () => {
    const finding = one(solo([100, null, 90]), "duration");
    expect(finding).toMatchObject({ code: "duration.long", state: "violation" });
    expect(finding.text).toContain("3 мин 10 с");
  });

  it("заданные шаги дошли до наибольшего времени, а темп задан не у всех — уже дольше", () => {
    // Шаг без длительности время только добавит.
    expect(one(solo([180, null]), "duration").code).toBe("duration.long");
    expect(one(solo([100, null, 80]), "duration").code).toBe("duration.long");
    expect(one(solo([179.999, null]), "duration").code).toBe("duration.untimed");
  });

  it("длительность мимо разбора, которая не положительное число, — темп не задан", () => {
    for (const bad of [Number.NaN, -30, 0, Number.POSITIVE_INFINITY, null, "30", true]) {
      const routine = solo([70, 20]);
      (routine.segments[0].paths["1"][3] as { seconds?: unknown }).seconds = bad;
      expect(judgedTimes(routine), String(bad)).toEqual([{ kite: "1", seconds: 70, untimed: 1 }]);
      const finding = one(routine, "duration");
      expect(finding.code, String(bad)).toBe("duration.untimed");
      expect(finding.text, String(bad)).not.toMatch(/NaN|Infinity/);
    }
  });

  it("темп не задан ни у одного шага — так и сказано, без суммы", () => {
    const finding = one(solo([null, null, null]), "duration");
    expect(finding).toMatchObject({ code: "duration.untimed", state: "unknown" });
    expect(finding.text).toContain("темп не задан ни у одного шага между IN и OUT (шагов — 3)");
    expect(finding.text).not.toContain("дают");
  });

  it("у отметки без длительности темп тоже не задан", () => {
    const routine = parse({
      discipline: "multi-line-individual",
      kites: ["1"],
      segments: [
        {
          origin: "own",
          paths: { "1": [{ kind: "start", at: A }, markIn, ...slides([70]), { kind: "mark", mark: "stall", nose: 0 }, markOut] },
        },
      ],
    });
    expect(judgedTimes(routine)).toEqual([{ kite: "1", seconds: 70, untimed: 1 }]);
    expect(one(routine, "duration").code).toBe("duration.untimed");
  });

  it("шаги фигуры каталога несут длительность из ссылки", () => {
    // MI 28 — квадрат одного кайта: вход в (−30; 10), между вызовами пять шагов.
    const square = (seconds?: (number | null)[]) =>
      parse({
        discipline: "multi-line-individual",
        kites: ["1"],
        segments: [
          { origin: "own", paths: { "1": [{ kind: "start", at: [-30, 10] }, markIn] } },
          { origin: "figure", figure: "mi-28-square", ...(seconds ? { seconds: { "1": seconds } } : {}) },
          { origin: "own", paths: { "1": [markOut] } },
        ],
      });
    expect(judgedTimes(square([20, 5, 20, 20, 20]))).toEqual([{ kite: "1", seconds: 85, untimed: 0 }]);
    expect(one(square([20, 5, 20, 20, 20]), "duration").code).toBe("duration.ok");
    expect(one(square([6, 1, 6, 6, 6]), "duration").code).toBe("duration.short");
    expect(judgedTimes(square([20, null, 20, 20, 20]))).toEqual([{ kite: "1", seconds: 80, untimed: 1 }]);
    expect(judgedTimes(square())).toEqual([{ kite: "1", seconds: 0, untimed: 5 }]);
  });

  it("у кайтов пары время между вызовами разное — запись противоречит себе", () => {
    const finding = one(crew("multi-line-pair", [[150], [160]]), "duration");
    expect(finding).toMatchObject({ code: "duration.disagree", state: "unknown" });
    expect(finding.text).toContain("«1» — 2 мин 30 с, «2» — 2 мин 40 с");
    expect(finding.text).toContain("здесь считаются общими");
    expect(finding.sources).toEqual([CITED.times, CITED.competitor]);
    // Недосчитанный кайт уже не короче досчитанного, а его шаг без длительности
    // время только добавит.
    const partial = one(crew("multi-line-pair", [[150], [160, null]]), "duration");
    expect(partial.code).toBe("duration.disagree");
    expect(partial.text).toContain("«1» — 2 мин 30 с, «2» — больше 2 мин 40 с");
    expect(one(crew("multi-line-pair", [[150], [150, null]]), "duration").code).toBe("duration.disagree");
    expect(one(crew("multi-line-pair", [[150], [149.999, null]]), "duration").code).toBe("duration.ok");
    // Порядок сложения десятых противоречием не становится.
    expect(one(crew("multi-line-team", [[0.1, 0.2, 149.7], [149.7, 0.2, 0.1], [50, 50, 50]]), "duration").code).toBe("duration.ok");
    expect(one(crew("multi-line-team", [[150], [150], [151]]), "duration").code).toBe("duration.disagree");
    // Короче первого — тоже разное, и нарушением по первому кайту не становится.
    expect(one(crew("multi-line-pair", [[150], [140]]), "duration").code).toBe("duration.disagree");
    expect(one(crew("multi-line-pair", [[250], [130]]), "duration").code).toBe("duration.disagree");
    // Хватит одного недосчитанного кайта, который уже не короче досчитанного.
    expect(one(crew("multi-line-team", [[150], [100, null], [160, null]]), "duration").code).toBe("duration.disagree");
    // Равные суммы, округлившиеся в соседние тысячные, — не противоречие.
    expect(one(crew("multi-line-team", [[201.4155], [139.2873, 62.1282], [62.1282, 139.2873]]), "duration").code).toBe("duration.ok");
    expect(one(crew("multi-line-pair", [[150], [150.002]]), "duration").code).toBe("duration.disagree");
  });

  it("время пары берётся у кайта, чей темп задан целиком", () => {
    expect(one(crew("multi-line-pair", [[150], [100, null]]), "duration").code).toBe("duration.ok");
    expect(one(crew("multi-line-pair", [[100], [50, null]]), "duration").code).toBe("duration.short");
    expect(one(crew("multi-line-pair", [[100, null], [50, null]]), "duration").code).toBe("duration.untimed");
    expect(one(crew("multi-line-pair", [[250, null], [50, null]]), "duration").code).toBe("duration.long");
    // Кайт с наибольшей суммой — не первый; шаги без длительности сочтены по всем.
    const late = one(crew("multi-line-pair", [[10, null, null, null], [240, null]]), "duration");
    expect(late.code).toBe("duration.long");
    expect(late.text).toContain("без длительности — 4");
    expect(late.text).toContain("у кайта с наибольшей суммой дают 4 мин");
    expect(one(crew("multi-line-pair", [[10, null], [239, null]]), "duration").code).toBe("duration.untimed");
  });
});

// Рутина, собранная мимо разбора: файл с такими вызовами разбор не примет, а
// редактор собрать может.
function handmade(marks: ("in" | "out")[]): Routine {
  const steps: Routine["segments"][number]["paths"][string] = [{ kind: "start", at: A }];
  for (const mark of marks) {
    steps.push({ kind: "line", to: steps.length % 2 === 1 ? B : A, nose: 0, seconds: 70 }, { kind: "mark", mark });
  }
  return { slug: "proba", name: "Проба", discipline: "multi-line-individual", kites: ["1"], segments: [{ origin: "own", paths: { "1": steps } }] } as Routine;
}

describe("вызовы IN и OUT", () => {
  it("оба вызова есть", () => {
    expect(one(solo([70]), "calls")).toMatchObject({ code: "calls.ok", state: "ok", standing: "rule", sources: [CITED.calls] });
    expect(one(crew("multi-line-pair", [[150], [150]]), "calls").text).toContain("у каждого кайта");
  });

  it.each([
    ["нет OUT", ["in"], "нет вызова OUT"],
    ["нет IN", ["out"], "нет вызова IN"],
    ["нет обоих", [], "нет вызова IN и OUT"],
  ] as const)("%s — нарушение", (_, marks, words) => {
    const routine = handmade([...marks]);
    const finding = one(routine, "calls");
    expect(finding).toMatchObject({ code: "calls.missing", state: "violation", standing: "rule", sources: [CITED.calls, CITED.noCall] });
    expect(finding.text).toContain(words);
    expect(finding.text).toContain("ISKRB IV.F.1, стр. 13");
    expect(finding.text).toContain("ISKJB XI.D, стр. 24");
    // Без границ рутины время и крайние точки не считаются.
    expect(one(routine, "duration")).toMatchObject({ code: "duration.no-calls", state: "unknown" });
    expect(judgedExtent(routine)).toBeNull();
    expect(find(routine, "window").map((item) => item.code)).toEqual(["window.criterion"]);
  });

  it.each([
    ["два IN", ["in", "in", "out"], "IN, IN, OUT"],
    ["OUT раньше IN", ["out", "in"], "OUT, IN"],
    ["два OUT", ["in", "out", "out"], "IN, OUT, OUT"],
  ] as const)("%s — границ у рутины нет", (_, marks, words) => {
    const routine = handmade([...marks]);
    const finding = one(routine, "calls");
    expect(finding).toMatchObject({ code: "calls.tangled", state: "unknown" });
    expect(finding.text).toContain(words);
    expect(one(routine, "duration").code).toBe("duration.no-calls");
  });

  it("в рутине без кайтов вызовов нет, и считать нечего", () => {
    const empty = { slug: "proba", name: "Проба", discipline: "multi-line-team", kites: [], segments: [] } as unknown as Routine;
    expect(checkRoutine(empty).map((finding) => [finding.code, finding.state])).toEqual([
      ["calls.missing", "violation"],
      ["duration.no-calls", "unknown"],
      ["ends.unchecked", "unchecked"],
      ["window.criterion", "unchecked"],
      ["variety.criterion", "unchecked"],
    ]);
    expect(one(empty, "calls").text).toContain("нет ни одного кайта");
  });

  it("вызов есть у второго кайта и не у первого — противоречие записи, а не пропуск", () => {
    const routine = crew("multi-line-pair", [[150], [150]]);
    const first = routine.segments[0].paths["1"];
    first.splice(
      first.findIndex((step) => step.kind === "mark" && step.mark === "out"),
      1,
    );
    expect(one(routine, "calls")).toMatchObject({ code: "calls.tangled", state: "unknown" });
    expect(one(routine, "calls").text).toContain("у кайта «1» вызовы идут так: IN");
    routine.segments[0].paths["1"] = [];
    expect(one(routine, "calls").text).toContain("у кайта «1» вызовов нет");
  });

  it("перепутанные вызовы у одного кайта пары", () => {
    const routine = crew("multi-line-pair", [[150], [150]]);
    routine.segments[0].paths["2"].push({ kind: "mark", mark: "out" });
    expect(one(routine, "calls")).toMatchObject({ code: "calls.tangled", state: "unknown" });
    expect(one(routine, "calls").text).toContain("у кайта «2» вызовы идут так: IN, OUT, OUT");
    expect(one(routine, "duration").code).toBe("duration.no-calls");
    // Крайние точки по одному кайту из двух не считаются.
    expect(judgedExtent(routine)).toBeNull();
  });

  it("шаг «start» между вызовами мимо разбора: длительности у него нет, точка в путь входит", () => {
    const routine = solo([70]);
    const steps = routine.segments[0].paths["1"];
    steps.splice(2, 0, { kind: "start", at: [-80, 20] });
    expect(judgedTimes(routine)).toEqual([{ kite: "1", seconds: 70, untimed: 0 }]);
    expect(judgedExtent(routine)).toEqual({ x: [-80, 0], y: [20, 20], unset: 0 });
  });

  it("вызова нет у одного кайта пары", () => {
    const routine = crew("multi-line-pair", [[150], [150]]);
    const second = routine.segments[0].paths["2"];
    second.splice(
      second.findIndex((step) => step.kind === "mark" && step.mark === "out"),
      1,
    );
    // Участник — пара целиком: IN и OUT у первого кайта есть, так что вызов
    // назван, а запись сама себе противоречит.
    expect(one(routine, "calls")).toMatchObject({ code: "calls.tangled", state: "unknown", sources: [CITED.calls] });
    expect(one(routine, "calls").text).toContain("у кайта «2» вызовы идут так: IN");
    // Вызова нет ни у одного кайта — его не назвал участник.
    const first = routine.segments[0].paths["1"];
    first.splice(
      first.findIndex((step) => step.kind === "mark" && step.mark === "out"),
      1,
    );
    expect(one(routine, "calls")).toMatchObject({ code: "calls.missing", state: "violation" });
    expect(one(routine, "calls").text).toContain("нет вызова OUT");
    routine.segments[0].paths["2"] = [];
    expect(one(routine, "calls").text).toContain("нет вызова OUT");
  });
});

describe("начало и конец", () => {
  it("по записи не проверяется: ни «выполнено», ни «нарушено»", () => {
    for (const routine of [solo([70]), solo([5]), handmade([])]) {
      const finding = one(routine, "ends");
      expect(finding).toMatchObject({ code: "ends.unchecked", state: "unchecked", standing: "rule", sources: [CITED.ends] });
      expect(finding.text).toContain("ISKJB XI.A.3, стр. 24");
      expect(finding.text).toContain("по записи этого не проверить");
    }
  });
});

describe("состав команды", () => {
  const team = (size: number) => crew("multi-line-team", Array.from({ length: size }, () => [150]));

  it("пять участников — граница входит, шесть — нарушение", () => {
    expect(TEAM_MOST).toBe(5);
    expect(one(team(3), "crew")).toMatchObject({ code: "crew.ok", state: "ok" });
    expect(one(team(5), "crew")).toMatchObject({ code: "crew.ok", state: "ok" });
    const over = one(team(6), "crew");
    expect(over).toMatchObject({ code: "crew.over", state: "violation", standing: "rule", sources: [CITED.crew] });
    expect(over.text).toContain("ISKRB III.K.2, стр. 11");
    expect(over.text).toContain("кайтов 6");
  });

  it("одиночнику и паре проверка не выдаётся", () => {
    expect(find(solo([70]), "crew")).toEqual([]);
    expect(find(crew("multi-line-pair", [[150], [150]]), "crew")).toEqual([]);
  });
});

describe("окно", () => {
  const own = (steps: Raw[]) => parse({ discipline: "multi-line-individual", kites: ["1"], segments: [{ origin: "own", paths: { "1": steps } }] });

  it("критерий назван критерием, крайние точки — нашей мерой без вывода", () => {
    const [criterion, extent] = find(solo([70]), "window");
    expect(criterion).toMatchObject({ code: "window.criterion", standing: "criterion", state: "unchecked", sources: [CITED.execution, CITED.judged, CITED.window] });
    expect(extent).toMatchObject({ code: "window.extent", standing: "own", state: "fact", sources: [] });
    expect(extent.text).toContain("по горизонтали от −50 до 0, по высоте от 20 до 20");
    expect(extent.text).toContain("порога у них нет");
  });

  it("берёт путь между IN и OUT, а не весь", () => {
    const routine = own([
      { kind: "start", at: [-90, 5] },
      { kind: "line", to: [-20, 30], nose: 0 },
      markIn,
      { kind: "line", to: [10, 30], nose: 0 },
      { kind: "line", to: [10, 60], nose: 0 },
      markOut,
      { kind: "line", to: [90, 95], nose: 0 },
    ]);
    expect(judgedExtent(routine)).toEqual({ x: [-20, 10], y: [30, 60], unset: 0 });
  });

  it("дуга уходит дальше своих концов", () => {
    // Полукруг против часовой из нижней точки в верхнюю идёт через правую.
    const half = own([{ kind: "start", at: [0, 20] }, markIn, { kind: "arc", to: [0, 70], center: [0, 45], direction: "ccw", sweep: 180 }, markOut]);
    const extent = judgedExtent(half)!;
    expect(extent.x[0]).toBeCloseTo(0, 9);
    expect(extent.x[1]).toBeCloseTo(25, 9);
    expect(extent.y).toEqual([20, 70]);
  });

  it.each([
    ["cw", 30],
    ["cw", 100],
    ["ccw", 200],
    ["ccw", 275],
    ["cw", 360],
    ["ccw", 359],
  ] as const)("крайние точки дуги %s на %d° — те же, что у частой выборки", (direction, sweep) => {
    const from: Point = [13, 38];
    const center: Point = [-5, 50];
    const to = arcPoint(from, center, direction, sweep).map((value) => Math.round(value * 100) / 100);
    const extent = judgedExtent(own([{ kind: "start", at: from }, markIn, { kind: "arc", to, center, direction, sweep }, markOut]))!;
    const sample = Array.from({ length: 20001 }, (_, index) => arcPoint(from, center, direction, (sweep * index) / 20000));
    const xs = sample.map((point) => point[0]);
    const ys = sample.map((point) => point[1]);
    expect(extent.x[0]).toBeCloseTo(Math.min(...xs), 1);
    expect(extent.x[1]).toBeCloseTo(Math.max(...xs), 1);
    expect(extent.y[0]).toBeCloseTo(Math.min(...ys), 1);
    expect(extent.y[1]).toBeCloseTo(Math.max(...ys), 1);
  });

  it("поворот вокруг законцовки ведёт нос по дуге", () => {
    // Нос вверх, поворот на 180° вокруг правой законцовки: нос уходит вправо на
    // размах и на полразмаха выше начала.
    const routine = own([
      { kind: "start", at: [0, 20] },
      { kind: "line", to: [0, 40] },
      markIn,
      { kind: "rotate", degrees: 180, direction: "cw", about: "right-tip", to: [10, 40] },
      { kind: "line", to: [30, 40], nose: 180 },
      markOut,
    ]);
    const extent = judgedExtent(routine)!;
    expect(extent.x).toEqual([0, 30]);
    // Ниже начала поворота нос не опускается: дуга — половина круга, а не весь.
    expect(extent.y[0]).toBe(40);
    expect(extent.y[1]).toBeCloseTo(45, 9);
  });

  it("координаты пишутся до сотых", () => {
    const routine = own([{ kind: "start", at: [-12.34, 20.5] }, markIn, { kind: "line", to: [7.25, 20.5], nose: 0 }, markOut]);
    expect(find(routine, "window")[1].text).toContain("по горизонтали от −12,34 до 7,25, по высоте от 20,5 до 20,5");
  });

  it("у пары — крайние точки обоих кайтов", () => {
    expect(judgedExtent(crew("multi-line-pair", [[150], [150]]))).toEqual({ x: [-50, 0], y: [10, 20], unset: 0 });
    expect(find(crew("multi-line-pair", [[150], [150]]), "window")[1].text).toContain("носы кайтов проходят");
  });

  it("место, которого книга не задаёт, названо", () => {
    // У MI 02 высота ступеней книгой не задана.
    const stairs = figures.find((figure) => figure.code === "MI 02")!;
    const geometry = stairs.geometry;
    if (geometry.status !== "ok") {
      throw new Error("у MI 02 геометрия не снята");
    }
    const first = geometry.variants[0].kites[0].path[0];
    if (first.kind !== "start") {
      throw new Error("путь MI 02 начинается не со старта");
    }
    const withFigure = parse({
      discipline: "multi-line-individual",
      kites: ["1"],
      segments: [
        { origin: "own", paths: { "1": [{ kind: "start", at: first.at }, markIn] } },
        { origin: "figure", figure: stairs.slug },
        { origin: "own", paths: { "1": [markOut] } },
      ],
    });
    const extent = judgedExtent(withFigure)!;
    // Четыре поворота с незаданным местом и отрезок с незаданной высотой.
    expect(extent.unset).toBe(5);
    expect(find(withFigure, "window")[1].text).toContain(`книга фигур не задаёт, — ${extent.unset}`);
  });
});

describe("разнообразие", () => {
  it("названо критерием и не считается", () => {
    const finding = one(solo([70]), "variety");
    expect(finding).toMatchObject({ code: "variety.criterion", standing: "criterion", state: "unchecked", sources: [CITED.content] });
    expect(finding.text).toContain("не считается");
    expect(finding.text).not.toMatch(/\d(?![^()]*\))/);
  });
});

// По рутине на каждый исход каждой проверки.
const SAMPLES: Routine[] = [
  solo([70]),
  solo([5]),
  solo([100, 100]),
  solo([30, null]),
  solo([100, null, 90]),
  handmade([]),
  handmade(["in", "in", "out"]),
  crew("multi-line-pair", [[150], [160]]),
  crew("dual-line-team", [[150], [150], [150]]),
  crew("multi-line-team", Array.from({ length: 6 }, () => [150])),
];
const ALL = SAMPLES.flatMap(checkRoutine);

describe("checkRoutine", () => {
  it("выдаёт проверки по порядку: сначала условия правил, потом критерии", () => {
    expect(checkRoutine(solo([70])).map((finding) => finding.code)).toEqual([
      "calls.ok",
      "duration.ok",
      "ends.unchecked",
      "window.criterion",
      "window.extent",
      "variety.criterion",
    ]);
    expect(checkRoutine(crew("multi-line-team", [[150], [150], [150]])).map((finding) => finding.check)).toEqual([
      "calls",
      "duration",
      "ends",
      "crew",
      "window",
      "window",
      "variety",
    ]);
  });

  it("образцы покрывают каждый исход", () => {
    expect([...new Set(ALL.map((finding) => finding.code))].sort()).toEqual([
      "calls.missing",
      "calls.ok",
      "calls.tangled",
      "crew.ok",
      "crew.over",
      "duration.disagree",
      "duration.long",
      "duration.no-calls",
      "duration.ok",
      "duration.short",
      "duration.untimed",
      "ends.unchecked",
      "variety.criterion",
      "window.criterion",
      "window.extent",
    ]);
    expect([...new Set(ALL.map((finding) => finding.check))].sort()).toEqual([...CHECKS].sort());
  });

  it("находка не выглядит судейской оценкой: ни баллов, ни процентов, ни слова «оценка»", () => {
    for (const finding of ALL) {
      const text = findingText(finding);
      expect(text, finding.code).not.toMatch(/оцен|балл|(?<![а-яё])очк|процент|%|score|ноль|(?<![а-яё])нул/i);
      // Размер штрафа в находку не попадает: число рядом с ним читалось бы как
      // счёт. Ссылки на страницы правил стоят в скобках и сюда не идут.
      expect(text.replace(/\([^()]*\)/g, ""), finding.code).not.toMatch(/штраф\D{0,40}\d|\d+\s*из\s*\d+|минус/i);
    }
  });

  it("основание стоит первым и у каждого своё слово", () => {
    expect(new Set(Object.values(STANDINGS)).size).toBe(3);
    for (const finding of ALL) {
      expect(findingText(finding).startsWith(`${STANDINGS[finding.standing]}: `), finding.code).toBe(true);
    }
    expect(findingText(one(solo([70]), "duration"))).toMatch(/^Правила требуют: /);
    expect(findingText(one(solo([70]), "variety"))).toMatch(/^Правила называют критерием, меры не дают: /);
    expect(findingText(find(solo([70]), "window")[1])).toMatch(/^Наша мера, не правило: /);
  });

  it("вывод делается только там, где у правил есть условие", () => {
    for (const finding of ALL) {
      if (finding.state === "ok" || finding.state === "violation") {
        expect(finding.standing, finding.code).toBe("rule");
      }
      if (finding.standing === "criterion") {
        expect(finding.state, finding.code).toBe("unchecked");
      }
      if (finding.standing === "own") {
        expect(finding.state, finding.code).toBe("fact");
        expect(finding.sources, finding.code).toEqual([]);
      }
    }
  });

  it("у каждой ссылки на правила — документ реестра и страница внутри него, и она названа в тексте", () => {
    const sources = loadSources();
    const names = { iskrb: "ISKRB", iskjb: "ISKJB" };
    for (const citation of Object.values(CITED)) {
      const document = sources.find((source) => source.id === citation.document && source.version === "3.0");
      expect(document, citation.document).toBeDefined();
      expect(citation.page).toBeGreaterThanOrEqual(1);
      expect(citation.page).toBeLessThanOrEqual(document!.pages);
    }
    for (const finding of ALL) {
      if (finding.standing !== "own") {
        expect(finding.sources.length, finding.code).toBeGreaterThan(0);
      }
      for (const source of finding.sources) {
        expect(findingText(finding), finding.code).toContain(`${names[source.document]} ${source.section}, стр. ${source.page}`);
      }
    }
  });
});

describe("clock", () => {
  it.each([
    [55, "55 с"],
    [60, "1 мин"],
    [95, "1 мин 35 с"],
    [180, "3 мин"],
    [59.5, "59,5 с"],
    [59.999, "59,999 с"],
    [119.999, "1 мин 59,999 с"],
    [180.001, "3 мин 0,001 с"],
    [179.9996, "3 мин"],
    [8.2 + 23.9 + 27.9, "1 мин"],
  ])("%d → %s", (seconds, text) => {
    expect(clock(seconds)).toBe(text);
  });
});

describe("рутины каталога", () => {
  it("каждая проходит проверки без сбоя", () => {
    for (const routine of listRoutines()) {
      expect(() => checkRoutine(routine), routine.slug).not.toThrow();
    }
  });
});

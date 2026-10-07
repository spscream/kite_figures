import { describe, expect, it } from "vitest";

import { along, drawVariant } from "./diagram";
import { listFigures } from "./figures";
import { isSwing, parseGeometry, type Variant } from "./geometry";

const start = { kind: "start", at: [-50, 20] };
const markIn = { kind: "mark", mark: "in" };
const markOut = { kind: "mark", mark: "out" };
// Точка поворота названа всегда; в чертеже от неё зависит только смещение.
const CENTER = { about: "center", about_basis: "text" };

// Чертёж строится по разобранной геометрии, как на странице: с умолчаниями.
const NO_GUIDES = { status: "not_found", reason: "на схеме их нет" };

function variant(...paths: unknown[][]): Variant {
  return guided(NO_GUIDES, ...paths);
}

function guided(guides: unknown, ...paths: unknown[][]): Variant {
  const kites = paths.map((path, index) => ({ id: String(index + 1), path }));
  const raw = { status: "ok", variants: [{ id: "main", kites, guides }], notes: ["для теста"] };
  const read = parseGeometry("g", raw, 125);
  if (read.status !== "ok") {
    throw new Error("геометрия не разобрана");
  }
  return read.variants[0];
}

// Наконечник стрелки — треугольник «остриё, левый угол, правый угол».
function arrowTips(arrows: { d: string }[]): { tip: number[]; back: number[] }[] {
  return arrows.flatMap(({ d }) =>
    [...d.matchAll(/M(\S+) (\S+)L(\S+) (\S+)L(\S+) (\S+)Z/g)].map((match) => {
      const [tx, ty, lx, ly, rx, ry] = match.slice(1).map(Number);
      return { tip: [tx, ty], back: [(lx + rx) / 2, (ly + ry) / 2] };
    }),
  );
}

// Контуры значков одного вида: вершины в координатах SVG.
const polygonsOf = (d: string): number[][][] =>
  d
    .split("Z")
    .filter(Boolean)
    .map((part) => [...part.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((match) => [Number(match[1]), Number(match[2])]));

// Все значки одного вида одной строкой, без разбора по цвету.
const drawn = (shapes: ReturnType<typeof drawVariant>["shapes"], name: keyof typeof shapes) =>
  (shapes[name] ?? []).map((item) => item.d).join("");

// Значки кайта вида: первая вершина и середина хвоста — в координатах SVG.
function kites(d: string, rev = false): { nose: number[]; at: number[] }[] {
  return d
    .split("Z")
    .filter(Boolean)
    .map((part) => {
      const points = [...part.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((match) => [Number(match[1]), Number(match[2])]);
      // У дельты нос — первая вершина, вырез хвоста — третья; у четырёхстропного
      // нос — середина кромки (первые две вершины), вырез — четвёртая.
      const front = rev ? [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2] : points[0];
      const notch = rev ? points[3] : points[2];
      const size = Math.hypot(front[0] - notch[0], front[1] - notch[1]);
      return { at: front, nose: [(front[0] - notch[0]) / size, -(front[1] - notch[1]) / size] };
    });
}

const line = (to: number[], extra: object = {}) => ({ kind: "line", to, ...extra });
// Остановка носом вверх — как книга рисует её у двухстропного.
const stall = { kind: "mark", mark: "stall", nose: 0 };
const stallAt = (nose: unknown) => ({ kind: "mark", mark: "stall", nose });

describe("drawVariant", () => {
  it("кладёт землю вниз: y сетки переворачивается", () => {
    const drawing = drawVariant(variant([start, markIn, line([0, 20]), markOut]));
    expect(drawing.tracks).toEqual([{ id: "1", d: "M-50 80L0 80" }]);
  });

  it("дуга по часовой, как видит пилот, идёт по часовой и на экране", () => {
    const arc = { kind: "arc", to: [0, 70], center: [0, 45], direction: "cw", sweep: 180 };
    const drawing = drawVariant(variant([{ kind: "start", at: [0, 20] }, markIn, arc, markOut]));
    expect(drawing.tracks[0].d).toBe("M0 80A25 25 0 0 1 0 30");
  });

  it("полный круг рисует двумя половинами и возвращается в начало", () => {
    const circle = { kind: "arc", to: [0, 70], center: [0, 50], direction: "ccw", sweep: 360 };
    const drawing = drawVariant(variant([{ kind: "start", at: [0, 70] }, markIn, circle, markOut]));
    expect(drawing.tracks[0].d).toBe("M0 30A20 20 0 0 0 0 70A20 20 0 0 0 0 30");
  });

  it("дугу в три четверти оборота ведёт через её середину, а не напрямик", () => {
    const arc = { kind: "arc", to: [0, 70], center: [0, 50], direction: "cw", sweep: 270 };
    const drawing = drawVariant(variant([{ kind: "start", at: [20, 50] }, markIn, arc, markOut]));
    // 135° по часовой от правой точки — слева внизу.
    expect(drawing.tracks[0].d).toBe("M20 50A20 20 0 0 1 -14.14 64.14A20 20 0 0 1 0 30");
  });

  describe("двухстропный кайт: направление показывает значок кайта в пути", () => {
    const path = [start, markIn, line([0, 20]), line([0, 60]), line([-40, 60]), markOut];

    it("стрелок рядом с линией нет", () => {
      expect(drawVariant(variant(path)).arrows).toEqual([]);
    });

    it("значок стоит на шаге, у концов которого нет значка с тем же носом, и смотрит по ходу", () => {
      // Первый шаг начинается входом, последний кончается выходом: их курс
      // уже показан. Средний — вверх — получает свой значок.
      const [only, ...rest] = kites(drawn(drawVariant(variant(path)).shapes, "pass"));
      expect(rest).toEqual([]);
      expect(only.nose[0]).toBeCloseTo(0);
      expect(only.nose[1]).toBeCloseTo(1);
      // Нос значка — на линии шага.
      expect(only.at[0]).toBeCloseTo(0);
      expect(100 - only.at[1]).toBeGreaterThan(20);
      expect(100 - only.at[1]).toBeLessThan(60);
    });

    it.each([
      ["cw", -1],
      ["ccw", 1],
    ] as const)("на дуге %s значок идёт по касательной в сторону обхода", (direction, vertical) => {
      const arc = { kind: "arc", to: [-20, 50], center: [0, 50], direction, sweep: 180 };
      const { shapes } = drawVariant(
        variant([{ kind: "start", at: [60, 50] }, markIn, line([20, 50]), arc, line([-60, 50]), markOut]),
      );
      const [mark] = kites(drawn(shapes, "pass"));
      // Место по умолчанию — 0,6 дуги, то есть 108° от правой точки.
      expect(mark.nose[0]).toBeCloseTo(-Math.sin((108 * Math.PI) / 180));
      expect(mark.nose[1]).toBeCloseTo(vertical * Math.cos((108 * Math.PI) / 180));
    });

    it("на шаге «unmarked» знака направления нет вовсе", () => {
      const marked = [start, markIn, line([0, 20]), line([0, 60]), line([-40, 60]), markOut];
      const unmarked = [start, markIn, line([0, 20]), line([0, 60], { unmarked: true }), line([-40, 60]), markOut];
      expect(kites(drawn(drawVariant(variant(marked)).shapes, "pass"))).toHaveLength(1);
      expect(drawVariant(variant(unmarked)).shapes.pass).toBeUndefined();
      // Линия при этом та же.
      expect(drawVariant(variant(unmarked)).tracks).toEqual(drawVariant(variant(marked)).tracks);
    });

    it("значок уходит с места, занятого другим значком", () => {
      const path = [start, markIn, line([0, 20]), line([0, 70]), line([40, 70]), markOut];
      // Обычное место на подъёме — 0,6 шага, высота 50; там стоит остановка
      // второго кайта.
      const other = [{ kind: "start", at: [-50, 50] }, markIn, line([3, 50]), stall, line([3, 90]), markOut];
      const alone = kites(drawn(drawVariant(variant(path)).shapes, "pass"));
      expect(alone.some((mark) => mark.at[0] === 0 && mark.at[1] === 50)).toBe(true);
      const climbing = kites(drawVariant(variant(path, other)).shapes.pass?.find((item) => item.tone === "k1")?.d ?? "").filter(
        (mark) => mark.at[0] === 0,
      );
      expect(climbing).toHaveLength(1);
      expect(Math.hypot(climbing[0].at[0] - 3, climbing[0].at[1] - 50)).toBeGreaterThan(7);
    });

    it("шаг хвостом вперёд получает стрелку: значок кайта направления там не показывает", () => {
      const path = [start, markIn, line([0, 20]), line([0, 60]), line([40, 60]), line([40, 20], { nose: "backward" }), line([80, 20]), markOut];
      const tips = arrowTips(drawVariant(variant(path)).arrows);
      expect(tips).toHaveLength(1);
      // Стрелка идёт вниз, как летит кайт, хотя нос его смотрит вверх.
      expect(tips[0].tip[1]).toBeGreaterThan(tips[0].back[1]);
      expect(tips[0].tip[0]).toBeCloseTo(tips[0].back[0]);
    });
  });

  describe("четырёхстропный кайт: рядом с линией идёт стрелка", () => {
    const up = [{ kind: "start", at: [0, 0] }, markIn, line([0, 80]), stall, line([0, 0], { nose: "backward" }), markOut];

    it("стрелка стоит на каждом шаге и смотрит по ходу", () => {
      const tips = arrowTips(drawVariant(variant(up), true).arrows);
      expect(tips).toHaveLength(2);
      // Первый шаг — вверх: на экране остриё выше основания.
      expect(tips[0].tip[1]).toBeLessThan(tips[0].back[1]);
      expect(tips[1].tip[1]).toBeGreaterThan(tips[1].back[1]);
    });

    it("встречные проходы по одной линии получают стрелки по разные её стороны", () => {
      const [there, back] = arrowTips(drawVariant(variant(up), true).arrows);
      // Стрелка — справа по ходу: вверх — правее линии, вниз — левее.
      expect(there.tip[0]).toBeCloseTo(4.6);
      expect(back.tip[0]).toBeCloseTo(-4.6);
    });

    it("первый проход от входа и последний к выходу окрашены, как в книге", () => {
      const square = [start, markIn, line([0, 20]), line([0, 60]), line([-50, 60]), markOut];
      expect(drawVariant(variant(square), true).arrows.map((item) => item.tone)).toEqual(["in", "mid", "out"]);
      // У команды все стрелки чёрные.
      expect(drawVariant(variant(square, up), true).arrows.map((item) => item.tone)).toEqual(["mid"]);
    });

    it("на шаге «unmarked» стрелки нет", () => {
      const path = [start, markIn, line([0, 20]), line([0, 60], { unmarked: true }), markOut];
      expect(arrowTips(drawVariant(variant(path), true).arrows)).toHaveLength(1);
    });

    it("стрелка на дуге идёт тем же изгибом снаружи или внутри неё", () => {
      const arc = { kind: "arc", to: [20, 50], center: [0, 50], direction: "cw", sweep: 180 };
      const [{ tip }] = arrowTips(drawVariant(variant([{ kind: "start", at: [-20, 50] }, markIn, arc, markOut]), true).arrows);
      // По часовой через верх: справа по ходу — внутри круга, радиус 20 − 4,6.
      expect(Math.hypot(tip[0], tip[1] - 50)).toBeCloseTo(15.4);
    });

    it("значок в пути показывает нос, когда его не показывает значок у конца шага", () => {
      const slide = [start, markIn, line([0, 20]), line([0, 60], { nose: 90 }), line([-50, 60], { nose: 90 }), markOut];
      const marks = kites(drawn(drawVariant(variant(slide), true).shapes, "pass"), true);
      // Первый шаг начат входом с тем же носом, третий кончается выходом;
      // второй — подъём носом вправо — получает значок.
      expect(marks).toHaveLength(1);
      expect(marks[0].nose[0]).toBeCloseTo(1);
      expect(marks[0].nose[1]).toBeCloseTo(0);
    });

    it("в остановке кайт стоит по курсу метки из данных, а не по пути", () => {
      // Пришёл вправо, уходит вправо носом вверх; книга рисует его носом влево.
      const path = [
        start,
        markIn,
        line([0, 20]),
        stallAt(270),
        { kind: "rotate", degrees: 90, direction: "ccw", ...CENTER },
        line([40, 20], { nose: 0 }),
        markOut,
      ];
      for (const rev of [true, false]) {
        const marks = kites(drawn(drawVariant(variant(path), rev).shapes, "stall"), rev);
        expect(marks).toHaveLength(1);
        expect(marks[0].nose[0]).toBeCloseTo(-1);
        expect(marks[0].nose[1]).toBeCloseTo(0);
        // Нос метки — в самой точке остановки.
        expect(marks[0].at[0]).toBeCloseTo(0);
        expect(marks[0].at[1]).toBeCloseTo(80);
      }
    });

    it("где книга метки в остановке не рисует, значка нет, а подпись остаётся", () => {
      const missing = { status: "not_found", reason: "метки нет" };
      const { shapes, labels } = drawVariant(variant([start, markIn, line([0, 20]), stallAt(missing), line([40, 20]), markOut]), true);
      expect(shapes.stall).toBeUndefined();
      expect(labels.filter((label) => label.kind === "note").map((label) => label.text)).toEqual(["Stop"]);
    });

    it("две остановки в одной точке: с одним курсом — одна метка, с разными — две", () => {
      const twice = (first: number, second: number) => [
        { kind: "start", at: [0, 0] },
        markIn,
        line([0, 20], { nose: 90 }),
        stallAt(first),
        { kind: "arc", to: [0, 20], center: [0, 50], direction: "ccw", sweep: 360 },
        stallAt(second),
        line([0, 0], { nose: 90 }),
        markOut,
      ];
      const count = (path: unknown[]) => kites(drawn(drawVariant(variant(path), true).shapes, "stall"), true).length;
      expect(count(twice(90, 90))).toBe(1);
      expect(count(twice(270, 90))).toBe(2);
    });
  });

  it("каждому событию ставит свой знак", () => {
    const { shapes, labels } = drawVariant(
      variant([
        { kind: "start", at: [0, 0], basis: "measured" },
        markIn,
        { kind: "mark", mark: "launch" },
        line([0, 40]),
        stall,
        line([30, 40]),
        { kind: "rotate", degrees: 90, direction: "cw", ...CENTER },
        line([60, 40]),
        { kind: "mark", mark: "half-axel" },
        line([60, 0]),
        { kind: "mark", mark: "landing", style: "two-point" },
        markOut,
      ]),
    );
    // Значок кайта: нос, угол крыла, вырез хвоста, второй угол; нос — в точке.
    // На земле кайт стоит на ней: значок поднят на длину хвоста.
    expect(drawn(shapes, "in")).toBe("M0 94L3.3 100L0 98.5L-3.3 100Z");
    // На выходе кайт смотрит по последнему шагу — вниз, нос в точке.
    expect(drawn(shapes, "out")).toBe("M60 100L56.7 94L60 95.5L63.3 94Z");
    expect(drawn(shapes, "stall")).toBe("M0 60L3.3 66L0 64.5L-3.3 66Z");
    // Аксель — точка на линии, поворот — дуга со стрелкой рядом с точкой.
    expect(drawn(shapes, "axel")).toBe("M58.4 60a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0");
    expect(drawn(shapes, "turn")).toMatch(/^M\S+ \S+A3.4 3.4 0 1 1 /);
    // Старт не с линии сетки отмечен так же, как конец шага; под значком
    // кайта отметка не прячется, а встаёт рядом — у земли сбоку.
    expect(drawn(shapes, "measured")).toBe("M-10.1 98.5h3v3h-3z");
    const notes = labels.filter((label) => label.kind === "note").map((label) => label.text);
    expect(notes).toEqual(["Stall", "½ Axel", "90°", "Launch", "2-point landing"]);
  });

  it("остановки одного кайта нумерует по порядку, у четырёхстропного зовёт их Stop", () => {
    const path = [start, markIn, line([0, 20]), stall, line([0, 60]), { kind: "mark", mark: "stall", style: "snap", nose: 0 }, markOut];
    const texts = (rev: boolean) => drawVariant(variant(path), rev).labels.filter((label) => label.kind === "note").map((label) => label.text);
    expect(texts(true)).toEqual(["Stop #1", "Snap Stall #2"]);
    expect(texts(false)).toEqual(["Stall #1", "Snap Stall #2"]);
    const once = [start, markIn, line([0, 20]), stall, markOut];
    expect(drawVariant(variant(once), true).labels.filter((label) => label.kind === "note").map((label) => label.text)).toEqual(["Stop"]);
  });

  it("у команды одинаковый знак соседних кайтов ставит один раз", () => {
    const kite = (x: number) => [
      { kind: "start", at: [x, 20] },
      markIn,
      line([x, 60]),
      stall,
      { kind: "rotate", degrees: 90, direction: "cw", ...CENTER },
      line([x + 40, 60], { nose: 90 }),
      markOut,
    ];
    const { labels, shapes } = drawVariant(variant(kite(-50), kite(-40)), true);
    expect(labels.filter((label) => label.kind === "note").map((label) => label.text)).toEqual(["Stop", "90°"]);
    expect(drawn(shapes, "turn").match(/A3\.4 3\.4/g)).toHaveLength(1);
    // Остановки при этом — у каждого кайта своя и своего цвета.
    expect(shapes.stall?.map((item) => item.tone)).toEqual(["k1", "k2"]);
  });

  it("поворот рисует в сторону поворота", () => {
    const path = (direction: string) => [start, markIn, line([0, 20]), { kind: "rotate", degrees: 180, direction, ...CENTER }, markOut];
    const end = (direction: string) => {
      const d = drawn(drawVariant(variant(path(direction)), true).shapes, "turn");
      const [fx, tx] = [d.match(/^M(\S+) /)![1], d.match(/A3.4 3.4 0 1 \d (\S+) /)![1]].map(Number);
      return Math.sign(tx - fx);
    };
    // Дуга идёт через верх: по часовой — слева направо.
    expect(end("cw")).toBe(1);
    expect(end("ccw")).toBe(-1);
  });

  it("подпись выхода у самой земли не ложится на землю и на вход", () => {
    const drawing = drawVariant(
      variant([{ kind: "start", at: [0, 0] }, markIn, line([0, 80]), line([0, 5]), markOut]),
    );
    const [first, second] = drawing.labels;
    expect([first.text, second.text]).toEqual(["In", "Out"]);
    // «In» — справа от кайта над землёй, «Out» — слева, как в книге.
    expect(first.x).toBeGreaterThan(0);
    expect(first.y).toBeLessThan(100);
    expect(second.x).toBeLessThan(0);
    expect(second.y).toBeLessThan(100);
  });

  it("номера кайтов, выходящих навстречу в одну точку, не встают на чужую линию", () => {
    const left = [{ kind: "start", at: [-40, 50] }, markIn, line([0, 50]), markOut];
    const right = [{ kind: "start", at: [40, 50] }, markIn, line([0, 50]), markOut];
    const outs = drawVariant(variant(left, right)).labels.filter((label) => label.text.startsWith("#")).filter((_, index) => index % 2 === 1);
    expect(outs).toHaveLength(2);
    for (const label of outs) {
      expect(Math.abs(label.y - 50)).toBeGreaterThan(4);
    }
  });

  it("у четырёхстропного шаг «unmarked» не получает ни стрелки, ни значка кайта", () => {
    const marked = [start, markIn, line([0, 20]), line([0, 60]), line([-40, 60]), markOut];
    const unmarked = [start, markIn, line([0, 20]), line([0, 60], { unmarked: true }), line([-40, 60]), markOut];
    const full = drawVariant(variant(marked), true);
    const bare = drawVariant(variant(unmarked), true);
    expect(arrowTips(full.arrows)).toHaveLength(3);
    expect(arrowTips(bare.arrows)).toHaveLength(2);
    const onClimb = (drawing: typeof full) => kites(drawn(drawing.shapes, "pass"), true).filter((mark) => mark.at[0] === 0);
    expect(onClimb(full)).toHaveLength(1);
    expect(onClimb(bare)).toHaveLength(0);
  });

  it("стрелка малого круга по часовой встаёт снаружи: внутри ей негде уместиться", () => {
    const ring = { kind: "arc", to: [0, 50], center: [-5, 50], direction: "cw", sweep: 360 };
    const path = [{ kind: "start", at: [60, 50] }, markIn, line([0, 50]), ring, line([-60, 50]), markOut];
    const tips = arrowTips(drawVariant(variant(path), true).arrows);
    expect(tips).toHaveLength(3);
    // Внутри кольца радиуса 5 нет ни острия, ни основания наконечника.
    for (const { tip, back } of tips) {
      expect(Math.hypot(tip[0] + 5, tip[1] - 50)).toBeGreaterThan(5);
      expect(Math.hypot(back[0] + 5, back[1] - 50)).toBeGreaterThan(5);
    }
  });

  it("точка, куда пришли шаги с разным происхождением, получает оба значка рядом", () => {
    const path = [start, markIn, line([0, 25], { basis: "derived" }), line([40, 60]), markOut];
    const other = [{ kind: "start", at: [-50, 80] }, markIn, line([0, 25], { basis: "measured" }), line([40, 80]), markOut];
    const { shapes } = drawVariant(variant(path, other));
    const where = (d: string) => d.match(/M(-?[\d.]+) (-?[\d.]+)/)!.slice(1).map(Number);
    const [circle, square] = [where(drawn(shapes, "derived")), where(drawn(shapes, "measured"))];
    // Оба пути начинаются слева от своей середины: кружок — на радиус 1,7,
    // квадрат — на полстороны 1,5.
    expect(Math.abs(circle[0] + 1.7 - (square[0] + 1.5))).toBeGreaterThan(3);
  });

  it.each([
    ["по курсу", {}, [1, 0]],
    ["назад", { nose: "backward" }, [-1, 0]],
    ["вверх при скольжении", { nose: 0 }, [0, 1]],
    ["влево по курсу 270°", { nose: 270 }, [-1, 0]],
  ] as const)("значок кайта на входе и выходе смотрит носом: %s", (_name, extra, [x, y]) => {
    const { shapes } = drawVariant(variant([start, markIn, line([0, 20], extra), markOut]));
    for (const d of [drawn(shapes, "in"), drawn(shapes, "out")]) {
      const [{ nose }] = kites(d);
      expect(nose[0]).toBeCloseTo(x);
      expect(nose[1]).toBeCloseTo(y);
    }
  });

  it.each([
    ["out", 1],
    ["in", -1],
  ] as const)("на дуге с носом «%s» значок смотрит по радиусу", (word, sign) => {
    const arc = { kind: "arc", to: [0, 70], center: [0, 50], direction: "ccw", sweep: 90, nose: word };
    const { shapes } = drawVariant(variant([{ kind: "start", at: [20, 50] }, markIn, arc, markOut]));
    // Вход в правой точке круга, выход — в верхней.
    expect(kites(drawn(shapes, "in"))[0].nose[0]).toBeCloseTo(sign);
    expect(kites(drawn(shapes, "out"))[0].nose[1]).toBeCloseTo(sign);
  });

  it("координата значка кайта — нос: у дельты остриё, у четырёхстропного передняя кромка", () => {
    const path = [start, markIn, line([0, 20]), markOut];
    // Летит вправо: кромка — вертикаль через точку входа, парус — позади.
    expect(drawn(drawVariant(variant(path), true).shapes, "in")).toBe("M-50 75.8L-50 84.2L-53.4 82.7L-52.1 80L-53.4 77.3Z");
    expect(drawn(drawVariant(variant(path)).shapes, "in")).toBe("M-50 80L-56 83.3L-54.5 80L-56 76.7Z");
  });

  describe("поворот со смещением", () => {
    // Лестница: кайт пришёл слева носом вправо и поднимается двумя
    // полуоборотами вокруг верхней законцовки.
    const tip = (direction: string, about: string, to: number[]) => ({ kind: "rotate", degrees: 180, direction, about, about_basis: "diagram", to });
    const ladder = [
      { kind: "start", at: [-60, 10] },
      markIn,
      line([0, 10]),
      tip("ccw", "left-tip", [0, 20]),
      tip("cw", "right-tip", [0, 30]),
      line([60, 30]),
      markOut,
    ];
    const drawing = drawVariant(variant(ladder), true);

    it("линию пролёта между точками не проводит: путь кайта рвётся и продолжается из новой точки", () => {
      expect(drawing.tracks[0].d).toBe("M-60 90L0 90M0 80M0 70L60 70");
      expect(drawing.tracks[0].d).not.toMatch(/L0 80|L0 70/);
    });

    it("вход прямо перед поворотом смотрит по курсу подлёта, а не на конец пролёта за поворотом", () => {
      const entered = drawVariant(variant([{ kind: "start", at: [-60, 10] }, line([0, 10]), markIn, tip("ccw", "left-tip", [0, 20]), line([-60, 20]), markOut]), true);
      const plain = drawVariant(variant([{ kind: "start", at: [-60, 10] }, line([0, 10]), markIn, line([60, 10]), markOut]), true);
      expect(entered.shapes.in).toEqual(plain.shapes.in);
    });

    it("рисует дугу носа вокруг точки поворота — в сторону поворота — со стрелкой посередине", () => {
      // Против часовой снизу вверх нос идёт справа от законцовки, по часовой — слева.
      expect(drawing.swings).toBe(
        "M0 90A5 5 0 0 0 0 80M6 86.9L5 85L4 86.9" + "M0 80A5 5 0 0 1 0 70M-4 76.9L-5 75L-6 76.9",
      );
    });

    it("знака поворота на месте не ставит, угол подписывает снаружи дуги", () => {
      expect(drawing.shapes.turn).toBeUndefined();
      const angles = drawing.labels.filter((label) => label.text === "180°");
      expect(angles).toHaveLength(2);
      // Первая дуга выгнута вправо, вторая — влево; подписи по те же стороны.
      expect(angles[0].x).toBeGreaterThan(5);
      expect(angles[1].x).toBeLessThan(-5);
    });

    it("стрелку получают только пролёты", () => {
      expect(arrowTips(drawing.arrows)).toHaveLength(2);
    });

    it("кайт до и после каждого поворота стоит значком — носом в своей точке, по курсу после поворота", () => {
      // Пришёл носом вправо; полуоборот разворачивает нос влево, второй — снова вправо.
      const stood = kites(drawn(drawing.shapes, "pass"), true);
      expect(stood.map((item) => item.at.map((part) => Math.round(part * 100) / 100))).toEqual([[0, 90], [0, 80], [0, 70]]);
      expect(stood.map((item) => Math.round(item.nose[0]))).toEqual([1, -1, 1]);
      // Пролёты до и после лестницы второго значка не получают: у их конца уже стоит этот.
      expect(stood).toHaveLength(3);
    });

    it("значок до поворота не дублирует вход или остановку, стоящие в той же точке с тем же носом", () => {
      const entered = drawVariant(variant([{ kind: "start", at: [-60, 10] }, line([0, 10]), markIn, tip("ccw", "left-tip", [0, 20]), line([-60, 20]), markOut]), true);
      expect(kites(drawn(entered.shapes, "pass"), true).map((item) => item.at.map((part) => Math.round(part)))).toEqual([[0, 80]]);
    });

    it("выход или остановка сразу за поворотом — сами значок его конца: второго в той же точке нет", () => {
      const left = [{ kind: "start", at: [-60, 10] }, markIn, line([0, 10]), tip("ccw", "left-tip", [0, 20]), markOut];
      const gone = drawVariant(variant(left), true);
      expect(kites(drawn(gone.shapes, "pass"), true).filter((item) => Math.abs(item.at[1] - 80) < 0.01)).toEqual([]);
      // Выход стоит один и потому не раздут в кольцо вокруг второго значка.
      expect(drawn(gone.shapes, "out")).toBe(drawn(drawVariant(variant([{ kind: "start", at: [60, 20] }, markIn, line([0, 20]), markOut]), true).shapes, "out"));
      const stall = (nose: number) => ({ kind: "mark", mark: "stall", nose });
      const stopped = (nose: number) =>
        kites(drawn(drawVariant(variant([{ kind: "start", at: [-60, 10] }, markIn, line([0, 10]), tip("ccw", "left-tip", [0, 20]), stall(nose), line([-60, 20]), markOut]), true).shapes, "pass"), true).filter(
          (item) => Math.abs(item.at[0]) < 0.01 && Math.abs(item.at[1] - 80) < 0.01,
        );
      // Остановка носом влево — тот же курс, что после поворота.
      expect(stopped(270)).toEqual([]);
      // Метка книги смотрит иначе — курс после поворота показывает свой значок.
      expect(stopped(0)).toHaveLength(1);
    });

    it("в команде значок у поворота — своего кайта и его цвета: чужой в той же точке его не заменяет", () => {
      const path = [{ kind: "start", at: [-60, 10] }, markIn, line([0, 10]), tip("ccw", "left-tip", [0, 20]), line([-60, 20]), markOut];
      const pair = drawVariant(variant(path, path), true);
      const stood = pair.shapes.pass ?? [];
      expect(stood.map((item) => item.tone).sort()).toEqual((pair.shapes.in ?? []).map((item) => item.tone).sort());
      expect(new Set(stood.map((item) => item.tone)).size).toBe(2);
      for (const { d } of stood) {
        expect(kites(d, true).filter((item) => Math.abs(item.at[0]) < 0.01)).toHaveLength(2);
      }
    });

    it("незаданной может быть и горизонталь: на сетку встаёт высота, ромб стоит у точки", () => {
      const free = drawVariant(variant([{ kind: "start", at: [-60, 10] }, markIn, line([0, 10]), line([0, 40]), { kind: "line", to: [null, 80], basis: "unspecified" }, markOut]), true);
      expect(free.grid.xs).toEqual([-60]);
      expect(free.grid.ys).toEqual([10, 40, 80]);
      expect(drawn(free.shapes, "unspecified").match(/M/g)).toHaveLength(1);
    });

    it("ромб и квадрат замера в одной точке встают рядом, а не один на другой", () => {
      const both = drawVariant(
        variant([{ kind: "start", at: [-60, 12], basis: "measured" }, markIn, line([0, 12], { basis: "measured" }), line([30, 40]), line([0, 12], { basis: "measured" }), { kind: "line", to: [-60, null], basis: "unspecified" }, markOut]),
        true,
      );
      const centre = (d: string) => [...d.matchAll(/M(-?[\d.]+) (-?[\d.]+)/g)].map((match) => Number(match[1]));
      const squares = centre(drawn(both.shapes, "measured")).map((x) => x + 1.5);
      const diamonds = centre(drawn(both.shapes, "unspecified"));
      for (const x of diamonds) {
        expect(squares.every((other) => Math.abs(other - x) > 3)).toBe(true);
      }
    });

    it("без пролёта перед поворотом курс носа неизвестен — значков у поворота нет", () => {
      const blind = [{ kind: "start", at: [0, 10] }, markIn, { kind: "rotate", degrees: 180, direction: "ccw", about: { status: "not_found", reason: "страница не называет" }, to: [0, 20] }, line([60, 20]), markOut];
      const stood = kites(drawn(drawVariant(variant(blind), true).shapes, "pass"), true);
      expect(stood.every((item) => Math.abs(item.at[1] - 80) < 0.01 && item.at[0] > 1)).toBe(true);
    });

    it("после шага без показанного направления курс носа неизвестен — значков у поворота нет", () => {
      const hidden = [{ kind: "start", at: [-60, 10] }, markIn, line([0, 10], { unmarked: true }), tip("ccw", "left-tip", [0, 20]), line([60, 20]), markOut];
      const stood = kites(drawn(drawVariant(variant(hidden), true).shapes, "pass"), true);
      expect(stood.filter((item) => Math.abs(item.at[0]) < 0.01)).toEqual([]);
    });

    it("положение, которое книга объявила незаданным, отмечает ромбом, а заданную координату отрезка ставит на сетку", () => {
      const open = { status: "unspecified", reason: "стр. 71: высота после поворота не задана" };
      const rung = { kind: "rotate", degrees: 180, direction: "ccw", about: "left-tip", about_basis: "diagram", to: open };
      const free = drawVariant(variant([{ kind: "start", at: [-60, 10] }, markIn, line([0, 10]), rung, { kind: "line", to: [60, null], basis: "unspecified" }, markOut]), true);
      // Два ромба: конец поворота и конец отрезка. Замером это не помечено.
      expect(drawn(free.shapes, "unspecified").match(/M/g)).toHaveLength(2);
      expect(free.shapes.measured).toBeUndefined();
      // Справа от центра 60 подписано в книге; высота линии сетки не получает.
      expect(free.grid.xs).toEqual([-60, 60]);
      expect(free.grid.ys).toEqual([10]);
      // Ступень — размах значка: метки стоят законцовка к законцовке.
      expect(free.tracks[0].d).toBe("M-60 90L0 90M0 81.6L60 81.6");
      const stood = polygonsOf(drawn(free.shapes, "pass"));
      expect(stood).toHaveLength(2);
      expect(Math.min(...stood[0].map((corner) => corner[1]))).toBeCloseTo(Math.max(...stood[1].map((corner) => corner[1])));
    });

    it("точку, куда привёл поворот, отмечает по её происхождению", () => {
      const measured = [start, markIn, line([0, 20]), { kind: "rotate", degrees: 180, direction: "cw", about: { status: "not_found", reason: "страница не называет" }, to: [0, 28], basis: "measured" }, markOut];
      expect(drawVariant(variant(measured), true).shapes.measured).toHaveLength(1);
    });

    it("поворот на месте в той же фигуре остаётся знаком поворота", () => {
      const both = [...ladder.slice(0, 5), { kind: "rotate", degrees: 90, direction: "cw", ...CENTER }, ...ladder.slice(5)];
      const mixed = drawVariant(variant(both), true);
      expect(drawn(mixed.shapes, "turn").match(/A3\.4 3\.4/g)).toHaveLength(1);
      expect(mixed.swings.match(/A5 5/g)).toHaveLength(2);
    });
  });

  it("поворот на месте разворачивает нос следующих значков", () => {
    const { shapes } = drawVariant(
      variant([
        start,
        markIn,
        line([0, 20]),
        { kind: "rotate", degrees: 90, direction: "ccw", ...CENTER },
        stall,
        { kind: "rotate", degrees: 180, direction: "cw", ...CENTER },
        markOut,
      ]),
    );
    // Летел вправо; после четверти против часовой нос вверх, ещё полоборота — вниз.
    expect(kites(drawn(shapes, "out"))[0].nose[1]).toBeCloseTo(-1);
  });

  it("вспомогательную линию книги рисует отдельным путём и не ставит на неё значков", () => {
    const path = [start, markIn, line([0, 20]), markOut];
    const plain = drawVariant(variant(path));
    expect(plain.guides).toBe("");
    const lines = [
      { from: [-20, 10], to: [40, 87.5], basis: "measured" },
      { from: [-15, 20], to: [15, 77.5] },
    ];
    const drawing = drawVariant(guided({ status: "ok", lines }, path));
    expect(drawing.guides).toBe("M-20 90L40 12.5M-15 80L15 22.5");
    // Путь кайта, значки и стрелки от неё не зависят.
    expect(drawing.tracks).toEqual(plain.tracks);
    expect(drawing.shapes).toEqual(plain.shapes);
    expect(drawing.arrows).toEqual(plain.arrows);
  });

  it("выход в точке входа обводит вход кольцом со всех сторон", () => {
    const circle = { kind: "arc", to: [0, 70], center: [0, 50], direction: "ccw", sweep: 360 };
    const corners = (d: string) => [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((match) => [Number(match[1]), Number(match[2])]);
    // Расстояние от точки до ближайшей стороны контура.
    const toEdge = (spot: number[], outline: number[][]) =>
      Math.min(
        ...outline.map((a, index) => {
          const b = outline[(index + 1) % outline.length];
          const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
          const t = Math.max(0, Math.min(1, ((spot[0] - a[0]) * dx + (spot[1] - a[1]) * dy) / (dx * dx + dy * dy)));
          return Math.hypot(spot[0] - a[0] - dx * t, spot[1] - a[1] - dy * t);
        }),
      );
    for (const rev of [false, true]) {
      const { shapes } = drawVariant(variant([{ kind: "start", at: [0, 70] }, markIn, circle, markOut]), rev);
      const inner = corners(drawn(shapes, "in"));
      const outer = corners(drawn(shapes, "out"));
      // Кольцо между входом и выходом нигде не уже 0,8 единицы: на экране в
      // 390 пикселей это больше пикселя, и залитый вход не сливается с обводкой.
      for (const corner of inner) {
        expect(toEdge(corner, outer)).toBeGreaterThanOrEqual(0.8);
      }
      // И выход именно снаружи: он шире и длиннее входа.
      const span = (points: number[][], axis: number) => Math.max(...points.map((p) => p[axis])) - Math.min(...points.map((p) => p[axis]));
      expect(span(outer, 0)).toBeGreaterThan(span(inner, 0) + 2.6);
      expect(span(outer, 1)).toBeGreaterThan(span(inner, 1) + 2.6);
    }
  });

  it("одинокий выход стоит носом в своей точке и в обычный размер", () => {
    const { shapes } = drawVariant(variant([start, markIn, line([0, 20]), markOut]));
    expect(drawn(shapes, "out")).toBe("M0 80L-6 83.3L-4.5 80L-6 76.7Z");
  });

  it("отметку координаты ставит за хвостом значка кайта, а не поверх него", () => {
    const { shapes } = drawVariant(
      variant([{ kind: "start", at: [-50, 20], basis: "derived" }, markIn, line([0, 20]), markOut]),
    );
    // Вход смотрит вправо, отметка — в 8,6 единицы левее точки.
    expect(drawn(shapes, "derived")).toContain("M-60.3 80");
  });

  it("край дуги, снятой замером, линию сетки не даёт", () => {
    const arc = { kind: "arc", to: [20, 50], center: [0, 50], direction: "cw", sweep: 180, basis: "measured" };
    const drawing = drawVariant(variant([{ kind: "start", at: [-20, 50] }, markIn, arc, markOut]));
    expect(drawing.grid).toEqual({ xs: [-20], ys: [] });
  });

  it("линии сетки проводит через точки фигуры на сетке и крайние точки дуг, без осей и краёв", () => {
    const drawing = drawVariant(
      variant([
        { kind: "start", at: [-100, 50] },
        markIn,
        line([-20, 50]),
        // Полукруг через верх: крайняя точка — на высоте 70.
        { kind: "arc", to: [20, 50], center: [0, 50], direction: "cw", sweep: 180 },
        line([33.3, 15], { basis: "measured" }),
        line([0, 10]),
        markOut,
      ]),
    );
    expect(drawing.grid).toEqual({ xs: [-20, 20], ys: [10, 70] });
  });

  it("отмечает выведенные и измеренные координаты разными значками, подписанные — никакими", () => {
    const drawing = drawVariant(
      variant([
        start,
        markIn,
        line([0, 20]),
        line([0, 40], { basis: "derived" }),
        line([30, 40], { basis: "measured" }),
        line([30, 60], { basis: "text" }),
        markOut,
      ]),
    );
    expect(drawn(drawing.shapes, "derived").match(/M/g)).toHaveLength(1);
    expect(drawn(drawing.shapes, "measured").match(/M/g)).toHaveLength(1);
    expect(drawn(drawing.shapes, "derived")).toContain("M-1.7 60");
    expect(drawn(drawing.shapes, "measured")).toContain("M28.5 58.5");
  });

  it("взлёт и посадку подписывает под землёй и растягивает поле под них", () => {
    const plain = drawVariant(variant([start, markIn, line([0, 20]), markOut]));
    const ground = drawVariant(
      variant([
        { kind: "start", at: [0, 0] },
        markIn,
        { kind: "mark", mark: "launch" },
        line([0, 50]),
        line([0, 0]),
        { kind: "mark", mark: "landing" },
        markOut,
      ]),
    );
    const height = (box: string) => Number(box.split(" ")[3]);
    expect(height(ground.viewBox)).toBeGreaterThan(height(plain.viewBox));
    const notes = ground.labels.filter((label) => label.kind === "note");
    expect(notes.map((label) => label.text)).toEqual(["Launch", "Landing"]);
    // Обе под землёй, под числами сетки, и одна другую не закрывает.
    expect(notes[0].y).toBeGreaterThan(108);
    expect(notes[1].y).toBeGreaterThan(notes[0].y);
  });

  it("одинаковую посадку соседних кайтов подписывает один раз", () => {
    const kite = (x: number) => [
      { kind: "start", at: [x, 40] },
      markIn,
      line([x, 0]),
      { kind: "mark", mark: "landing", style: "two-point" },
      markOut,
    ];
    const notes = drawVariant(variant(kite(-10), kite(10), kite(70))).labels.filter((label) => label.kind === "note");
    // Кайты на −10 и 10 — одна подпись на двоих; дальний — своя.
    expect(notes.map((label) => label.text)).toEqual(["2-point landing", "2-point landing"]);
  });

  it("одному кайту подписывает In и Out; команде — номер у каждого кайта и In, Out у первого", () => {
    const path = [start, markIn, line([0, 20]), markOut];
    const other = [{ kind: "start", at: [50, 60] }, markIn, line([0, 60]), markOut];
    const names = (drawing: ReturnType<typeof drawVariant>) => drawing.labels.filter((label) => label.kind === "name");
    expect(names(drawVariant(variant(path))).map((label) => label.text)).toEqual(["In", "Out"]);
    expect(names(drawVariant(variant(path))).map((label) => label.tone)).toEqual(["t-in", "t-out"]);
    const pair = names(drawVariant(variant(path, other)));
    expect(pair.map((label) => label.text)).toEqual(["#1", "In", "#1", "Out", "#2", "#2"]);
    expect(pair.map((label) => label.tone)).toEqual(["t-k1", "t-in", "t-k1", "t-out", "t-k2", "t-k2"]);
  });

  it("значки кайтов команды красит цветом кайта", () => {
    const path = [start, markIn, line([0, 20]), line([0, 60]), line([40, 60]), markOut];
    const other = [{ kind: "start", at: [50, 80] }, markIn, line([10, 80]), markOut];
    const { shapes } = drawVariant(variant(path, other));
    expect(shapes.in?.map((item) => item.tone)).toEqual(["k1", "k2"]);
    expect(shapes.out?.map((item) => item.tone)).toEqual(["k1", "k2"]);
    expect(shapes.pass?.map((item) => item.tone)).toEqual(["k1"]);
    expect(drawVariant(variant(path)).shapes.in?.map((item) => item.tone)).toEqual([""]);
  });
});

describe("чертежи каталога", () => {
  const figures = listFigures();

  it.each(figures.map((figure) => [figure.slug, figure] as const))("%s", (_slug, figure) => {
    if (figure.geometry.status !== "ok") {
      return;
    }
    const rev = figure.discipline.startsWith("multi-line");
    for (const item of figure.geometry.variants) {
      const drawing = drawVariant(item, rev);
      const moves = item.kites.flatMap((kite) =>
        kite.path.filter((step) => step.kind === "line" || step.kind === "arc"),
      );
      const directed = moves.filter((step) => !step.unmarked);
      // У многострочных стрелка на каждом шаге с направлением и ни одной на
      // «unmarked»; у двухстропных — только на шаге не носом вперёд. Значков
      // в пути не больше, чем шагов с направлением.
      expect(arrowTips(drawing.arrows)).toHaveLength(directed.filter((step) => rev || step.nose !== "forward").length);
      // Сверх того значок стоит у каждого поворота со смещением: до и после.
      const passes = kites(drawn(drawing.shapes, "pass"), rev);
      // `known` — курс носа перед поворотом следует из пути: только у таких
      // поворотов значок обязателен.
      const swings = item.kites.flatMap((kite) => {
        let here: readonly number[] = [];
        let known = false;
        return kite.path.flatMap((step) => {
          const from = here;
          here = step.kind === "start" ? step.at : step.kind === "line" || step.kind === "arc" || isSwing(step) ? step.to : here;
          if (step.kind === "line" || step.kind === "arc") {
            known = !step.unmarked;
          }
          return isSwing(step) ? [{ ends: [from, step.to], known }] : [];
        });
      });
      const swingEnds = swings.flatMap((swing) => swing.ends);
      const atSwing = (mark: { at: number[] }) => swingEnds.some((end) => Math.hypot(end[0] - mark.at[0], 100 - end[1] - mark.at[1]) < 0.01);
      expect(passes.filter((mark) => !atSwing(mark)).length).toBeLessThanOrEqual(directed.length);
      // Ни один значок в пути не стоит на шаге «unmarked»: нос его лежит на
      // линии шага с известным направлением.
      const lines = item.kites.flatMap((kite) => {
        let here: readonly [number, number] = [0, 0];
        return kite.path.flatMap((step) => {
          if (step.kind === "start") {
            here = step.at;
          }
          if (step.kind !== "line" && step.kind !== "arc") {
            return [];
          }
          const from = here;
          here = step.to;
          return [{ unmarked: step.unmarked === true, points: Array.from({ length: 401 }, (_, i) => along(from, step, i / 400).point) }];
        });
      });
      const reach = (mark: { at: number[] }, unmarked: boolean) =>
        Math.min(
          ...lines
            .filter((line) => line.unmarked === unmarked)
            .flatMap((line) => line.points.map((point) => Math.hypot(point[0] - mark.at[0], 100 - point[1] - mark.at[1]))),
          1000,
        );
      for (const mark of passes.filter((item) => !atSwing(item))) {
        expect(reach(mark, false)).toBeLessThan(0.6);
      }
      // У каждого конца поворота со смещением стоит значок кайта — в пути
      // либо вход, выход или остановка.
      const standing = (["in", "out", "stall", "pass"] as const).flatMap((kind) => kites(drawn(drawing.shapes, kind), rev));
      for (const end of swings.filter((swing) => swing.known).flatMap((swing) => swing.ends)) {
        expect(standing.some((mark) => Math.hypot(end[0] - mark.at[0], 100 - end[1] - mark.at[1]) < 0.01)).toBe(true);
      }
      expect(drawing.tracks).toHaveLength(item.kites.length);
      // Линия рвётся на каждом повороте со смещением и только на нём, а дуг
      // поворота на схеме столько же: фантомному отрезку взяться неоткуда.
      const swung = item.kites.map((kite) => kite.path.filter(isSwing).length);
      expect(drawing.tracks.map((track) => track.d.match(/M/g)!.length - 1)).toEqual(swung);
      expect((drawing.swings.match(/A/g) ?? []).length).toBe(swung.reduce((sum, value) => sum + value, 0));
      const many = item.kites.length > 1;
      expect(drawing.labels.filter((label) => label.kind === "name")).toHaveLength(many ? item.kites.length * 2 + 2 : 2);
      expect(JSON.stringify(drawing)).not.toMatch(/NaN|Infinity|undefined|e-\d/);
      // Сетка называет ровно то, что подписано: величина, которую книга
      // объявила незаданной, линии сетки и числа у рамки не получает.
      const open = item.kites.flatMap((kite) => kite.path.flatMap((step) => (step.kind === "line" && step.unset === 1 ? [step.to[1]] : isSwing(step) && step.basis === "unspecified" ? [step.to[1]] : [])));
      for (const height of open) {
        expect(drawing.grid.ys).not.toContain(height);
      }
    }
  });
});

// Расстановку значков держат числа по всему каталогу: одна фигура ничего не
// говорит о соседней, а правка, разводящая значки в одном месте, сводит их в
// другом. Потолки — то, что намерено на данных; меньше — можно, больше — нет.
describe("наложения значков на схемах каталога", () => {
  type Spot = number[];
  const polygons = (d: string): Spot[][] =>
    d
      .split("Z")
      .filter(Boolean)
      .map((part) => [...part.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((match) => [Number(match[1]), Number(match[2])]));
  // Значки координат прямоугольниками: квадрат — как есть, кружок — описанный.
  const dotBoxes = (shapes: ReturnType<typeof drawVariant>["shapes"]): Spot[][] => [
    ...[...drawn(shapes, "measured").matchAll(/M(-?[\d.]+) (-?[\d.]+)h/g)].map((match) => {
      const [x, y] = [Number(match[1]), Number(match[2])];
      return [[x, y], [x + 3, y], [x + 3, y + 3], [x, y + 3]];
    }),
    ...[...drawn(shapes, "derived").matchAll(/M(-?[\d.]+) (-?[\d.]+)a/g)].map((match) => {
      const [x, y] = [Number(match[1]), Number(match[2])];
      return [[x, y - 1.7], [x + 3.4, y - 1.7], [x + 3.4, y + 1.7], [x, y + 1.7]];
    }),
    // Ромб: путь начинается с верхней вершины.
    ...[...drawn(shapes, "unspecified").matchAll(/M(-?[\d.]+) (-?[\d.]+)l/g)].map((match) => {
      const [x, y] = [Number(match[1]), Number(match[2])];
      return [[x, y], [x + 2, y + 2], [x, y + 4], [x - 2, y + 2]];
    }),
  ];
  const inside = (spot: Spot, poly: Spot[]) => {
    let odd = false;
    poly.forEach((a, index) => {
      const b = poly[(index + 1) % poly.length];
      if (a[1] > spot[1] !== b[1] > spot[1] && spot[0] < a[0] + ((spot[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1])) {
        odd = !odd;
      }
    });
    return odd;
  };
  const side = (u: Spot, v: Spot, w: Spot) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
  const overlap = (a: Spot[], b: Spot[]) =>
    a.some((corner) => inside(corner, b)) ||
    b.some((corner) => inside(corner, a)) ||
    a.some((p, i) =>
      b.some((u, j) => {
        const [q, v] = [a[(i + 1) % a.length], b[(j + 1) % b.length]];
        return side(p, q, u) * side(p, q, v) < 0 && side(u, v, p) * side(u, v, q) < 0;
      }),
    );
  const toEdge = (spot: Spot, poly: Spot[]) =>
    Math.min(
      ...poly.map((a, index) => {
        const b = poly[(index + 1) % poly.length];
        const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
        const t = Math.max(0, Math.min(1, ((spot[0] - a[0]) * dx + (spot[1] - a[1]) * dy) / (dx * dx + dy * dy)));
        return Math.hypot(spot[0] - a[0] - dx * t, spot[1] - a[1] - dy * t);
      }),
    );
  const span = (poly: Spot[]) =>
    Math.max(...[0, 1].map((axis) => Math.max(...poly.map((p) => p[axis])) - Math.min(...poly.map((p) => p[axis]))));

  const totals = { dots: 0, origins: 0, onDot: 0, passOnPass: 0, passOnStanding: 0, angleOnDot: 0, rings: 0, openRings: 0 };
  const where: Record<string, string[]> = { onDot: [], angleOnDot: [], openRings: [], doubled: [] };
  for (const figure of listFigures()) {
    if (figure.geometry.status !== "ok") {
      continue;
    }
    const rev = figure.discipline.startsWith("multi-line");
    for (const item of figure.geometry.variants) {
      const { shapes, labels } = drawVariant(item, rev);
      const name = `${figure.code} ${item.id}`;
      const dots = dotBoxes(shapes);
      const origins = new Set<string>();
      for (const kite of item.kites) {
        for (const step of kite.path) {
          // Поворот со смещением приводит кайт в точку, как отрезок и дуга.
          if ((step.kind === "start" || step.kind === "line" || step.kind === "arc" || isSwing(step)) && (step.basis === "derived" || step.basis === "measured" || step.basis === "unspecified")) {
            origins.add(`${step.basis} ${(step.kind === "start" ? step.at : step.to).join(" ")}`);
          }
        }
      }
      totals.dots += dots.length;
      totals.origins += origins.size;
      if (dots.length !== origins.size) {
        where.doubled.push(name);
      }
      const passes = polygons(drawn(shapes, "pass"));
      const standing = (["in", "out", "stall"] as const).flatMap((kind) => polygons(drawn(shapes, kind)));
      for (const kite of [...passes, ...standing]) {
        if (dots.some((dot) => overlap(kite, dot))) {
          totals.onDot += 1;
          where.onDot.push(name);
        }
      }
      passes.forEach((a, index) => {
        totals.passOnPass += passes.slice(index + 1).filter((b) => overlap(a, b)).length;
        totals.passOnStanding += standing.filter((b) => overlap(a, b)).length;
      });
      for (const label of labels) {
        if (label.kind === "note" && label.text.includes("°")) {
          const half = label.text.length * 1.25;
          const box = [[label.x - half, label.y - 3.6], [label.x + half, label.y - 3.6], [label.x + half, label.y + 0.6], [label.x - half, label.y + 0.6]];
          if (dots.some((dot) => overlap(box, dot))) {
            totals.angleOnDot += 1;
            where.angleOnDot.push(name);
          }
        }
      }
      // Кольцо выхода: увеличенный вдвое выход, внутри которого целиком, с
      // просветом, стоит вход или остановка.
      const inner = (["in", "stall"] as const).flatMap((kind) => polygons(drawn(shapes, kind)));
      const plain = rev ? 8.4 : 8.6;
      for (const out of polygons(drawn(shapes, "out")).filter((poly) => span(poly) > plain * 1.8)) {
        totals.rings += 1;
        if (!inner.some((poly) => poly.every((corner) => inside(corner, out) && toEdge(corner, out) >= 0.75))) {
          totals.openRings += 1;
          where.openRings.push(name);
        }
      }
    }
  }

  it("у каждой координаты не с подписей сетки ровно один значок", () => {
    expect(where.doubled).toEqual([]);
    expect(totals.dots).toBe(totals.origins);
  });

  it("ни один значок кайта не лежит на значке координаты", () => {
    expect(where.onDot).toEqual([]);
  });

  it("ни один угол поворота не лежит на значке координаты", () => {
    expect(where.angleOnDot).toEqual([]);
  });

  it("каждое кольцо выхода охватывает значок под ним с просветом", () => {
    expect(totals.rings).toBeGreaterThan(0);
    expect(where.openRings).toEqual([]);
  });

  it("значки в пути ложатся друг на друга и на вход, выход и остановку не чаще намеренного", () => {
    // Остаток — общий отрезок строя, где значкам не хватает места (DP 03,
    // DT 05 состав 5, MT 09), и шаги, где свободного места нет вовсе.
    expect(totals.passOnPass).toBeLessThanOrEqual(5);
    expect(totals.passOnStanding).toBeLessThanOrEqual(4);
  });
});

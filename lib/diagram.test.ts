import { describe, expect, it } from "vitest";

import { along, drawVariant } from "./diagram";
import { listFigures } from "./figures";
import { parseGeometry, type Variant } from "./geometry";

const start = { kind: "start", at: [-50, 20] };
const markIn = { kind: "mark", mark: "in" };
const markOut = { kind: "mark", mark: "out" };

// Чертёж строится по разобранной геометрии, как на странице: с умолчаниями.
function variant(...paths: unknown[][]): Variant {
  const kites = paths.map((path, index) => ({ id: String(index + 1), path }));
  const raw = { status: "ok", variants: [{ id: "main", kites }], notes: ["для теста"] };
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
const stall = { kind: "mark", mark: "stall" };

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

    it("в точке остановки кайт показан таким, каким из неё уходит, — уже после поворота", () => {
      const path = [
        start,
        markIn,
        line([0, 20]),
        stall,
        { kind: "rotate", degrees: 90, direction: "ccw" },
        line([40, 20], { nose: 0 }),
        markOut,
      ];
      const [mark] = kites(drawn(drawVariant(variant(path), true).shapes, "stall"), true);
      expect(mark.nose[1]).toBeCloseTo(1);
      // У двухстропного значок остановки смотрит так, как кайт в неё пришёл.
      const [delta] = kites(drawn(drawVariant(variant(path)).shapes, "stall"));
      expect(delta.nose[0]).toBeCloseTo(1);
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
        { kind: "rotate", degrees: 90, direction: "cw" },
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
    const path = [start, markIn, line([0, 20]), stall, line([0, 60]), { kind: "mark", mark: "stall", style: "snap" }, markOut];
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
      { kind: "rotate", degrees: 90, direction: "cw" },
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
    const path = (direction: string) => [start, markIn, line([0, 20]), { kind: "rotate", degrees: 180, direction }, markOut];
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
    expect(drawn(drawVariant(variant(path), true).shapes, "in")).toBe("M-50 75.2L-50 84.8L-53.4 83L-52.1 80L-53.4 77Z");
    expect(drawn(drawVariant(variant(path)).shapes, "in")).toBe("M-50 80L-56 83.3L-54.5 80L-56 76.7Z");
  });

  it("поворот на месте разворачивает нос следующих значков", () => {
    const { shapes } = drawVariant(
      variant([
        start,
        markIn,
        line([0, 20]),
        { kind: "rotate", degrees: 90, direction: "ccw" },
        stall,
        { kind: "rotate", degrees: 180, direction: "cw" },
        markOut,
      ]),
    );
    // Летел вправо; после четверти против часовой нос вверх, ещё полоборота — вниз.
    expect(kites(drawn(shapes, "stall"))[0].nose[1]).toBeCloseTo(1);
    expect(kites(drawn(shapes, "out"))[0].nose[1]).toBeCloseTo(-1);
  });

  it("остановка смотрит носом, а не по ходу шага", () => {
    const { shapes } = drawVariant(variant([start, markIn, line([0, 20], { nose: 0 }), stall, markOut]));
    expect(kites(drawn(shapes, "stall"))[0].nose[1]).toBeCloseTo(1);
  });

  it("выход в точке входа рисует крупнее, чтобы вход остался виден", () => {
    const circle = { kind: "arc", to: [0, 70], center: [0, 50], direction: "ccw", sweep: 360 };
    const { shapes } = drawVariant(variant([{ kind: "start", at: [0, 70] }, markIn, circle, markOut]));
    const tail = (d: string) => Math.abs(Number(d.match(/L(\S+) /)![1]));
    // Нос влево, в точке: хвост входа в 6 единицах от неё, выхода — в 1,35 раза дальше.
    expect(tail(drawn(shapes, "in"))).toBeCloseTo(6);
    expect(tail(drawn(shapes, "out"))).toBeCloseTo(8.1);
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
      const passes = kites(drawn(drawing.shapes, "pass"), rev);
      expect(passes.length).toBeLessThanOrEqual(directed.length);
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
      for (const mark of passes) {
        expect(reach(mark, false)).toBeLessThan(0.6);
      }
      expect(drawing.tracks).toHaveLength(item.kites.length);
      const many = item.kites.length > 1;
      expect(drawing.labels.filter((label) => label.kind === "name")).toHaveLength(many ? item.kites.length * 2 + 2 : 2);
      expect(JSON.stringify(drawing)).not.toMatch(/NaN|Infinity|undefined|e-\d/);
    }
  });
});

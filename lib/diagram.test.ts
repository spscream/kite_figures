import { describe, expect, it } from "vitest";

import { drawVariant } from "./diagram";
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

// Стрелка — треугольник «остриё, левый угол, правый угол».
function arrowTips(arrows: string): { tip: number[]; back: number[] }[] {
  return [...arrows.matchAll(/M(\S+) (\S+)L(\S+) (\S+)L(\S+) (\S+)Z/g)].map((match) => {
    const [tx, ty, lx, ly, rx, ry] = match.slice(1).map(Number);
    return { tip: [tx, ty], back: [(lx + rx) / 2, (ly + ry) / 2] };
  });
}

describe("drawVariant", () => {
  it("кладёт землю вниз: y сетки переворачивается", () => {
    const drawing = drawVariant(variant([start, markIn, { kind: "line", to: [0, 20] }, markOut]));
    expect(drawing.tracks).toEqual([{ id: "1", d: "M-50 80L0 80" }]);
  });

  it("дуга по часовой, как видит пилот, идёт по часовой и на экране", () => {
    const arc = { kind: "arc", to: [0, 70], center: [0, 45], direction: "cw", sweep: 180 };
    const drawing = drawVariant(variant([{ kind: "start", at: [0, 20] }, markIn, arc, markOut]));
    expect(drawing.tracks[0].d).toBe("M0 80A25 25 0 0 1 0 30");
    // Полуоборот по часовой снизу вверх проходит левую сторону круга.
    const [{ tip }] = arrowTips(drawing.arrows);
    expect(tip[0]).toBeLessThan(0);
  });

  it("полный круг рисует двумя половинами и возвращается в начало", () => {
    const circle = { kind: "arc", to: [0, 70], center: [0, 50], direction: "ccw", sweep: 360 };
    const drawing = drawVariant(variant([{ kind: "start", at: [0, 70] }, markIn, circle, markOut]));
    expect(drawing.tracks[0].d).toBe("M0 30A20 20 0 0 0 0 70A20 20 0 0 0 0 30");
  });

  it("стрелка смотрит по ходу шага", () => {
    const drawing = drawVariant(variant([start, markIn, { kind: "line", to: [0, 20] }, markOut]));
    const [{ tip, back }] = arrowTips(drawing.arrows);
    expect(tip[0]).toBeGreaterThan(back[0]);
    expect(tip[1]).toBeCloseTo(80);
  });

  // Куда смотрит стрелка: единичный вектор в сетке окна (y вверх).
  const aim = (path: unknown[]) => {
    const [{ tip, back }] = arrowTips(drawVariant(variant(path)).arrows);
    const size = Math.hypot(tip[0] - back[0], tip[1] - back[1]);
    return [(tip[0] - back[0]) / size, -(tip[1] - back[1]) / size];
  };

  it.each([
    ["влево", [-90, 20], [-1, 0]],
    ["вверх", [-50, 80], [0, 1]],
    ["вниз", [-50, 0], [0, -1]],
  ] as const)("стрелка на отрезке %s смотрит туда же", (_name, to, [x, y]) => {
    const [ax, ay] = aim([start, markIn, { kind: "line", to }, markOut]);
    expect(ax).toBeCloseTo(x);
    expect(ay).toBeCloseTo(y);
  });

  it.each([
    // Четверть круга от правой точки: по часовой — вниз, против — вверх.
    ["cw", [0, 30], -1],
    ["ccw", [0, 70], 1],
  ] as const)("стрелка на дуге %s идёт по касательной в сторону обхода", (direction, to, vertical) => {
    const arc = { kind: "arc", to, center: [0, 50], direction, sweep: 90 };
    const [ax, ay] = aim([{ kind: "start", at: [20, 50] }, markIn, arc, markOut]);
    // Место по умолчанию — 0,6 дуги, то есть 54° от правой точки.
    expect(ax).toBeCloseTo(-Math.sin((54 * Math.PI) / 180));
    expect(ay).toBeCloseTo(vertical * Math.cos((54 * Math.PI) / 180));
  });

  it("дугу в три четверти оборота ведёт через её середину, а не напрямик", () => {
    const arc = { kind: "arc", to: [0, 70], center: [0, 50], direction: "cw", sweep: 270 };
    const drawing = drawVariant(variant([{ kind: "start", at: [20, 50] }, markIn, arc, markOut]));
    // 135° по часовой от правой точки — слева внизу.
    expect(drawing.tracks[0].d).toBe("M20 50A20 20 0 0 1 -14.14 64.14A20 20 0 0 1 0 30");
  });

  it("каждому событию ставит свой значок, в точке события", () => {
    const { shapes } = drawVariant(
      variant([
        { kind: "start", at: [0, 0], basis: "measured" },
        markIn,
        { kind: "mark", mark: "launch" },
        { kind: "line", to: [0, 40] },
        { kind: "mark", mark: "stall" },
        { kind: "line", to: [30, 40] },
        { kind: "rotate", degrees: 90, direction: "cw" },
        { kind: "line", to: [60, 40] },
        { kind: "mark", mark: "half-axel" },
        { kind: "line", to: [60, 0] },
        { kind: "mark", mark: "landing" },
        markOut,
      ]),
    );
    // Значок кайта: нос, угол крыла, вырез хвоста, второй угол. На входе он
    // смотрит по первому шагу (вверх), на выходе — по последнему (вниз).
    expect(shapes.in).toBe("M0 96.4L3.3 102.4L0 100.9L-3.3 102.4Z");
    expect(shapes.out).toBe("M60 103.6L56.7 97.6L60 99.1L63.3 97.6Z");
    // Остановка — тот же значок с чертой перед носом.
    expect(shapes.stall).toBe("M0 56.4L3.3 62.4L0 60.9L-3.3 62.4ZM2.6 54.8L-2.6 54.8");
    expect(shapes.turn).toBe("M26.6 60a3.4 3.4 0 1 0 6.8 0a3.4 3.4 0 1 0 -6.8 0");
    expect(shapes.axel).toBe("M60 57l3 3-3 3-3-3z");
    // Взлёт — остриём вверх, посадка — вниз; оба под землёй, под своей точкой.
    // Первая строка под землёй — числа сетки.
    expect(shapes.launch).toBe("M0 112.1l2.8 4.8h-5.6z");
    expect(shapes.landing).toBe("M60 116.9l2.8-4.8h-5.6z");
    // Старт не с линии сетки отмечен так же, как конец шага.
    expect(shapes.measured).toBe("M-1.5 98.5h3v3h-3z");
  });

  it("подпись выхода у самой земли не ложится на землю и на вход", () => {
    const drawing = drawVariant(
      variant([
        { kind: "start", at: [0, 0] },
        markIn,
        { kind: "line", to: [0, 80] },
        { kind: "line", to: [0, 5] },
        markOut,
      ]),
    );
    expect(drawing.labels.map((label) => label.y)).toEqual([114.5, 121]);
  });

  it("номера кайтов, выходящих навстречу в одну точку, не встают на чужую линию", () => {
    const left = [{ kind: "start", at: [-40, 50] }, markIn, { kind: "line", to: [0, 50] }, markOut];
    const right = [{ kind: "start", at: [40, 50] }, markIn, { kind: "line", to: [0, 50] }, markOut];
    const outs = drawVariant(variant(left, right)).labels.filter((_, index) => index % 2 === 1);
    for (const label of outs) {
      expect(Math.abs(label.y - 50)).toBeGreaterThan(4);
    }
  });

  it("подпись не закрывает стрелку", () => {
    // Короткий последний шаг: стрелка и подпись выхода спорят за одно место.
    const path = [start, markIn, { kind: "line", to: [0, 20] }, { kind: "line", to: [8, 20] }, markOut];
    const other = [{ kind: "start", at: [-50, 40] }, markIn, { kind: "line", to: [20, 40] }, markOut];
    const drawing = drawVariant(variant(path, other));
    for (const { tip, back } of arrowTips(drawing.arrows)) {
      for (const label of drawing.labels) {
        const dx = Math.max(Math.abs((tip[0] + back[0]) / 2 - label.x) - 2.1, 0);
        expect(Math.hypot(dx, (tip[1] + back[1]) / 2 - label.y)).toBeGreaterThan(2.5);
      }
    }
  });

  it("на шаге «unmarked» стрелка стоит, как на любом другом, и смотрит по записанному порядку", () => {
    const drawing = drawVariant(
      variant([start, markIn, { kind: "line", to: [0, 20] }, { kind: "line", to: [0, 60], unmarked: true }, markOut]),
    );
    const tips = arrowTips(drawing.arrows);
    expect(tips).toHaveLength(2);
    expect(tips[1].tip[1]).toBeLessThan(tips[1].back[1]);
  });

  // Нос значка кайта: вектор от выреза хвоста к острию, в сетке окна.
  const nose = (d: string) => {
    const [tx, ty, , , nx, ny] = d.match(/^M(\S+) (\S+)L(\S+) (\S+)L(\S+) (\S+)L/)!.slice(1).map(Number);
    const size = Math.hypot(tx - nx, ty - ny);
    return [(tx - nx) / size, -(ty - ny) / size];
  };

  it.each([
    ["по курсу", {}, [1, 0]],
    ["назад", { nose: "backward" }, [-1, 0]],
    ["вверх при скольжении", { nose: 0 }, [0, 1]],
    ["влево по курсу 270°", { nose: 270 }, [-1, 0]],
  ] as const)("значок кайта на входе и выходе смотрит носом: %s", (_name, extra, [x, y]) => {
    const { shapes } = drawVariant(variant([start, markIn, { kind: "line", to: [0, 20], ...extra }, markOut]));
    for (const d of [shapes.in!, shapes.out!]) {
      const [nx, ny] = nose(d);
      expect(nx).toBeCloseTo(x);
      expect(ny).toBeCloseTo(y);
    }
  });

  it.each([
    ["out", 1],
    ["in", -1],
  ] as const)("на дуге с носом «%s» значок смотрит по радиусу", (word, sign) => {
    const arc = { kind: "arc", to: [0, 70], center: [0, 50], direction: "ccw", sweep: 90, nose: word };
    const { shapes } = drawVariant(variant([{ kind: "start", at: [20, 50] }, markIn, arc, markOut]));
    // Вход в правой точке круга, выход — в верхней.
    expect(nose(shapes.in!)[0]).toBeCloseTo(sign);
    expect(nose(shapes.out!)[1]).toBeCloseTo(sign);
  });

  it("линии сетки проводит через точки фигуры на сетке и крайние точки дуг, без осей и краёв", () => {
    const drawing = drawVariant(
      variant([
        { kind: "start", at: [-100, 50] },
        markIn,
        { kind: "line", to: [-20, 50] },
        // Полукруг через верх: крайняя точка — на высоте 70.
        { kind: "arc", to: [20, 50], center: [0, 50], direction: "cw", sweep: 180 },
        { kind: "line", to: [33.3, 15], basis: "measured" },
        { kind: "line", to: [0, 10] },
        markOut,
      ]),
    );
    expect(drawing.grid).toEqual({ xs: [-20, 20], ys: [10, 70] });
  });

  it("стрелка уходит с места, занятого значком", () => {
    const path = [
      { kind: "start", at: [0, 0] },
      markIn,
      { kind: "line", to: [0, 90] },
      { kind: "line", to: [0, 54] },
      { kind: "mark", mark: "stall" },
      { kind: "line", to: [40, 54] },
      markOut,
    ];
    const [up] = arrowTips(drawVariant(variant(path)).arrows);
    // Обычное место — 0,6 шага, высота 54: там остановка. Следующее — 0,4.
    expect((up.tip[1] + up.back[1]) / 2).toBeCloseTo(100 - 36, 0);
  });

  it("отмечает выведенные и измеренные координаты разными значками, подписанные — никакими", () => {
    const drawing = drawVariant(
      variant([
        start,
        markIn,
        { kind: "line", to: [0, 20] },
        { kind: "line", to: [0, 40], basis: "derived" },
        { kind: "line", to: [30, 40], basis: "measured" },
        { kind: "line", to: [30, 60], basis: "text" },
        markOut,
      ]),
    );
    expect(drawing.shapes.derived?.match(/M/g)).toHaveLength(1);
    expect(drawing.shapes.measured?.match(/M/g)).toHaveLength(1);
    expect(drawing.shapes.derived).toContain("M-1.7 60");
    expect(drawing.shapes.measured).toContain("M28.5 58.5");
  });

  it("взлёт и посадку ставит под точкой и растягивает поле под них", () => {
    const plain = drawVariant(variant([start, markIn, { kind: "line", to: [0, 20] }, markOut]));
    const ground = drawVariant(
      variant([
        { kind: "start", at: [0, 0] },
        markIn,
        { kind: "mark", mark: "launch" },
        { kind: "line", to: [0, 50] },
        { kind: "line", to: [0, 0] },
        { kind: "mark", mark: "landing" },
        markOut,
      ]),
    );
    const height = (box: string) => Number(box.split(" ")[3]);
    expect(height(ground.viewBox)).toBeGreaterThan(height(plain.viewBox));
    // Подписи входа и выхода тоже ушли под землю, под значки, друг под друга.
    expect(ground.labels.map((label) => label.text)).toEqual(["In", "Out"]);
    expect(ground.labels[0].y).toBeGreaterThan(100);
    expect(ground.labels[1].y).toBeGreaterThan(ground.labels[0].y);
  });

  it("одному кайту подписывает In и Out, нескольким — их номера цветом кайта", () => {
    const path = [start, markIn, { kind: "line", to: [0, 20] }, markOut];
    const other = [{ kind: "start", at: [50, 60] }, markIn, { kind: "line", to: [0, 60] }, markOut];
    expect(drawVariant(variant(path)).labels.map((label) => label.text)).toEqual(["In", "Out"]);
    expect(drawVariant(variant(path)).labels.map((label) => label.tone)).toEqual(["t-in", "t-out"]);
    const pair = drawVariant(variant(path, other)).labels;
    expect(pair.map((label) => label.text)).toEqual(["#1", "#1", "#2", "#2"]);
    expect(pair.map((label) => label.tone)).toEqual(["t-k1", "t-k1", "t-k2", "t-k2"]);
  });
});

describe("чертежи каталога", () => {
  const figures = listFigures();

  it.each(figures.map((figure) => [figure.slug, figure] as const))("%s", (_slug, figure) => {
    if (figure.geometry.status !== "ok") {
      return;
    }
    for (const item of figure.geometry.variants) {
      const drawing = drawVariant(item);
      const moves = item.kites.flatMap((kite) =>
        kite.path.filter((step) => step.kind === "line" || step.kind === "arc"),
      );
      // Стрелка на каждом шаге, в том числе «unmarked».
      expect(arrowTips(drawing.arrows)).toHaveLength(moves.length);
      expect(drawing.tracks).toHaveLength(item.kites.length);
      expect(drawing.labels).toHaveLength(item.kites.length * 2);
      const drawn = JSON.stringify(drawing);
      expect(drawn).not.toMatch(/NaN|Infinity|undefined|e-\d/);
    }
  });
});

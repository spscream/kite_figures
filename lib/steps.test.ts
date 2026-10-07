import { describe, expect, it } from "vitest";

import { listFigures } from "./figures";
import { type Kite, parseGeometry } from "./geometry";
import { describeKite, lineText } from "./steps";

function kite(path: unknown[]): Kite {
  const raw = { status: "ok", variants: [{ id: "main", kites: [{ id: "1", path }] }], notes: ["для теста"] };
  const read = parseGeometry("g", raw, 125);
  if (read.status !== "ok") {
    throw new Error("геометрия не разобрана");
  }
  return read.variants[0].kites[0];
}

const texts = (path: unknown[], many = false) => describeKite(kite(path)).map((line) => lineText(line, many));

describe("describeKite", () => {
  it("пишет строку на перемещение и дописывает к ней события в точке прибытия", () => {
    expect(
      texts([
        { kind: "start", at: [0, 0] },
        { kind: "mark", mark: "in" },
        { kind: "mark", mark: "launch" },
        { kind: "line", to: [0, 20.5] },
        { kind: "mark", mark: "stall", style: "push" },
        { kind: "rotate", degrees: 90, direction: "cw" },
        { kind: "arc", to: [0, 60.5], center: [0, 40.5], direction: "ccw", sweep: 180 },
        { kind: "arc", to: [0, 60.5], center: [0, 40.5], direction: "cw", sweep: 360 },
        { kind: "line", to: [-30, 60.5] },
        { kind: "mark", mark: "landing", style: "two-point" },
        { kind: "mark", mark: "out" },
      ]),
    ).toEqual([
      "Точка (0; 0) — вход (IN), взлёт",
      "Прямая до (0; 20,5) — остановка толчком (push), поворот на 90° по часовой стрелке",
      "Дуга 180° против часовой стрелки вокруг (0; 40,5) до (0; 60,5)",
      "Полный круг по часовой стрелке вокруг (0; 40,5)",
      "Прямая до (−30; 60,5) — посадка на две точки, выход (OUT)",
    ]);
  });

  it("называет курс носа, когда он не по ходу", () => {
    expect(
      texts([
        { kind: "start", at: [0, 10] },
        { kind: "mark", mark: "in" },
        { kind: "line", to: [0, 50], nose: "backward" },
        { kind: "line", to: [40, 50], nose: 0 },
        { kind: "line", to: [40, 20], nose: 45 },
        { kind: "arc", to: [40, 60], center: [40, 40], direction: "cw", sweep: 180, nose: "out" },
        { kind: "mark", mark: "out" },
      ]).slice(1),
    ).toEqual([
      "Прямая до (0; 50), полёт назад",
      "Прямая до (40; 50), нос вверх",
      "Прямая до (40; 20), нос по курсу 45°",
      "Дуга 180° по часовой стрелке вокруг (40; 40) до (40; 60), нос наружу круга — выход (OUT)",
    ]);
  });

  it("помечает, откуда координата, и шаг без направления", () => {
    const lines = describeKite(
      kite([
        { kind: "start", at: [0, 10], basis: "measured" },
        { kind: "mark", mark: "in" },
        { kind: "line", to: [0, 50], basis: "derived", unmarked: true },
        { kind: "line", to: [40, 50], basis: "text" },
        { kind: "line", to: [40, 20] },
        { kind: "mark", mark: "out" },
      ]),
    );
    expect(lines.map((line) => line.tags)).toEqual([["measured"], ["unmarked", "derived"], ["text"], []]);
    expect(lines.map((line) => lineText(line, false))).toEqual([
      "Точка (0; 10) □ — вход (IN)",
      "Прямая до (0; 50) ○",
      "Прямая до (40; 50) (число из текста страницы)",
      "Прямая до (40; 20) — выход (OUT)",
    ]);
  });

  it("не путает стороны, законцовки и виды остановок и посадок", () => {
    expect(
      texts([
        { kind: "start", at: [0, 10] },
        { kind: "mark", mark: "in" },
        { kind: "line", to: [0, 50], nose: 90 },
        { kind: "rotate", degrees: 180, direction: "ccw", about: "left-tip" },
        { kind: "line", to: [40, 50], nose: 270 },
        { kind: "rotate", degrees: 180, direction: "cw", about: "right-tip" },
        { kind: "mark", mark: "stall", style: "snap" },
        { kind: "arc", to: [40, 10], center: [40, 30], direction: "cw", sweep: 180, nose: "in" },
        { kind: "mark", mark: "half-axel" },
        { kind: "line", to: [40, 0], nose: 180 },
        { kind: "mark", mark: "landing", style: "leading-edge" },
        { kind: "mark", mark: "out" },
      ]).slice(1),
    ).toEqual([
      "Прямая до (0; 50), нос вправо — поворот на 180° против часовой стрелки вокруг левой законцовки",
      "Прямая до (40; 50), нос влево — поворот на 180° по часовой стрелке вокруг правой законцовки, остановка рывком (snap)",
      "Дуга 180° по часовой стрелке вокруг (40; 30) до (40; 10), нос внутрь круга — половина акселя",
      "Прямая до (40; 0), нос вниз — посадка на переднюю кромку, выход (OUT)",
    ]);
  });

  it("на дуге «unmarked» называет ту сторону обхода, что записана в данных и нарисована стрелкой", () => {
    expect(
      texts([
        { kind: "start", at: [0, 40] },
        { kind: "mark", mark: "in" },
        { kind: "arc", to: [0, 80], center: [0, 60], direction: "ccw", sweep: 180, unmarked: true },
        { kind: "arc", to: [0, 80], center: [0, 60], direction: "ccw", sweep: 360, unmarked: true },
        { kind: "mark", mark: "out" },
      ]).slice(1),
    ).toEqual([
      "Дуга 180° против часовой стрелки вокруг (0; 60) до (0; 80)",
      "Полный круг против часовой стрелки вокруг (0; 60) — выход (OUT)",
    ]);
  });

  it("метки одновременности показывает только там, где кайтов несколько", () => {
    const path = [
      { kind: "start", at: [0, 10] },
      { kind: "mark", mark: "in", sync: "in" },
      { kind: "line", to: [0, 50], sync: "a" },
      { kind: "mark", mark: "out", sync: "out" },
    ];
    expect(texts(path, true)).toEqual(["Точка (0; 10) — вход (IN) [in]", "Прямая до (0; 50) — выход (OUT) [a, out]"]);
    expect(texts(path, false)).toEqual(["Точка (0; 10) — вход (IN)", "Прямая до (0; 50) — выход (OUT)"]);
  });
});

describe("шаги каталога", () => {
  it("у каждого кайта каждое перемещение — своя строка, и ни одна не пуста", () => {
    for (const figure of listFigures()) {
      if (figure.geometry.status !== "ok") {
        continue;
      }
      for (const kite of figure.geometry.variants.flatMap((variant) => variant.kites)) {
        const moves = kite.path.filter((step) => step.kind === "line" || step.kind === "arc").length;
        const lines = describeKite(kite);
        expect(lines, figure.slug).toHaveLength(moves + 1);
        for (const line of lines) {
          expect(lineText(line, true), figure.slug).not.toMatch(/undefined|NaN/);
        }
      }
    }
  });
});

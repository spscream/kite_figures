import { describe, expect, it } from "vitest";

import { listFigures } from "./figures";
import { parseGeometry, type Step } from "./geometry";
import {
  back,
  type Cursor,
  forward,
  frameAt,
  GAP_TEXT,
  HOLD,
  PACE_TEXT,
  paceOf,
  pause,
  play,
  sceneOf,
  SPEED,
  START,
  tick,
  TURN_RATE,
} from "./playback";
import { describeKite } from "./steps";

const start = { kind: "start", at: [-50, 20] };
const markIn = { kind: "mark", mark: "in" };
const markOut = { kind: "mark", mark: "out" };
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

// Варианты каталога с одним кайтом: только их страница и проигрывает.
const SOLO = listFigures().flatMap((figure) =>
  figure.geometry.status === "ok"
    ? figure.geometry.variants
        .filter((variant) => variant.kites.length === 1)
        .map((variant) => ({ code: figure.code, kite: variant.kites[0], rev: figure.discipline.startsWith("multi-line") }))
    : [],
);

function catalog(code: string) {
  const found = SOLO.find((item) => item.code === code);
  if (found === undefined) {
    throw new Error(`нет фигуры ${code} с одним кайтом`);
  }
  return sceneOf(found.kite.path, found.rev);
}

// Уголок: вправо на 60, вверх на 30.
const corner = () => sceneOf(path(start, markIn, { kind: "line", to: [10, 20] }, { kind: "line", to: [10, 50] }, markOut), true);

const at = (row: number, t: number): Cursor => ({ row, t, run: "rest" });

describe("строки проигрывания", () => {
  it("те же, что строки шагов под схемой, — у каждого варианта каталога с одним кайтом", () => {
    expect(SOLO.length).toBe(46);
    for (const { code, kite, rev } of SOLO) {
      expect(sceneOf(kite.path, rev).rows.length, code).toBe(describeKite(kite).length);
    }
  });

  it("первая строка — старт: перемещения, линии и времени у неё нет", () => {
    const [first, second] = corner().rows;
    expect(first.legs.map((leg) => leg.step.kind)).toEqual(["mark"]);
    expect([first.track, first.seconds, first.shares]).toEqual(["", 0, []]);
    expect(second.track).toBe("M-50 80L10 80");
  });

  it("событие в точке прихода стоит в строке своего перемещения", () => {
    const rows = corner().rows;
    expect(rows[2].legs.map((leg) => leg.step.kind)).toEqual(["line", "mark"]);
  });
});

describe("темп", () => {
  it("скорость одна на весь путь: время строки — её длина", () => {
    const [, right, up] = corner().rows;
    expect(right.seconds).toBeCloseTo(60 / SPEED, 9);
    expect(up.seconds).toBeCloseTo(30 / SPEED, 9);
  });

  it("дуга идёт с той же скоростью, что прямая", () => {
    const scene = sceneOf(
      path(start, markIn, { kind: "arc", to: [-10, 20], center: [-30, 20], direction: "cw", sweep: 180 }, markOut),
      true,
    );
    expect(scene.rows[1].seconds).toBeCloseTo((20 * Math.PI) / SPEED, 9);
  });

  it("остановка и поворот на месте занимают условную паузу, вход и выход — ничего", () => {
    const scene = sceneOf(
      path(
        start,
        markIn,
        { kind: "line", to: [10, 20], nose: 0 },
        { kind: "mark", mark: "stall", nose: 0 },
        { kind: "rotate", degrees: 90, direction: "cw", about: "center", about_basis: "text" },
        markOut,
      ),
      true,
    );
    expect(scene.rows[1].legs.map(paceOf)).toEqual([60 / SPEED, HOLD, 90 / TURN_RATE, 0]);
  });

  it("посадка — такая же условная пауза, как остановка", () => {
    const scene = sceneOf(path({ kind: "start", at: [0, 30] }, markIn, { kind: "line", to: [0, 0] }, { kind: "mark", mark: "landing" }, markOut), true);
    expect(scene.rows[1].legs.map(paceOf)).toEqual([1, HOLD, 0]);
  });

  it("MI 02: поворот со смещением идёт с той же скоростью носа, и линия у него есть", () => {
    const row = catalog("MI 02").rows.find((item) => item.legs[0].step.kind === "rotate");
    expect(row?.seconds).toBeCloseTo((row?.legs[0].length ?? 0) / SPEED, 9);
    expect(row?.legs[0].length).toBeGreaterThan(0);
    expect(row?.track).toMatch(/^M.+A/);
  });

  it("строка, которой свой счёт не дал времени, проходится сразу", () => {
    const scene = sceneOf(path(start, markIn, { kind: "line", to: [10, 20] }, { kind: "line", to: [10, 50] }, markOut), true, (leg) =>
      leg.index === 2 ? 0 : leg.length,
    );
    expect(scene.rows[1].shares).toEqual([]);
    expect(frameAt(scene, { row: 1, t: 0, run: "all" }).pose.point).toEqual([10, 20]);
    expect(tick(scene, play(scene, START), 1).row).toBe(2);
  });

  it("свой счёт времени заменяет условный", () => {
    const scene = sceneOf(path(start, markIn, { kind: "line", to: [10, 20] }, markOut), true, (leg) => (leg.length > 0 ? 7 : 0));
    expect(scene.rows[1].seconds).toBe(7);
  });

  it("в подписи сказано, что темп условный, и нет ни одного числа", () => {
    expect(PACE_TEXT).toContain("Темп условный");
    expect(PACE_TEXT).toContain("Времени на экране нет");
    expect(PACE_TEXT).toContain("нос меняет курс скачком");
    expect(PACE_TEXT).not.toMatch(/\d/);
  });
});

describe("кадр", () => {
  it("до первого шага кайт стоит на старте носом по первому пролёту", () => {
    const { pose, glyph } = frameAt(corner(), START);
    expect(pose.point).toEqual([-50, 20]);
    expect(pose.nose).toEqual([1, 0]);
    expect(glyph?.kind).toBe("kite");
  });

  it("на прямой кайт стоит в пройденной доле", () => {
    const { pose } = frameAt(corner(), at(1, 0.25));
    expect(pose.point).toEqual([-35, 20]);
  });

  it("в остановке кайт стоит на месте всю паузу", () => {
    const scene = sceneOf(
      path(start, markIn, { kind: "line", to: [10, 20] }, { kind: "mark", mark: "stall", nose: 0 }, { kind: "line", to: [10, 50] }, markOut),
      true,
    );
    const row = scene.rows[1];
    const stalled = row.shares[1];
    expect(stalled[1] - stalled[0]).toBeCloseTo(HOLD / row.seconds, 9);
    for (const t of [stalled[0], (stalled[0] + stalled[1]) / 2, 1]) {
      expect(frameAt(scene, at(1, t)).pose.point).toEqual([10, 20]);
    }
  });

  it("значок рисуется той же формулой, что значок схемы, и стоит носом в точке", () => {
    const { glyph } = frameAt(corner(), at(1, 0.5));
    // Нос четырёхстропного — середина передней кромки: первые две вершины.
    const [a, b] = [...(glyph?.d ?? "").matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]).toEqual([-20, 80]);
  });

  it("силуэт — по виду кайта: у двухстропного дельта, у четырёхстропного кромка с парусом", () => {
    const steps = path(start, markIn, { kind: "line", to: [10, 20] }, markOut);
    const corners = (rev: boolean) => (frameAt(sceneOf(steps, rev), at(1, 0.5)).glyph?.d ?? "").split("L").length;
    expect([corners(false), corners(true)]).toEqual([4, 5]);
  });

  it("DI 16: двухстропный в остановке стоит носом вверх, четырёхстропный по тому же пути — с курсом прихода", () => {
    const found = SOLO.find((item) => item.code === "DI 16");
    const steps = found?.kite.path ?? [];
    const stalled = (rev: boolean) => {
      const scene = sceneOf(steps, rev);
      const index = scene.rows.findIndex((row) => row.legs.some((leg) => leg.step.kind === "mark" && leg.step.mark === "stall"));
      return frameAt(scene, at(index, 1)).pose.nose;
    };
    expect(stalled(false)).toEqual([0, 1]);
    expect(stalled(true)).not.toEqual([0, 1]);
  });

  it("севший кайт стоит на земле, а не под ней", () => {
    const scene = sceneOf(path({ kind: "start", at: [0, 30] }, markIn, { kind: "line", to: [0, 0], nose: 90 }, markOut), true);
    const { glyph } = frameAt(scene, at(1, 1));
    const ys = [...(glyph?.d ?? "").matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[2]));
    expect(Math.max(...ys)).toBeLessThanOrEqual(100);
  });
});

describe("нос на стыке строк", () => {
  it("меняет курс скачком: промежуточного курса нет ни в одном кадре", () => {
    const scene = corner();
    const seen = new Set<string>();
    for (const row of [1, 2]) {
      for (let t = 0; t <= 1; t += 1 / 64) {
        seen.add(String(frameAt(scene, at(row, t)).pose.nose));
      }
    }
    expect([...seen]).toEqual(["1,0", "0,1"]);
  });

  it("в конце строки кайт ещё смотрит по ней, в начале следующей — уже по ней", () => {
    const scene = corner();
    expect(frameAt(scene, at(1, 1)).pose.nose).toEqual([1, 0]);
    expect(frameAt(scene, at(2, 0)).pose.nose).toEqual([0, 1]);
  });
});

describe("шаг вперёд и назад", () => {
  const scene = corner();

  it("вперёд — следующая строка с начала, и она летится", () => {
    expect(forward(scene, START)).toEqual({ row: 1, t: 0, run: "step" });
  });

  it("строка долетает до конца и встаёт, дальше сама не идёт", () => {
    const flying = forward(scene, START);
    expect(tick(scene, flying, 1)).toEqual({ row: 1, t: 0.5, run: "step" });
    expect(tick(scene, flying, 100)).toEqual({ row: 1, t: 1, run: "rest" });
  });

  it("вперёд посреди полёта ставит кайт в конец строки", () => {
    const flying = tick(scene, forward(scene, START), 0.5);
    expect(forward(scene, flying)).toEqual({ row: 1, t: 1, run: "rest" });
  });

  it("вперёд в конце пути ничего не меняет", () => {
    expect(forward(scene, at(2, 1))).toEqual(at(2, 1));
  });

  it("назад возвращает к началу строки без полёта — и из середины, и из конца", () => {
    expect(back(at(2, 1))).toEqual(at(1, 1));
    expect(back({ row: 2, t: 0.4, run: "step" })).toEqual(at(1, 1));
    expect(back(START)).toEqual(START);
    expect(back({ row: 2, t: 0.4, run: "rest" })).toEqual(at(1, 1));
  });

  it("без движения вперёд ставит кайт сразу в конец следующей строки", () => {
    expect(forward(scene, START, true)).toEqual(at(1, 1));
    expect(forward(scene, at(1, 0.3), true)).toEqual(at(1, 1));
  });
});

describe("весь путь подряд", () => {
  const scene = corner();

  it("идёт через стык строк, не теряя времени, и встаёт в конце пути", () => {
    const playing = play(scene, START);
    expect(playing).toEqual({ row: 1, t: 0, run: "all" });
    // Первая строка — 2 секунды, вторая — 1.
    const later = tick(scene, playing, 2.5);
    expect(later.row).toBe(2);
    expect(later.t).toBeCloseTo(0.5, 9);
    expect(tick(scene, playing, 3)).toEqual(at(2, 1));
    expect(tick(scene, playing, 99)).toEqual(at(2, 1));
  });

  it("пауза держит место, вперёд после неё долетает строку, играть — идёт дальше", () => {
    const paused = pause(tick(scene, play(scene, START), 1));
    expect(paused).toEqual({ row: 1, t: 0.5, run: "rest" });
    expect(tick(scene, paused, 5)).toEqual(paused);
    expect(forward(scene, paused)).toEqual({ row: 1, t: 0.5, run: "step" });
    expect(play(scene, paused)).toEqual({ row: 1, t: 0.5, run: "all" });
  });

  it("с конца пути начинается заново", () => {
    expect(play(scene, at(2, 1))).toEqual({ row: 1, t: 0, run: "all" });
  });
});

describe("чего книга не показала", () => {
  it("MI 16: на круге без показанного порядка кайта нет, линия круга выделена", () => {
    const scene = catalog("MI 16");
    const index = scene.rows.findIndex((row) => row.unmarked);
    expect(index).toBeGreaterThan(0);
    const row = scene.rows[index];
    expect(row.gaps).toContain("order");
    expect(row.track).toMatch(/^M[^A]+A/);
    for (const t of [0.1, 0.5, 0.9]) {
      expect(frameAt(scene, at(index, t)).glyph).toBeNull();
    }
  });

  it("поворот вокруг неназванной точки показан с пометкой, и курс идёт от начального к конечному", () => {
    const scene = sceneOf(
      path(start, markIn, { kind: "line", to: [10, 20], nose: 0 }, { kind: "rotate", degrees: 90, direction: "cw", ...UNNAMED }, markOut),
      true,
    );
    const row = scene.rows[1];
    expect(row.gaps).toEqual(["pivot"]);
    const [from, to] = row.shares[1];
    const flying = frameAt(scene, at(1, from / 2));
    expect(flying.unsure).toBe(false);
    const turning = frameAt(scene, at(1, (from + to) / 2));
    expect(turning.unsure).toBe(true);
    expect(turning.pose.point).toEqual([10, 20]);
    expect(turning.pose.nose?.[0]).toBeCloseTo(Math.SQRT1_2, 9);
    expect(turning.pose.nose?.[1]).toBeCloseTo(Math.SQRT1_2, 9);
  });

  it("поворот вокруг названной точки пометки не несёт", () => {
    const scene = sceneOf(
      path(
        start,
        markIn,
        { kind: "line", to: [10, 20], nose: 0 },
        { kind: "rotate", degrees: 90, direction: "cw", about: "center", about_basis: "text" },
        markOut,
      ),
      true,
    );
    expect(scene.rows[1].gaps).toEqual([]);
    expect(frameAt(scene, at(1, 0.99)).unsure).toBe(false);
  });

  it("пометка «pivot» — ровно у тех фигур каталога, где книга точку поворота не называет", () => {
    const unnamed = SOLO.filter(({ kite }) => kite.path.some((step) => step.kind === "rotate" && step.to === undefined && typeof step.about !== "string"));
    const marked = SOLO.filter(({ kite, rev }) => sceneOf(kite.path, rev).rows.some((row) => row.gaps.includes("pivot")));
    expect(marked.map((item) => item.code)).toEqual(unnamed.map((item) => item.code));
    expect(marked.length).toBeGreaterThan(0);
  });

  it("MI 02: незаданное книгой место показано с пометкой, и только у этой фигуры", () => {
    const spanned = SOLO.filter(({ kite, rev }) => sceneOf(kite.path, rev).rows.some((row) => row.gaps.includes("span")));
    expect(spanned.map((item) => item.code)).toEqual(["MI 02"]);
    const scene = catalog("MI 02");
    const index = scene.rows.findIndex((row) => row.gaps.includes("span"));
    expect(frameAt(scene, at(index, 1)).unsure).toBe(true);
  });

  it("аксель: кайт стоит в точке с пометкой, движения нет", () => {
    const scene = sceneOf(path(start, markIn, { kind: "line", to: [10, 20] }, { kind: "mark", mark: "half-axel" }, markOut), false);
    const row = scene.rows[1];
    expect(row.gaps).toEqual(["axel"]);
    const [from, to] = row.shares[1];
    const during = frameAt(scene, at(1, (from + to) / 2));
    expect(during.unsure).toBe(true);
    expect(during.pose.point).toEqual([10, 20]);
    expect(frameAt(scene, at(1, from / 2)).unsure).toBe(false);
  });

  it("аксели каталога помечены все", () => {
    const withAxel = SOLO.filter(({ kite }) => kite.path.some((step) => step.kind === "mark" && step.mark.endsWith("axel")));
    const marked = SOLO.filter(({ kite, rev }) => sceneOf(kite.path, rev).rows.some((row) => row.gaps.includes("axel")));
    expect(marked.map((item) => item.code)).toEqual(withAxel.map((item) => item.code));
    expect(marked.length).toBeGreaterThan(0);
  });

  it("где курс из пути не следует, вместо кайта — кольцо в точке", () => {
    // Круг без показанного порядка, нос по ходу: на его краю точка известна, курс — нет.
    const scene = sceneOf(
      path(start, markIn, { kind: "arc", to: [-50, 20], center: [-30, 20], direction: "cw", sweep: 360, unmarked: true }, markOut),
      true,
    );
    expect(frameAt(scene, START).glyph?.kind).toBe("spot");
    expect(frameAt(scene, at(1, 0.5)).glyph).toBeNull();
    expect(frameAt(scene, at(1, 1)).glyph?.kind).toBe("spot");
  });

  it("слова пометок — каждая о своём, и ни в одной нет чисел", () => {
    expect(GAP_TEXT.order).toContain("Порядок прохода");
    expect(GAP_TEXT.pivot).toContain("Вокруг чего кайт поворачивается");
    expect(GAP_TEXT.span).toContain("незаданным");
    expect(GAP_TEXT.axel).toContain("Аксель");
    for (const text of Object.values(GAP_TEXT)) {
      expect(text).not.toMatch(/\d/);
    }
  });

  it("DI 20: после акселя кайт стоит с пометкой — курс после него из данных не следует", () => {
    const scene = catalog("DI 20");
    const index = scene.rows.findIndex((row) => row.gaps.includes("axel"));
    expect(frameAt(scene, at(index, 1)).unsure).toBe(true);
    expect(frameAt(scene, at(index, 0.01)).unsure).toBe(false);
  });

  it("полный аксель помечен так же, как половина", () => {
    const scene = sceneOf(path(start, markIn, { kind: "line", to: [10, 20] }, { kind: "mark", mark: "axel" }, markOut), false);
    expect(scene.rows[1].gaps).toEqual(["axel"]);
    expect(frameAt(scene, at(1, 0.99)).unsure).toBe(true);
  });

  it("после поворота вокруг неназванной точки пометка остаётся и в покое, что бы ни стояло за поворотом", () => {
    const scene = sceneOf(
      path(start, markIn, { kind: "line", to: [10, 20], nose: 0 }, { kind: "rotate", degrees: 90, direction: "cw", ...UNNAMED }, markOut),
      true,
    );
    expect(frameAt(scene, at(1, 1)).unsure).toBe(true);
  });

  it("строка без пометок в покое пометки не несёт", () => {
    expect(frameAt(corner(), at(1, 1)).unsure).toBe(false);
  });

  it("MI 02: незаданное место помечено и в полёте, а не только в покое", () => {
    const scene = catalog("MI 02");
    const index = scene.rows.findIndex((row) => row.gaps.includes("span"));
    expect(frameAt(scene, at(index, 0.5)).unsure).toBe(true);
  });

  it("DI 12: внутри пробега из двух шагов кайта нет ни на одном из них", () => {
    const scene = catalog("DI 12");
    const loose = scene.rows.flatMap((row, index) => (row.unmarked ? [index] : []));
    expect(loose.length).toBe(2);
    for (const index of loose) {
      for (const t of [1e-9, 0.3, 0.7, 0.999999]) {
        expect(frameAt(scene, at(index, t)).glyph).toBeNull();
      }
    }
  });

  it("шаг без показанного порядка первым в пути: старт несёт ту же пометку, что и кольцо на нём", () => {
    const scene = sceneOf(
      path(start, markIn, { kind: "arc", to: [-50, 20], center: [-30, 20], direction: "cw", sweep: 360, unmarked: true }, markOut),
      true,
    );
    expect(scene.rows[0].gaps).toEqual(["order"]);
    expect(corner().rows[0].gaps).toEqual([]);
  });
});

describe("каждый путь каталога с одним кайтом", () => {
  it("проигрывается от старта до конца по кадрам, и кайта нет только там, где порядок не показан", () => {
    for (const { code, kite, rev } of SOLO) {
      const scene = sceneOf(kite.path, rev);
      let cursor = play(scene, START);
      let frames = 0;
      while (cursor.run !== "rest") {
        const frame = frameAt(scene, cursor);
        if (frame.glyph === null) {
          expect(frame.row.gaps, code).toContain("order");
        } else {
          expect(frame.glyph.d, code).not.toMatch(/NaN|Infinity/);
        }
        cursor = tick(scene, cursor, 1 / 30);
        frames += 1;
        expect(frames, code).toBeLessThan(5000);
      }
      expect(cursor, code).toEqual(at(scene.rows.length - 1, 1));
      const path = kite.path;
      const end = [...path].reverse().find((step) => "to" in step && step.to !== undefined);
      expect(frameAt(scene, cursor).pose.point, code).toEqual(end && "to" in end ? end.to : null);
    }
  });

  it("шагами вперёд проходится за столько нажатий, сколько строк после старта", () => {
    for (const { code, kite, rev } of SOLO) {
      const scene = sceneOf(kite.path, rev);
      let cursor = START;
      let presses = 0;
      while (cursor.row < scene.rows.length - 1) {
        cursor = forward(scene, cursor, true);
        presses += 1;
      }
      expect(presses, code).toBe(describeKite(kite).length - 1);
    }
  });

  it("до первого шага кайт стоит в точке старта", () => {
    for (const { code, kite, rev } of SOLO) {
      const first = kite.path[0];
      expect(frameAt(sceneOf(kite.path, rev), START).pose.point, code).toEqual(first.kind === "start" ? first.at : null);
    }
  });
});

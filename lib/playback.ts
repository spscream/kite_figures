// Проигрывание пути одного кайта на странице фигуры: что показать в каждый
// момент и как шагать по пути вперёд и назад. Своей геометрии здесь нет —
// положение и нос считает `lib/pose.ts`, значок и линию — `lib/diagram.ts`.
// Модуль ничего не знает про React и исполняется в браузере.
//
// Путь поделён на строки — те же, что в списке шагов под схемой: строка — одно
// перемещение и события в точке, куда оно привело. Строка и есть шаг
// проигрывания: «вперёд» пролетает её и встаёт, «назад» возвращает к началу.
//
// Темп условный. Скорости книга не задаёт, длительности остановки и поворота
// нет ни в данных, ни в книге; три числа ниже — условность показа, а не
// сведения о фигуре, и на экран они не выводятся. В данные фигур время не
// попадает: кому длительность известна (рутина), тот передаёт свой счёт.
//
// Чего книга не показала, проигрывание не достраивает: на шаге `unmarked`
// кайта нет вовсе, остаётся линия; поворот вокруг неназванной точки и место,
// объявленное незаданным, показаны с пометкой; аксель записан точкой, и его
// движения нет; между строками нос меняет курс скачком, как его выдаёт поза.

import { shape, trackOf } from "./diagram";
import { GRID, isSwing, type Step } from "./geometry";
import { type Doubt, type Leg, legsOf, type Pose, poseAt, poseOn, sharesOf, swingArc } from "./pose";

// Скорость носа, единиц сетки в секунду: одна на весь путь.
export const SPEED = 30;
// Поворот на месте, градусов в секунду.
export const TURN_RATE = 180;
// Сколько кайт стоит в остановке, после посадки и на акселе, секунд.
export const HOLD = 0.6;

const HELD = ["stall", "landing", "axel", "half-axel"];

// Сколько секунд показа занимает шаг пути.
export function paceOf(leg: Leg): number {
  const { step } = leg;
  if (leg.length > 0) {
    return leg.length / SPEED;
  }
  if (step.kind === "rotate") {
    return step.degrees / TURN_RATE;
  }
  return step.kind === "mark" && HELD.includes(step.mark) ? HOLD : 0;
}

// Чего на строке книга не показала: сомнения позы и аксель, у которого в
// данных нет самого движения.
export type Gap = Doubt | "axel";

export const GAPS: readonly Gap[] = ["order", "pivot", "span", "axel"];

export const GAP_TEXT: Record<Gap, string> = {
  order: "Порядок прохода этого шага книга не показывает: кайта на нём нет, выделена только линия.",
  pivot: "Вокруг чего кайт поворачивается, книга не называет: значок повёрнут вокруг носа условно и обведён пунктиром.",
  span: "Это место книга объявляет незаданным: значок стоит по размаху нашего значка кайта и обведён пунктиром.",
  axel: "Аксель записан точкой: самого движения в данных нет, и здесь оно не показано.",
};

// Подпись под кнопками: темп условный, и это сказано на странице.
export const PACE_TEXT =
  "Темп условный: скорости книга не задаёт. Кайт идёт с постоянной скоростью, остановка и поворот на месте показаны условной паузой, " +
  "времени на экране нет: судить по этому показу о ритме нельзя, он показывает порядок шагов. " +
  "На стыке шагов нос меняет курс скачком: как кайт доворачивает, книга не показывает.";

// Строка шагов: перемещение и события в точке, куда оно привело. Первая строка
// пути — точка старта с её событиями — перемещения не имеет.
export type Row = {
  legs: Leg[];
  // Доли строки, которые занимает каждый её шаг; у первой строки пусто.
  shares: [number, number][];
  seconds: number;
  gaps: Gap[];
  // Линия перемещения строки для SVG; у первой строки пусто.
  track: string;
  // Порядок прохода перемещения книгой не показан.
  unmarked: boolean;
};

export type Scene = {
  rev: boolean;
  rows: Row[];
  // Поза до первого шага — доля пути ноль.
  opening: Pose;
};

// Шаг открывает строку: пролёт или поворот со смещением.
const moves = (step: Step) => step.kind === "line" || step.kind === "arc" || isSwing(step);

function trackOfLeg({ step, from }: Leg): string {
  if (step.kind === "line" || step.kind === "arc") {
    return trackOf(from, step);
  }
  return isSwing(step) ? trackOf(from, swingArc(from, step)) : "";
}

function gapsOf(legs: Leg[]): Gap[] {
  const found = new Set<Gap>();
  for (const leg of legs) {
    for (const t of [0, 0.5, 1]) {
      poseOn(leg, t).doubts.forEach((doubt) => found.add(doubt));
    }
    if (leg.step.kind === "mark" && (leg.step.mark === "axel" || leg.step.mark === "half-axel")) {
      found.add("axel");
    }
  }
  return GAPS.filter((gap) => found.has(gap));
}

// Путь кайта, разложенный для проигрывания. `rev` — кайт четырёхстропный;
// `pace` — сколько секунд занимает шаг.
export function sceneOf(path: Step[], rev: boolean, pace: (leg: Leg) => number = paceOf): Scene {
  const groups: Leg[][] = [[]];
  for (const leg of legsOf(path, rev)) {
    if (moves(leg.step)) {
      groups.push([]);
    }
    groups[groups.length - 1].push(leg);
  }
  const rows = groups.map((legs, index): Row => {
    const weights = legs.map(pace);
    const seconds = weights.reduce((sum, weight) => sum + weight, 0);
    const first = legs[0];
    return {
      legs,
      // Первая строка не проигрывается, и долей у неё нет.
      shares: index > 0 ? sharesOf(legs, (leg) => weights[legs.indexOf(leg)]) : [],
      seconds,
      gaps: gapsOf(legs),
      track: index > 0 ? trackOfLeg(first) : "",
      unmarked: index > 0 && "unmarked" in first.step && first.step.unmarked === true,
    };
  });
  return { rev, rows, opening: poseAt(path, 0, rev) };
}

// Где проигрывание: строка и пройденная её доля. `rest` — стоит, `step` —
// долетает строку, `all` — идёт до конца пути.
export type Cursor = { row: number; t: number; run: "rest" | "step" | "all" };

export const START: Cursor = { row: 0, t: 1, run: "rest" };

const last = (scene: Scene) => scene.rows.length - 1;

// Следующая строка. Пока строка летится — встать в её конец; строку, прерванную
// паузой, долететь. `instant` — без движения: сразу в конец строки.
export function forward(scene: Scene, at: Cursor, instant = false): Cursor {
  if (at.run !== "rest") {
    return { row: at.row, t: 1, run: "rest" };
  }
  if (at.t < 1) {
    return instant ? { row: at.row, t: 1, run: "rest" } : { ...at, run: "step" };
  }
  if (at.row >= last(scene)) {
    return at;
  }
  return instant ? { row: at.row + 1, t: 1, run: "rest" } : { row: at.row + 1, t: 0, run: "step" };
}

// К началу строки, то есть к концу предыдущей. Назад кайт не летит: обратного
// прохода в данных нет.
export function back(at: Cursor): Cursor {
  return { row: Math.max(0, at.row - 1), t: 1, run: "rest" };
}

// Весь путь подряд; с конца пути — заново с начала.
export function play(scene: Scene, at: Cursor): Cursor {
  const from = at.row >= last(scene) && at.t >= 1 ? START : at;
  if (from.t < 1) {
    return { ...from, run: "all" };
  }
  return from.row >= last(scene) ? from : { row: from.row + 1, t: 0, run: "all" };
}

export function pause(at: Cursor): Cursor {
  return { ...at, run: "rest" };
}

// Прошло `seconds` секунд показа.
export function tick(scene: Scene, at: Cursor, seconds: number): Cursor {
  if (at.run === "rest" || !(seconds > 0)) {
    return at;
  }
  let { row, t } = at;
  let left = seconds;
  for (;;) {
    const whole = scene.rows[row].seconds;
    const rest = (1 - t) * whole;
    if (left < rest) {
      return { row, t: t + left / whole, run: at.run };
    }
    if (at.run === "step" || row >= last(scene)) {
      return { row, t: 1, run: "rest" };
    }
    left -= rest;
    row += 1;
    t = 0;
  }
}

export type Frame = {
  row: Row;
  pose: Pose;
  // Значок на схеме: кайт носом по курсу, а где курс из пути не следует —
  // кольцо в точке. Там, где порядок прохода книгой не показан, значка нет.
  glyph: { kind: "kite" | "spot"; d: string } | null;
  // Значок стоит условно: точка поворота не названа, место не задано либо
  // идёт аксель, движения которого в данных нет.
  unsure: boolean;
};

// Значок проигрывания крупнее значков схемы: он лежит поверх них.
const SCALE = 1.25;

// Что показать в этом месте проигрывания.
export function frameAt(scene: Scene, at: Cursor): Frame {
  const row = scene.rows[at.row];
  let pose = scene.opening;
  let leg: Leg | undefined;
  if (at.row > 0) {
    const index = row.shares.findIndex(([, to]) => to > at.t);
    if (index < 0) {
      pose = poseOn(row.legs[row.legs.length - 1], 1);
    } else {
      const [from, to] = row.shares[index];
      leg = row.legs[index];
      pose = poseOn(leg, Math.max(0, at.t - from) / (to - from));
    }
  }
  const axel = leg !== undefined && leg.step.kind === "mark" && (leg.step.mark === "axel" || leg.step.mark === "half-axel");
  const { point, nose } = pose;
  const glyph =
    point === null
      ? null
      : nose === null
        ? ({ kind: "spot", d: shape("derived", point[0], GRID.yMax - point[1]) } as const)
        : ({ kind: "kite", d: shape("pass", point[0], GRID.yMax - point[1], nose, SCALE, scene.rev, true) } as const);
  return { row, pose, glyph, unsure: axel || pose.doubts.includes("pivot") || pose.doubts.includes("span") };
}

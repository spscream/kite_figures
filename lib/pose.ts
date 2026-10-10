// Положение и нос кайта в доле пути: где кайт и куда смотрит его нос, когда
// пройдена такая-то часть пути. Считается из тех же шагов, что и чертёж, и
// поверх его же `along` и `noseAt`; ни времени, ни разметки здесь нет.
//
// Доля — это доля веса пути, а вес шага по умолчанию равен длине, которую
// проходит нос. Поэтому остановка и поворот на месте доли не занимают: их
// длительности нет ни в данных, ни в книге, и модуль её не выдумывает. Кому
// длительность известна (рутина), тот передаёт свои веса.
//
// Три места, где книга чего-то не показывает, поза называет сама:
// - шаг `unmarked`: порядок прохода книгой не показан, и доля пути точки на нём
//   не задаёт — `point` равен `null`, остаётся линия шага;
// - поворот на месте вокруг неназванной точки: нос стоит в своей точке сетки,
//   как записано в данных, курс идёт от начального к конечному, а вокруг чего
//   вращается сам кайт, неизвестно — сомнение `pivot`;
// - положение, которое книга объявила незаданным: место считает разбор от
//   размаха нашего значка (`REV_SPAN`), и поза его повторяет с сомнением `span`.
//
// Между шагами, между которыми нет `rotate`, нос не доворачивается: курс на
// шаге — тот, что записан у шага, и на стыке он меняется скачком. Сторону и
// длительность такого доворота книга не показывает.
//
// Стоящий кайт. Четырёхстропный в остановке держит курс, с которым пришёл:
// `nose` отметки `stall` — метка книги, она стоит то до поворота, то после, и
// за курс не берётся. Двухстропный в остановке и после посадки на оба конца
// крыла стоит носом вверх, откуда бы ни пришёл, пока не полетит дальше: так
// остановку описывает разбор (все метки двухстропных остановок в каталоге —
// носом вверх, это держит тест), а севший кайт так ставит и чертёж. Поэтому
// модулю надо сказать, какой кайт летит (`rev`).
//
// Одновременность кайтов (`sync`) здесь не учитывается: равная доля у двух
// кайтов одной схемы — не один и тот же момент.

import { along, noseAt, ON_TIPS } from "./diagram";
import { isSwing, pivotOf, UNSPECIFIED, type Point, type Step, type Swing } from "./geometry";

type Move = Extract<Step, { kind: "line" | "arc" }>;

// Что в позе не прочитано из книги:
// `order` — шаг `unmarked`, порядок его прохода книга не показывает;
// `pivot` — поворот на месте, чью точку вращения книга не называет;
// `span` — место следует из размаха нашего значка либо стоит на координате,
// которую книга объявила незаданной.
export type Doubt = "order" | "pivot" | "span";

export type Pose = {
  // Номер шага в пути, на который приходится эта доля, — в том порядке, в
  // каком шаги записаны.
  step: number;
  // Где нос кайта, в сетке окна. `null` — внутри пробега из шагов `unmarked`:
  // на самих шагах и на отметках и поворотах между ними.
  point: Point | null;
  // Курс носа единичным вектором в сетке окна ([0, 1] — вверх). `null` — курс
  // из пути не следует: до первого пролёта, на шаге `unmarked`, где курс
  // зависит от порядка обхода, и после него, пока курс не задаст следующий
  // пролёт — либо, у двухстропного, остановка или посадка на оба конца крыла.
  nose: Point | null;
  doubts: Doubt[];
};

// Шаг пути вместе с тем, с чем кайт к нему пришёл. Шаг `start` сюда не входит.
export type Leg = {
  // Номер шага в пути.
  index: number;
  step: Exclude<Step, { kind: "start" }>;
  // Точка и курс носа перед шагом; у отметки — курс, с которым кайт в ней
  // стоит.
  from: Point;
  nose: Point | null;
  // Сколько проходит нос: длина отрезка или дуги, у поворота со смещением —
  // дуга носа вокруг точки поворота, у отметки и поворота на месте — ноль.
  length: number;
  // Точка `from` следует из размаха нашего значка, а не из книги.
  ours: boolean;
  // Только у шага `unmarked`: известны ли его начало и конец. Пробег из таких
  // шагов книга рисует целиком, и его края — точки пути при любом порядке
  // обхода; стыки внутри пробега от порядка зависят.
  ends?: [boolean, boolean];
  // Отметка или поворот на месте на стыке внутри пробега `unmarked`: при другом
  // порядке обхода кайт в эту долю в другом месте.
  adrift?: true;
};

const UP: Point = [0, 1];

// Поворот со смещением как дуга носа вокруг точки поворота.
function swingArc(from: Point, step: Swing): Move {
  return {
    kind: "arc",
    to: step.to,
    center: pivotOf(from, step.to, step.direction, step.degrees),
    direction: step.direction,
    sweep: step.degrees,
    basis: "grid",
    nose: "forward",
  };
}

function travel(from: Point, step: Move): number {
  if (step.kind === "line") {
    return Math.hypot(step.to[0] - from[0], step.to[1] - from[1]);
  }
  return (Math.hypot(from[0] - step.center[0], from[1] - step.center[1]) * step.sweep * Math.PI) / 180;
}

// Курс после поворота на `degrees`: по часовой курс растёт.
function turned(nose: Point, direction: "cw" | "ccw", degrees: number): Point {
  const angle = ((direction === "cw" ? degrees : -degrees) * Math.PI) / 180;
  return [
    nose[0] * Math.cos(angle) + nose[1] * Math.sin(angle),
    nose[1] * Math.cos(angle) - nose[0] * Math.sin(angle),
  ];
}

// Курс на шаге зависит от порядка обхода: нос по ходу или против хода.
const followsOrder = (step: Move) => step.nose === "forward" || step.nose === "backward";

// Пробег `unmarked` из одного шага: при обратном обходе это тот же шаг, и курс
// числом на нём тот же. В пробеге из нескольких шагов в ту же долю летится
// другой шаг — со своим курсом.
const alone = (leg: Leg) => leg.ends !== undefined && leg.ends[0] && leg.ends[1];

// Шаг перемещает кайт: пролёт или поворот со смещением.
const moves = (step: Step) => step.kind === "line" || step.kind === "arc" || isSwing(step);
const loose = (step: Step | undefined) => step !== undefined && (step.kind === "line" || step.kind === "arc") && step.unmarked === true;

// Путь по шагам: каждый шаг — с точкой и курсом, с которыми кайт к нему пришёл.
// `rev` — кайт четырёхстропный (разделы Multi-line).
export function legsOf(path: Step[], rev: boolean): Leg[] {
  const legs: Leg[] = [];
  // Номера шагов, перемещающих кайт: по ним ищутся края пробегов `unmarked`.
  const moving = path.flatMap((step, index) => (moves(step) ? [index] : []));
  let here: Point | null = null;
  let nose: Point | null = null;
  let ours = false;
  let adrift = false;
  for (const [index, step] of path.entries()) {
    if (step.kind === "start") {
      here = step.at;
      continue;
    }
    if (here === null) {
      throw new Error("путь начинается шагом «start»");
    }
    // Внутри пробега `unmarked` и это неизвестно: в ту же долю при другом
    // порядке обхода кайт ещё летит.
    if (step.kind === "mark" && !rev && !adrift && (step.mark === "stall" || (step.mark === "landing" && ON_TIPS.includes(step.style ?? "")))) {
      nose = UP;
    }
    const leg: Leg = { index, step, from: here, nose, length: 0, ours };
    legs.push(leg);
    if (step.kind === "line" || step.kind === "arc") {
      leg.length = travel(here, step);
      if (step.unmarked) {
        // Края пробега: соседний шаг, перемещающий кайт, направление несёт.
        const at = moving.indexOf(index);
        leg.ends = [!loose(path[moving[at - 1]]), !loose(path[moving[at + 1]])];
        adrift = !leg.ends[1];
      }
      nose = step.unmarked && (followsOrder(step) || !alone(leg)) ? null : noseAt(here, step, 1);
      here = step.to;
      ours = step.basis === UNSPECIFIED;
    } else if (step.kind === "rotate") {
      nose = nose && turned(nose, step.direction, step.degrees);
      if (isSwing(step)) {
        leg.length = travel(here, swingArc(here, step));
        here = step.to;
        ours = step.basis === UNSPECIFIED;
      }
    }
    if (adrift && leg.length === 0) {
      leg.adrift = true;
    }
  }
  return legs;
}

// Поза на шаге; `t` — доля шага от 0 до 1.
export function poseOn(leg: Leg, t: number): Pose {
  if (!(t >= 0 && t <= 1)) {
    throw new RangeError(`доля шага — от 0 до 1, получено ${t}`);
  }
  const { step, from } = leg;
  const doubts: Doubt[] = [];
  const pose = (point: Point | null, nose: Point | null): Pose => ({ step: leg.index, point, nose, doubts });
  // Шаг может начаться в точке книги и прийти в незаданное место, и наоборот:
  // сомнение относится к тому концу, который не от книги.
  const there = leg.length > 0 ? "basis" in step && step.basis === UNSPECIFIED : leg.ours;
  if ((leg.ours && t < 1) || (there && t > 0)) {
    doubts.push("span");
  }
  if (step.kind === "mark" || step.kind === "rotate") {
    const nose = step.kind === "mark" ? leg.nose : leg.nose && turned(leg.nose, step.direction, step.degrees * t);
    if (leg.adrift) {
      doubts.push("order");
      return pose(null, nose);
    }
    if (step.kind === "mark") {
      return pose(from, nose);
    }
    if (isSwing(step)) {
      // Точка поворота следует из самого смещения, названа она или нет.
      return pose(along(from, swingArc(from, step), t).point, nose);
    }
    if (typeof step.about !== "string") {
      doubts.push("pivot");
    }
    return pose(from, nose);
  }
  if (!step.unmarked) {
    return pose(along(from, step, t).point, noseAt(from, step, t));
  }
  // Край пробега — точка пути при любом порядке обхода; внутри него точки нет.
  // Курс следует из данных только в пробеге из одного шага: числом — на всём
  // шаге, наружу и внутрь круга — на его концах.
  const edge = (t === 0 && leg.ends?.[0]) || (t === 1 && leg.ends?.[1]);
  const point = edge ? along(from, step, t).point : null;
  const nose = alone(leg) && (typeof step.nose === "number" || (edge && !followsOrder(step))) ? noseAt(from, step, t) : null;
  if (point === null || nose === null) {
    doubts.push("order");
  }
  return pose(point, nose);
}

// Доли пути, которые занимает каждый шаг: начало и конец, от 0 до 1. `weigh` —
// вес шага; по умолчанию длина, и тогда остановки и повороты на месте долей не
// занимают.
export function sharesOf(legs: Leg[], weigh: (leg: Leg) => number = (leg) => leg.length): [number, number][] {
  const weights = legs.map((leg) => {
    const weight = weigh(leg);
    if (!(weight >= 0) || !Number.isFinite(weight)) {
      throw new RangeError(`шаг ${leg.index}: вес шага — неотрицательное число, получено ${weight}`);
    }
    return weight;
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!(total > 0)) {
    throw new RangeError("в пути нет ни одного шага с весом: долю не от чего считать");
  }
  if (!Number.isFinite(total)) {
    throw new RangeError("сумма весов шагов не помещается в число");
  }
  let passed = 0;
  return weights.map((weight) => [passed / total, (passed += weight) / total]);
}

// Положение и нос кайта, когда пройдена доля `fraction` пути, от 0 до 1. На
// стыке шагов поза принадлежит следующему шагу; шаг без веса проходится
// мгновенно, и на его месте поза уже учитывает его целиком. `rev` — кайт
// четырёхстропный.
export function poseAt(path: Step[], fraction: number, rev: boolean, weigh?: (leg: Leg) => number): Pose {
  if (!(fraction >= 0 && fraction <= 1)) {
    throw new RangeError(`доля пути — от 0 до 1, получено ${fraction}`);
  }
  const legs = legsOf(path, rev);
  const shares = sharesOf(legs, weigh);
  const index = shares.findIndex(([, to]) => to > fraction);
  if (index < 0) {
    return poseOn(legs[legs.length - 1], 1);
  }
  const [from, to] = shares[index];
  return poseOn(legs[index], (fraction - from) / (to - from));
}

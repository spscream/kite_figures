// Чертёж варианта фигуры: из пути каждого кайта — строки для SVG. Рисунок
// целиком выводится из `data/figures/`; чего в данных нет, того нет и на
// чертеже. Условные обозначения — словарь книги фигур, снятый с её схем
// (графической легенды в книге нет, см. `docs/sources.md`): значок кайта носом
// по курсу на входе, выходе, остановке и вдоль пути, координата — по носу,
// тонкая стрелка рядом с линией у многострочных, подписи «In», «Out», «Stop»,
// дуга со стрелкой и углом у поворота на месте, дуга носа со стрелкой у
// поворота, который сам перемещает кайт, цвета кайтов команды, линии
// сетки только там, где проходит фигура. Модуль ничего не знает про React: он
// считает геометрию, а разметку собирает `components/FigureDiagram.tsx`.
//
// Координаты SVG — та же сетка окна, только `y` перевёрнут: земля внизу, на
// `y = 100`. Дуга «по часовой, как видит пилот» на экране тоже по часовой.

import { arcPoint, GRID, isSwing, pivotOf, type Kite, type Point, type Step, type Variant } from "./geometry";

type Move = Extract<Step, { kind: "line" | "arc" }>;

// Значки чертежа. Первые четыре — значок кайта: вход залит, выход пуст,
// остановка и кайт в пути залиты цветом пути. Остановку от кайта в пути
// отличает подпись «Stop» или «Stall», как в книге.
export const KITE_SHAPES = ["in", "out", "stall", "pass"] as const;
export const SHAPES = [...KITE_SHAPES, "turn", "axel", "derived", "measured"] as const;
export type Shape = (typeof SHAPES)[number];
type KiteShape = (typeof KITE_SHAPES)[number];

// Подпись на чертеже. `name` — крупная: «In», «Out», номер кайта; `note` —
// мелкая: остановка, угол поворота, взлёт и посадка.
export type Label = { x: number; y: number; text: string; tone: string; kind: "name" | "note" };

export type Drawing = {
  viewBox: string;
  // Линия каждого кайта, в порядке кайтов варианта. Там, где кайт перемещён
  // поворотом, линия разорвана: пролёта между этими точками нет.
  tracks: { id: string; d: string }[];
  // Повороты, которые сами перемещают кайт, одним путём: дуга, по которой нос
  // идёт вокруг точки поворота, со стрелкой посередине. Пусто, когда таких нет.
  swings: string;
  // Стрелки направления рядом с линией, по цвету: `in` — первый проход от
  // входа, `out` — последний к выходу, `mid` — остальные. Есть только у
  // многострочных: двухстропный кайт летит носом вперёд, и направление
  // показывает сам значок кайта.
  arrows: { tone: "in" | "out" | "mid"; d: string }[];
  // Вспомогательные линии книги одним путём; пусто, когда книга их не рисует.
  guides: string;
  // Линии сетки: значения, через которые проходит фигура. Края окна и его
  // оси (x = 0, y = 50) сюда не входят: они рисуются всегда.
  grid: { xs: number[]; ys: number[] };
  // Значки по видам; вида, которого в варианте нет, нет и в записи. У значка
  // кайта `tone` — чем красить: `k1`…`k5` у кайтов команды, у одного — пусто.
  shapes: Partial<Record<Shape, { tone: string; d: string }[]>>;
  labels: Label[];
};

// Поля вокруг окна: слева, справа и сверху — под подписи сетки и кайтов,
// снизу — под числа сетки и подписи, которым место под землёй.
const MARGIN = 12;
const WIDTH = GRID.xMax - GRID.xMin;

export const VIEW = { left: GRID.xMin - MARGIN, top: -MARGIN, width: WIDTH + 2 * MARGIN } as const;

// Две цифры после запятой — точность самих данных; «−0» печатается нулём.
function fmt(value: number): string {
  return String(Math.round(value * 100) / 100);
}

const sx = (point: Point) => point[0];
const sy = (point: Point) => GRID.yMax - point[1];
const at = (point: Point) => `${fmt(sx(point))} ${fmt(sy(point))}`;

function length(from: Point, step: Move): number {
  if (step.kind === "line") {
    return Math.hypot(step.to[0] - from[0], step.to[1] - from[1]);
  }
  const radius = Math.hypot(from[0] - step.center[0], from[1] - step.center[1]);
  return (radius * step.sweep * Math.PI) / 180;
}

// Точка на шаге и направление полёта в ней; `t` — доля шага от 0 до 1.
export function along(from: Point, step: Move, t: number): { point: Point; heading: Point } {
  if (step.kind === "line") {
    const dx = step.to[0] - from[0];
    const dy = step.to[1] - from[1];
    const size = Math.hypot(dx, dy);
    return { point: [from[0] + dx * t, from[1] + dy * t], heading: [dx / size, dy / size] };
  }
  const point = arcPoint(from, step.center, step.direction, step.sweep * t);
  const rx = point[0] - step.center[0];
  const ry = point[1] - step.center[1];
  const size = Math.hypot(rx, ry);
  // Касательная: радиус, повёрнутый на четверть оборота в сторону обхода.
  return {
    point,
    heading: step.direction === "ccw" ? [-ry / size, rx / size] : [ry / size, -rx / size],
  };
}

function segment(from: Point, step: Move): string {
  if (step.kind === "line") {
    return `L${at(step.to)}`;
  }
  // Радиус округляется вниз: слишком короткий SVG сам дотягивает до точек
  // дуги, а слишком длинный увёл бы вершину полуоборота в сторону.
  const radius = fmt(Math.floor(Math.hypot(from[0] - step.center[0], from[1] - step.center[1]) * 100) / 100);
  const sweep = step.direction === "cw" ? 1 : 0;
  // Дуга больше полуоборота рисуется двумя половинами: команда SVG не умеет
  // полный круг и неустойчива рядом с ним.
  if (step.sweep > 180) {
    const middle = arcPoint(from, step.center, step.direction, step.sweep / 2);
    return `A${radius} ${radius} 0 0 ${sweep} ${at(middle)}A${radius} ${radius} 0 0 ${sweep} ${at(step.to)}`;
  }
  return `A${radius} ${radius} 0 0 ${sweep} ${at(step.to)}`;
}

// Доли шага, где может встать значок кайта в пути, в порядке предпочтения.
// Первая — не середина: когда кайт возвращается по той же линии, встречные
// значки не ложатся один на другой.
const PASS_AT = [0.6, 0.4, 0.75, 0.25, 0.5, 0.85, 0.15];
// Ближе этого к соседнему значку значок в пути уже лежит на нём.
const TIGHT = 5;
// Стрелка рядом с линией встаёт у середины шага.
const ARROW_AT = [0.5, 0.35, 0.65, 0.25, 0.75];
// Насколько стрелка отстоит от линии — вправо по ходу полёта: встречные
// проходы по одной линии получают стрелки по разные её стороны.
const ARROW_OFF = 4.6;

function gap(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

// Первая из долей шага, вокруг которой свободно, а если тесно везде — та, где
// свободнее всего.
function freest(spots: readonly number[], room: (t: number) => number, enough: number): number {
  return spots.find((t) => room(t) >= enough) ?? spots.reduce((a, b) => (room(b) > room(a) ? b : a));
}

// Куда смотрит нос кайта в точке шага — в координатах окна.
export function noseAt(from: Point, step: Move, t: number): Point {
  const { point, heading } = along(from, step, t);
  if (step.nose === "backward") {
    return [-heading[0], -heading[1]];
  }
  if (typeof step.nose === "number") {
    // Курс: 0 — вверх, 90 — вправо.
    const angle = (step.nose * Math.PI) / 180;
    return [Math.sin(angle), Math.cos(angle)];
  }
  if (step.kind === "arc" && step.nose !== "forward") {
    const rx = point[0] - step.center[0];
    const ry = point[1] - step.center[1];
    const size = Math.hypot(rx, ry) * (step.nose === "out" ? 1 : -1);
    return [rx / size, ry / size];
  }
  return heading;
}

// Вершины значка кайта: сколько вдоль носа (вперёд — плюс) и сколько поперёк.
// Точка значка — нос: координаты в книге даны по носу кайта. Двухстропный —
// дельта: нос, угол крыла, вырез хвоста, второй угол. Четырёхстропный — прямая
// передняя кромка во весь размах (она и есть его нос) и парус за ней,
// сужающийся назад, с неглубоким вырезом посередине задней кромки.
const DELTA: readonly Point[] = [
  [0, 0],
  [-6, 3.3],
  [-4.5, 0],
  [-6, -3.3],
];
// Полуразмах четырёхстропного. Соседи в строю стоят через 10 единиц, и между
// их значками должен оставаться просвет шире обводки.
const REV_HALF = 4.2;
const REV: readonly Point[] = [
  [0, -REV_HALF],
  [0, REV_HALF],
  [-3.4, 2.7],
  [-2.1, 0],
  [-3.4, -2.7],
];
// Те же вершины в координатах окна — чтобы мерить, что значок закрывает.
function outline(point: Point, nose: Point, scale: number, rev: boolean): Point[] {
  const corners = (rev ? REV : DELTA).map(([ahead, aside]): Point => [
    point[0] + (nose[0] * ahead + nose[1] * aside) * scale,
    point[1] + (nose[1] * ahead - nose[0] * aside) * scale,
  ]);
  // Кайт у самой земли стоит на ней, как и на схеме.
  const sunk = sunkBy(point, nose, scale, rev);
  return corners.map(([x, y]): Point => [x, y + sunk]);
}

// На сколько значок в этой точке ушёл бы под землю — на столько он поднят.
function sunkBy(point: Point, nose: Point, scale: number, rev: boolean): number {
  return Math.max(
    0,
    ...(rev ? REV : DELTA).map(([ahead, aside]) => GRID.yMin - (point[1] + (nose[1] * ahead - nose[0] * aside) * scale)),
  );
}

// Лежат ли два контура друг на друге: вершина одного внутри другого либо
// ближе обводки к его стороне, либо стороны пересекаются.
function touching(a: Point[], b: Point[]): boolean {
  const side = (u: Point, v: Point, w: Point) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
  return (
    a.some((corner) => clearOf(corner, b) < 0.4) ||
    b.some((corner) => clearOf(corner, a) < 0.4) ||
    a.some((p, i) => {
      const q = a[(i + 1) % a.length];
      return b.some((u, j) => {
        const v = b[(j + 1) % b.length];
        return side(p, q, u) * side(p, q, v) < 0 && side(u, v, p) * side(u, v, q) < 0;
      });
    })
  );
}

// Расстояние от точки до контура; ноль, когда точка внутри него.
function clearOf(spot: Point, corners: Point[]): number {
  let inside = false;
  let nearest = Infinity;
  corners.forEach((a, index) => {
    const b = corners[(index + 1) % corners.length];
    if (a[1] > spot[1] !== b[1] > spot[1] && spot[0] < a[0] + ((spot[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1])) {
      inside = !inside;
    }
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((spot[0] - a[0]) * dx + (spot[1] - a[1]) * dy) / (dx * dx + dy * dy)));
    nearest = Math.min(nearest, Math.hypot(spot[0] - a[0] - dx * t, spot[1] - a[1] - dy * t));
  });
  return inside ? 0 : nearest;
}

// Сколько места вокруг своей середины занимает значок координаты: круг, в
// который входят и кружок, и квадрат вместе с обводкой.
const DOT_R = 2.5;

// Середина значка позади носа: её занимает тело кайта.
const BODY = { delta: 3, rev: 1.7 } as const;

// Значок вида `name` в точке SVG; `nose` — куда смотрит нос кайта, в
// координатах окна. Этой же функцией рисуется легенда. `rev` —
// четырёхстропный кайт: у него другой силуэт. `ground` — значок на схеме, а
// не в легенде: кайт, стоящий на земле, под землю не уходит, а встаёт на неё.
export function shape(
  name: Shape,
  x: number,
  y: number,
  nose: Point = [0, 1],
  scale = 1,
  rev = false,
  ground = false,
): string {
  const ring = (r: number) =>
    `M${fmt(x - r)} ${fmt(y)}a${r} ${r} 0 1 0 ${fmt(2 * r)} 0a${r} ${r} 0 1 0 ${fmt(-2 * r)} 0`;
  const box = (h: number) => `M${fmt(x - h)} ${fmt(y - h)}h${fmt(2 * h)}v${fmt(2 * h)}h${fmt(-2 * h)}z`;
  switch (name) {
    case "in":
    case "out":
    case "stall":
    case "pass": {
      const corners = (rev ? REV : DELTA).map(([ahead, aside]): Point => [
        x + (nose[0] * ahead + nose[1] * aside) * scale,
        y + (nose[0] * aside - nose[1] * ahead) * scale,
      ]);
      const sunk = ground ? Math.max(0, ...corners.map((corner) => corner[1] - GRID.yMax)) : 0;
      return `M${corners.map((corner) => `${fmt(corner[0])} ${fmt(corner[1] - sunk)}`).join("L")}Z`;
    }
    case "turn":
      return turn(x, y, "cw");
    case "axel":
      return ring(1.6);
    case "derived":
      return ring(1.7);
    case "measured":
      return box(1.5);
  }
}

// Поворот на месте: дуга-шапка со стрелкой на конце, под ней — угол. Точка —
// середина знака в координатах SVG: дуга над ней, подпись под ней.
const TURN_R = 3.4;
function turn(x: number, y: number, direction: "cw" | "ccw"): string {
  // Дуга идёт через верх от одного края к другому; стрелка — на том конце,
  // куда кайт поворачивается.
  const ends = [195, -15].map((degrees) => {
    const angle = (degrees * Math.PI) / 180;
    return [x + TURN_R * Math.cos(angle), y - TURN_R * Math.sin(angle)] as const;
  });
  const [from, to] = direction === "cw" ? ends : [ends[1], ends[0]];
  const sweep = direction === "cw" ? 1 : 0;
  // Наконечник — два уса от конца дуги назад вдоль неё.
  const back = direction === "cw" ? 1 : -1;
  const whisker = (dx: number, dy: number) => `M${fmt(to[0] + dx * back)} ${fmt(to[1] + dy)}L${fmt(to[0])} ${fmt(to[1])}`;
  return (
    `M${fmt(from[0])} ${fmt(from[1])}A${TURN_R} ${TURN_R} 0 1 ${sweep} ${fmt(to[0])} ${fmt(to[1])}` +
    whisker(-1.9, -0.9) +
    whisker(0.9, -1.9)
  );
}

// Тонкая стрелка рядом с линией шага: древко вдоль шага и наконечник.
function sideArrow(from: Point, step: Move, t: number): { d: string; spots: Point[] } {
  const total = length(from, step);
  const size = Math.max(3, Math.min(12, total * 0.5));
  // У дуги по часовой «справа по ходу» — это внутрь, к центру. В малом круге
  // стрелке там негде уместиться, и она встаёт снаружи.
  const off = step.kind === "arc" && step.direction === "cw" && gap(from, step.center) < ARROW_OFF + 5 ? -ARROW_OFF : ARROW_OFF;
  const aside = (u: number): Point => {
    const { point, heading } = along(from, step, Math.max(0, Math.min(1, u)));
    return [point[0] + heading[1] * off, point[1] - heading[0] * off];
  };
  const half = size / 2 / total;
  // Дуга ведётся ломаной: стрелка идёт рядом с ней, тем же изгибом.
  const count = step.kind === "arc" ? 6 : 1;
  const shaft = Array.from({ length: count + 1 }, (_, index) => aside(t - half + (2 * half * index) / count));
  const tip = shaft[shaft.length - 1];
  const [hx, hy] = along(from, step, Math.min(1, t + half)).heading;
  const base: Point = [tip[0] - hx * 2.6, tip[1] - hy * 2.6];
  const left: Point = [base[0] - hy * 1.1, base[1] + hx * 1.1];
  const right: Point = [base[0] + hy * 1.1, base[1] - hx * 1.1];
  return {
    // Древко пройдено туда и обратно: у ломаной нет площади, и заливка наконечника её не закрасит.
    d: `M${[...shaft, ...shaft.slice(0, -1).reverse()].map(at).join("L")}M${at(tip)}L${at(left)}L${at(right)}Z`,
    spots: [aside(t - half), aside(t), tip],
  };
}

const LANDING: Record<string, string> = {
  "two-point": "2-point landing",
  "snap-two-point": "Snap landing",
  "stall-two-point": "Stall landing",
  "spin-two-point": "Spin landing",
  "leading-edge": "Leading-edge landing",
  belly: "Belly landing",
};

// Подпись остановки — словами книги: у двухстропных «Stall», у
// многострочных «Stop».
function stopText(style: string | undefined, rev: boolean): string {
  if (style === "snap") {
    return "Snap Stall";
  }
  if (style === "push") {
    return "Push Stall";
  }
  return rev ? "Stop" : "Stall";
}

// Слова, которыми схема подписывает события; легенда переводит те, что
// встретились на схеме.
export const WORDS: Record<string, string> = {
  Stop: "остановка",
  Stall: "остановка",
  "Snap Stall": "остановка рывком",
  "Push Stall": "остановка толчком",
  Launch: "взлёт",
  Landing: "посадка",
  "2-point landing": "посадка на две точки",
  "Snap landing": "посадка рывком на две точки",
  "Stall landing": "посадка из остановки на две точки",
  "Spin landing": "посадка с вращением на две точки",
  "Leading-edge landing": "посадка на переднюю кромку",
  "Belly landing": "посадка на живот",
  Axel: "аксель",
  "½ Axel": "половина акселя",
};

// Слово подписи без номера: «Stop #2» — это «Stop».
export function wordOf(text: string): string {
  return text.replace(/ #\d+$/, "");
}

// Полуширина подписи в единицах сетки: крупная — жирным в 6 единиц, мелкая —
// обычным в 4,6.
const halfOf = (text: string, kind: Label["kind"]) => text.length * (kind === "name" ? 1.9 : 1.25);

// `rev` — фигура для четырёхстропного кайта (разделы Multi-line).
export function drawVariant(variant: Variant, rev = false): Drawing {
  const solo = variant.kites.length === 1;
  const shapes: Drawing["shapes"] = {};
  const put = (name: Shape, tone: string, d: string) => {
    const list = (shapes[name] ??= []);
    const same = list.find((item) => item.tone === tone);
    if (same) {
      same.d += d;
    } else {
      list.push({ tone, d });
    }
  };
  // Точки, занятые значками: их обходят значки в пути, стрелки и подписи.
  const busy: Point[] = [];
  // Место, занятое значком кайта: нос, середина тела и, у четырёхстропного,
  // концы передней кромки — она шире всего остального на схеме.
  const body = (point: Point, nose: Point): Point[] => {
    const back = rev ? BODY.rev : BODY.delta;
    const middle: Point = [point[0] - nose[0] * back, point[1] - nose[1] * back];
    const tips: Point[] = rev
      ? [
          [point[0] + nose[1] * REV_HALF, point[1] - nose[0] * REV_HALF],
          [point[0] - nose[1] * REV_HALF, point[1] + nose[0] * REV_HALF],
        ]
      : [];
    return [point, middle, ...tips];
  };
  // Значки кайта рисуются после обхода всех кайтов: их вид зависит от того,
  // что ещё стоит в той же точке.
  type Glyph = { name: KiteShape; point: Point; nose: Point; tone: string; kite: number };
  const glyphs: Glyph[] = [];
  // Остановки, у которых метка уже стоит: кайт, точка и курс до градуса.
  const stoodAt = new Set<string>();
  const glyph = (item: Glyph) => {
    glyphs.push(item);
    busy.push(...body(item.point, item.nose));
  };
  const marks: { basis: "derived" | "measured"; point: Point }[] = [];
  // Шаги с направлением: им нужен знак направления. Шаг `unmarked` сюда не
  // попадает — книга его направления не показывает, не показывает и схема.
  const flown: { from: Point; step: Move; kite: number; tone: string; edge: "in" | "out" | "mid" }[] = [];
  const traces: Point[][] = [];
  // Что подписать рядом с точкой: остановки, акселя, повороты.
  // `spots` — места подписи по порядку предпочтения, когда они у неё свои.
  const notes: { point: Point; text: string; turn?: "cw" | "ccw"; spots?: (half: number) => Point[] }[] = [];
  let swings = "";
  // Что подписать под землёй: взлёты и посадки.
  const grounded: { point: Point; text: string }[] = [];
  const wanted: { point: Point; toward: Point; text: string; tone: string; side?: -1 | 1 }[] = [];

  // Значения сетки, через которые проходит фигура: концы шагов, стоящие на
  // линиях сетки, и крайние точки дуг, если они пришлись на круглое число.
  const xs = new Set<number>();
  const ys = new Set<number>();
  const onGrid = (basis: string, point: Point) => {
    if (basis === "grid") {
      xs.add(point[0]);
      ys.add(point[1]);
    }
  };
  const extremes = (from: Point, step: Move) => {
    // Дуга, снятая замером, проходит между подписанными линиями: её край
    // линию сетки не даёт, как не даёт и её конец.
    if (step.kind !== "arc" || step.basis === "measured") {
      return;
    }
    const [cx, cy] = step.center;
    const radius = Math.hypot(from[0] - cx, from[1] - cy);
    const begin = (Math.atan2(from[1] - cy, from[0] - cx) * 180) / Math.PI;
    for (const angle of [0, 90, 180, 270]) {
      const swept = step.direction === "ccw" ? angle - begin : begin - angle;
      if (((swept % 360) + 360) % 360 > step.sweep + 0.01) {
        continue;
      }
      const value = angle % 180 === 0 ? cx + (angle === 0 ? radius : -radius) : cy + (angle === 90 ? radius : -radius);
      const round5 = Math.round(value / 5) * 5;
      if (Math.abs(value - round5) < 0.01) {
        (angle % 180 === 0 ? xs : ys).add(round5);
      }
    }
  };

  const tracks: Drawing["tracks"] = [];

  const offGrid = (basis: string, point: Point) => {
    if (basis === "derived" || basis === "measured") {
      marks.push({ basis, point });
    }
  };

  variant.kites.forEach((kite, order) => {
    let here: Point = [0, 0];
    let heading: Point = [1, 0];
    // Нос кайта в точке, куда привёл последний шаг.
    let nose: Point = [0, 1];
    let d = "";
    const tone = solo ? "" : `k${(order % 5) + 1}`;
    const moves = kite.path.filter((step): step is Move => step.kind === "line" || step.kind === "arc");
    // Остановки нумеруются, когда их у кайта несколько: номер даёт порядок
    // проходов там, где линия пройдена дважды.
    const stops = kite.path.filter((step) => step.kind === "mark" && step.mark === "stall").length;
    let stop = 0;
    kite.path.forEach((step, index) => {
      switch (step.kind) {
        case "start":
          here = step.at;
          d = `M${at(here)}`;
          offGrid(step.basis, here);
          onGrid(step.basis, here);
          break;
        case "line":
        case "arc": {
          d += segment(here, step);
          const count = Math.max(2, Math.ceil(length(here, step) / 3));
          traces.push(Array.from({ length: count + 1 }, (_, i) => along(here, step, i / count).point));
          if (!step.unmarked) {
            const edge = !solo ? "mid" : step === moves[0] ? "in" : step === moves[moves.length - 1] ? "out" : "mid";
            flown.push({ from: here, step, kite: order, tone, edge });
          }
          extremes(here, step);
          heading = along(here, step, 1).heading;
          nose = noseAt(here, step, 1);
          here = step.to;
          offGrid(step.basis, here);
          onGrid(step.basis, here);
          break;
        }
        case "rotate": {
          const text = `${fmt(step.degrees).replace(".", ",")}°`;
          if (isSwing(step)) {
            // Поворот сам переносит кайт: нос идёт по дуге вокруг точки
            // поворота, а она следует из смещения, угла и стороны. Линия пути
            // здесь рвётся — прямой между этими точками кайт не летит.
            const center = pivotOf(here, step.to, step.direction, step.degrees);
            const arc: Move = { kind: "arc", to: step.to, center, direction: step.direction, sweep: step.degrees, basis: "grid", nose: "forward" };
            const end = along(here, arc, 1);
            // Стрелка — посередине дуги: её концы заняты значками координат.
            const tip = along(here, arc, 0.5);
            const whisker = (aside: number): Point => [
              tip.point[0] - tip.heading[0] * 1.9 + tip.heading[1] * aside,
              tip.point[1] - tip.heading[1] * 1.9 - tip.heading[0] * aside,
            ];
            swings += `M${at(here)}${segment(here, arc)}M${at(whisker(1))}L${at(tip.point)}L${at(whisker(-1))}`;
            const count = Math.max(2, Math.ceil(length(here, arc) / 3));
            traces.push(Array.from({ length: count + 1 }, (_, i) => along(here, arc, i / count).point));
            // Угол — снаружи дуги, у её середины.
            const middle = tip.point;
            const radius = gap(middle, center);
            const out: Point = [(middle[0] - center[0]) / radius, (middle[1] - center[1]) / radius];
            notes.push({
              point: middle,
              text,
              spots: (half) => [
                ...[3.5, 6].map((far): Point => [middle[0] + out[0] * (far + half), middle[1] + out[1] * far]),
                ...around(middle, 7, half),
              ],
            });
            busy.push(middle, step.to);
            heading = end.heading;
            here = step.to;
            d += `M${at(here)}`;
            offGrid(step.basis ?? "grid", here);
            onGrid(step.basis ?? "grid", here);
          } else {
            notes.push({ point: here, text, turn: step.direction });
          }
          // Поворот на месте разворачивает нос: по часовой курс растёт.
          const angle = ((step.direction === "cw" ? step.degrees : -step.degrees) * Math.PI) / 180;
          nose = [
            nose[0] * Math.cos(angle) + nose[1] * Math.sin(angle),
            nose[1] * Math.cos(angle) - nose[0] * Math.sin(angle),
          ];
          break;
        }
        case "mark": {
          const next = nextMove(kite, index);
          if (step.mark === "in") {
            // Подпись входа — позади кайта, откуда он пришёл бы: туда линия
            // фигуры не идёт.
            const ahead = next ? along(here, next, 0).heading : heading;
            glyph({ name: "in", point: here, nose: next ? noseAt(here, next, 0) : nose, tone, kite: order });
            const toward: Point = [-ahead[0], -ahead[1]];
            if (!solo) {
              wanted.push({ point: here, toward, text: `#${kite.id}`, tone: `t-${tone}` });
            }
            // «In» и «Out» у команды книга ставит один раз, у первого кайта.
            if (order === 0) {
              wanted.push({ point: here, toward, text: "In", tone: "t-in", side: 1 });
            }
          } else if (step.mark === "out") {
            glyph({ name: "out", point: here, nose, tone, kite: order });
            if (!solo) {
              wanted.push({ point: here, toward: heading, text: `#${kite.id}`, tone: `t-${tone}` });
            }
            if (order === 0) {
              wanted.push({ point: here, toward: heading, text: "Out", tone: "t-out", side: -1 });
            }
          } else if (step.mark === "launch") {
            grounded.push({ point: here, text: "Launch" });
          } else if (step.mark === "landing") {
            grounded.push({ point: here, text: (step.style && LANDING[step.style]) || "Landing" });
          } else if (step.mark === "stall") {
            stop += 1;
            // Кайт в остановке стоит так, как его рисует в этой точке книга:
            // курс метки записан в данных и из пути не выводится. Где книга
            // метки не рисует, нет её и здесь — остаётся подпись. Две
            // остановки в одной точке с одним курсом — одна метка, как в книге.
            if (typeof step.nose === "number") {
              const angle = (step.nose * Math.PI) / 180;
              const stood: Point = [Math.sin(angle), Math.cos(angle)];
              const key = `${order} ${at(here)} ${Math.round(step.nose) % 360}`;
              if (!stoodAt.has(key)) {
                stoodAt.add(key);
                glyph({ name: "stall", point: here, nose: stood, tone, kite: order });
              }
            }
            notes.push({ point: here, text: stopText(step.style, rev) + (solo && stops > 1 ? ` #${stop}` : "") });
          } else {
            put("axel", "", shape("axel", sx(here), sy(here)));
            busy.push(here);
            notes.push({ point: here, text: step.mark === "axel" ? "Axel" : "½ Axel" });
          }
          break;
        }
      }
    });
    tracks.push({ id: kite.id, d });
  });

  // Вспомогательная линия — не путь: значков и стрелок на ней нет, но подписи
  // и стрелки её обходят, как обходят линии кайтов.
  const guides =
    variant.guides.status === "ok"
      ? variant.guides.lines
          .map(({ from, to }) => {
            const count = Math.max(2, Math.ceil(gap(from, to) / 3));
            traces.push(
              Array.from({ length: count + 1 }, (_, i): Point => [
                from[0] + ((to[0] - from[0]) * i) / count,
                from[1] + ((to[1] - from[1]) * i) / count,
              ]),
            );
            return `M${at(from)}L${at(to)}`;
          })
          .join("")
      : "";

  // Выход в точке, где уже стоит вход или остановка, рисуется крупнее: иначе
  // один значок закрыл бы другой. Когда они смотрят в одну сторону, выход
  // обводит их кольцом со всех сторон: кольцо нигде не уже 0,8 единицы, а
  // спереди и с боков шире 1,3 — на экране в 390 пикселей это от полутора до
  // двух пикселей. Нос такого выхода вынесен вперёд на ширину кольца; сама
  // точка — под ним. У земли кольцо встаёт на неё, а значок внутри поднят
  // вместе с ним и остаётся в его середине. Значки, которые смотрят в разные
  // стороны, различает сам курс: выход лишь немного крупнее.
  // Значки и их места на схеме: по ним встают значки координат и кайты в пути.
  const drawnGlyphs: Point[][] = [];
  const facing = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1] > 0.99;
  const beneath = (item: Glyph) => glyphs.filter((other) => other.name !== "out" && gap(other.point, item.point) < 1);
  const ringed = (item: Glyph) => item.name === "out" && beneath(item).length > 0 && beneath(item).every((other) => facing(other.nose, item.nose));
  const RING = rev ? { lead: 1.6, scale: 2.2 } : { lead: 2.8, scale: 2.1 };
  const tipOf = ({ point, nose }: Glyph): Point => [point[0] + nose[0] * RING.lead, point[1] + nose[1] * RING.lead];
  for (const item of glyphs) {
    const { name, point, nose, tone } = item;
    if (ringed(item)) {
      const tip = tipOf(item);
      put(name, tone, shape(name, sx(tip), sy(tip), nose, RING.scale, rev, true));
      drawnGlyphs.push(outline(tip, nose, RING.scale, rev));
      continue;
    }
    // Значок внутри кольца поднят над землёй на столько же, на сколько кольцо.
    const ring = name === "out" ? undefined : glyphs.find((other) => ringed(other) && gap(other.point, point) < 1);
    const lift = ring ? sunkBy(tipOf(ring), ring.nose, RING.scale, rev) : 0;
    const spot: Point = [point[0], point[1] + lift];
    const scale = name === "out" && beneath(item).length > 0 ? 1.35 : 1;
    put(name, tone, shape(name, sx(spot), sy(spot), nose, scale, rev, true));
    drawnGlyphs.push(outline(spot, nose, scale, rev));
  }
  // Значок происхождения координаты в точке со значком кайта встаёт за его
  // хвостом: поверх он стёр бы разницу между залитым входом и пустым выходом.
  const marked = new Set<string>();
  // Середины значков координат: кайт в пути и знак поворота на них не ложатся.
  // Сами значки рисуются после кайтов в пути: на коротком шаге, где кайту
  // некуда встать, отходит в сторону значок координаты.
  const dots: Point[] = [];
  const placed: { basis: "derived" | "measured"; point: Point; spot: Point }[] = [];
  const tail = rev ? 6 : 8.6;
  const origins = new Set<string>();
  for (const { basis, point } of marks) {
    // Точка, записанная в пути дважды, получает один значок.
    if (origins.has(`${basis} ${at(point)}`)) {
      continue;
    }
    origins.add(`${basis} ${at(point)}`);
    const under = glyphs.find((other) => gap(other.point, point) < 0.5);
    // У земли за хвостом места нет — там числа сетки; значок встаёт сбоку.
    const nose = under?.nose ?? [0, 0];
    const sides: Point[] = [nose, [nose[1], -nose[0]], [-nose[1], nose[0]]];
    const spots = sides.map(([bx, by]): Point => [point[0] - bx * tail, point[1] - by * tail]);
    let spot = spots[0][1] >= 2 ? spots[0] : (spots.slice(1).find((candidate) => candidate[1] >= 0) ?? spots[0]);
    // За хвостом своего кайта может стоять сосед по строю: тогда значок
    // отходит дальше за хвост или вбок — туда, где он не ляжет ни на один кайт.
    const free = (candidate: Point) =>
      candidate[1] >= 2 && Math.abs(candidate[0]) <= GRID.xMax && drawnGlyphs.every((corners) => clearOf(candidate, corners) >= DOT_R);
    if (under && !free(spot)) {
      const further = [1, 1.5, 2, 2.5].flatMap((far) =>
        sides.map(([bx, by]): Point => [point[0] - bx * tail * far, point[1] - by * tail * far]),
      );
      spot = further.find((candidate) => free(candidate) && !marked.has(`${basis} ${at(candidate)}`)) ?? spot;
    }
    if (marked.has(`${basis} ${at(spot)}`)) {
      continue;
    }
    // В точку пришли два шага с разным происхождением: значки встают рядом,
    // а не один поверх другого.
    if (marked.has(`${basis === "derived" ? "measured" : "derived"} ${at(spot)}`)) {
      marked.add(`${basis} ${at(spot)}`);
      spot = [spot[0] + 3.6, spot[1]];
    }
    marked.add(`${basis} ${at(spot)}`);
    placed.push({ basis, point, spot });
    dots.push(spot);
  }

  // Значок кайта в пути: нос показывает, куда кайт смотрит на этом шаге, а у
  // двухстропного — и куда он летит. Шагу, у начала или конца которого уже
  // стоит значок этого кайта с тем же носом, второй не нужен.
  type Pass = { from: Point; step: (typeof flown)[number]["step"]; tone: string; scale: number; t: number };
  const passes: Pass[] = [];
  for (const { from, step, kite, tone } of flown) {
    const shown = ([end, t]: readonly [Point, number]) =>
      glyphs.some((other) => {
        const nose = noseAt(from, step, t);
        return other.kite === kite && gap(other.point, end) < 0.5 && other.nose[0] * nose[0] + other.nose[1] * nose[1] > 0.99;
      });
    if (shown([from, 0]) || shown([step.to, 1])) {
      continue;
    }
    // На шаге короче самого значка он уменьшается вместе с ним.
    passes.push({ from, step, tone, scale: Math.max(0.6, Math.min(1, length(from, step) / 8)), t: PASS_AT[0] });
  }
  const settled = busy.slice();
  const standing = drawnGlyphs.slice();
  const bodyOf = (pass: Pass) => body(along(pass.from, pass.step, pass.t).point, noseAt(pass.from, pass.step, pass.t));
  const choose = ({ from, step, scale }: Pass, others: Point[]) => {
    const room = (t: number) => Math.min(...others.map((other) => gap(other, along(from, step, t).point)), 50);
    // Значок не ложится на значок координаты: место — первое свободное из
    // тех, где он его не задевает, а на шаге, где таких мест нет, — то, где до
    // значка координаты дальше всего.
    // Так же он обходит вход, выход и остановку: место, где он лёг бы на один
    // из них, считается занятым.
    const clear = (t: number) => {
      const own = outline(along(from, step, t).point, noseAt(from, step, t), scale, rev);
      return standing.some((other) => touching(own, other)) ? 0 : Math.min(...dots.map((dot) => clearOf(dot, own)), 50);
    };
    const anywhere = Array.from({ length: 17 }, (_, index) => 0.1 + index * 0.05);
    // Сперва привычные места; в тесноте, где ни одно из них не свободно, —
    // любое место шага, где до соседних значков дальше всего.
    const open = PASS_AT.filter((spot) => clear(spot) >= DOT_R);
    const wider = [...PASS_AT, ...anywhere].filter((spot) => clear(spot) >= DOT_R);
    return open.some((spot) => room(spot) >= 7) || wider.length === 0
      ? open.length > 0
        ? freest(open, room, 7)
        : anywhere.reduce((best, spot) => (clear(spot) > clear(best) + 0.01 ? spot : best), freest(PASS_AT, room, 7))
      : wider.reduce((best, spot) => (room(spot) > room(best) + 0.01 ? spot : best));
  };
  // Первый проход ставит значки по очереди, и ранний не знает о поздних: на
  // общем отрезке строя он занимает середину, а остальным остаются края. Два
  // следующих прохода переставляют каждый значок, уже видя все остальные.
  // Значкам, которым и после этого тесно, места на отрезке не хватает вовсе:
  // они уменьшаются, как на коротком шаге, и встают заново.
  for (let round = 0; round < 5; round += 1) {
    passes.forEach((pass, index) => {
      const others = [
        ...settled,
        ...passes.filter((other, at) => (round === 0 ? at < index : at !== index)).flatMap(bodyOf),
      ];
      pass.t = choose(pass, others);
      const { point } = along(pass.from, pass.step, pass.t);
      if (round === 2 && Math.min(...others.map((other) => gap(other, point)), 50) < TIGHT) {
        pass.scale = Math.min(pass.scale, 0.7);
      }
    });
  }
  for (const pass of passes) {
    const { point } = along(pass.from, pass.step, pass.t);
    const nose = noseAt(pass.from, pass.step, pass.t);
    put("pass", pass.tone, shape("pass", sx(point), sy(point), nose, pass.scale, rev, true));
    busy.push(...body(point, nose));
    drawnGlyphs.push(outline(point, nose, pass.scale, rev));
  }

  // Значок координаты, на который всё же лёг кайт, отходит от своей точки —
  // туда, где не задевает ни кайтов, ни других значков координат; сперва
  // ближе, потом дальше. Не нашлось места — остаётся, где был.
  placed.forEach((item, index) => {
    const hit = (spot: Point) => drawnGlyphs.some((corners) => clearOf(spot, corners) < DOT_R);
    if (hit(item.spot)) {
      const others = dots.filter((_, at) => at !== index);
      const moved = [4.5, 6, 7.5, 9]
        .flatMap((far) =>
          [45, 135, 225, 315, 90, 270, 0, 180].map((degrees): Point => {
            const angle = (degrees * Math.PI) / 180;
            return [item.point[0] + far * Math.cos(angle), item.point[1] + far * Math.sin(angle)];
          }),
        )
        .find(
          (spot) =>
            spot[1] >= 2 &&
            spot[1] <= GRID.yMax - 2 &&
            Math.abs(spot[0]) <= GRID.xMax - 2 &&
            !hit(spot) &&
            others.every((other) => gap(other, spot) >= 2 * DOT_R),
        );
      if (moved) {
        item.spot = moved;
        dots[index] = moved;
      }
    }
    put(item.basis, "", shape(item.basis, sx(item.spot), sy(item.spot)));
    busy.push(item.spot);
  });

  // Стрелки — многострочным: там кайт летит и боком, и задом, и значок
  // кайта направления полёта не показывает. У двухстропного стрелку получает
  // только шаг, который он летит не носом вперёд.
  const lines = traces.flat();
  const arrows: Drawing["arrows"] = [];
  {
    for (const { from, step, edge } of flown) {
      if (!rev && step.nose === "forward") {
        continue;
      }
      const room = (t: number) =>
        Math.min(
          ...sideArrow(from, step, t).spots.flatMap((spot) => [
            ...busy.map((other) => gap(other, spot)),
            ...lines.map((other) => gap(other, spot)),
          ]),
          50,
        );
      // Своя линия — в `ARROW_OFF` от стрелки; теснее этого быть не должно.
      const { d, spots } = sideArrow(from, step, freest(ARROW_AT, room, ARROW_OFF - 0.2));
      busy.push(...spots);
      const same = arrows.find((item) => item.tone === edge);
      if (same) {
        same.d += d;
      } else {
        arrows.push({ tone: edge, d });
      }
    }
  }

  // Подписи ставятся последними и обходят всё уже нарисованное: значки,
  // стрелки, линии и друг друга.
  // Числа сетки у рамки тоже заняты: слева — высоты, под землёй — расстояния.
  const taken: { spot: Point; half: number }[] = [
    ...[...ys, 50].map((y) => ({ spot: [GRID.xMin - 6, y] as Point, half: 4 })),
    ...[...xs, 0].map((x) => ({ spot: [x, -7.5] as Point, half: 3 })),
  ];
  // Расстояние от препятствия до подписи — до отрезка во всю её ширину.
  const reachTo = (other: Point, [x, y]: Point, width: number) =>
    Math.hypot(Math.max(Math.abs(other[0] - x) - width, 0), other[1] - y);
  // `own` — считать препятствием и значок в самой точке: знаку поворота под
  // ним не место, а слово подписи встаёт к нему вплотную.
  const roomAt = (point: Point, spot: Point, half: number, own = false) =>
    Math.min(
      ...busy.filter((other) => own || gap(other, point) > 0.5).map((other) => reachTo(other, spot, half)),
      ...(own ? dots.map((other) => reachTo(other, spot, half) - DOT_R) : []),
      ...lines.filter((other) => gap(other, point) > 4).map((other) => reachTo(other, spot, half)),
      ...taken.map((other) => reachTo(other.spot, spot, half + other.half)),
      50,
    );
  const fits = ([x, y]: Point, half: number) =>
    y >= 2 && y <= GRID.yMax + MARGIN - 4 && Math.abs(x) + half <= GRID.xMax + MARGIN;
  // Лучшее из мест вокруг точки: первое свободное, иначе самое свободное.
  // `tall` — знак поворота: он занимает место и над серединой (дуга), и под
  // ней (угол), и свободным должно быть всё оно, со значком в самой точке.
  const settle = (point: Point, spots: Point[], half: number, tall = false): Point => {
    const open = spots.filter((spot) => fits(spot, half));
    const space = (spot: Point) =>
      tall
        ? Math.min(...[3.4, 0, -3.4].map((dy) => roomAt(point, [spot[0], spot[1] + dy], half, true)))
        : roomAt(point, spot, half);
    const best =
      (tall ? undefined : open.find((spot) => space(spot) >= 4)) ??
      open.reduce((a, b) => (space(b) > space(a) + 0.01 ? b : a), open[0] ?? spots[0]);
    // Подпись у самого края окна сдвигается внутрь поля, а не обрезается.
    const edge = GRID.xMax + MARGIN - half;
    const placed: Point = [Math.max(-edge, Math.min(edge, best[0])), best[1]];
    taken.push({ spot: placed, half });
    return placed;
  };
  const around = (point: Point, reach: number, half: number): Point[] =>
    (
      [
        [1, 0.45],
        [-1, 0.45],
        [0, 1],
        [1, -0.45],
        [-1, -0.45],
        [0, -1],
        [1, 1],
        [-1, 1],
        [1, 1.4],
        [-1, 1.4],
        [1, -1.4],
        [-1, -1.4],
        [0, 1.8],
        [0, -1.8],
      ] as const
    ).map(([ux, uy]) => [point[0] + ux * (reach + half), point[1] + uy * reach]);

  // Подписи под землёй встают строками: в строке подписи не пересекаются,
  // первая строка под землёй занята числами сетки.
  const rows: { x: number; half: number; text: string }[][] = [];
  let bottom = GRID.yMax + 10;
  const below = (x: number, text: string, kind: Label["kind"]): { x: number; y: number } | null => {
    const half = halfOf(text, kind);
    // Одинаковые подписи соседних кайтов сливаются в одну, как в книге.
    if (kind === "note" && rows.flat().some((other) => other.text === text && Math.abs(other.x - x) < 30)) {
      return null;
    }
    const edge = GRID.xMax + MARGIN - half;
    const cx = Math.max(-edge, Math.min(edge, x));
    let row = rows.findIndex((items) => items.every((other) => Math.abs(other.x - cx) >= other.half + half + 2));
    if (row < 0) {
      row = rows.push([]) - 1;
    }
    rows[row].push({ x: cx, half, text });
    const y = GRID.yMax + 8 + 6.5 * (row + 1);
    bottom = Math.max(bottom, y + 4);
    return { x: round(cx), y: round(y) };
  };

  const labels: Label[] = [];

  // Повороты и остановки. У команды одинаковый знак соседних кайтов ставится
  // один раз на группу, как в книге.
  const placedNotes: { point: Point; text: string }[] = [];
  // Сперва слова — им место справа от точки, как в книге; знак поворота
  // встаёт потом туда, где осталось свободно.
  for (const { point, text, turn: direction, spots } of [...notes.filter((note) => !note.turn), ...notes.filter((note) => note.turn)]) {
    const key = direction ? `${direction} ${text}` : spots ? `swing ${text}` : text;
    if (!solo && placedNotes.some((other) => other.text === key && gap(other.point, point) < 16)) {
      continue;
    }
    placedNotes.push({ point, text: key });
    if (direction) {
      // Знак встаёт туда, где вокруг точки свободнее всего: у вершины это
      // угол, в который не уходит ни одна из её линий.
      const spot = settle(
        point,
        (
          [
            [0.8, 0.8],
            [-0.8, 0.8],
            [0.8, -0.8],
            [-0.8, -0.8],
            [0, 1.1],
            [1.1, 0],
            [-1.1, 0],
            [0, -1.1],
          ] as const
        ).flatMap(([ux, uy]) => [8.5, 12.5].map((far): Point => [point[0] + ux * far, point[1] + uy * far])),
        TURN_R + 1.5,
        true,
      );
      // Знак выше подписи: дуга занимает место над серединой, угол — под ней.
      taken.push({ spot: [spot[0], spot[1] + 3], half: TURN_R + 1 }, { spot: [spot[0], spot[1] - 3], half: TURN_R + 1 });
      put("turn", "", turn(sx(spot), sy(spot) - 1.2, direction));
      busy.push(spot, [spot[0], spot[1] + 3]);
      labels.push({ x: round(sx(spot)), y: round(sy(spot) + 2.6), text, tone: "", kind: "note" });
    } else {
      const half = halfOf(text, "note");
      const spot = settle(point, spots ? spots(half) : around(point, 7, half), half);
      labels.push({ x: round(sx(spot)), y: round(sy(spot)), text, tone: "", kind: "note" });
    }
  }

  // «In», «Out» и номера кайтов. Первое место — на продолжении линии (позади
  // входа, впереди выхода), дальше — сбоку и наискось: когда кайты идут
  // колонной или выходят навстречу, продолжение линии занято соседом.
  const reach = 7;
  for (const { point, toward: [tx, ty], text, tone, side } of wanted) {
    const half = halfOf(text, "name");
    const spot = (ux: number, uy: number): Point => {
      const size = Math.hypot(ux, uy);
      return [point[0] + (ux / size) * (reach + half), point[1] + (uy / size) * reach];
    };
    const first = spot(tx, ty);
    if (first[1] < 1) {
      // У земли книга ставит «In» справа от кайта, «Out» — слева; под землю
      // подпись уходит, только когда рядом занято.
      const beside = [reach, reach + 6]
        .map((far): Point => [point[0] + (side ?? 1) * (far + half), point[1] + 4.5])
        .find((spot) => fits(spot, half) && roomAt(point, spot, half) >= 3.5);
      if (side && beside) {
        taken.push({ spot: beside, half });
        labels.push({ x: round(sx(beside)), y: round(sy(beside)), text, tone, kind: "name" });
        continue;
      }
      const under = below(point[0], text, "name")!;
      labels.push({ ...under, text, tone, kind: "name" });
      continue;
    }
    const placed = settle(point, [first, spot(-ty, tx), spot(ty, -tx), spot(tx - ty, ty + tx), spot(tx + ty, ty - tx)], half);
    labels.push({ x: round(sx(placed)), y: round(sy(placed)), text, tone, kind: "name" });
  }

  for (const { point, text } of grounded) {
    const under = below(point[0], text, "note");
    if (under) {
      labels.push({ ...under, text, tone: "", kind: "note" });
    }
  }

  return {
    viewBox: `${VIEW.left} ${VIEW.top} ${VIEW.width} ${fmt(bottom - VIEW.top)}`,
    tracks,
    swings,
    arrows,
    guides,
    grid: {
      xs: [...xs].filter((x) => x !== 0 && Math.abs(x) < GRID.xMax).sort((a, b) => a - b),
      ys: [...ys].filter((y) => y !== 50 && y > GRID.yMin && y < GRID.yMax).sort((a, b) => a - b),
    },
    shapes,
    labels,
  };
}

function round(value: number): number {
  return Number(fmt(value));
}

// Ближайший пролёт из этой же точки. За поворотом со смещением пролёт
// начинается уже в другой точке, и курса отсюда он не задаёт.
function nextMove(kite: Kite, after: number): Move | undefined {
  const next = kite.path.slice(after + 1).find((step) => step.kind === "line" || step.kind === "arc" || isSwing(step));
  return next?.kind === "line" || next?.kind === "arc" ? next : undefined;
}

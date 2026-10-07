// Чертёж варианта фигуры: из пути каждого кайта — строки для SVG. Рисунок
// целиком выводится из `data/figures/`; чего в данных нет, того нет и на
// чертеже. Условные обозначения — как в книге фигур: значок кайта носом по
// курсу на входе, выходе и остановке, подписи «In» и «Out», цвета кайтов
// команды, линии сетки только там, где проходит фигура. Модуль ничего не знает про React: он считает геометрию, а
// разметку собирает `components/FigureDiagram.tsx`.
//
// Координаты SVG — та же сетка окна, только `y` перевёрнут: земля внизу, на
// `y = 100`. Дуга «по часовой, как видит пилот» на экране тоже по часовой.

import { arcPoint, GRID, type Kite, type Point, type Step, type Variant } from "./geometry";

type Move = Extract<Step, { kind: "line" | "arc" }>;

// Значки чертежа. Вход, выход и остановка — значок кайта: залитый, пустой и
// с чертой перед носом, так что они различаются и без цвета. Остальные формы
// подобраны так, чтобы читаться вложенными друг в друга: в данных остановка
// и поворот, взлёт и посадка то и дело приходятся на одну точку.
export const SHAPES = [
  "in",
  "out",
  "stall",
  "turn",
  "axel",
  "launch",
  "landing",
  "derived",
  "measured",
] as const;
export type Shape = (typeof SHAPES)[number];

export type Drawing = {
  viewBox: string;
  // Линия каждого кайта, в порядке кайтов варианта.
  tracks: { id: string; d: string }[];
  // Стрелки направления всех кайтов одним путём: по стрелке на каждый шаг,
  // в том порядке, в каком шаги записаны в данных.
  arrows: string;
  // Линии сетки: значения, через которые проходит фигура. Края окна и его
  // оси (x = 0, y = 50) сюда не входят: они рисуются всегда.
  grid: { xs: number[]; ys: number[] };
  // Значки по видам; вида, которого в варианте нет, нет и в записи.
  shapes: Partial<Record<Shape, string>>;
  // Подписи у входа и выхода: «In» и «Out» у одного кайта, «#номер» — у
  // нескольких. `tone` — чем красить: входом, выходом или цветом кайта.
  labels: { x: number; y: number; text: string; tone: string }[];
};

// Поля вокруг окна: слева, справа и сверху — под подписи сетки и кайтов,
// снизу — под числа сетки и значки взлёта и посадки, которые ставятся под
// землёй.
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

// Доли шага, где может встать стрелка, в порядке предпочтения. Первая — не
// середина: когда кайт возвращается по той же линии, встречные стрелки не
// сливаются в ромб.
const ARROW_AT = [0.6, 0.4, 0.75, 0.25, 0.5, 0.85, 0.15];

function gap(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

// Первая из долей шага, вокруг которой свободно, а если тесно везде — та, где
// свободнее всего.
function freest(spots: readonly number[], room: (t: number) => number): number {
  return spots.find((t) => room(t) >= 5) ?? spots.reduce((a, b) => (room(b) > room(a) ? b : a));
}

// Стрелка встаёт на место, не занятое значком или другой стрелкой: иначе на вертикали, пройденной вверх и вниз, её закрывает значок
// остановки, а встречная стрелка сливается с ней.
function arrow(from: Point, step: Move, busy: Point[]): string {
  const room = (t: number) => Math.min(...busy.map((other) => gap(other, along(from, step, t).point)), 50);
  const { point, heading } = along(from, step, freest(ARROW_AT, room));
  busy.push(point);
  // На шаге короче самой стрелки она уменьшается вместе с ним.
  const scale = Math.min(1, length(from, step) / 6);
  const [hx, hy] = heading;
  const tip: Point = [point[0] + hx * 2.4 * scale, point[1] + hy * 2.4 * scale];
  const base: Point = [point[0] - hx * 1.8 * scale, point[1] - hy * 1.8 * scale];
  const left: Point = [base[0] - hy * 1.7 * scale, base[1] + hx * 1.7 * scale];
  const right: Point = [base[0] + hy * 1.7 * scale, base[1] - hx * 1.7 * scale];
  return `M${at(tip)}L${at(left)}L${at(right)}Z`;
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

// Значок вида `name` с центром в точке SVG; `nose` — куда смотрит нос кайта,
// в координатах окна. Этой же функцией рисуется легенда.
export function shape(name: Shape, x: number, y: number, nose: Point = [0, 1]): string {
  // Точка значка кайта: `ahead` — вдоль носа, `aside` — поперёк.
  const p = (ahead: number, aside: number) =>
    `${fmt(x + nose[0] * ahead + nose[1] * aside)} ${fmt(y - nose[1] * ahead + nose[0] * aside)}`;
  const kite = `M${p(3.6, 0)}L${p(-2.4, 3.3)}L${p(-0.9, 0)}L${p(-2.4, -3.3)}Z`;
  const ring = (r: number) =>
    `M${fmt(x - r)} ${fmt(y)}a${r} ${r} 0 1 0 ${fmt(2 * r)} 0a${r} ${r} 0 1 0 ${fmt(-2 * r)} 0`;
  const box = (h: number) => `M${fmt(x - h)} ${fmt(y - h)}h${fmt(2 * h)}v${fmt(2 * h)}h${fmt(-2 * h)}z`;
  switch (name) {
    case "in":
    case "out":
      return kite;
    case "stall":
      return `${kite}M${p(5.2, 2.6)}L${p(5.2, -2.6)}`;
    case "turn":
      return ring(3.4);
    case "axel":
      return `M${fmt(x)} ${fmt(y - 3)}l3 3-3 3-3-3z`;
    case "launch":
      return `M${fmt(x)} ${fmt(y - 2.4)}l2.8 4.8h-5.6z`;
    case "landing":
      return `M${fmt(x)} ${fmt(y + 2.4)}l2.8-4.8h-5.6z`;
    case "derived":
      return ring(1.7);
    case "measured":
      return box(1.5);
  }
}

export function drawVariant(variant: Variant): Drawing {
  const solo = variant.kites.length === 1;
  const shapes: Partial<Record<Shape, string>> = {};
  const put = (name: Shape, x: number, y: number, nose?: Point) => {
    shapes[name] = (shapes[name] ?? "") + shape(name, x, y, nose);
  };
  // Точки, занятые значками на самой линии, и шаги, которым нужна стрелка:
  // стрелки расставляются после значков.
  const busy: Point[] = [];
  const flown: { from: Point; step: Move }[] = [];
  const event = (name: Shape, point: Point, nose?: Point) => {
    put(name, sx(point), sy(point), nose);
    busy.push(point);
  };

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
    if (step.kind !== "arc") {
      return;
    }
    const [cx, cy] = step.center;
    const radius = Math.hypot(from[0] - cx, from[1] - cy);
    const begin = (Math.atan2(from[1] - cy, from[0] - cx) * 180) / Math.PI;
    for (const angle of [0, 90, 180, 270]) {
      const turn = step.direction === "ccw" ? angle - begin : begin - angle;
      if (((turn % 360) + 360) % 360 > step.sweep + 0.01) {
        continue;
      }
      const value = angle % 180 === 0 ? cx + (angle === 0 ? radius : -radius) : cy + (angle === 90 ? radius : -radius);
      const round5 = Math.round(value / 5) * 5;
      if (Math.abs(value - round5) < 0.01) {
        (angle % 180 === 0 ? xs : ys).add(round5);
      }
    }
  };

  // Взлёт, посадка и подписи, которым место под землёй, встают столбиком под
  // своей точкой: на самой точке уже стоят вход и выход. У земли столбик один
  // на вертикаль и начинается под линией земли, а не под точкой: иначе
  // подпись точки чуть выше земли легла бы на саму землю.
  const stacks = new Map<string, number>();
  let bottom = GRID.yMax + 10;
  const below = (point: Point): number => {
    const ground = point[1] <= 10;
    const key = ground ? `ground ${point[0]}` : point.join();
    const slot = stacks.get(key) ?? 0;
    stacks.set(key, slot + 1);
    // Под землёй первая строка занята числами сетки.
    const y = (ground ? GRID.yMax + 8 : sy(point)) + 6.5 + slot * 6.5;
    bottom = Math.max(bottom, y + 4);
    return y;
  };

  const tracks: Drawing["tracks"] = [];
  const wanted: { point: Point; toward: Point; text: string; tone: string }[] = [];

  const offGrid = (basis: string, point: Point) => {
    if (basis === "derived" || basis === "measured") {
      put(basis, sx(point), sy(point));
    }
  };

  variant.kites.forEach((kite, order) => {
    let here: Point = [0, 0];
    let heading: Point = [1, 0];
    // Нос кайта в точке, куда привёл последний шаг.
    let nose: Point = [0, 1];
    let d = "";
    const tone = (mark: string) => `t-${solo ? mark : `k${(order % 5) + 1}`}`;
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
          flown.push({ from: here, step });
          extremes(here, step);
          heading = along(here, step, 1).heading;
          nose = noseAt(here, step, 1);
          here = step.to;
          offGrid(step.basis, here);
          onGrid(step.basis, here);
          break;
        }
        case "rotate":
          event("turn", here);
          break;
        case "mark":
          if (step.mark === "in") {
            // Подпись входа — позади кайта, откуда он пришёл бы: туда линия
            // фигуры не идёт.
            const next = nextMove(kite, index);
            const ahead = next ? along(here, next, 0).heading : heading;
            event("in", here, next ? noseAt(here, next, 0) : nose);
            wanted.push({ point: here, toward: [-ahead[0], -ahead[1]], text: solo ? "In" : `#${kite.id}`, tone: tone("in") });
          } else if (step.mark === "out") {
            event("out", here, nose);
            wanted.push({ point: here, toward: heading, text: solo ? "Out" : `#${kite.id}`, tone: tone("out") });
          } else if (step.mark === "launch" || step.mark === "landing") {
            put(step.mark, sx(here), below(here));
          } else if (step.mark === "stall") {
            event("stall", here, nose);
          } else {
            event("axel", here);
          }
          break;
      }
    });
    tracks.push({ id: kite.id, d });
  });

  const traces = flown.map(({ from, step }) => {
    const count = Math.max(2, Math.ceil(length(from, step) / 3));
    return Array.from({ length: count + 1 }, (_, index) => along(from, step, index / count).point);
  });
  const arrows = flown.map(({ from, step }) => arrow(from, step, busy)).join("");

  // Подписи ставятся последними и обходят всё уже нарисованное: значки,
  // стрелки, линии и друг друга. Первое место — на продолжении линии (позади
  // входа, впереди выхода), дальше — сбоку и наискось: когда кайты идут
  // колонной или выходят навстречу, продолжение линии занято соседом. Подпись,
  // которой место под землёй, встаёт в столбик под точкой, под взлёт и посадку.
  const lines = traces.flat();
  // Числа сетки у рамки тоже заняты: слева — высоты, под землёй — расстояния.
  const taken: { spot: Point; half: number }[] = [
    ...[...ys, 50].map((y) => ({ spot: [GRID.xMin - 6, y] as Point, half: 4 })),
    ...[...xs, 0].map((x) => ({ spot: [x, -7.5] as Point, half: 3 })),
  ];
  const reach = 7;
  const labels = wanted.map(({ point, toward: [tx, ty], text, tone }) => {
    // Полуширина подписи жирным шрифтом в 6 единиц.
    const half = text.length * 1.9;
    const spot = (ux: number, uy: number): Point => {
      const size = Math.hypot(ux, uy);
      return [point[0] + (ux / size) * (reach + half), point[1] + (uy / size) * reach];
    };
    // Расстояние от препятствия до подписи — до отрезка во всю её ширину.
    const reachTo = (other: Point, [x, y]: Point, width: number) =>
      Math.hypot(Math.max(Math.abs(other[0] - x) - width, 0), other[1] - y);
    const room = (at: Point) =>
      Math.min(
        ...busy.filter((other) => gap(other, point) > 0.5).map((other) => reachTo(other, at, half)),
        ...lines.filter((other) => gap(other, point) > 4).map((other) => reachTo(other, at, half)),
        ...taken.map((other) => reachTo(other.spot, at, half + other.half)),
        50,
      );
    const first = spot(tx, ty);
    if (first[1] < 1) {
      return { x: round(sx(point)), y: round(below(point)), text, tone };
    }
    const fits = ([x, y]: Point) => y >= 2 && y <= GRID.yMax + MARGIN - 4 && Math.abs(x) + half <= GRID.xMax + MARGIN;
    const spots = [first, spot(-ty, tx), spot(ty, -tx), spot(tx - ty, ty + tx), spot(tx + ty, ty - tx)].filter(fits);
    const best =
      spots.find((at) => room(at) >= 4) ?? spots.reduce((a, b) => (room(b) > room(a) ? b : a), spots[0] ?? first);
    // Подпись у самого края окна сдвигается внутрь поля, а не обрезается.
    const edge = GRID.xMax + MARGIN - half;
    const placed: Point = [Math.max(-edge, Math.min(edge, best[0])), best[1]];
    taken.push({ spot: placed, half });
    return { x: round(sx(placed)), y: round(sy(placed)), text, tone };
  });

  return {
    viewBox: `${VIEW.left} ${VIEW.top} ${VIEW.width} ${fmt(bottom - VIEW.top)}`,
    tracks,
    arrows,
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

function nextMove(kite: Kite, after: number): Move | undefined {
  return kite.path.slice(after + 1).find((step): step is Move => step.kind === "line" || step.kind === "arc");
}

// Геометрия фигуры: то, по чему рисуется своя схема. Формат описан в
// `data/figures/README.md`; этот модуль — его проверка. Всё, что формат не
// называет, отвергается: молча пропущенное поле — это схема, нарисованная не
// по тем данным.
//
// Сетка окна — как в правилах: 200 единиц в ширину и 100 в высоту. `x` идёт
// от −100 (левый край) до 100 (правый), ноль — горизонтальный центр окна;
// `y` — от 0 (земля) до 100. Угол растёт против часовой стрелки.

export const GRID = { xMin: -100, xMax: 100, yMin: 0, yMax: 100 } as const;

// Допуск на сведение дуги: координаты пишутся с двумя знаками после запятой.
const TOLERANCE = 0.05;

export type Point = readonly [number, number];

// Откуда взята координата шага. Без поля — `grid`.
export const BASES = ["grid", "text", "derived", "measured"] as const;
export type Basis = (typeof BASES)[number];

// Куда смотрит нос кайта, пока он летит этот шаг. Без поля — `forward`.
// Число — постоянный курс носа в градусах: 0 — вверх, 90 — вправо, 180 —
// вниз, 270 — влево (так пишутся слайды многострочных кайтов).
export const NOSE_WORDS = ["forward", "backward", "out", "in"] as const;
export type Nose = (typeof NOSE_WORDS)[number] | number;

// Событие в точке, где кайт сейчас находится, и допустимые уточнения.
export const MARKS = {
  in: [],
  out: [],
  launch: [],
  landing: ["two-point", "snap-two-point", "stall-two-point", "spin-two-point", "leading-edge", "belly"],
  stall: ["push", "snap"],
  axel: [],
  "half-axel": [],
} as const satisfies Record<string, readonly string[]>;
export type MarkName = keyof typeof MARKS;

// Вокруг чего кайт поворачивается. Законцовки названы так, как их видит пилот
// у кайта носом вверх: при носе вправо левая законцовка — верхняя.
export const ROTATE_ABOUT = ["center", "left-tip", "right-tip"] as const;
export type RotateAbout = (typeof ROTATE_ABOUT)[number];

// Откуда известна точка поворота: названа в тексте страницы, видна на схеме
// либо выведена из условия, названного в `notes`. Умолчания нет: чего книга не
// называет, то записывается как `not_found`.
export const ABOUT_BASES = ["text", "diagram", "derived"] as const;
export type AboutBasis = (typeof ABOUT_BASES)[number];

// `unmarked: true` — страница не показывает, в каком порядке кайт проходит этот
// шаг (замкнутая петля без стрелки). Шаг записан в одном из возможных
// порядков; линия верна. Схема знака направления на нём не ставит, а в шагах
// помечает, что первоисточник его не показывает.
type Flown = { basis: Basis; nose: Nose; unmarked?: true; sync?: string };

// Чего книга не показывает: причина словами, со страницей и днём чтения.
export type Missing = { status: "not_found"; reason: string };

export type Step =
  | { kind: "start"; at: Point; basis: Basis }
  | ({ kind: "line"; to: Point } & Flown)
  | ({ kind: "arc"; to: Point; center: Point; direction: "cw" | "ccw"; sweep: number } & Flown)
  // `nose` — только у остановки и у неё обязателен: курс метки, которой книга
  // рисует кайт в этой точке (0 — вверх, 90 — вправо), либо запись о том, что
  // метки там нет.
  | { kind: "mark"; mark: MarkName; style?: string; sync?: string; nose?: number | Missing }
  // Поворот. `to` — куда он привёл нос кайта: поворот вокруг законцовки сам
  // перемещает кайт, и это смещение принадлежит ему, а не отрезку после него.
  // Без `to` нос остаётся в той же точке сетки.
  | {
      kind: "rotate";
      degrees: number;
      direction: "cw" | "ccw";
      about: RotateAbout | Missing;
      about_basis?: AboutBasis;
      to?: Point;
      basis?: Basis;
    };

// Поворот, который сам перемещает кайт: у него записана точка, куда пришёл нос.
export type Swing = Extract<Step, { kind: "rotate" }> & { to: Point };

export function isSwing(step: Step): step is Swing {
  return step.kind === "rotate" && step.to !== undefined;
}

export type Kite = { id: string; path: Step[] };

// Вспомогательная линия книги — тонкая серая черта, которой схема связывает
// точки разных кайтов. Не путь: по ней никто не летит.
export type Guide = { from: Point; to: Point; basis: Basis };

export type Variant = {
  id: string;
  // Для командных фигур, у которых схема своя на каждый состав.
  team_size?: number;
  // Страница схемы этого варианта, когда она не та, что у фигуры.
  page?: number;
  kites: Kite[];
  // Вспомогательные линии схемы либо запись о том, что книга их не рисует.
  guides: { status: "ok"; lines: Guide[] } | Missing;
};

export type Geometry =
  | { status: "ok"; variants: Variant[]; notes: string[] }
  | { status: "not_found"; reason: string };

function fail(where: string, message: string): never {
  throw new Error(`${where}: ${message}`);
}

function record(where: string, raw: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    fail(where, "ожидается объект");
  }
  const value = raw as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      fail(where, `незнакомое поле «${key}»`);
    }
  }
  return value;
}

function text(where: string, value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(where, "должно быть непустой строкой");
  }
  return value;
}

function oneOf<T extends string>(where: string, value: unknown, options: readonly T[]): T {
  if (typeof value !== "string" || !options.includes(value as T)) {
    fail(where, `ожидается одно из: ${options.join(", ")}`);
  }
  return value as T;
}

function list(where: string, value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail(where, "ожидается непустой список");
  }
  return value;
}

function inGrid([x, y]: Point): boolean {
  return (
    x >= GRID.xMin - TOLERANCE &&
    x <= GRID.xMax + TOLERANCE &&
    y >= GRID.yMin - TOLERANCE &&
    y <= GRID.yMax + TOLERANCE
  );
}

// `anywhere` — для центра дуги: у пологой дуги он лежит за краем окна, и в
// сетке обязана быть сама дуга, а не точка, вокруг которой она проведена.
function point(where: string, value: unknown, anywhere = false): Point {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every((part) => typeof part === "number" && Number.isFinite(part))
  ) {
    fail(where, "ожидается точка [x, y] из двух чисел");
  }
  const result: Point = [value[0] as number, value[1] as number];
  if (!anywhere && !inGrid(result)) {
    fail(where, `точка [${result.join(", ")}] вне сетки окна: x от −100 до 100, y от 0 до 100`);
  }
  return result;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

// Точка, в которую придёт кайт, пролетев дугу `sweep` градусов вокруг центра.
export function arcPoint(from: Point, center: Point, direction: "cw" | "ccw", sweep: number): Point {
  const angle = ((direction === "ccw" ? sweep : -sweep) * Math.PI) / 180;
  const dx = from[0] - center[0];
  const dy = from[1] - center[1];
  return [
    center[0] + dx * Math.cos(angle) - dy * Math.sin(angle),
    center[1] + dx * Math.sin(angle) + dy * Math.cos(angle),
  ];
}

// Точка, вокруг которой поворот на `degrees` в сторону `direction` переводит
// нос из `from` в `to`. Она следует из самого смещения и не зависит от того,
// названа ли в данных законцовка.
export function pivotOf(from: Point, to: Point, direction: "cw" | "ccw", degrees: number): Point {
  const half = ((direction === "ccw" ? degrees : -degrees) * Math.PI) / 360;
  const along = Math.cos(half) / Math.sin(half) / 2;
  return [
    (from[0] + to[0]) / 2 - (to[1] - from[1]) * along,
    (from[1] + to[1]) / 2 + (to[0] - from[0]) * along,
  ];
}

// Курс носа единичным вектором: 0 — вверх, 90 — вправо.
function courseVector(degrees: number): Point {
  const angle = (degrees * Math.PI) / 180;
  return [Math.sin(angle), Math.cos(angle)];
}

// Куда смотрит нос кайта в конце отрезка или дуги.
function noseAfter(from: Point, step: Extract<Step, { kind: "line" | "arc" }>): Point {
  if (typeof step.nose === "number") {
    return courseVector(step.nose);
  }
  let ahead: Point;
  if (step.kind === "line") {
    const size = distance(from, step.to);
    ahead = [(step.to[0] - from[0]) / size, (step.to[1] - from[1]) / size];
  } else {
    const size = distance(step.to, step.center);
    const radial: Point = [(step.to[0] - step.center[0]) / size, (step.to[1] - step.center[1]) / size];
    if (step.nose === "out" || step.nose === "in") {
      return step.nose === "out" ? radial : [-radial[0], -radial[1]];
    }
    ahead = step.direction === "ccw" ? [-radial[1], radial[0]] : [radial[1], -radial[0]];
  }
  return step.nose === "backward" ? [-ahead[0], -ahead[1]] : ahead;
}

function course(where: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value >= 360) {
    fail(where, "курс носа — от 0 до 360 градусов, не включая 360");
  }
  return value;
}

function missing(where: string, raw: unknown): Missing {
  const value = record(where, raw, ["status", "reason"]);
  oneOf(`${where}.status`, value.status, ["not_found"] as const);
  return { status: "not_found", reason: text(`${where}.reason`, value.reason) };
}

function unmarked(where: string, value: unknown): boolean {
  if (value !== undefined && value !== true) {
    fail(`${where}.unmarked`, "поле либо отсутствует, либо равно true");
  }
  return value === true;
}

function flown(where: string, value: Record<string, unknown>): Flown {
  let nose: Nose = "forward";
  if (value.nose !== undefined) {
    if (typeof value.nose === "number") {
      nose = course(`${where}.nose`, value.nose);
    } else {
      nose = oneOf(`${where}.nose`, value.nose, NOSE_WORDS);
    }
  }
  return {
    basis: value.basis === undefined ? "grid" : oneOf(`${where}.basis`, value.basis, BASES),
    nose,
    ...(unmarked(where, value.unmarked) ? { unmarked: true as const } : {}),
    ...(value.sync === undefined ? {} : { sync: text(`${where}.sync`, value.sync) }),
  };
}

// `heading` — куда смотрит нос перед шагом, если это следует из пути.
function parseStep(where: string, raw: unknown, position: Point | null, heading: Point | null = null): Step {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    fail(where, "ожидается объект");
  }
  const kind = (raw as Record<string, unknown>).kind;
  switch (kind) {
    case "start": {
      const value = record(where, raw, ["kind", "at", "basis"]);
      return {
        kind,
        at: point(`${where}.at`, value.at),
        basis: value.basis === undefined ? "grid" : oneOf(`${where}.basis`, value.basis, BASES),
      };
    }
    case "line": {
      const value = record(where, raw, ["kind", "to", "basis", "nose", "unmarked", "sync"]);
      const to = point(`${where}.to`, value.to);
      if (position !== null && distance(position, to) < TOLERANCE) {
        fail(where, "отрезок нулевой длины");
      }
      const rest = flown(where, value);
      if (rest.nose === "out" || rest.nose === "in") {
        fail(`${where}.nose`, "«out» и «in» имеют смысл только на дуге");
      }
      return { kind, to, ...rest };
    }
    case "arc": {
      const value = record(where, raw, ["kind", "to", "center", "direction", "sweep", "basis", "nose", "unmarked", "sync"]);
      const to = point(`${where}.to`, value.to);
      const center = point(`${where}.center`, value.center, true);
      const direction = oneOf(`${where}.direction`, value.direction, ["cw", "ccw"] as const);
      const sweep = value.sweep;
      if (typeof sweep !== "number" || !(sweep > 0 && sweep <= 360)) {
        fail(`${where}.sweep`, "угол дуги — больше 0 и не больше 360 градусов");
      }
      if (position !== null) {
        const radius = distance(position, center);
        if (radius < TOLERANCE) {
          fail(where, "центр дуги совпадает с её началом");
        }
        if ((radius * sweep * Math.PI) / 180 < TOLERANCE) {
          fail(where, "дуга нулевой длины");
        }
        const end = arcPoint(position, center, direction, sweep);
        if (distance(end, to) > TOLERANCE) {
          fail(
            where,
            `дуга не сходится: из [${position.join(", ")}] вокруг [${center.join(", ")}] на ${sweep}° ${direction} ` +
              `выходит [${end.map((part) => part.toFixed(2)).join(", ")}], а записано [${to.join(", ")}]`,
          );
        }
        // Шаг в градус: между соседними пробами дуга радиуса 100 отходит от
        // хорды меньше чем на 0,004 единицы.
        for (let turned = 0; turned < sweep; turned += 1) {
          if (!inGrid(arcPoint(position, center, direction, turned))) {
            fail(where, "дуга выходит за сетку окна");
          }
        }
      }
      return { kind, to, center, direction, sweep, ...flown(where, value) };
    }
    case "mark": {
      const value = record(where, raw, ["kind", "mark", "style", "sync", "nose"]);
      const mark = oneOf(`${where}.mark`, value.mark, Object.keys(MARKS) as MarkName[]);
      const styles: readonly string[] = MARKS[mark];
      // Курс носа в остановке не выводится из пути: двухстропный кайт в ней
      // стоит носом вверх, откуда бы ни пришёл, а четырёхстропный книга рисует
      // то до поворота, то после. Поэтому поле обязательно — числом с метки
      // книги либо записью, что метки нет.
      if ((mark === "stall") !== (value.nose !== undefined)) {
        fail(
          `${where}.nose`,
          mark === "stall"
            ? "у остановки обязателен курс носа с метки книги либо запись «not_found» с причиной"
            : "курс носа записывается только у остановки",
        );
      }
      return {
        kind,
        mark,
        ...(value.nose === undefined
          ? {}
          : { nose: typeof value.nose === "number" ? course(`${where}.nose`, value.nose) : missing(`${where}.nose`, value.nose) }),
        ...(value.style === undefined ? {} : { style: oneOf(`${where}.style`, value.style, styles) }),
        ...(value.sync === undefined ? {} : { sync: text(`${where}.sync`, value.sync) }),
      };
    }
    case "rotate": {
      const value = record(where, raw, ["kind", "degrees", "direction", "about", "about_basis", "to", "basis"]);
      const degrees = value.degrees;
      if (typeof degrees !== "number" || !(degrees > 0)) {
        fail(`${where}.degrees`, "угол поворота — положительное число градусов");
      }
      const direction = oneOf(`${where}.direction`, value.direction, ["cw", "ccw"] as const);
      // Точка поворота названа всегда: либо словом и тем, откуда оно взято,
      // либо записью, что книга её не называет. Молчаливого «вокруг центра» нет.
      if (value.about === undefined) {
        fail(`${where}.about`, "обязательна точка поворота либо запись «not_found» с причиной");
      }
      const named = typeof value.about === "string";
      const about = named ? oneOf(`${where}.about`, value.about, ROTATE_ABOUT) : missing(`${where}.about`, value.about);
      if (named !== (value.about_basis !== undefined)) {
        fail(
          `${where}.about_basis`,
          named
            ? `у названной точки поворота обязательно, откуда она взята: ${ABOUT_BASES.join(", ")}`
            : "записывается только у названной точки поворота",
        );
      }
      const step: Extract<Step, { kind: "rotate" }> = {
        kind,
        degrees,
        direction,
        about,
        ...(named ? { about_basis: oneOf(`${where}.about_basis`, value.about_basis, ABOUT_BASES) } : {}),
      };
      // Вокруг центра нос остаётся в своей точке сетки; вокруг законцовки кайт
      // переезжает, и куда — обязано быть сказано здесь же: иначе смещение
      // снова достанется отрезку после поворота.
      if (about === "center" && value.to !== undefined) {
        fail(`${where}.to`, "поворот вокруг центра кайт не перемещает");
      }
      if ((about === "left-tip" || about === "right-tip") && value.to === undefined) {
        fail(`${where}.to`, "поворот вокруг законцовки перемещает кайт: нужна точка, куда пришёл нос");
      }
      if (value.to === undefined) {
        if (value.basis !== undefined) {
          fail(`${where}.basis`, "записывается только вместе с точкой «to»");
        }
        return step;
      }
      const to = point(`${where}.to`, value.to);
      const basis = value.basis === undefined ? "grid" : oneOf(`${where}.basis`, value.basis, BASES);
      if (degrees >= 360) {
        fail(`${where}.degrees`, "поворот со смещением — меньше полного оборота");
      }
      if (position !== null) {
        if (distance(position, to) < TOLERANCE) {
          fail(`${where}.to`, "поворот не смещает кайт: точка «to» совпадает с текущей");
        }
        const pivot = pivotOf(position, to, direction, degrees);
        // Нос идёт по дуге вокруг точки поворота — она тоже не покидает окна.
        for (let turned = 0; turned < degrees; turned += 1) {
          if (!inGrid(arcPoint(position, pivot, direction, turned))) {
            fail(where, "поворот выводит кайт за сетку окна");
          }
        }
        // Нос — середина передней кромки, законцовка — сбоку от него: левая —
        // слева от курса, если смотреть на кайт носом вверх.
        if (heading !== null && typeof about === "string") {
          const reach: Point = [pivot[0] - position[0], pivot[1] - position[1]];
          const aside = reach[0] * -heading[1] + reach[1] * heading[0];
          const ahead = reach[0] * heading[0] + reach[1] * heading[1];
          const side = aside > 0 ? "left-tip" : "right-tip";
          if (Math.abs(aside) <= Math.abs(ahead) || side !== about) {
            fail(
              `${where}.about`,
              `смещение в [${to.join(", ")}] при этом курсе носа даёт точку поворота [${pivot.map((part) => part.toFixed(2)).join(", ")}]` +
                (Math.abs(aside) <= Math.abs(ahead) ? " — не сбоку от носа, это не законцовка" : ` — это «${side}», а записано «${about}»`),
            );
          }
        }
      }
      return { ...step, to, basis };
    }
    default:
      fail(`${where}.kind`, "ожидается одно из: start, line, arc, mark, rotate");
  }
}

function parseKite(where: string, raw: unknown): Kite {
  const value = record(where, raw, ["id", "path"]);
  const id = text(`${where}.id`, value.id);
  const path: Step[] = [];
  let position: Point | null = null;
  // Куда смотрит нос, пока это следует из пути: по нему сверяется законцовка.
  let heading: Point | null = null;
  // Отрезки и дуги между «in» и «out»: оцениваемая часть не бывает пустой.
  let judged = 0;
  const calls: MarkName[] = [];
  list(`${where}.path`, value.path).forEach((item, index) => {
    const at = `${where}.path[${index}]`;
    const step = parseStep(at, item, position, heading);
    if ((step.kind === "start") !== (index === 0)) {
      fail(at, "путь начинается шагом «start», и такой шаг в нём один");
    }
    if (step.kind === "start") {
      position = step.at;
    } else if (step.kind === "line" || step.kind === "arc") {
      heading = position === null ? null : noseAfter(position, step);
      position = step.to;
      if (calls.join(",") === "in") {
        judged += 1;
      }
    } else if (step.kind === "rotate") {
      if (heading !== null) {
        // По часовой курс растёт.
        const angle = ((step.direction === "cw" ? step.degrees : -step.degrees) * Math.PI) / 180;
        heading = [
          heading[0] * Math.cos(angle) + heading[1] * Math.sin(angle),
          heading[1] * Math.cos(angle) - heading[0] * Math.sin(angle),
        ];
      }
      if (isSwing(step)) {
        position = step.to;
      }
    } else if (step.kind === "mark" && (step.mark === "in" || step.mark === "out")) {
      calls.push(step.mark);
    }
    path.push(step);
  });
  if (calls.join(",") !== "in,out") {
    fail(`${where}.path`, "в пути должна быть ровно одна отметка «in» и после неё ровно одна «out»");
  }
  if (judged === 0) {
    fail(`${where}.path`, "между «in» и «out» нет ни одного отрезка или дуги");
  }
  return { id, path };
}

function unique(where: string, ids: string[]) {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      fail(where, `повторяется id «${id}»`);
    }
    seen.add(id);
  }
}

function parseGuides(where: string, raw: unknown): Variant["guides"] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    fail(where, "ожидается объект: линии либо запись «not_found» с причиной");
  }
  if ((raw as Record<string, unknown>).status !== "ok") {
    return missing(where, raw);
  }
  const value = record(where, raw, ["status", "lines"]);
  const lines = list(`${where}.lines`, value.lines).map((item, index) => {
    const at = `${where}.lines[${index}]`;
    const line = record(at, item, ["from", "to", "basis"]);
    const from = point(`${at}.from`, line.from);
    const to = point(`${at}.to`, line.to);
    if (distance(from, to) < TOLERANCE) {
      fail(at, "линия нулевой длины");
    }
    return { from, to, basis: line.basis === undefined ? "grid" : oneOf(`${at}.basis`, line.basis, BASES) };
  });
  return { status: "ok", lines };
}

function parseVariant(where: string, raw: unknown, pages: number): Variant {
  const value = record(where, raw, ["id", "team_size", "page", "kites", "guides"]);
  const kites = list(`${where}.kites`, value.kites).map((item, index) =>
    parseKite(`${where}.kites[${index}]`, item),
  );
  unique(`${where}.kites`, kites.map((kite) => kite.id));
  const variant: Variant = { id: text(`${where}.id`, value.id), kites, guides: parseGuides(`${where}.guides`, value.guides) };
  if (value.team_size !== undefined) {
    if (!Number.isInteger(value.team_size) || (value.team_size as number) < 2) {
      fail(`${where}.team_size`, "состав команды — целое число не меньше 2");
    }
    variant.team_size = value.team_size as number;
  }
  if (value.page !== undefined) {
    variant.page = parsePage(`${where}.page`, value.page, pages);
  }
  return variant;
}

// Номер страницы первоисточника: целое от 1 до числа страниц документа.
export function parsePage(where: string, value: unknown, pages: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > pages) {
    fail(where, `страница должна быть целым числом от 1 до ${pages}`);
  }
  return value;
}

// `pages` — число страниц документа-первоисточника: вариант может ссылаться на
// свою страницу, и она проверяется так же, как страница фигуры.
export function parseGeometry(where: string, raw: unknown, pages: number): Geometry {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    fail(where, "ожидается объект");
  }
  const status = oneOf(`${where}.status`, (raw as Record<string, unknown>).status, ["ok", "not_found"] as const);
  if (status === "not_found") {
    const value = record(where, raw, ["status", "reason"]);
    return { status, reason: text(`${where}.reason`, value.reason) };
  }
  const value = record(where, raw, ["status", "variants", "notes"]);
  const variants = list(`${where}.variants`, value.variants).map((item, index) =>
    parseVariant(`${where}.variants[${index}]`, item, pages),
  );
  unique(`${where}.variants`, variants.map((variant) => variant.id));
  if (value.notes !== undefined && !Array.isArray(value.notes)) {
    fail(`${where}.notes`, "ожидается список строк");
  }
  const notes = ((value.notes as unknown[] | undefined) ?? []).map((item, index) =>
    text(`${where}.notes[${index}]`, item),
  );
  // Координата не с подписанной линии сетки обязана быть объяснена: иначе
  // читатель данных не отличит измеренное от подписанного.
  const unexplained = variants.some(
    (variant) =>
      (variant.guides.status === "ok" && variant.guides.lines.some((line) => line.basis !== "grid" && line.basis !== "text")) ||
      variant.kites.some((kite) =>
      kite.path.some(
        (step) =>
          ("basis" in step && step.basis !== undefined && step.basis !== "grid" && step.basis !== "text") ||
          ("unmarked" in step && step.unmarked === true) ||
          (step.kind === "rotate" && step.about_basis === "derived"),
      ),
    ),
  );
  if (unexplained && notes.length === 0) {
    fail(
      `${where}.notes`,
      "есть шаги или вспомогательные линии с basis «derived» или «measured», шаги с «unmarked» либо выведенная точка поворота — нужна заметка, что именно не подписано и откуда взято значение",
    );
  }
  return { status, variants, notes };
}

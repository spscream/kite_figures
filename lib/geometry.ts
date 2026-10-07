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

export const ROTATE_ABOUT = ["center", "left-tip", "right-tip"] as const;

// `unmarked: true` — страница не показывает, в каком порядке кайт проходит этот
// шаг (замкнутая петля без стрелки). Шаг записан в одном из возможных
// порядков; линия верна. Схема знака направления на нём не ставит, а в шагах
// помечает, что первоисточник его не показывает.
type Flown = { basis: Basis; nose: Nose; unmarked?: true; sync?: string };

export type Step =
  | { kind: "start"; at: Point; basis: Basis }
  | ({ kind: "line"; to: Point } & Flown)
  | ({ kind: "arc"; to: Point; center: Point; direction: "cw" | "ccw"; sweep: number } & Flown)
  | { kind: "mark"; mark: MarkName; style?: string; sync?: string }
  | { kind: "rotate"; degrees: number; direction: "cw" | "ccw"; about: (typeof ROTATE_ABOUT)[number] };

export type Kite = { id: string; path: Step[] };

export type Variant = {
  id: string;
  // Для командных фигур, у которых схема своя на каждый состав.
  team_size?: number;
  // Страница схемы этого варианта, когда она не та, что у фигуры.
  page?: number;
  kites: Kite[];
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
      if (!Number.isFinite(value.nose) || value.nose < 0 || value.nose >= 360) {
        fail(`${where}.nose`, "курс носа — от 0 до 360 градусов, не включая 360");
      }
      nose = value.nose;
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

function parseStep(where: string, raw: unknown, position: Point | null): Step {
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
      const value = record(where, raw, ["kind", "mark", "style", "sync"]);
      const mark = oneOf(`${where}.mark`, value.mark, Object.keys(MARKS) as MarkName[]);
      const styles: readonly string[] = MARKS[mark];
      return {
        kind,
        mark,
        ...(value.style === undefined ? {} : { style: oneOf(`${where}.style`, value.style, styles) }),
        ...(value.sync === undefined ? {} : { sync: text(`${where}.sync`, value.sync) }),
      };
    }
    case "rotate": {
      const value = record(where, raw, ["kind", "degrees", "direction", "about"]);
      if (typeof value.degrees !== "number" || !(value.degrees > 0)) {
        fail(`${where}.degrees`, "угол поворота — положительное число градусов");
      }
      return {
        kind,
        degrees: value.degrees,
        direction: oneOf(`${where}.direction`, value.direction, ["cw", "ccw"] as const),
        about: value.about === undefined ? "center" : oneOf(`${where}.about`, value.about, ROTATE_ABOUT),
      };
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
  // Отрезки и дуги между «in» и «out»: оцениваемая часть не бывает пустой.
  let judged = 0;
  const calls: MarkName[] = [];
  list(`${where}.path`, value.path).forEach((item, index) => {
    const at = `${where}.path[${index}]`;
    const step = parseStep(at, item, position);
    if ((step.kind === "start") !== (index === 0)) {
      fail(at, "путь начинается шагом «start», и такой шаг в нём один");
    }
    if (step.kind === "start") {
      position = step.at;
    } else if (step.kind === "line" || step.kind === "arc") {
      position = step.to;
      if (calls.join(",") === "in") {
        judged += 1;
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

function parseVariant(where: string, raw: unknown, pages: number): Variant {
  const value = record(where, raw, ["id", "team_size", "page", "kites"]);
  const kites = list(`${where}.kites`, value.kites).map((item, index) =>
    parseKite(`${where}.kites[${index}]`, item),
  );
  unique(`${where}.kites`, kites.map((kite) => kite.id));
  const variant: Variant = { id: text(`${where}.id`, value.id), kites };
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
  const unexplained = variants.some((variant) =>
    variant.kites.some((kite) =>
      kite.path.some(
        (step) =>
          ("basis" in step && step.basis !== "grid" && step.basis !== "text") ||
          ("unmarked" in step && step.unmarked === true),
      ),
    ),
  );
  if (unexplained && notes.length === 0) {
    fail(
      `${where}.notes`,
      "есть шаги с basis «derived» или «measured» либо с «unmarked» — нужна заметка, что именно не подписано и откуда взято значение",
    );
  }
  return { status, variants, notes };
}

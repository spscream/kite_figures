import fs from "node:fs";
import path from "node:path";

import { DISCIPLINES, type Discipline, type Figure, listFigures } from "./figures";
import { type OwnStep, parseOwnStep, type Point, type Pose, poseAfter, type Step, TOLERANCE } from "./geometry";

// Рутина — один длинный путь на каждый кайт, записанный теми же шагами, что и
// путь фигуры. Формат файла описан в `docs/routines.md`; здесь — его проверка.
// Меняя одно, меняй другое.
//
// Файл рутины — список частей, и у каждой названо, откуда она взята. Фигуру
// каталога часть называет ссылкой и её шагов не повторяет; разбор разворачивает
// ссылку, и дальше рутина — это всегда шаги.
export const ROUTINES_DIR = path.join(process.cwd(), "data", "routines");

export const ROUTINE_SCHEMA = 1;

const EXTENSION = ".json";
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KEYS = ["schema", "name", "summary", "discipline", "kites", "segments"];

// Откуда взята часть рутины: фигура каталога, связка между фигурами или своя
// работа автора. Это не `basis` шага: тот говорит, откуда на странице книги
// взята координата, и есть только у шагов фигуры.
export const ORIGINS = ["figure", "link", "own"] as const;
export type Origin = (typeof ORIGINS)[number];

// Сколько кайтов в составе; состав — последнее слово в имени раздела.
const CREW: Record<string, readonly [number, number]> = {
  individual: [1, 1],
  pair: [2, 2],
  team: [3, Infinity],
};

export function crewOf(discipline: Discipline): readonly [number, number] {
  const crew = CREW[discipline.split("-").at(-1) ?? ""];
  if (!crew) {
    throw new Error(`раздел «${discipline}»: состав по имени раздела не определяется`);
  }
  return crew;
}

// Длительность шага в секундах — темп, который задаёт автор рутины. Ни книга,
// ни правила его не называют, поэтому поле есть только здесь, а не у шага
// фигуры, и необязательно: без него темп шага не задан.
export type Timed<S> = S & { seconds?: number };

export type Segment =
  // Шаги фигуры между её «in» и «out», как они записаны в каталоге.
  | { origin: "figure"; figure: string; variant: string; paths: Record<string, Timed<Step>[]> }
  | { origin: "link" | "own"; paths: Record<string, Timed<OwnStep>[]> };

export type Routine = {
  // Имя файла без расширения.
  slug: string;
  name: string;
  summary?: string;
  discipline: Discipline;
  // Кайты по порядку; у каждой части — путь на каждый из них.
  kites: string[];
  segments: Segment[];
};

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

function seconds(where: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    fail(where, "длительность — положительное число секунд; шаг без заданного темпа поля не несёт");
  }
  return value;
}

function show(point: Point): string {
  return `[${point.join(", ")}]`;
}

// Счёт вызовов на пути одного кайта: правила требуют один «in» и один «out»
// на всю рутину, и между ними кайт обязан лететь.
type Flight = { pose: Pose; calls: string[]; judged: number };

function count(flight: Flight, step: Step | OwnStep): void {
  flight.pose = poseAfter(flight.pose, step);
  if ((step.kind === "line" || step.kind === "arc") && flight.calls.join(",") === "in") {
    flight.judged += 1;
  } else if (step.kind === "mark" && (step.mark === "in" || step.mark === "out")) {
    flight.calls.push(step.mark);
  }
}

function ownSegment(where: string, value: Record<string, unknown>, kites: string[], flights: Map<string, Flight>): Segment {
  const paths = record(`${where}.paths`, value.paths, kites);
  const result: Record<string, Timed<OwnStep>[]> = {};
  for (const kite of kites) {
    const at = `${where}.paths.${kite}`;
    if (!Array.isArray(paths[kite])) {
      fail(at, "ожидается список шагов кайта; кайт, который в этой части не летит, получает пустой список");
    }
    const flight = flights.get(kite)!;
    result[kite] = (paths[kite] as unknown[]).map((item, index) => {
      const here = `${at}[${index}]`;
      // Длительность — поле рутины: до разбора шага она снимается, и шаг
      // читает тот же код, что читает шаги фигур.
      const timed = typeof item === "object" && item !== null && !Array.isArray(item) && "seconds" in item;
      const { seconds: duration, ...raw } = timed ? (item as Record<string, unknown>) : { seconds: undefined };
      const step = parseOwnStep(here, timed ? raw : item, flight.pose);
      if ((step.kind === "start") !== (flight.pose.position === null)) {
        fail(here, "путь кайта начинается шагом «start», и такой шаг в нём один на всю рутину");
      }
      if (timed && (step.kind === "start" || (step.kind === "mark" && (step.mark === "in" || step.mark === "out")))) {
        fail(`${here}.seconds`, "у старта и у вызовов «in» и «out» длительности нет");
      }
      count(flight, step);
      return timed ? { ...step, seconds: seconds(`${here}.seconds`, duration) } : step;
    });
  }
  if (kites.every((kite) => result[kite].length === 0)) {
    fail(`${where}.paths`, "в части нет ни одного шага");
  }
  return { origin: value.origin as "link" | "own", paths: result };
}

function figureSegment(
  where: string,
  value: Record<string, unknown>,
  routine: Pick<Routine, "discipline" | "kites">,
  flights: Map<string, Flight>,
  figures: Figure[],
): Segment {
  const slug = text(`${where}.figure`, value.figure);
  const figure = figures.find((item) => item.slug === slug);
  if (!figure) {
    fail(`${where}.figure`, `фигуры «${slug}» нет в каталоге`);
  }
  if (figure.discipline !== routine.discipline) {
    fail(`${where}.figure`, `фигура ${figure.code} — из раздела «${figure.discipline}», а рутина — «${routine.discipline}»`);
  }
  if (figure.geometry.status !== "ok") {
    fail(`${where}.figure`, `у фигуры ${figure.code} геометрия не снята`);
  }
  const variants = figure.geometry.variants;
  const id = value.variant === undefined && variants.length === 1 ? variants[0].id : value.variant;
  const variant = variants.find((item) => item.id === id);
  if (!variant) {
    fail(`${where}.variant`, `у фигуры ${figure.code} варианты: ${variants.map((item) => item.id).join(", ")} — нужен один из них`);
  }
  // Кайты рутины и варианта — одни и те же: перестановки формат не выражает.
  const own = variant.kites.map((kite) => kite.id);
  if (own.length !== routine.kites.length || routine.kites.some((kite) => !own.includes(kite))) {
    fail(`${where}.figure`, `кайты варианта «${variant.id}» фигуры ${figure.code} — ${own.join(", ")}, а кайты рутины — ${routine.kites.join(", ")}`);
  }
  const durations = value.seconds === undefined ? {} : record(`${where}.seconds`, value.seconds, routine.kites);
  const paths: Record<string, Timed<Step>[]> = {};
  for (const kite of routine.kites) {
    const flight = flights.get(kite)!;
    const path = variant.kites.find((item) => item.id === kite)!.path;
    // Берётся оцениваемая часть фигуры: шаги между её «in» и «out». Сами
    // вызовы остаются фигуре — у рутины свои, по одному на всю.
    const from = path.findIndex((step) => step.kind === "mark" && step.mark === "in");
    const to = path.findIndex((step) => step.kind === "mark" && step.mark === "out");
    let pose: Pose = { position: null, heading: null };
    for (const step of path.slice(0, from)) {
      pose = poseAfter(pose, step);
    }
    const entry = pose.position!;
    const here = flight.pose.position;
    if (here === null) {
      fail(where, `кайт «${kite}» ещё не стоит в окне: до фигуры нужна своя часть с шагом «start»`);
    }
    if (Math.hypot(here[0] - entry[0], here[1] - entry[1]) > TOLERANCE) {
      fail(where, `кайт «${kite}» стоит в ${show(here)}, а фигура ${figure.code} начинается в ${show(entry)}: между ними нужна связка`);
    }
    // Курс носа на входе — тот, что следует из пути самой фигуры.
    flight.pose = pose;
    const steps = path.slice(from + 1, to);
    const given = durations[kite];
    if (given !== undefined && (!Array.isArray(given) || given.length !== steps.length)) {
      fail(`${where}.seconds.${kite}`, `ожидается список из ${steps.length} значений — по одному на шаг фигуры ${figure.code} между «in» и «out»; null — темп шага не задан`);
    }
    paths[kite] = steps.map((step, index) => {
      count(flight, step);
      const duration = (given as unknown[] | undefined)?.[index] ?? null;
      return duration === null ? step : { ...step, seconds: seconds(`${where}.seconds.${kite}[${index}]`, duration) };
    });
  }
  return { origin: "figure", figure: figure.slug, variant: variant.id, paths };
}

// `figures` — каталог, на фигуры которого рутина ссылается.
export function parseRoutine(file: string, content: string, figures: Figure[]): Routine {
  const slug = path.basename(file, EXTENSION);
  if (!SLUG.test(slug)) {
    fail(file, "имя файла рутины состоит из строчных латинских букв, цифр и дефисов");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (error) {
    fail(file, `не JSON (${(error as Error).message})`);
  }
  const value = record(file, raw, KEYS);
  if (value.schema !== ROUTINE_SCHEMA) {
    fail(file, `поле «schema» должно быть равно ${ROUTINE_SCHEMA}`);
  }
  if (typeof value.discipline !== "string" || !Object.hasOwn(DISCIPLINES, value.discipline)) {
    fail(file, `поле «discipline» — одно из: ${Object.keys(DISCIPLINES).join(", ")}`);
  }
  const discipline = value.discipline as Discipline;
  if (!Array.isArray(value.kites) || value.kites.length === 0) {
    fail(`${file}: kites`, "ожидается непустой список номеров кайтов");
  }
  const kites = value.kites.map((item, index) => text(`${file}: kites[${index}]`, item));
  if (new Set(kites).size !== kites.length) {
    fail(`${file}: kites`, "номера кайтов повторяются");
  }
  const [least, most] = crewOf(discipline);
  if (kites.length < least || kites.length > most) {
    fail(`${file}: kites`, `в разделе «${discipline}» кайтов ${least === most ? `ровно ${least}` : `не меньше ${least}`}, а записано ${kites.length}`);
  }
  if (!Array.isArray(value.segments) || value.segments.length === 0) {
    fail(`${file}: segments`, "ожидается непустой список частей рутины");
  }
  const origins = value.segments.map((item, index) => {
    const where = `${file}: segments[${index}]`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      fail(where, "ожидается объект");
    }
    const origin = (item as Record<string, unknown>).origin;
    if (typeof origin !== "string" || !ORIGINS.includes(origin as Origin)) {
      fail(`${where}.origin`, `ожидается одно из: ${ORIGINS.join(", ")}`);
    }
    return origin as Origin;
  });
  const flights = new Map<string, Flight>(
    kites.map((kite) => [kite, { pose: { position: null, heading: null }, calls: [], judged: 0 }]),
  );
  const segments = value.segments.map((item, index) => {
    const where = `${file}: segments[${index}]`;
    const origin = origins[index];
    if (origin === "figure") {
      return figureSegment(where, record(where, item, ["origin", "figure", "variant", "seconds"]), { discipline, kites }, flights, figures);
    }
    // Связка — переход к фигуре или от неё; путь без фигуры рядом — своя работа.
    if (origin === "link" && origins[index - 1] !== "figure" && origins[index + 1] !== "figure") {
      fail(`${where}.origin`, "связка стоит рядом с фигурой каталога — до неё или после; иначе это «own»");
    }
    return ownSegment(where, record(where, item, ["origin", "paths"]), kites, flights);
  });
  for (const kite of kites) {
    const flight = flights.get(kite)!;
    const where = `${file}: кайт «${kite}»`;
    if (flight.pose.position === null) {
      fail(where, "в рутине нет ни одного шага этого кайта");
    }
    if (flight.calls.join(",") !== "in,out") {
      fail(where, "в рутине должна быть ровно одна отметка «in» и после неё ровно одна «out»");
    }
    if (flight.judged === 0) {
      fail(where, "между «in» и «out» нет ни одного отрезка или дуги");
    }
  }
  const routine: Routine = { slug, name: text(`${file}: name`, value.name), discipline, kites, segments };
  if (value.summary !== undefined) {
    routine.summary = text(`${file}: summary`, value.summary);
  }
  return routine;
}

export type Placed = { step: Timed<Step> | Timed<OwnStep>; origin: Origin; segment: number };

// Весь путь одного кайта по порядку; у каждого шага — из какой он части и
// откуда она взята.
export function kiteSteps(routine: Routine, kite: string): Placed[] {
  return routine.segments.flatMap((segment, index) =>
    (segment.paths[kite] ?? []).map((step) => ({ step, origin: segment.origin, segment: index })),
  );
}

// Рутины каталога по имени файла. Каталога может не быть вовсе: пока в
// репозитории рутин нет. Битый файл роняет сборку с именем файла.
export function listRoutines(dir: string = ROUTINES_DIR, figures: Figure[] = listFigures()): Routine[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const names: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.name.toLowerCase().endsWith(EXTENSION)) {
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(EXTENSION)) {
      fail(entry.name, `рутина — обычный файл с расширением «${EXTENSION}» строчными буквами`);
    }
    names.push(entry.name);
  }
  return names.sort().map((name) => parseRoutine(name, fs.readFileSync(path.join(dir, name), "utf8"), figures));
}

// Рутина как страница: лента кадров, обзорная схема и шаги со временем. Всё
// считается из разобранной рутины (`lib/routines.ts`); разметку собирает
// `components/RoutineView.tsx`.
//
// Кадр — то, что чертёж умеет рисовать: вариант с путём на каждый кайт. Границу
// кадра ставит автор рутины, а не этот модуль: кадр — это часть рутины, в
// которой кайт перемещается. Часть без перемещения (старт и вызов, остановка,
// поворот на месте) своего кадра не получает: она описывает точку, куда привёл
// предыдущий пролёт, и показана в кадре перед ней, а до первого пролёта — в
// кадре после. Поэтому в одном кадре книжное и своё не чередуются: все его
// пролёты взяты из одного места.
//
// Обзорная схема — те же кадры одной тонкой линией, без значков, стрелок и
// слов: путь на минуты ложится сам на себя, и значкам на нём места нет. На ней
// стоят только номера кадров, каждый у начала своего кадра; номера друг на
// друга не ложатся — см. `overviewOf`.
//
// Время — только то, что записал автор (`seconds`). Шаг без него остаётся без
// времени, и накопленное время после него не считается: числа за автора модуль
// не подставляет.

import { along, type Drawing, drawVariant, frameLabel, VIEW } from "./diagram";
import { type Figure, figureTitle } from "./figures";
import { GRID, type Guide, isSwing, type Kite, type OwnStep, pivotOf, type Point, poseAfter, type Step, type Variant } from "./geometry";
import { legsOf } from "./pose";
import { type Origin, type Routine, type Timed } from "./routines";
import { describeKite, lineText, startsLine } from "./steps";

type Recorded = Timed<Step> | Timed<OwnStep>;

// Откуда взята часть кадра; у фигуры — её страница в каталоге.
export type FramePart = { segment: number; origin: Origin; figure?: { slug: string; title: string } };

export type FrameLine = {
  text: string;
  // Направление шага книга не показывает — пометка, как на странице фигуры.
  unmarked: boolean;
  // Когда строка начинается, в секундах от первого шага кайта; `null` — до неё
  // есть шаг без заданного темпа.
  at: number | null;
  // Сколько она длится; `null` — у шага в ней темп не задан. Ноль — в строке
  // нет ничего, что длится: старт и вызовы.
  seconds: number | null;
};

export type Frame = {
  number: number;
  parts: FramePart[];
  variant: Variant;
  drawing: Drawing;
  // Шаги каждого кайта словами; `first` — номер первой строки: счёт строк у
  // кайта сквозной через все кадры.
  kites: { id: string; color: number; first: number; lines: FrameLine[] }[];
  // Когда кадр начинается у первого кайта.
  at: number | null;
};

// Время одного кайта. `judged` — от вызова «in» до вызова «out».
export type Clock = { kite: string; total: number | null; judged: number | null; untimed: number };

export type Storyboard = { frames: Frame[]; clocks: Clock[] };

const flies = (step: Recorded) => step.kind === "line" || step.kind === "arc" || (step.kind === "rotate" && step.to !== undefined);

// У старта и вызовов длительности нет — так решает формат.
const lasts = (step: Recorded) => step.kind !== "start" && !(step.kind === "mark" && (step.mark === "in" || step.mark === "out"));

// Шаг, как его читает чертёж. `basis` чертежу нужен только затем, чтобы
// поставить значок у координаты не с линии сетки; у своего шага этого поля нет,
// и значка нет. «grid» здесь значит «значка не ставить», а не «прочитано с
// сетки книги»: в данные рутины оно не попадает.
function drawn(step: Recorded): Step {
  const rest = { ...step };
  delete rest.seconds;
  return (rest.kind === "start" || rest.kind === "line" || rest.kind === "arc" ? { basis: "grid", ...rest } : rest) as Step;
}

const stepsOf = (segment: Routine["segments"][number], kite: string): Recorded[] => segment.paths[kite] ?? [];

// Части рутины по кадрам.
function groupsOf(routine: Routine): number[][] {
  const groups: number[][] = [];
  let leading: number[] = [];
  routine.segments.forEach((segment, index) => {
    if (Object.values(segment.paths).some((path) => path.some(flies))) {
      groups.push([...leading, index]);
      leading = [];
    } else if (groups.length > 0) {
      groups[groups.length - 1].push(index);
    } else {
      leading.push(index);
    }
  });
  return groups;
}

// `figures` — каталог, на фигуры которого рутина ссылается: у фигуры берутся
// название, линии сетки и вспомогательные линии её схемы.
export function storyboard(routine: Routine, figures: Figure[]): Storyboard {
  const rev = routine.discipline.startsWith("multi-line");
  const many = routine.kites.length > 1;
  const groups = groupsOf(routine);
  const variantOf = (segment: Extract<Routine["segments"][number], { origin: "figure" }>) => {
    const figure = figures.find((item) => item.slug === segment.figure);
    const variant = figure?.geometry.status === "ok" ? figure.geometry.variants.find((item) => item.id === segment.variant) : undefined;
    if (!figure || !variant) {
      throw new Error(`рутина «${routine.slug}»: фигуры «${segment.figure}» с вариантом «${segment.variant}» нет в каталоге`);
    }
    return { figure, variant };
  };
  // Что известно о каждом кайте к началу очередного кадра.
  const flights = routine.kites.map((kite) => {
    const path = routine.segments.flatMap((segment) => stepsOf(segment, kite).map(drawn));
    return {
      kite,
      // Курс, с которым кайт пришёл к каждому шагу, — по номеру шага в пути.
      noses: new Map(legsOf(path, rev).map((leg) => [leg.index, leg.nose])),
      position: null as Point | null,
      seen: 0,
      line: 1,
      clock: 0 as number | null,
      // Время от «in» до «out» копится своим счётом: шаг без темпа до «in»
      // его не портит.
      judged: undefined as number | null | undefined,
      judging: false,
      untimed: 0,
    };
  });

  const frames = groups.map((group, at): Frame => {
    const number = at + 1;
    const xs = new Set<number>();
    const ys = new Set<number>();
    const lines: Guide[] = [];
    // Точки своих шагов: линии через них нужны только кадру без фигуры.
    const ownXs = new Set<number>();
    const ownYs = new Set<number>();
    let book = false;
    const parts = group.map((index): FramePart => {
      const segment = routine.segments[index];
      if (segment.origin !== "figure") {
        return { segment: index, origin: segment.origin };
      }
      const { figure, variant } = variantOf(segment);
      // Линии сетки и вспомогательные линии — факт о странице книги: у кадра
      // фигуры они те же, что на её схеме.
      variant.grid.x.forEach((x) => xs.add(x));
      variant.grid.y.forEach((y) => ys.add(y));
      if (variant.guides.status === "ok") {
        lines.push(...variant.guides.lines);
      }
      book ||= variant.path_kites === "book";
      return { segment: index, origin: segment.origin, figure: { slug: figure.slug, title: figureTitle(figure) } };
    });

    const startedAt = flights[0].clock;
    const kites: Kite[] = [];
    const entry: (Point | null)[] = [];
    const told: Frame["kites"] = [];
    flights.forEach((flight, order) => {
      const steps = group.flatMap((index) => stepsOf(routine.segments[index], flight.kite));
      if (steps.length === 0) {
        // Кайт в окне ещё не появился либо в этом кадре стоит и ничего не
        // делает: рисовать и называть нечего.
        return;
      }
      const path: Step[] = [];
      // Шаги, записанные не со страницы книги: слова о них книгу не называют.
      const ours = new Set<Step>();
      const own = steps[0]?.kind === "start";
      if (!own) {
        // Кадр продолжает путь: начинается там, где кайт стоит. У кадра фигуры
        // это её точка входа — с тем же происхождением координаты, что в
        // каталоге.
        const first = group.map((index) => routine.segments[index]).find((segment) => stepsOf(segment, flight.kite).length > 0);
        const start = first?.origin === "figure" ? variantOf(first).variant.kites.find((item) => item.id === flight.kite)?.path[0] : undefined;
        path.push({ kind: "start", at: flight.position!, basis: start?.kind === "start" ? start.basis : "grid" });
      }
      entry.push(own ? null : (flight.noses.get(flight.seen) ?? null));

      // Время строки — сумма длительностей её шагов; строка открывается точкой
      // старта и каждым перемещением, как в шагах фигуры.
      const timing: { at: number | null; seconds: number | null }[] = own ? [] : [{ at: flight.clock, seconds: 0 }];
      for (const index of group) {
        const segment = routine.segments[index];
        for (const step of stepsOf(segment, flight.kite)) {
          const shown = drawn(step);
          if (startsLine(shown)) {
            timing.push({ at: flight.clock, seconds: 0 });
          }
          const line = timing[timing.length - 1];
          if (step.kind === "mark" && step.mark === "in" && flight.judged === undefined) {
            flight.judged = 0;
            flight.judging = true;
          }
          if (step.kind === "mark" && step.mark === "out") {
            flight.judging = false;
          }
          if (lasts(step)) {
            if (step.seconds === undefined) {
              flight.untimed += 1;
              flight.clock = null;
              line.seconds = null;
              if (flight.judging) {
                flight.judged = null;
              }
            } else {
              flight.clock = flight.clock === null ? null : flight.clock + step.seconds;
              line.seconds = line.seconds === null ? null : line.seconds + step.seconds;
              if (flight.judging && flight.judged != null) {
                flight.judged += step.seconds;
              }
            }
          }
          // Свои шаги сами называют нужные линии сетки: через каждую точку
          // пути. У шагов фигуры набор линий снят со страницы книги.
          const before = flight.position;
          flight.position = poseAfter({ position: flight.position, heading: null }, step).position;
          if (segment.origin !== "figure") {
            for (const point of [before, flight.position]) {
              if (point) {
                ownXs.add(point[0]);
                ownYs.add(point[1]);
              }
            }
          }
          path.push(shown);
          if (segment.origin !== "figure") {
            ours.add(shown);
          }
        }
      }
      flight.seen += steps.length;

      const color = (order % 5) + 1;
      const kite: Kite = { id: flight.kite, path, color };
      kites.push(kite);
      const described = describeKite(kite, ours).map((line, index) => ({
        text: lineText(line, many),
        unmarked: line.tags.includes("unmarked"),
        ...timing[index],
        idle: line.events.length === 0,
      }));
      // Строка «точка, где кадр начинается» нужна, только когда в этой точке
      // что-то происходит до первого перемещения; настоящий старт стоит всегда.
      const kept = described.filter((line, index) => own || index > 0 || !line.idle);
      told.push({ id: flight.kite, color, first: flight.line, lines: kept.map(({ text, unmarked, at, seconds }) => ({ text, unmarked, at, seconds })) });
      flight.line += kept.length;
    });

    // У кадра фигуры линии сетки — ровно те, что на её схеме: своя часть без
    // перемещения, показанная в нём заодно, новых линий не добавляет.
    if (!parts.some((part) => part.figure)) {
      ownXs.forEach((x) => xs.add(x));
      ownYs.forEach((y) => ys.add(y));
    }
    const sorted = (values: Set<number>) => [...values].sort((a, b) => a - b);
    const variant: Variant = {
      id: `kadr-${number}`,
      kites,
      grid: { x: sorted(xs), y: sorted(ys) },
      guides: lines.length > 0 ? { status: "ok", lines } : { status: "not_found", reason: "В кадре рутины вспомогательных линий нет." },
      ...(book ? { path_kites: "book" as const } : {}),
    };
    return {
      number,
      parts,
      variant,
      drawing: drawVariant(variant, rev, { entry, number, more: number < groups.length, team: many }),
      kites: told,
      at: startedAt,
    };
  });

  const clocks = flights.map(({ kite, clock, judged, untimed }): Clock => ({ kite, total: clock, judged: judged ?? null, untimed }));
  return { frames, clocks };
}

export type Overview = {
  viewBox: string;
  // Линия каждого кайта в каждом кадре.
  tracks: { frame: number; color: number; d: string }[];
  // Повороты со смещением: дуга носа, как на схеме кадра.
  swings: string;
  // Номер кадра у точки, где кадр начинается, и выноска к этой точке.
  labels: { frame: number; x: number; y: number; text: string }[];
  leads: string;
};

// Поле вокруг окна — то же, что у схемы кадра.
const MARGIN = -VIEW.top;
// Полуширина и высота номера кадра в единицах сетки: жирный шрифт в 6 единиц.
const HALF = 1.9;
const TALL = 7;

// Точки пути через каждые три единицы: номера кадров обходят линии.
function samples(variant: Variant): Point[] {
  const points: Point[] = [];
  for (const kite of variant.kites) {
    let here: Point | null = null;
    for (const step of kite.path) {
      if (step.kind === "start") {
        here = step.at;
      } else if (here && (step.kind === "line" || step.kind === "arc" || isSwing(step))) {
        const move: Extract<Step, { kind: "line" | "arc" }> = isSwing(step)
          ? { kind: "arc", to: step.to, center: pivotOf(here, step.to, step.direction, step.degrees), direction: step.direction, sweep: step.degrees, basis: "grid", nose: "forward" }
          : step;
        const from = here;
        const length = move.kind === "line" ? Math.hypot(move.to[0] - from[0], move.to[1] - from[1]) : (Math.hypot(from[0] - move.center[0], from[1] - move.center[1]) * move.sweep * Math.PI) / 180;
        const count = Math.max(2, Math.ceil(length / 3));
        points.push(...Array.from({ length: count + 1 }, (_, index) => along(from, move, index / count).point));
        here = step.to;
      }
    }
  }
  return points;
}

// Обзорная схема: все кадры одной тонкой линией. Наложения здесь двух родов, и
// решены они по-разному.
//
// Линии. Путь проходит по одним и тем же местам много раз, и развести проходы
// нельзя, не увезя их с координат. Поэтому на обзоре нет ничего, что на линию
// можно положить: ни значков кайта, ни стрелок, ни слов событий. Линия,
// пройденная дважды, выглядит как пройденная один раз; обзор отвечает на вопрос
// «где в окне летит рутина», а порядок и события читаются по кадрам.
//
// Номера кадров. Кадры часто начинаются в одной точке, и номера у неё легли бы
// друг на друга. Номер ищет место вокруг своей точки — сперва ближе, потом
// дальше, по восьми сторонам; занятым считается место, где он задел бы уже
// поставленный номер. Из свободных берётся первое, где он не лежит и на линии;
// когда такого нет — первое свободное от номеров. Номер, ушедший от точки,
// связан с ней выноской.
export function overviewOf(frames: Frame[]): Overview {
  const tracks: Overview["tracks"] = [];
  const busy: Point[] = [];
  for (const frame of frames) {
    frame.drawing.tracks.forEach((track, index) => {
      tracks.push({ frame: frame.number, color: frame.variant.kites[index].color ?? 1, d: track.d });
    });
    busy.push(...samples(frame.variant));
  }
  const placed: { spot: Point; half: number }[] = [];
  const labels: Overview["labels"] = [];
  let leads = "";
  const sides: Point[] = [
    [0, 1],
    [1, 0.6],
    [-1, 0.6],
    [1, -0.6],
    [-1, -0.6],
    [0, -1],
    [1, 0],
    [-1, 0],
  ];
  for (const frame of frames) {
    const start = frame.variant.kites[0]?.path[0];
    if (start?.kind !== "start") {
      continue;
    }
    const text = frameLabel(frame.number);
    const half = text.length * HALF;
    const spots = Array.from({ length: 12 }, (_, ring) => 7 + ring * 5).flatMap((far) =>
      sides.map(([ux, uy]): Point => [start.at[0] + ux * (far + (ux === 0 ? 0 : half)), start.at[1] + uy * far]),
    );
    const fits = ([x, y]: Point) => Math.abs(x) + half <= GRID.xMax + MARGIN - 1 && y >= 4 && y <= GRID.yMax + MARGIN - 5;
    const apart = ([x, y]: Point) => placed.every((other) => Math.abs(other.spot[0] - x) >= other.half + half + 1.5 || Math.abs(other.spot[1] - y) >= TALL);
    const clear = ([x, y]: Point) => busy.every((other) => Math.abs(other[0] - x) >= half + 1.5 || Math.abs(other[1] - y) >= TALL / 2 + 1);
    const free = spots.filter((spot) => fits(spot) && apart(spot));
    const spot = free.find(clear) ?? free[0] ?? spots[0];
    placed.push({ spot, half });
    labels.push({ frame: frame.number, x: round(spot[0]), y: round(GRID.yMax - spot[1] + 2), text });
    leads += `M${round(start.at[0])} ${round(GRID.yMax - start.at[1])}L${round(spot[0])} ${round(GRID.yMax - spot[1])}`;
  }
  return {
    viewBox: `${VIEW.left} ${VIEW.top} ${VIEW.width} ${GRID.yMax + 2 * MARGIN}`,
    tracks,
    // От поворота со смещением на обзоре остаётся дуга, без наконечника.
    swings: frames
      .flatMap((frame) => frame.drawing.swings.split("M"))
      .filter((piece) => piece.includes("A"))
      .map((piece) => `M${piece}`)
      .join(""),
    labels,
    leads,
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

const comma = (value: number) => String(value).replace(".", ",");

// Отметка времени: «1:07», с десятыми — «1:07,5».
export function clockText(seconds: number): string {
  const tenths = Math.round(seconds * 10);
  const rest = tenths % 600;
  return `${Math.floor(tenths / 600)}:${String(Math.floor(rest / 10)).padStart(2, "0")}${rest % 10 ? `,${rest % 10}` : ""}`;
}

// Длительность: «4 с», «1,5 с».
export function spanText(seconds: number): string {
  return `${comma(Math.round(seconds * 10) / 10)} с`;
}

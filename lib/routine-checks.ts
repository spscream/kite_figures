// Проверки рутины: подсказки автору программы. Описаны в
// `docs/routine-checks.md`; меняя одно, меняй другое.
//
// Это не судейство. Проверка сверяет запись рутины с тем, что свод правил и
// судейская книга называют условием, и говорит, что из этого видно по файлу.
// Каждая находка несёт одно из трёх оснований, и слова у них разные:
// правила требуют; правила называют критерием, а меры не дают; мера наша.
//
// Модуль ничего не читает с диска: ему дают разобранную рутину. Того, что
// разбор уже проверил (один «in», один «out»), он на веру не берёт — рутину
// может собрать и редактор, минуя файл.

import { arcPoint, GRID, pivotOf, UNSPECIFIED, type OwnStep, type Point, type Step } from "./geometry";
import type { Routine, Timed } from "./routines";

// На чём стоит находка.
export const STANDINGS = {
  rule: "Правила требуют",
  criterion: "Правила называют критерием, меры не дают",
  own: "Наша мера, не правило",
} as const;
export type Standing = keyof typeof STANDINGS;

// Что проверка увидела в файле:
// `ok` — условие выполнено; `violation` — нарушено;
// `unknown` — по этой записи не решить: не хватает темпа либо запись сама себе
// противоречит;
// `unchecked` — по файлу не решается вовсе либо здесь не считается;
// `fact` — число без вывода: ни порога, ни «хорошо» и «плохо» у него нет.
export type State = "ok" | "violation" | "unknown" | "unchecked" | "fact";

export const CHECKS = ["calls", "duration", "ends", "crew", "window", "variety"] as const;
export type Check = (typeof CHECKS)[number];

// Место в первоисточнике: документ реестра `data/sources.json`, пункт, страница.
export type Citation = { document: "iskrb" | "iskjb"; section: string; page: number };

export type Finding = {
  check: Check;
  // Какой именно исход проверки: `duration.short`, `calls.missing`.
  code: string;
  standing: Standing;
  state: State;
  // Своими словами, без основания в начале: его добавляет `findingText`.
  text: string;
  sources: Citation[];
};

const RB = (section: string, page: number): Citation => ({ document: "iskrb", section, page });
const JB = (section: string, page: number): Citation => ({ document: "iskjb", section, page });

// Всё, на что проверки ссылаются. Сверено с текстом документов 2026-10-11.
export const CITED = {
  calls: RB("IV.F.1", 13),
  competitor: RB("II.J", 8),
  noCall: JB("XI.D", 24),
  times: RB("IV.I.3.c", 17),
  short: JB("XI.A.2.a", 24),
  long: JB("XI.A.2.b", 24),
  ends: JB("XI.A.3", 24),
  crew: RB("III.K.2", 11),
  execution: RB("IV.I.3.a", 17),
  judged: JB("VIII.B.2.a", 21),
  window: JB("VII.B.9", 20),
  content: RB("IV.I.3.b", 17),
} as const;

// Состав — последнее слово в имени раздела.
export type Crew = "individual" | "pair" | "team";

const CREW_NAMES: Record<Crew, string> = { individual: "одиночника", pair: "пары", team: "команды" };

// Наименьшее и наибольшее время технической рутины, секунды; обе границы
// входят: правила наказывают то, что «не дотягивает» до минимума и что
// «превышает» максимум.
export const TIME_LIMITS: Record<Crew, readonly [number, number]> = {
  individual: [60, 180],
  pair: [120, 240],
  team: [120, 240],
};

// Сколько человек в команде в дисциплине Precision, частью которой идёт
// техническая рутина.
export const TEAM_MOST = 5;

export function crewName(routine: Pick<Routine, "discipline">): Crew {
  const crew = routine.discipline.split("-").at(-1);
  if (crew !== "individual" && crew !== "pair" && crew !== "team") {
    throw new Error(`раздел «${routine.discipline}»: состав по имени раздела не определяется`);
  }
  return crew;
}

type Any = Timed<Step> | Timed<OwnStep>;

function pathOf(routine: Routine, kite: string): Any[] {
  return routine.segments.flatMap((segment) => (segment.paths[kite] ?? []) as Any[]);
}

const isCall = (step: Any, mark: "in" | "out") => step.kind === "mark" && step.mark === mark;

function callsOf(path: Any[]): ("in" | "out")[] {
  return path.flatMap((step) => (isCall(step, "in") ? ["in" as const] : isCall(step, "out") ? ["out" as const] : []));
}

// Шаги между вызовами — то, что правила называют рутиной. `null` — вызовы не
// стоят как один «in» и после него один «out», и границ у рутины нет.
function judgedOf(path: Any[]): Any[] | null {
  if (callsOf(path).join(",") !== "in,out") {
    return null;
  }
  // Шаг «start» длительности не несёт; после разбора его между вызовами нет.
  return path
    .slice(path.findIndex((step) => isCall(step, "in")) + 1, path.findIndex((step) => isCall(step, "out")))
    .filter((step) => step.kind !== "start");
}

// Длительность шага — положительное число секунд; всё остальное, что может
// прийти мимо разбора (пустое поле ввода, ноль, минус), — темп не задан.
const timed = (step: Any): step is Any & { seconds: number } =>
  typeof step.seconds === "number" && Number.isFinite(step.seconds) && step.seconds > 0;

// Сумма секунд складывается из десятых и сотых, и в двоичной записи 59,7 +
// 0,1 + 0,2 — это не 60. Тысячная секунды — точность, с которой сравнивается
// время.
const millis = (value: number) => Math.round(value * 1000) / 1000;

// Одна и та же сумма, по-разному разбитая на шаги, может округлиться в
// соседние тысячные; разным время кайтов считается, когда расходится больше.
const apart = (a: number, b: number) => Math.abs(a - b) > 0.0015;

// Число по-русски; `digits` — сколько знаков после запятой оставить.
function number(value: number, digits = 2): string {
  const scale = 10 ** digits;
  return String(Math.round(value * scale) / scale)
    .replace(".", ",")
    .replace("-", "−");
}

// 95 → «1 мин 35 с». Пишется с той же точностью, с какой время сравнивается:
// иначе 59,999 с читалось бы как «60 с — меньше наименьшего времени».
export function clock(seconds: number): string {
  const total = millis(seconds);
  const minutes = Math.floor(total / 60);
  const rest = millis(total - minutes * 60);
  if (minutes === 0) {
    return `${number(rest, 3)} с`;
  }
  return rest === 0 ? `${minutes} мин` : `${minutes} мин ${number(rest, 3)} с`;
}

function cite(...sources: Citation[]): string {
  const names = { iskrb: "ISKRB", iskjb: "ISKJB" } as const;
  return sources.map((source) => `${names[source.document]} ${source.section}, стр. ${source.page}`).join("; ");
}

const kiteLabel = (routine: Routine, kite: string) => (routine.kites.length === 1 ? "кайта" : `кайта «${kite}»`);

// Вызовы IN и OUT: участник обязан назвать начало и конец рутины.
function checkCalls(routine: Routine): Finding {
  const rule = `участник обязан назвать начало технической рутины вызовом IN, а конец — вызовом OUT (${cite(CITED.calls)})`;
  const all = routine.kites.map((kite) => ({ kite, calls: callsOf(pathOf(routine, kite)) }));
  // Вызова нет ни у одного кайта: участник его не назвал.
  const absent = (["in", "out"] as const).filter((mark) => all.every(({ calls }) => !calls.includes(mark)));
  if (absent.length > 0) {
    return {
      check: "calls",
      code: "calls.missing",
      standing: "rule",
      state: "violation",
      sources: [CITED.calls, CITED.noCall],
      text: `${rule}. В записи ${routine.kites.length === 0 ? "нет ни одного кайта" : `нет вызова ${absent.map((mark) => mark.toUpperCase()).join(" и ")}`}. Техническую рутину, у которой вызов не назван, судьи не засчитывают целиком (${cite(CITED.noCall)}).`,
    };
  }
  // Участник — пара или команда целиком, так что вызов у кайтов общий. Отметка,
  // которая стоит не у всех или не по одному разу, — противоречие записи, а
  // не пропущенный вызов.
  const odd = all
    .filter(({ calls }) => calls.join(",") !== "in,out")
    .map(({ kite, calls }) => `у ${kiteLabel(routine, kite)} ${calls.length === 0 ? "вызовов нет" : `вызовы идут так: ${calls.map((mark) => mark.toUpperCase()).join(", ")}`}`);
  if (odd.length > 0) {
    return {
      check: "calls",
      code: "calls.tangled",
      standing: "rule",
      state: "unknown",
      sources: [CITED.calls],
      text: `${rule}. Здесь это читается как один IN и после него один OUT${routine.kites.length === 1 ? "" : " у каждого кайта"}, а в записи ${odd.join("; ")}. Где рутина начинается и кончается, по такой записи не сказать.`,
    };
  }
  return {
    check: "calls",
    code: "calls.ok",
    standing: "rule",
    state: "ok",
    sources: [CITED.calls],
    text: `${rule}. В записи оба вызова есть${routine.kites.length === 1 ? "" : " у каждого кайта"}.`,
  };
}

// Время кайта между вызовами: сумма заданных длительностей и число шагов, чей
// темп не задан. `null` — у кайта нет однозначных «in» и «out».
export type KiteTime = { kite: string; seconds: number; untimed: number };

export function judgedTimes(routine: Routine): (KiteTime | null)[] {
  return routine.kites.map((kite) => {
    const judged = judgedOf(pathOf(routine, kite));
    if (judged === null) {
      return null;
    }
    const given = judged.filter(timed);
    return {
      kite,
      seconds: millis(given.reduce((sum, step) => sum + step.seconds, 0)),
      untimed: judged.length - given.length,
    };
  });
}

const LONG = `По правилам судьи смотрят только то, что пролётано до отметки наибольшего времени, и превышение штрафуется (${cite(CITED.long)}); штраф применяется единогласным решением судей.`;

// Длительность: время между IN и OUT в границах для состава.
function checkDuration(routine: Routine): Finding {
  const crew = crewName(routine);
  const [least, most] = TIME_LIMITS[crew];
  const limits = `от ${clock(least)} до ${clock(most)}`;
  const rule = `техническая рутина ${CREW_NAMES[crew]} длится ${limits} (${cite(CITED.times)})`;
  const base = { check: "duration" as const, standing: "rule" as const };
  const times = judgedTimes(routine);
  if (times.length === 0 || times.includes(null)) {
    return {
      ...base,
      code: "duration.no-calls",
      state: "unknown",
      sources: [CITED.times],
      text: `${rule}. Время здесь считается от IN до OUT, а в записи эти вызовы не стоят как один IN и после него один OUT — считать не от чего.`,
    };
  }
  const known = times as KiteTime[];
  const full = known.filter((time) => time.untimed === 0);
  const part = known.filter((time) => time.untimed > 0);
  // Вызов один на всех: у кайтов пары или команды время между IN и OUT одно.
  // Шаг без длительности тоже займёт время, так что недосчитанный кайт летит
  // дольше суммы своих заданных шагов.
  if (full.some((time) => apart(time.seconds, full[0].seconds)) || (full.length > 0 && part.some((time) => time.seconds >= full[0].seconds))) {
    return {
      ...base,
      code: "duration.disagree",
      state: "unknown",
      sources: [CITED.times, CITED.competitor],
      text: `${rule}. Участник — пара или команда целиком (${cite(CITED.competitor)}), поэтому вызовы IN и OUT здесь считаются общими для всех кайтов, а время между ними у кайтов записано разное: ${known
        .map((time) => `«${time.kite}» — ${time.untimed === 0 ? "" : "больше "}${clock(time.seconds)}`)
        .join(", ")}. Запись противоречит сама себе, и сравнивать с границами нечего.`,
    };
  }
  if (full.length === 0) {
    const longest = Math.max(...part.map((time) => time.seconds));
    const untimed = part.reduce((sum, time) => sum + time.untimed, 0);
    if (longest === 0) {
      return {
        ...base,
        code: "duration.untimed",
        state: "unknown",
        sources: [CITED.times],
        text: `${rule}. В записи темп не задан ни у одного шага между IN и OUT (шагов — ${untimed}). Уложится ли рутина в границы, по записи пока не сказать.`,
      };
    }
    const gap = `темп задан не у всех шагов между IN и OUT (без длительности — ${untimed})`;
    const given = `${part.length === 1 ? "заданные" : "заданные у кайта с наибольшей суммой"} дают ${clock(longest)}`;
    if (longest >= most) {
      return {
        ...base,
        code: "duration.long",
        state: "violation",
        sources: [CITED.times, CITED.long],
        text: `${rule}. В записи ${gap}, но уже ${given}, а шаги без длительности время только добавят — выйдет больше наибольшего времени. ${LONG}`,
      };
    }
    return {
      ...base,
      code: "duration.untimed",
      state: "unknown",
      sources: [CITED.times],
      text: `${rule}. В записи ${gap}; ${given}. Уложится ли рутина в границы, по записи пока не сказать.`,
    };
  }
  const total = full[0].seconds;
  const flown = `в записи от IN до OUT ${clock(total)}`;
  if (total < least) {
    return {
      ...base,
      code: "duration.short",
      state: "violation",
      sources: [CITED.times, CITED.short],
      text: `${rule}, а ${flown} — меньше наименьшего времени. Выступление, которое до наименьшего времени не дотянуло, по правилам считается непролётанным (${cite(CITED.short)}); применяется это единогласным решением судей.`,
    };
  }
  if (total > most) {
    return {
      ...base,
      code: "duration.long",
      state: "violation",
      sources: [CITED.times, CITED.long],
      text: `${rule}, а ${flown} — больше наибольшего времени. ${LONG}`,
    };
  }
  return { ...base, code: "duration.ok", state: "ok", sources: [CITED.times], text: `${rule}; ${flown}.` };
}


// Начало и конец очевидны: условие есть, но оно о полёте, а не о записи.
function checkEnds(): Finding {
  return {
    check: "ends",
    code: "ends.unchecked",
    standing: "rule",
    state: "unchecked",
    sources: [CITED.ends],
    text: `началу и концу рутины следует быть очевидными без пояснений; неясное начало или неясный конец штрафуется (${cite(CITED.ends)}), и штраф применяется единогласным решением судей. Очевидны ли они, решают судьи, глядя на полёт: по записи этого не проверить, и здесь это не проверяется.`,
  };
}

// Число участников команды в дисциплине Precision.
function checkCrew(routine: Routine): Finding[] {
  if (crewName(routine) !== "team" || routine.kites.length === 0) {
    return [];
  }
  const size = routine.kites.length;
  const rule = `в дисциплине Precision, частью которой идёт техническая рутина, в команде не больше ${TEAM_MOST} участников (${cite(CITED.crew)})`;
  const base = { check: "crew" as const, standing: "rule" as const, sources: [CITED.crew] };
  return [
    size > TEAM_MOST
      ? { ...base, code: "crew.over", state: "violation", text: `${rule}, а в записи кайтов ${size}.` }
      : { ...base, code: "crew.ok", state: "ok", text: `${rule}; в записи кайтов ${size}.` },
  ];
}

// Крайние точки пути носа между вызовами, в сетке окна.
export type Extent = {
  x: [number, number];
  y: [number, number];
  // Сколько шагов фигур каталога стоит на месте, которого книга не задаёт.
  unset: number;
};

// Точки дуги, в которых она дальше всего уходит по каждой из осей.
function arcReach(from: Point, center: Point, direction: "cw" | "ccw", sweep: number): Point[] {
  const begin = (Math.atan2(from[1] - center[1], from[0] - center[0]) * 180) / Math.PI;
  const points: Point[] = [];
  for (const axis of [0, 90, 180, 270]) {
    const turn = (((direction === "ccw" ? axis - begin : begin - axis) % 360) + 360) % 360;
    if (turn <= sweep) {
      points.push(arcPoint(from, center, direction, turn));
    }
  }
  return points;
}

// `null` — у какого-то кайта нет однозначных вызовов.
export function judgedExtent(routine: Routine): Extent | null {
  const points: Point[] = [];
  let unset = 0;
  for (const kite of routine.kites) {
    const path = pathOf(routine, kite);
    if (judgedOf(path) === null) {
      return null;
    }
    let position: Point | null = null;
    let judged = false;
    for (const step of path) {
      if (step.kind === "start") {
        position = step.at;
        if (judged) {
          points.push(position);
        }
        continue;
      }
      if (step.kind === "mark") {
        // Точка самого вызова входит в рутину.
        if ((step.mark === "in" || step.mark === "out") && position !== null) {
          points.push(position);
        }
        judged = step.mark === "in" ? true : step.mark === "out" ? false : judged;
        continue;
      }
      const from: Point | null = position;
      const to: Point | null = step.kind === "rotate" ? (step.to ?? position) : step.to;
      position = to;
      if (!judged || from === null || to === null) {
        continue;
      }
      if (("basis" in step && step.basis === UNSPECIFIED) || ("unset" in step && step.unset !== undefined)) {
        unset += 1;
      }
      points.push(to);
      if (step.kind === "arc") {
        points.push(...arcReach(from, step.center, step.direction, step.sweep));
      } else if (step.kind === "rotate" && step.to !== undefined) {
        // Поворот со смещением ведёт нос по дуге вокруг точки поворота.
        points.push(...arcReach(from, pivotOf(from, step.to, step.direction, step.degrees), step.direction, step.degrees));
      }
    }
  }
  if (points.length === 0) {
    return null;
  }
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return { x: [Math.min(...xs), Math.max(...xs)], y: [Math.min(...ys), Math.max(...ys)], unset };
}

// Занятость окна: критерий исполнения без меры и наши крайние точки пути.
function checkWindow(routine: Routine): Finding[] {
  const findings: Finding[] = [
    {
      check: "window",
      code: "window.criterion",
      standing: "criterion",
      state: "unchecked",
      sources: [CITED.execution, CITED.judged, CITED.window],
      text: `использование окна названо среди того, из чего складывается исполнение (${cite(CITED.execution)}), и судьям велено его учитывать (${cite(CITED.judged)}). Определение — умение занять всю область, где кайт обычно может лететь при условиях этого дня (${cite(CITED.window)}). Числа, с которым можно сверить запись, у правил нет, а сама область зависит от условий дня, и по записи её не узнать.`,
    },
  ];
  const extent = judgedExtent(routine);
  if (extent !== null) {
    const many = routine.kites.length > 1;
    findings.push({
      check: "window",
      code: "window.extent",
      standing: "own",
      state: "fact",
      sources: [],
      text: `между IN и OUT ${many ? "носы кайтов проходят" : "нос кайта проходит"} по горизонтали от ${number(extent.x[0])} до ${number(extent.x[1])}, по высоте от ${number(extent.y[0])} до ${number(extent.y[1])} — в единицах сетки окна, где горизонталь идёт от ${number(GRID.xMin)} до ${number(GRID.xMax)}, а высота от ${number(GRID.yMin)} до ${number(GRID.yMax)}. Это крайние точки пути, а не занятая площадь: порога у них нет, и вывода из них проверка не делает.${
        extent.unset === 0 ? "" : ` Шагов, стоящих на месте, которого книга фигур не задаёт, — ${extent.unset}: их место взято от размера нашего значка.`
      }`,
    });
  }
  return findings;
}

// Разнообразие: критерий содержания без меры; здесь не считается.
function checkVariety(): Finding {
  return {
    check: "variety",
    code: "variety.criterion",
    standing: "criterion",
    state: "unchecked",
    sources: [CITED.content],
    text: `разнообразие названо среди того, из чего складывается содержание (${cite(CITED.content)}). Разнообразие чего именно, правила не говорят, и меры не дают. Здесь оно не считается: своей меры у проверки нет.`,
  };
}

// Все проверки рутины по порядку: сначала то, для чего у правил есть условие,
// потом критерии без меры.
export function checkRoutine(routine: Routine): Finding[] {
  return [checkCalls(routine), checkDuration(routine), checkEnds(), ...checkCrew(routine), ...checkWindow(routine), checkVariety()];
}

// Находка строкой: основание всегда стоит первым.
export function findingText(finding: Finding): string {
  return `${STANDINGS[finding.standing]}: ${finding.text}`;
}

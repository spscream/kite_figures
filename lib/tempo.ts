// Темп рутины: длительности шагов как то, что автор правит и получает обратно
// файлом. Здесь всё, что нужно редактору длительностей
// (`components/TempoEditor.tsx`), кроме самих проверок: какие шаги длятся, как
// читается поле ввода, рутина с другими длительностями, текст её файла, время
// начала каждого шага и положение кайта в заданную секунду.
//
// Ни одного числа модуль не подставляет. Длительность есть только у шага, у
// которого её записал автор; шаг без неё остаётся без неё — в рутине, в файле и
// в счёте времени, который после такого шага не называется вовсе.
//
// Модуль исполняется в браузере и с диска ничего не читает: из
// `lib/routines.ts` он берёт только типы.

import type { OwnStep, Step } from "./geometry";
import { type Pose, poseAt } from "./pose";
import { clock, type KiteTime } from "./routine-checks";
import type { Routine, Timed } from "./routines";
import { stepText, UNMARKED_TEXT } from "./steps";

type Recorded = Timed<Step> | Timed<OwnStep>;

// Шаг, который длится. У старта и вызовов «in» и «out» длительности нет — так
// решает формат (`docs/routines.md`); у всего остального она может быть, в том
// числе у остановки, поворота на месте, посадки, взлёта и акселя, у которых
// нет длины пути.
export const lasts = (step: Recorded): boolean => step.kind !== "start" && !(step.kind === "mark" && (step.mark === "in" || step.mark === "out"));

// Место шага в рутине: часть, кайт, номер шага в пути кайта в этой части.
export const slotKey = (segment: number, kite: string, index: number): string => `${segment}/${kite}/${index}`;

// Шаг, у которого редактор спрашивает длительность.
export type Slot = {
  key: string;
  segment: number;
  kite: string;
  index: number;
  // Шаг словами — теми же, что в списке шагов, но без значков происхождения
  // координаты (○ □ ◇): подпись поля называет шаг, а не разбирает его.
  text: string;
  // Длительность, записанная в рутине; `null` — темп шага не задан.
  seconds: number | null;
};

const stepsOf = (routine: Routine, segment: number, kite: string): Recorded[] => routine.segments[segment].paths[kite] ?? [];

// Все шаги рутины, которые длятся: по частям, в части — по кайтам.
export function slotsOf(routine: Routine): Slot[] {
  return routine.segments.flatMap((segment, at) =>
    routine.kites.flatMap((kite) =>
      stepsOf(routine, at, kite).flatMap((step, index) =>
        lasts(step)
          ? [
              {
                key: slotKey(at, kite, index),
                segment: at,
                kite,
                index,
                text:
                  stepText(step as Step, segment.origin !== "figure") +
                  ((step.kind === "line" || step.kind === "arc") && "unmarked" in step && step.unmarked ? ` (${UNMARKED_TEXT})` : ""),
                seconds: step.seconds ?? null,
              },
            ]
          : [],
      ),
    ),
  );
}

// Длительности по месту шага; шага без длительности в наборе нет.
export type Durations = ReadonlyMap<string, number>;

export function durationsOf(routine: Routine): Map<string, number> {
  return new Map(slotsOf(routine).flatMap((slot) => (slot.seconds === null ? [] : [[slot.key, slot.seconds]])));
}

// Поле ввода длительности: до четырёх цифр секунд и до трёх знаков после
// запятой или точки. Границы — поля, а не правил: тысячная — точность, с
// которой проверки сравнивают время, а больше 9999 с не длится ни одна рутина.
// Запятая без цифр за ней («4,») читается как целое: это число на полпути к
// «4,5», и ошибкой посреди набора оно не становится.
const FIELD = /^\d{1,4}(?:[.,]\d{0,3})?$/;

// В поле записано не число секунд.
export const BAD = "bad";

// Что записано в поле: число секунд; `null` — поле пусто, темп шага не задан;
// `BAD` — не длительность. Ноль — тоже не длительность: шаг, который длится,
// длится положительное время, а не заданный темп записывается пустым полем.
export function readField(text: string): number | null | typeof BAD {
  const trimmed = text.trim();
  if (trimmed === "") {
    return null;
  }
  if (!FIELD.test(trimmed)) {
    return BAD;
  }
  const value = Number(trimmed.replace(",", "."));
  return value > 0 ? value : BAD;
}

export function fieldText(seconds: number | null): string {
  return seconds === null ? "" : String(seconds).replace(".", ",");
}

// Что стоит в полях редактора, пока автор ничего не правил: длительность шага
// из рутины, а у шага без неё — пусто. `bare` — все поля пусты.
export function fieldsOf(slots: Slot[], bare = false): Record<string, string> {
  return Object.fromEntries(slots.map((slot) => [slot.key, fieldText(bare ? null : slot.seconds)]));
}

// Та же рутина с другими длительностями: у шага из набора — его число, у
// остальных длительности нет.
export function withDurations(routine: Routine, durations: Durations): Routine {
  const segments = routine.segments.map((segment, at) => ({
    ...segment,
    paths: Object.fromEntries(
      Object.entries(segment.paths).map(([kite, steps]) => [
        kite,
        (steps as Recorded[]).map((step, index) => {
          const rest = { ...step };
          delete rest.seconds;
          const given = durations.get(slotKey(at, kite, index));
          if (given === undefined || !lasts(step)) {
            return rest;
          }
          if (!(given > 0) || !Number.isFinite(given)) {
            throw new RangeError(`шаг ${slotKey(at, kite, index)}: длительность — положительное число секунд, получено ${given}`);
          }
          return { ...rest, seconds: given };
        }),
      ]),
    ),
  }));
  return { ...routine, segments: segments as Routine["segments"] };
}

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

// Поле на прежнем месте с новым значением; нового поля не было — встаёт
// последним; `undefined` поле убирает.
function put(object: Json, key: string, value: unknown): Json {
  const entries = Object.entries(object).flatMap(([name, old]): [string, unknown][] => (name !== key ? [[name, old]] : value === undefined ? [] : [[name, value]]));
  return Object.fromEntries(key in object || value === undefined ? entries : [...entries, [key, value]]);
}

// Файл рутины с другими длительностями. `file` — разобранный JSON файла,
// `routine` — та же рутина после разбора: по ней известно, сколько шагов у
// фигуры, на которую файл только ссылается. Меняется одно поле `seconds`: у
// своего шага оно стоит у шага, у фигуры — списком у ссылки, по значению на
// шаг, `null` — темп не задан; кайт, у которого не задано ничего, списка не
// получает. В файл идёт то же, что в рутину: длительность не у шага, который
// длится, отбрасывается, не положительная — ошибка.
export function fileWithDurations(file: unknown, routine: Routine, given: Durations): Json {
  if (!isRecord(file) || !Array.isArray(file.segments) || file.segments.length !== routine.segments.length) {
    throw new Error("файл рутины и разобранная рутина расходятся: число частей не то");
  }
  const durations = durationsOf(withDurations(routine, given));
  const segments = file.segments.map((raw: unknown, at) => {
    const segment = routine.segments[at];
    if (!isRecord(raw) || raw.origin !== segment.origin || (segment.origin === "figure" && raw.figure !== segment.figure)) {
      throw new Error(`файл рутины и разобранная рутина расходятся: часть ${at + 1}`);
    }
    if (segment.origin === "figure") {
      const lists = routine.kites.flatMap((kite): [string, (number | null)[]][] => {
        const list = stepsOf(routine, at, kite).map((_, index) => durations.get(slotKey(at, kite, index)) ?? null);
        return list.some((value) => value !== null) ? [[kite, list]] : [];
      });
      return put(raw, "seconds", lists.length > 0 ? Object.fromEntries(lists) : undefined);
    }
    if (!isRecord(raw.paths)) {
      throw new Error(`файл рутины: у части ${at + 1} нет путей`);
    }
    const paths = Object.fromEntries(
      Object.entries(raw.paths).map(([kite, steps]) => {
        if (!Array.isArray(steps) || steps.length !== stepsOf(routine, at, kite).length) {
          throw new Error(`файл рутины и разобранная рутина расходятся: часть ${at + 1}, кайт «${kite}»`);
        }
        return [kite, steps.map((step: unknown, index) => (isRecord(step) ? put(step, "seconds", durations.get(slotKey(at, kite, index))) : step))];
      }),
    );
    return { ...raw, paths };
  });
  return { ...file, segments };
}

const flat = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(flat).join(", ")}]`
    : isRecord(value)
      ? `{${Object.entries(value)
          .map(([key, item]) => `${JSON.stringify(key)}: ${flat(item)}`)
          .join(", ")}}`
      : JSON.stringify(value);

// Кайты — в порядке списка `kites` рутины. Разбор JSON сам переставляет ключи
// из одних цифр по возрастанию, так что порядок записи в файле до нас не
// доходит; порядок списка кайтов — единственный, который можно вернуть.
function byKite(value: Json, kites: unknown[]): [string, unknown][] {
  const place = (kite: string) => (kites.includes(kite) ? kites.indexOf(kite) : kites.length);
  return Object.entries(value).sort(([a], [b]) => place(a) - place(b));
}

function segmentText(segment: unknown, kites: unknown[]): string {
  if (!isRecord(segment)) {
    return `    ${flat(segment)}`;
  }
  const fields = Object.entries(segment).map(([key, value]) => {
    if (key === "seconds" && isRecord(value)) {
      return `"seconds": {${byKite(value, kites)
        .map(([kite, list]) => `${JSON.stringify(kite)}: ${flat(list)}`)
        .join(", ")}}`;
    }
    if (key !== "paths" || !isRecord(value)) {
      return `${JSON.stringify(key)}: ${flat(value)}`;
    }
    const paths = byKite(value, kites).map(
      ([kite, steps]) =>
        `${JSON.stringify(kite)}: ${Array.isArray(steps) && steps.length > 0 ? `[\n${steps.map((step) => `      ${flat(step)}`).join(",\n")}\n    ]` : flat(steps)}`,
    );
    return `"paths": {${paths.join(", ")}}`;
  });
  return `    {${fields.join(", ")}}`;
}

// Текст файла рутины в том виде, в каком рутины лежат в `data/routines/`:
// поле на строку, часть на строку, шаг своей части на строку, кайты — в
// порядке списка `kites`. Это и есть вид, в котором файл каталога записан:
// прочитанный и записанный обратно без правок, он выходит тем же байт в байт —
// это держит тест.
export function routineFileText(file: Json): string {
  const kites = Array.isArray(file.kites) ? file.kites : [];
  const fields = Object.entries(file).map(([key, value]) =>
    key === "segments" && Array.isArray(value)
      ? `  "segments": [\n${value.map((segment: unknown) => segmentText(segment, kites)).join(",\n")}\n  ]`
      : `  ${JSON.stringify(key)}: ${flat(value)}`,
  );
  return `{\n${fields.join(",\n")}\n}\n`;
}

export type Timetable = {
  // Когда начинается каждый шаг, который длится, — в секундах от первого шага
  // своего кайта; `null` — до него есть шаг без длительности.
  starts: Map<string, number | null>;
  // Время всего записанного пути каждого кайта; `null` — не складывается.
  kites: { kite: string; total: number | null; untimed: number }[];
};

// Расписание рутины: то же правило, что на её странице, — после шага без
// длительности время не называется.
export function timetable(routine: Routine): Timetable {
  const starts = new Map<string, number | null>();
  const kites = routine.kites.map((kite) => {
    let now: number | null = 0;
    let untimed = 0;
    routine.segments.forEach((_, at) => {
      stepsOf(routine, at, kite).forEach((step, index) => {
        if (!lasts(step)) {
          return;
        }
        starts.set(slotKey(at, kite, index), now);
        if (step.seconds === undefined) {
          untimed += 1;
          now = null;
        } else {
          now = now === null ? null : now + step.seconds;
        }
      });
    });
    return { kite, total: now, untimed };
  });
  return { starts, kites };
}

// «у 1 шага», «у 3 шагов».
const ofSteps = (count: number) => `у ${count} ${count % 10 === 1 && count % 100 !== 11 ? "шага" : "шагов"}`;

// Время одного кайта словами: от IN до OUT (`judged` — из
// `judgedTimes` проверок) и весь записанный путь. Сумма, в которую вошли не все
// шаги, названа суммой заданных, а не временем.
export function timeText(judged: KiteTime | null, whole: Timetable["kites"][number]): string {
  const between =
    judged === null
      ? "от IN до OUT не посчитать: вызовы не стоят как один IN и после него один OUT"
      : judged.untimed === 0
        ? `от IN до OUT — ${clock(judged.seconds)}`
        : judged.seconds === 0
          ? `от IN до OUT длительность не задана ни у одного шага (шагов — ${judged.untimed})`
          : `от IN до OUT заданные шаги дают ${clock(judged.seconds)}, длительность не задана ${ofSteps(judged.untimed)}`;
  const path = whole.total === null ? `весь записанный путь не складывается: длительность не задана ${ofSteps(whole.untimed)}` : `весь записанный путь — ${clock(whole.total)}`;
  return `${between}; ${path}`;
}

// Положение и нос кайта в секунду `seconds` от его первого шага. Вес шага —
// его длительность, поэтому остановка, поворот на месте и посадка занимают
// своё время: кайт стоит в точке, пока оно идёт. `null` — у какого-то шага
// длительность не задана либо не длится ни один: место кайта во времени тогда
// неизвестно, и числа за автора функция не подставляет. `rev` — кайт
// четырёхстропный. Последняя секунда принимается с той точностью, с какой
// время показано и сравнивается, — до тысячной: сумма длительностей в двоичной
// записи бывает чуть меньше самой себя, округлённой.
export function poseAtTime(routine: Routine, kite: string, seconds: number, rev: boolean): Pose | null {
  const path = routine.segments.flatMap((_, at) => stepsOf(routine, at, kite));
  if (path.some((step) => lasts(step) && step.seconds === undefined)) {
    return null;
  }
  const weight = (index: number) => (lasts(path[index]) ? (path[index].seconds ?? 0) : 0);
  const total = path.reduce((sum, _, index) => sum + weight(index), 0);
  if (!(total > 0)) {
    return null;
  }
  if (!(seconds >= 0 && seconds <= total + 0.0015)) {
    throw new RangeError(`время — от 0 до ${total} с, получено ${seconds}`);
  }
  return poseAt(path as Step[], Math.min(1, seconds / total), rev, (leg) => weight(leg.index));
}

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { listFigures } from "./figures";
import type { Step } from "./geometry";
import { poseAt } from "./pose";
import { checkRoutine, judgedTimes } from "./routine-checks";
import { listRoutines, parseRoutine, type Routine, ROUTINES_DIR } from "./routines";
import {
  BAD,
  durationsOf,
  fieldText,
  fileWithDurations,
  lasts,
  poseAtTime,
  readField,
  routineFileText,
  slotKey,
  slotsOf,
  timetable,
  timeText,
  withDurations,
} from "./tempo";

type Raw = Record<string, unknown>;

const figures = listFigures();
const catalog = listRoutines();

const start = (at: [number, number]): Raw => ({ kind: "start", at });
const markIn: Raw = { kind: "mark", mark: "in" };
const markOut: Raw = { kind: "mark", mark: "out" };
const line = (to: [number, number], over: Raw = {}): Raw => ({ kind: "line", to, ...over });
const stall = (over: Raw = {}): Raw => ({ kind: "mark", mark: "stall", nose: 0, ...over });
const turn = (over: Raw = {}): Raw => ({ kind: "rotate", degrees: 90, direction: "cw", about: "center", ...over });
const landing = (over: Raw = {}): Raw => ({ kind: "mark", mark: "landing", ...over });

const file = (segments: unknown[], over: Raw = {}): Raw => ({ schema: 1, name: "Проба", discipline: "multi-line-individual", kites: ["1"], segments, ...over });
const parse = (raw: unknown) => parseRoutine("proba.json", JSON.stringify(raw), figures);
const own = (steps: unknown[], origin = "own"): Raw => ({ origin, paths: { "1": steps } });

// Слайд вправо, остановка, поворот на месте, слайд вниз, посадка.
const flight = (seconds: (number | undefined)[]) => {
  const [slide, hold, spin, drop, land] = seconds.map((value) => (value === undefined ? {} : { seconds: value }));
  return file([own([start([-50, 40]), markIn, line([0, 40], { nose: 0, ...slide }), stall(hold), turn(spin), line([0, 0], { nose: 90, ...drop }), landing(land), markOut])]);
};

const raw = (slug: string) => JSON.parse(fs.readFileSync(path.join(ROUTINES_DIR, `${slug}.json`), "utf8")) as Raw;

describe("шаги, которые длятся", () => {
  it("длится всё, кроме старта и вызовов: остановка, поворот на месте и посадка — тоже", () => {
    const routine = parse(flight([4, 2, 1.5, 3, 1]));
    expect(routine.segments[0].paths["1"].map(lasts)).toEqual([false, false, true, true, true, true, true, false]);
    expect(slotsOf(routine).map((slot) => [slot.key, slot.seconds])).toEqual([
      ["0/1/2", 4],
      ["0/1/3", 2],
      ["0/1/4", 1.5],
      ["0/1/5", 3],
      ["0/1/6", 1],
    ]);
    expect(slotsOf(routine).map((slot) => slot.text)).toEqual([
      "Прямая до (0; 40), нос вверх",
      "Остановка, кайт носом вверх",
      "Поворот на 90° по часовой стрелке вокруг центра",
      "Прямая до (0; 0), нос вправо",
      "Посадка",
    ]);
  });

  it("шаг без длительности остаётся без неё: числа за автора никто не подставляет", () => {
    const routine = parse(flight([4, undefined, undefined, 3, undefined]));
    expect(slotsOf(routine).map((slot) => slot.seconds)).toEqual([4, null, null, 3, null]);
    expect([...durationsOf(routine)]).toEqual([
      ["0/1/2", 4],
      ["0/1/5", 3],
    ]);
    const bare = withDurations(routine, new Map());
    expect(slotsOf(bare).every((slot) => slot.seconds === null)).toBe(true);
    for (const step of bare.segments[0].paths["1"]) {
      expect(step).not.toHaveProperty("seconds");
    }
  });

  it("шаги фигуры названы словами каталога, свои — своими", () => {
    const proba = catalog.find((routine) => routine.slug === "proba")!;
    const slots = slotsOf(proba);
    expect(slots).toHaveLength(14);
    expect(slots.filter((slot) => slot.segment === 3).map((slot) => slot.seconds)).toEqual([6, 1.5, 6, 6, 6]);
    // Метка остановки фигуры — метка схемы книги; у своей остановки это курс кайта.
    expect(slots.find((slot) => slot.key === "1/1/1")?.text).toBe("Остановка, кайт носом вверх");
  });
});

describe("поле длительности", () => {
  it.each([
    ["4", 4],
    ["1,5", 1.5],
    ["1.5", 1.5],
    [" 12,125 ", 12.125],
    ["0,001", 0.001],
    ["9999,999", 9999.999],
    ["", null],
    ["   ", null],
    ["0", BAD],
    ["0,000", BAD],
    ["-1", BAD],
    ["1e3", BAD],
    ["1,2345", BAD],
    ["10000", BAD],
    ["1,", BAD],
    [",5", BAD],
    ["пять", BAD],
    ["Infinity", BAD],
  ])("«%s» читается как %s", (text, expected) => {
    expect(readField(text)).toBe(expected);
  });

  it("пустое поле — темп не задан, а не ноль и не число по умолчанию", () => {
    expect(readField(fieldText(null))).toBeNull();
    expect(fieldText(1.5)).toBe("1,5");
    expect(readField(fieldText(1.5))).toBe(1.5);
  });

  it("каждая длительность рутин каталога читается полем редактора как она есть", () => {
    for (const routine of catalog) {
      for (const slot of slotsOf(routine)) {
        expect(readField(fieldText(slot.seconds)), `${routine.slug}: ${slot.key}`).toBe(slot.seconds);
      }
    }
  });
});

describe("рутина с другими длительностями", () => {
  it("меняет только длительности, и исходную рутину не трогает", () => {
    const routine = parse(flight([4, 2, 1.5, 3, 1]));
    const before = JSON.stringify(routine);
    const edited = withDurations(routine, new Map([[slotKey(0, "1", 3), 7]]));
    expect(JSON.stringify(routine)).toBe(before);
    expect(edited).toEqual(parse(flight([undefined, 7, undefined, undefined, undefined])));
  });

  it("длительность у старта и вызова не ставит, не положительную отвергает", () => {
    const routine = parse(flight([4, 2, 1.5, 3, 1]));
    const edited = withDurations(routine, new Map([[slotKey(0, "1", 0), 5], [slotKey(0, "1", 1), 5], [slotKey(0, "1", 7), 5]]));
    expect(slotsOf(edited).every((slot) => slot.seconds === null)).toBe(true);
    expect(edited.segments[0].paths["1"].some((step) => "seconds" in step)).toBe(false);
    for (const value of [0, -1, Number.NaN, Infinity]) {
      expect(() => withDurations(routine, new Map([[slotKey(0, "1", 2), value]]))).toThrow(/длительность — положительное число секунд/);
    }
  });

  it("проверки отвечают на правку: время от IN до OUT и исход проверки длительности", () => {
    const routine = parse(flight([4, 2, 1.5, 3, 1]));
    const duration = (edited: Routine) => checkRoutine(edited).find((finding) => finding.check === "duration")!.code;
    expect(judgedTimes(routine)).toEqual([{ kite: "1", seconds: 11.5, untimed: 0 }]);
    expect(duration(routine)).toBe("duration.short");
    // Одна остановка длиннее — и рутина одиночника в границах.
    const longer = withDurations(routine, new Map([...durationsOf(routine), [slotKey(0, "1", 3), 60]]));
    expect(judgedTimes(longer)).toEqual([{ kite: "1", seconds: 69.5, untimed: 0 }]);
    expect(duration(longer)).toBe("duration.ok");
    expect(duration(withDurations(routine, new Map([...durationsOf(routine), [slotKey(0, "1", 6), 200]])))).toBe("duration.long");
    // Снятая длительность посадки: время уже не известно, и проверка так и говорит.
    const partial = new Map(durationsOf(longer));
    partial.delete(slotKey(0, "1", 6));
    expect(judgedTimes(withDurations(routine, partial))).toEqual([{ kite: "1", seconds: 68.5, untimed: 1 }]);
    expect(duration(withDurations(routine, partial))).toBe("duration.untimed");
    expect(duration(withDurations(routine, new Map()))).toBe("duration.untimed");
  });
});

describe("файл рутины", () => {
  it("файл каталога, записанный обратно без правок, — тот же байт в байт", () => {
    expect(catalog.length).toBeGreaterThan(0);
    for (const routine of catalog) {
      const text = fs.readFileSync(path.join(ROUTINES_DIR, `${routine.slug}.json`), "utf8");
      expect(routineFileText(JSON.parse(text) as Raw), routine.slug).toBe(text);
      expect(routineFileText(fileWithDurations(JSON.parse(text), routine, durationsOf(routine))), routine.slug).toBe(text);
    }
  });

  it("файл с новыми длительностями читается разбором как рутина с этими длительностями", () => {
    for (const routine of catalog) {
      const slots = slotsOf(routine);
      // У каждого шага своё число; у каждого третьего длительность снята.
      const durations = new Map(slots.flatMap((slot, index): [string, number][] => (index % 3 === 2 ? [] : [[slot.key, 1 + index / 8]])));
      const text = routineFileText(fileWithDurations(raw(routine.slug), routine, durations));
      expect(parseRoutine(`${routine.slug}.json`, text, figures), routine.slug).toEqual(withDurations(routine, durations));
    }
  });

  it("снятые длительности из файла уходят: у шага — поле, у фигуры — список", () => {
    const proba = catalog.find((routine) => routine.slug === "proba")!;
    const text = routineFileText(fileWithDurations(raw("proba"), proba, new Map()));
    expect(text).not.toContain("seconds");
    expect(slotsOf(parseRoutine("proba.json", text, figures)).every((slot) => slot.seconds === null)).toBe(true);
    // Одна длительность у фигуры: список по шагу на значение, остальные — null.
    const one = routineFileText(fileWithDurations(raw("proba"), proba, new Map([[slotKey(3, "1", 1), 2]])));
    expect(one).toContain('{"origin": "figure", "figure": "mi-28-square", "seconds": {"1": [null, 2, null, null, null]}}');
  });

  it("новое поле длительности встаёт у шага последним, прежнее остаётся на месте", () => {
    const source = file([own([start([-50, 40]), markIn, { kind: "line", seconds: 4, to: [0, 40], nose: 0 }, stall(), markOut])]);
    const routine = parse(source);
    const text = routineFileText(fileWithDurations(source, routine, new Map([[slotKey(0, "1", 2), 5], [slotKey(0, "1", 3), 2]])));
    expect(text).toContain('{"kind": "line", "seconds": 5, "to": [0, 40], "nose": 0}');
    expect(text).toContain('{"kind": "mark", "mark": "stall", "nose": 0, "seconds": 2}');
  });

  it("пара: длительности у каждого кайта свои, кайт без шагов остаётся с пустым списком", () => {
    const source = file(
      [
        { origin: "own", paths: { "1": [start([-50, 40]), markIn, line([0, 40], { seconds: 4 }), markOut], "2": [start([50, 40]), markIn] } },
        { origin: "own", paths: { "1": [], "2": [line([0, 60]), stall({ nose: 0 }), markOut] } },
      ],
      { discipline: "dual-line-pair", kites: ["1", "2"] },
    );
    const routine = parse(source);
    expect(slotsOf(routine).map((slot) => slot.key)).toEqual(["0/1/2", "1/2/0", "1/2/1"]);
    const durations = new Map([[slotKey(1, "2", 1), 3]]);
    const text = routineFileText(fileWithDurations(source, routine, durations));
    expect(text).toContain('"paths": {"1": [], "2": [');
    expect(parseRoutine("proba.json", text, figures)).toEqual(withDurations(routine, durations));
  });

  it("отказывается от файла, который не этой рутины", () => {
    const routine = parse(flight([4, 2, 1.5, 3, 1]));
    expect(() => fileWithDurations(file([own([start([0, 0]), markIn]), own([line([10, 0]), markOut])]), routine, new Map())).toThrow(/расходятся/);
    expect(() => fileWithDurations(file([own([start([0, 0]), markIn, line([10, 0]), markOut])]), routine, new Map())).toThrow(/расходятся/);
  });
});

describe("расписание", () => {
  it("шаг начинается, когда кончились все перед ним; после шага без длительности время не называется", () => {
    const full = timetable(parse(flight([4, 2, 1.5, 3, 1])));
    expect([...full.starts.values()]).toEqual([0, 4, 6, 7.5, 10.5]);
    expect(full.kites).toEqual([{ kite: "1", total: 11.5, untimed: 0 }]);
    const holed = timetable(parse(flight([4, undefined, 1.5, 3, undefined])));
    expect([...holed.starts.values()]).toEqual([0, 4, null, null, null]);
    expect(holed.kites).toEqual([{ kite: "1", total: null, untimed: 2 }]);
  });

  it("время словами: сумма, в которую вошли не все шаги, временем не названа", () => {
    const told = (seconds: (number | undefined)[]) => {
      const routine = parse(flight(seconds));
      return timeText(judgedTimes(routine)[0], timetable(routine).kites[0]);
    };
    expect(told([4, 2, 1.5, 3, 1])).toBe("от IN до OUT — 11,5 с; весь записанный путь — 11,5 с");
    expect(told([4, undefined, 1.5, 3, undefined])).toBe(
      "от IN до OUT заданные шаги дают 8,5 с, длительность не задана у 2 шагов; весь записанный путь не складывается: длительность не задана у 2 шагов",
    );
    expect(told([undefined, undefined, undefined, undefined, undefined])).toBe(
      "от IN до OUT длительность не задана ни у одного шага (шагов — 5); весь записанный путь не складывается: длительность не задана у 5 шагов",
    );
  });
});

describe("положение кайта в секунду рутины", () => {
  const routine = parse(flight([4, 2, 1.5, 3, 1]));
  const at = (seconds: number) => poseAtTime(routine, "1", seconds, true)!;

  it("остановка занимает своё время: кайт стоит в точке, пока она длится", () => {
    expect(at(2).point).toEqual([-25, 40]);
    for (const seconds of [4, 4.5, 5.9]) {
      expect(at(seconds), `${seconds} с`).toMatchObject({ step: 3, point: [0, 40] });
    }
  });

  it("поворот на месте идёт своё время: нос доворачивается, кайт стоит", () => {
    const half = at(6.75);
    expect(half).toMatchObject({ step: 4, point: [0, 40] });
    expect(half.nose![0]).toBeCloseTo(Math.SQRT1_2);
    expect(half.nose![1]).toBeCloseTo(Math.SQRT1_2);
    expect(at(7.5).step).toBe(5);
  });

  it("посадка занимает своё время в конце пути", () => {
    expect(at(9).point![0]).toBeCloseTo(0);
    expect(at(9).point![1]).toBeCloseTo(20);
    for (const seconds of [10.5, 11, 11.4]) {
      expect(at(seconds), `${seconds} с`).toMatchObject({ step: 6, point: [0, 0] });
    }
    // Последняя секунда — уже вызов OUT, в той же точке.
    expect(at(11.5)).toMatchObject({ step: 7, point: [0, 0] });
  });

  it("по длине пути та же остановка времени не занимала бы: в ту же секунду кайт был бы в пути", () => {
    // Вес по умолчанию — длина: 90 единиц пути, остановка и поворот проходятся мгновенно.
    const path = routine.segments[0].paths["1"] as Step[];
    expect(at(5).point).toEqual([0, 40]);
    expect(poseAt(path, 5 / 11.5, true).point).not.toEqual([0, 40]);
  });

  it("не называет места, пока длительность задана не у всех шагов, и за пределами пути", () => {
    expect(poseAtTime(parse(flight([4, undefined, 1.5, 3, 1])), "1", 1, true)).toBeNull();
    expect(poseAtTime(withDurations(routine, new Map()), "1", 0, true)).toBeNull();
    expect(() => at(12)).toThrow(/время — от 0 до 11.5 с/);
    expect(() => at(-1)).toThrow(RangeError);
  });

  it("рутины каталога с полным темпом проходятся от первой секунды до последней", () => {
    for (const item of catalog) {
      const rev = item.discipline.startsWith("multi-line");
      for (const { kite, total } of timetable(item).kites) {
        if (total === null) {
          expect(poseAtTime(item, kite, 0, rev), item.slug).toBeNull();
          continue;
        }
        for (let step = 0; step <= 100; step += 1) {
          expect(poseAtTime(item, kite, (total * step) / 100, rev), `${item.slug}, ${step}%`).not.toBeNull();
        }
      }
    }
  });

  it("остановка пробы длится свои две секунды", () => {
    const proba = catalog.find((item) => item.slug === "proba")!;
    // Подъём 4 с, остановка 2 с в (−60; 50), затем дуга.
    expect(poseAtTime(proba, "1", 4.1, true)?.point).toEqual([-60, 50]);
    expect(poseAtTime(proba, "1", 5.9, true)?.point).toEqual([-60, 50]);
    expect(poseAtTime(proba, "1", 6.5, true)?.point).not.toEqual([-60, 50]);
  });
});

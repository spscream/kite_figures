import { describe, expect, it } from "vitest";

import { type Draft, type Editing, elementsOf, insertElement, placesOf, preview } from "./compose";
import { editorProps } from "./editor";
import { ELEMENT_IDS, ELEMENTS, OUTSIDE } from "./elements";
import { listFigures } from "./figures";
import { checkRoutine, judgedTimes } from "./routine-checks";
import { parseRoutine } from "./routines";
import { fieldsOf, fileWithDurations, readField, routineFileText, slotsOf, withDurations } from "./tempo";

// Тесты идут тем же путём, что страница редактора: `editorProps` — то, что
// шаблон страницы отдаёт клиентскому коду, `insertElement` — то, что зовёт
// кнопка «Поставить в рутину», а файл и находки считаются так же, как их
// считает компонент. Чего этим путём не видно — что кнопка в браузере
// действительно нажимается: браузера в гейте нет.
const props = editorProps("proba")!;
const { fileName, figures, parts } = props;

const fresh = (): Editing => ({ doc: { file: props.file, routine: props.routine }, fields: fieldsOf(slotsOf(props.routine)) });

// Что редактор отдаёт: рутина с длительностями из полей и текст её файла.
function output(editing: Editing) {
  const { file, routine } = editing.doc;
  const durations = new Map(
    slotsOf(routine).flatMap((slot): [string, number][] => {
      const value = readField(editing.fields[slot.key] ?? "");
      return typeof value === "number" ? [[slot.key, value]] : [];
    }),
  );
  return { edited: withDurations(routine, durations), text: routineFileText(fileWithDurations(file, routine, durations)) };
}

const put = (editing: Editing, draft: Omit<Draft, "place">, place: (text: string) => boolean): Editing => {
  const places = placesOf(editing.doc.routine, parts);
  const found = places.filter((item) => place(item.text));
  expect(found, `место для «${draft.element}»`).toHaveLength(1);
  return insertElement(editing, places, { ...draft, place: found[0].key }, fileName, figures);
};

// Перед вызовом OUT: последнее место последней части.
const beforeOut = (text: string) => text.startsWith("Часть 6: своя работа — после шага 4:");

describe("элемент встаёт в рутину каталога", () => {
  it("страница отдаёт редактору фигуры, на которые рутина ссылается, — без них рутину с новым шагом не прочесть", () => {
    expect(figures.map((figure) => figure.slug)).toEqual(["mi-28-square"]);
    const places = placesOf(props.routine, parts);
    const draft: Draft = { element: "stop", place: places.at(-1)!.key, values: { nose: "0" }, seconds: "" };
    expect(preview(fresh().doc, places, draft, fileName, figures).state).toBe("ready");
    const bare = preview(fresh().doc, places, draft, fileName, []);
    expect(bare.state === "bad" && bare.message).toContain("нет в каталоге");
  });

  it("места — в своих частях и связках, после старта; в фигуру каталога элемент не встаёт", () => {
    const places = placesOf(props.routine, parts);
    expect(places.map((place) => `${place.segment}/${place.index}`)).toEqual([
      "0/1", "0/2",
      "1/0", "1/1", "1/2", "1/3",
      "2/0", "2/1",
      "4/0", "4/1",
      "5/0", "5/1", "5/2", "5/3", "5/4", "5/5",
    ]);
    expect(places[0]).toMatchObject({ position: [-60, 10], text: "Часть 1: своя работа — после шага 1: Точка (−60; 10)" });
    expect(places.find((place) => place.key === "4/1/0")).toMatchObject({ text: "Часть 5: связка — в начало" });
    expect(new Set(places.map((place) => place.key)).size).toBe(places.length);
  });

  it("все двенадцать элементов по очереди: шаги в файле, файл читается разбором, имя элемента читается с шага", () => {
    // Из [0, 10] перед OUT; каждый следующий элемент встаёт за предыдущим.
    const flight: Omit<Draft, "place">[] = [
      { element: "forward", values: { x: "20", y: "30" }, seconds: "2" },
      { element: "backward", values: { x: "20", y: "50" }, seconds: "2" },
      { element: "slide-horizontal", values: { x: "40" }, seconds: "2" },
      { element: "slide-vertical", values: { y: "20", nose: "90" }, seconds: "2,5" },
      { element: "slide-inverted", values: { x: "10" }, seconds: "" },
      { element: "diagonal", values: { x: "30", y: "40", nose: "0" }, seconds: "2" },
      { element: "arc", values: { cx: "30", cy: "20", direction: "ccw", sweep: "90", nose: "in" }, seconds: "3" },
      { element: "spin", values: { degrees: "90", direction: "cw" }, seconds: "1" },
      { element: "tip-spin", values: { degrees: "180", direction: "cw", about: "left-tip", x: "18", y: "20" }, seconds: "1" },
      { element: "stop", values: { nose: "0" }, seconds: "2" },
      { element: "slide-vertical", values: { y: "0", nose: "270" }, seconds: "2" },
      { element: "landing", values: { style: "leading-edge" }, seconds: "1" },
      { element: "launch", values: {}, seconds: "1" },
    ];
    expect(new Set(flight.map((item) => item.element))).toEqual(new Set(ELEMENT_IDS));
    let editing = fresh();
    flight.forEach((draft, order) => {
      editing = put(editing, draft, (text) => text.startsWith(`Часть 6: своя работа — после шага ${4 + order}:`));
    });
    const { edited, text } = output(editing);
    const steps = edited.segments[5].paths["1"];
    expect(steps.slice(4, -1)).toEqual([
      { kind: "line", to: [20, 30], nose: "forward", seconds: 2 },
      { kind: "line", to: [20, 50], nose: "backward", seconds: 2 },
      { kind: "line", to: [40, 50], nose: 0, seconds: 2 },
      { kind: "line", to: [40, 20], nose: 90, seconds: 2.5 },
      { kind: "line", to: [10, 20], nose: 180 },
      { kind: "line", to: [30, 40], nose: 0, seconds: 2 },
      { kind: "arc", to: [10, 20], center: [30, 20], direction: "ccw", sweep: 90, nose: "in", seconds: 3 },
      { kind: "rotate", degrees: 90, direction: "cw", about: "center", seconds: 1 },
      { kind: "rotate", degrees: 180, direction: "cw", about: "left-tip", to: [18, 20], seconds: 1 },
      { kind: "mark", mark: "stall", nose: 0, seconds: 2 },
      { kind: "line", to: [18, 0], nose: 270, seconds: 2 },
      { kind: "mark", mark: "landing", style: "leading-edge", seconds: 1 },
      { kind: "mark", mark: "launch", seconds: 1 },
    ]);
    expect(steps.at(-1)).toEqual({ kind: "mark", mark: "out" });
    // Файл, который редактор отдаёт, — рутина для разбора каталога, та же самая.
    expect(parseRoutine(fileName, text, listFigures())).toEqual(edited);
    expect(text).toContain('      {"kind": "line", "to": [20, 30], "seconds": 2},\n      {"kind": "line", "to": [20, 50], "nose": "backward", "seconds": 2},\n');
    expect(text).toContain('      {"kind": "line", "to": [10, 20], "nose": 180},\n');
    expect(text).toContain('      {"kind": "mark", "mark": "launch", "seconds": 1},\n      {"kind": "mark", "mark": "out"}\n');
    // Имени элемента в файле нет: оно читается с шага.
    expect(text).not.toContain("element");
    const names = elementsOf(edited);
    expect(flight.map((_, order) => names.get(`5/1/${4 + order}`)?.id)).toEqual(flight.map((item) => item.element));
    // Прежние шаги на месте и со своими длительностями.
    expect(steps.slice(0, 4)).toEqual(props.routine.segments[5].paths["1"].slice(0, 4));
    expect(edited.segments.slice(0, 5)).toEqual(props.routine.segments.slice(0, 5));
  });

  it("проверки рутины работают над шагами элемента без правок: те же находки, время — с новым шагом", () => {
    const before = checkRoutine(props.routine);
    expect(judgedTimes(props.routine)).toEqual([{ kite: "1", seconds: 56, untimed: 0 }]);
    expect(before.find((finding) => finding.code.startsWith("duration"))?.state).toBe("violation");
    // Остановка на пять секунд перед OUT: 56 с становятся 61 с — больше минуты.
    const stopped = output(put(fresh(), { element: "stop", values: { nose: "0" }, seconds: "5" }, beforeOut)).edited;
    const after = checkRoutine(stopped);
    expect(before.map((finding) => finding.code)).toEqual(["calls.ok", "duration.short", "ends.unchecked", "window.criterion", "window.extent", "variety.criterion"]);
    expect(after.map((finding) => finding.code)).toEqual(["calls.ok", "duration.ok", "ends.unchecked", "window.criterion", "window.extent", "variety.criterion"]);
    expect(judgedTimes(stopped)).toEqual([{ kite: "1", seconds: 61, untimed: 0 }]);
    expect(after.find((finding) => finding.code.startsWith("duration"))?.state).toBe("ok");
    // Элемент без длительности — шаг, чей темп не задан: время не складывается.
    const untimed = output(put(fresh(), { element: "stop", values: { nose: "0" }, seconds: "" }, beforeOut)).edited;
    expect(judgedTimes(untimed)).toEqual([{ kite: "1", seconds: 56, untimed: 1 }]);
    expect(checkRoutine(untimed).find((finding) => finding.code.startsWith("duration"))?.state).toBe("unknown");
    // Пролёт двигает крайние точки пути: находка об окне считана по новому шагу.
    const flown = output(put(fresh(), { element: "forward", values: { x: "90", y: "95" }, seconds: "3" }, beforeOut)).edited;
    const extent = (routine: typeof flown) => checkRoutine(routine).find((finding) => finding.code === "window.extent")?.text;
    expect(extent(flown)).toContain("до 90");
    expect(extent(flown)).not.toBe(extent(props.routine));
  });

  it("поля длительности шагов за новым сдвигаются вместе с шагами", () => {
    const editing = fresh();
    editing.fields["1/1/1"] = "7";
    const next = put(editing, { element: "stop", values: { nose: "90" }, seconds: "1,5" }, (text) => text.startsWith("Часть 2: своя работа — после шага 1:"));
    expect(next.fields).toMatchObject({ "1/1/0": "4", "1/1/1": "1,5", "1/1/2": "7", "1/1/3": "5", "2/1/0": "4" });
    expect(Object.keys(next.fields)).toHaveLength(Object.keys(editing.fields).length + 1);
    expect(output(next).edited.segments[1].paths["1"].map((step) => step.seconds)).toEqual([4, 1.5, 7, 5]);
    // Исходная рутина и её файл не тронуты.
    expect(editing.doc.file).toBe(props.file);
    expect(routineFileText(props.file as Record<string, unknown>)).toBe(output(fresh()).text);
  });

  it("шаг, с которым рутина перестала читаться, в неё не встаёт, и причина названа", () => {
    const places = placesOf(props.routine, parts);
    const at = (key: string, draft: Omit<Draft, "place">) => preview(fresh().doc, places, { ...draft, place: key }, fileName, figures);
    // Перед фигурой каталога: кайт уходит из точки её входа.
    const away = at("2/1/1", { element: "forward", values: { x: "0", y: "40" }, seconds: "" });
    expect(away.state === "bad" && away.message).toContain("нужна связка");
    // Перед дугой: она перестаёт сходиться.
    const bent = at("1/1/2", { element: "slide-horizontal", values: { x: "-50" }, seconds: "" });
    expect(bent.state === "bad" && bent.message).toContain("дуга не сходится");
    // За сеткой окна.
    const far = at("5/1/4", { element: "forward", values: { x: "150", y: "10" }, seconds: "" });
    expect(far.state === "bad" && far.message).toContain("вне сетки окна");
    // Посадка не на земле — отказ словаря, а не формата.
    const high = at("5/1/4", { element: "landing", values: { style: "none" }, seconds: "" });
    expect(high.state === "bad" && high.message).toContain("посадка — на земле");
    // Не число в поле элемента и в поле длительности.
    expect(at("5/1/4", { element: "stop", values: { nose: "вверх" }, seconds: "" }).state).toBe("bad");
    expect(at("5/1/4", { element: "stop", values: { nose: "0" }, seconds: "0" }).state).toBe("bad");
    expect(() => insertElement(fresh(), places, { element: "landing", place: "5/1/4", values: { style: "none" }, seconds: "" }, fileName, figures)).toThrow("посадка — на земле");
  });

  it("пока элемент, место или параметр не названы, шагов нет", () => {
    const places = placesOf(props.routine, parts);
    const doc = fresh().doc;
    expect(preview(doc, places, { element: "", place: "5/1/4", values: {}, seconds: "" }, fileName, figures)).toEqual({ state: "empty", missing: [] });
    expect(preview(doc, places, { element: "stop", place: "", values: { nose: "0" }, seconds: "" }, fileName, figures)).toEqual({ state: "empty", missing: [] });
    // Место в части-фигуре и место, которого нет, — не место.
    expect(preview(doc, places, { element: "stop", place: "3/1/0", values: { nose: "0" }, seconds: "" }, fileName, figures).state).toBe("empty");
    for (const def of ELEMENTS.filter((item) => item.fields.length > 0)) {
      const made = preview(doc, places, { element: def.id, place: "5/1/4", values: {}, seconds: "3" }, fileName, figures);
      expect(made, def.id).toMatchObject({ state: "empty" });
      expect(made.state === "empty" && made.missing.length, def.id).toBeGreaterThan(0);
      expect(() => insertElement(fresh(), places, { element: def.id, place: "5/1/4", values: {}, seconds: "3" }, fileName, figures), def.id).toThrow("не заданы");
    }
  });

  it("оставшееся снаружи редактор не ставит", () => {
    const places = placesOf(props.routine, parts);
    for (const name of ["axel", "half-axel", "pivot", "hover", "push-stall", "belly", ...OUTSIDE.map((item) => item.what)]) {
      const draft: Draft = { element: name, place: "5/1/4", values: { nose: "0", style: "none" }, seconds: "" };
      expect(preview(fresh().doc, places, draft, fileName, figures).state, name).toBe("empty");
      expect(() => insertElement(fresh(), places, draft, fileName, figures), name).toThrow();
    }
  });

  it("имя элемента стоит у шагов рутины каталога, которые им записаны", () => {
    const names = elementsOf(props.routine);
    const named = (segment: number) => props.routine.segments[segment].paths["1"].map((_, index) => names.get(`${segment}/1/${index}`)?.name ?? null);
    expect(named(0)).toEqual([null, null]);
    expect(named(1)).toEqual(["полёт вперёд", "остановка", "дуга и круг"]);
    // Спуск носом вверх и пролёт вправо носом вправо: нос числом лежит на линии хода.
    expect(named(2)).toEqual(["полёт назад"]);
    expect(named(4)).toEqual(["полёт вперёд"]);
    expect(named(5)).toEqual(["слайд вертикальный", "поворот на месте", "остановка", "полёт назад", null]);
  });
});

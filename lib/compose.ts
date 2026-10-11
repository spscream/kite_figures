// Элемент словаря — в рутину: куда его можно поставить, каким шагом он
// встаёт в файл и что после этого стоит в полях редактора. Сам словарь —
// `lib/elements.ts`; поля и разметка — `components/TempoEditor.tsx`.
//
// Рутину с новым шагом читает тот же разбор, что читает каталог
// (`parseRoutine`): всё, что он отвергает в файле, он отвергает и здесь, и
// шаг, с которым рутина перестала читаться, в неё не встаёт.
//
// Модуль исполняется в браузере и с диска ничего не читает.

import { type ElementDef, elementBy, elementOf, ELEMENTS_FOR, expand, NO_ELEMENTS_TEXT, readValues } from "./elements";
import type { Figure } from "./figures";
import type { OwnStep, Point, Step } from "./geometry";
import { parseRoutine, type Routine } from "./routine-format";
import { stepText } from "./steps";
import { BAD, fieldText, lasts, readField, slotKey } from "./tempo";

type Json = Record<string, unknown>;

// Рутина в редакторе: разобранный JSON её файла и она же после разбора.
export type Doc = { file: unknown; routine: Routine };

// Шаги, вставшие в рутину одним элементом: часть, кайт, с какого шага и сколько.
export type Added = { segment: number; kite: string; index: number; count: number };

// Что редактор держит: рутину, текст полей длительности по месту шага и
// элементы, поставленные в этот заход, по порядку.
export type Editing = { doc: Doc; fields: Record<string, string>; added: readonly Added[] };

// Место в пути кайта, куда встаёт элемент: перед шагом `index` своей части.
export type Place = {
  key: string;
  segment: number;
  kite: string;
  index: number;
  // Где кайт стоит в этом месте.
  position: Point;
  text: string;
};

const stepsOf = (routine: Routine, segment: number, kite: string): (Step | OwnStep)[] => routine.segments[segment].paths[kite] ?? [];

const after = (position: Point | null, step: Step | OwnStep): Point | null =>
  step.kind === "start" ? step.at : step.kind === "line" || step.kind === "arc" ? step.to : step.kind === "rotate" ? (step.to ?? position) : position;

// Куда в рутине можно поставить элемент: в начало своей части или связки и
// после каждого её шага. Шаги фигуры каталога не правятся — фигура стоит
// ссылкой. До шага «start» места нет: кайт ещё не в окне. `parts` — заголовки
// частей, те же, что над полями длительности.
export function placesOf(routine: Routine, parts: readonly string[]): Place[] {
  const many = routine.kites.length > 1;
  return routine.kites.flatMap((kite) => {
    let position: Point | null = null;
    return routine.segments.flatMap((segment, at) => {
      const places: Place[] = [];
      const steps = stepsOf(routine, at, kite);
      for (let index = 0; index <= steps.length; index += 1) {
        if (segment.origin !== "figure" && position !== null) {
          const where = index === 0 ? "в начало" : `после шага ${index}: ${stepText(steps[index - 1] as Step, true)}`;
          places.push({ key: slotKey(at, kite, index), segment: at, kite, index, position, text: `${many ? `Кайт ${kite}. ` : ""}${parts[at] ?? `Часть ${at + 1}`} — ${where}` });
        }
        if (index < steps.length) {
          position = after(position, steps[index]);
        }
      }
      return places;
    });
  });
}

// Какой элемент словаря записан каждым шагом рутины, по месту шага.
export function elementsOf(routine: Routine): Map<string, ElementDef> {
  const named = new Map<string, ElementDef>();
  for (const kite of routine.kites) {
    let position: Point | null = null;
    routine.segments.forEach((_, at) => {
      stepsOf(routine, at, kite).forEach((step, index) => {
        const id = elementOf(step, position);
        if (id !== null) {
          named.set(slotKey(at, kite, index), elementBy(id)!);
        }
        position = after(position, step);
      });
    });
  }
  return named;
}

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

// Тот же файл с шагами `steps`, вставшими на место `place`.
function withSteps(file: unknown, place: Place, steps: Json[]): Json {
  const segments = isRecord(file) && Array.isArray(file.segments) ? file.segments : undefined;
  const segment: unknown = segments?.[place.segment];
  const path = isRecord(segment) && isRecord(segment.paths) ? segment.paths[place.kite] : undefined;
  if (!isRecord(file) || segments === undefined || !isRecord(segment) || !isRecord(segment.paths) || !Array.isArray(path) || place.index > path.length) {
    throw new Error("файл рутины и разобранная рутина расходятся: места для элемента в файле нет");
  }
  const paths = { ...segment.paths, [place.kite]: [...path.slice(0, place.index), ...steps, ...path.slice(place.index)] };
  return { ...file, segments: segments.map((item: unknown, at) => (at === place.segment ? { ...segment, paths } : item)) };
}

export type Draft = {
  // Номер элемента в словаре, место в рутине, поля элемента и поле длительности — как набраны.
  element: string;
  place: string;
  values: Readonly<Record<string, string>>;
  seconds: string;
};

export type Preview =
  // Элемент или место не выбраны, либо не все поля заполнены: шагов ещё нет.
  | { state: "empty"; missing: string[] }
  | { state: "bad"; message: string }
  // `doc` — рутина с этими шагами, уже прочитанная разбором.
  | { state: "ready"; steps: Json[]; words: string[]; place: Place; seconds: number | null; doc: Doc };

// Что выходит из набранного: шаги, которыми элемент встанет в файл, либо
// причина, по которой их нет. `fileName` и `figures` — имя файла рутины и
// фигуры каталога, на которые она ссылается: с ними рутину с новым шагом
// читает разбор.
export const BAD_FIELD_TEXT =
  "В поле параметра записано не то: число — до четырёх цифр и до двух знаков после запятой; длительность — положительное число секунд, пустое поле — темп не задан.";

export function preview(doc: Doc, places: readonly Place[], draft: Draft, fileName: string, figures: Figure[]): Preview {
  if (doc.routine.discipline !== ELEMENTS_FOR) {
    return { state: "bad", message: NO_ELEMENTS_TEXT };
  }
  const def = elementBy(draft.element);
  const place = places.find((item) => item.key === draft.place);
  if (def === undefined || place === undefined) {
    return { state: "empty", missing: [] };
  }
  const read = readValues(def, draft.values);
  const seconds = readField(draft.seconds);
  if (read.bad.length > 0 || seconds === BAD) {
    return { state: "bad", message: BAD_FIELD_TEXT };
  }
  if (read.missing.length > 0) {
    return { state: "empty", missing: read.missing };
  }
  try {
    // Длительность встаёт в файл вместе с шагом — последним полем, как у любого шага.
    const steps = expand(def.id, read.values, place.position).map((step) => (seconds === null ? step : { ...step, seconds }));
    const file = withSteps(doc.file, place, steps);
    const routine = parseRoutine(fileName, JSON.stringify(file), figures);
    // Шаги за новым редактор не правит, но начинаются они теперь из другой
    // точки. Шаг, который был записью элемента и перестал ею быть либо стал
    // записью другого, — отказ: иначе посадка осталась бы в воздухе, а слайд
    // молча стал бы диагональю.
    const now = elementsOf(routine);
    for (const [key, was] of elementsOf(doc.routine)) {
      const [segment, kite, index] = key.split("/");
      const moved = Number(segment) === place.segment && kite === place.kite && Number(index) >= place.index;
      const is = now.get(moved ? slotKey(place.segment, kite, Number(index) + steps.length) : key);
      if (is?.id !== was.id) {
        const step = stepsOf(doc.routine, Number(segment), kite)[Number(index)];
        throw new Error(
          `шаг «${stepText(step as Step, doc.routine.segments[Number(segment)].origin !== "figure")}» записан элементом «${was.name}», а за новым шагом ${is ? `читался бы как «${is.name}»` : "не читался бы ни одним элементом словаря"}: шаги после нового редактор не правит`,
        );
      }
    }
    const words = steps.map((_, offset) => stepText(stepsOf(routine, place.segment, place.kite)[place.index + offset] as Step, true));
    return { state: "ready", steps, words, place, seconds, doc: { file, routine } };
  } catch (error) {
    return { state: "bad", message: (error as Error).message };
  }
}

// Редактор после того, как элемент встал в рутину: шаги на месте, поля
// длительности шагов за ним сдвинуты, у нового шага — длительность, набранная
// у элемента, либо пусто. Набранное не даёт шагов — ошибка с причиной.
export function insertElement(editing: Editing, places: readonly Place[], draft: Draft, fileName: string, figures: Figure[]): Editing {
  const made = preview(editing.doc, places, draft, fileName, figures);
  if (made.state !== "ready") {
    throw new Error(made.state === "bad" ? made.message : "элемент, место или параметр не заданы");
  }
  const { place, steps } = made;
  const fields: Record<string, string> = {};
  for (const [key, text] of Object.entries(editing.fields)) {
    const [segment, kite, index] = key.split("/");
    const moved = Number(segment) === place.segment && kite === place.kite && Number(index) >= place.index;
    fields[moved ? slotKey(place.segment, kite, Number(index) + steps.length) : key] = text;
  }
  steps.forEach((_, offset) => {
    const step = stepsOf(made.doc.routine, place.segment, place.kite)[place.index + offset];
    if (lasts(step)) {
      fields[slotKey(place.segment, place.kite, place.index + offset)] = fieldText(made.seconds);
    }
  });
  return { doc: made.doc, fields, added: [...editing.added, { segment: place.segment, kite: place.kite, index: place.index, count: steps.length }] };
}

// Редактор без элемента, поставленного последним: его шаги уходят из файла,
// поля длительности шагов за ним возвращаются на место, остальное набранное
// остаётся как было.
export function removeLast(editing: Editing, fileName: string, figures: Figure[]): Editing {
  const last = editing.added.at(-1);
  if (last === undefined) {
    return editing;
  }
  const file = editing.doc.file;
  const segments = isRecord(file) && Array.isArray(file.segments) ? file.segments : [];
  const segment: unknown = segments[last.segment];
  const path = isRecord(segment) && isRecord(segment.paths) ? segment.paths[last.kite] : undefined;
  if (!isRecord(file) || !isRecord(segment) || !isRecord(segment.paths) || !Array.isArray(path)) {
    throw new Error("файл рутины и разобранная рутина расходятся: шагов элемента в файле нет");
  }
  const paths = { ...segment.paths, [last.kite]: [...path.slice(0, last.index), ...path.slice(last.index + last.count)] };
  const next = { ...file, segments: segments.map((item: unknown, at) => (at === last.segment ? { ...segment, paths } : item)) };
  const fields: Record<string, string> = {};
  for (const [key, text] of Object.entries(editing.fields)) {
    const [at, kite, index] = key.split("/");
    const here = Number(at) === last.segment && kite === last.kite;
    if (here && Number(index) >= last.index && Number(index) < last.index + last.count) {
      continue;
    }
    fields[here && Number(index) >= last.index ? slotKey(last.segment, kite, Number(index) - last.count) : key] = text;
  }
  return { doc: { file: next, routine: parseRoutine(fileName, JSON.stringify(next), figures) }, fields, added: editing.added.slice(0, -1) };
}

// Форма элемента после выбора элемента: место и длительность остаются как
// набраны, параметры пусты — прежний элемент своих значений новому не оставляет.
export const NO_DRAFT: Draft = { element: "", place: "", values: {}, seconds: "" };

export function chooseElement(draft: Draft, element: string): Draft {
  return { ...draft, element, values: {} };
}

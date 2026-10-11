// Словарь элементов рутины: двенадцать именованных движений четырёхстропного
// кайта, каждое — с параметрами и разворотом в шаги пути. Откуда взят список и
// почему в нём ровно столько — `docs/routine-elements.md`, раздел 6; имена,
// источники и причины отсутствия здесь повторяют его таблицы слово в слово, и
// это держит тест `lib/elements.test.ts`.
//
// Оба правила живут здесь: «элемент → шаги» (`expand`) и «шаг → элемент»
// (`elementOf`). Имени элемента в файле рутины нет: оно читается с шага.
//
// Ни одного числа модуль не подставляет. Параметр, которого определение не
// даёт, называет автор: без него шага нет, и ни из соседних шагов, ни из
// «обычного» значения он не берётся.
//
// Модуль исполняется в браузере и с диска ничего не читает.

import { arcPoint, GRID, type OwnStep, type Point, type Step, TOLERANCE } from "./geometry";

export const ELEMENT_IDS = [
  "forward",
  "backward",
  "slide-horizontal",
  "slide-vertical",
  "slide-inverted",
  "diagonal",
  "arc",
  "spin",
  "tip-spin",
  "stop",
  "launch",
  "landing",
] as const;
export type ElementId = (typeof ELEMENT_IDS)[number];

// Поле формы элемента. Числа — в единицах сетки окна и в градусах, как в шаге;
// у выбора нет значения, выбранного заранее. `when` — поле нужно только при
// таком значении другого поля.
export type Field = { key: string; label: string; when?: readonly [string, string] } & (
  | { kind: "number" }
  | { kind: "choice"; options: readonly { value: string; label: string }[] }
);

export type ElementDef = {
  id: ElementId;
  // Имя, источник, шаг и параметры — столбцы таблицы «Что вошло» разбора.
  name: string;
  source: string;
  into: string;
  asks: string;
  fields: readonly Field[];
};

const COURSE_LABEL = "курс носа, градусы: 0 — вверх, 90 — вправо, 180 — вниз, 270 — влево";
const X: Field = { key: "x", label: "куда: x, от −100 до 100", kind: "number" };
const Y: Field = { key: "y", label: "куда: y, от 0 до 100", kind: "number" };
const SIDE: Field = {
  key: "direction",
  label: "сторона",
  kind: "choice",
  options: [
    { value: "cw", label: "по часовой стрелке" },
    { value: "ccw", label: "против часовой стрелки" },
  ],
};

export const ELEMENTS: readonly ElementDef[] = [
  { id: "forward", name: "полёт вперёд", source: "ISKCB III.DD, стр. 11", into: "`line`", asks: "куда", fields: [X, Y] },
  { id: "backward", name: "полёт назад", source: "ISKCB III.CC, стр. 11", into: '`line`, `nose: "backward"`', asks: "куда", fields: [X, Y] },
  {
    id: "slide-horizontal",
    name: "слайд горизонтальный",
    source: "ISKCB III.FF, стр. 11",
    into: "`line`, `nose: 0`",
    asks: "до какой вертикали",
    fields: [{ key: "x", label: "до какой вертикали: x, от −100 до 100", kind: "number" }],
  },
  {
    id: "slide-vertical",
    name: "слайд вертикальный",
    source: "ISKCB III.FF, стр. 11",
    into: "`line`, `nose: 90` или `270`",
    asks: "до какой высоты; нос влево или вправо",
    fields: [
      { key: "y", label: "до какой высоты: y, от 0 до 100", kind: "number" },
      {
        key: "nose",
        label: "нос",
        kind: "choice",
        options: [
          { value: "270", label: "влево" },
          { value: "90", label: "вправо" },
        ],
      },
    ],
  },
  {
    id: "slide-inverted",
    name: "перевёрнутый слайд",
    source: "ISKCB III.GG, стр. 11",
    into: "`line`, `nose: 180`",
    asks: "до какой вертикали",
    fields: [{ key: "x", label: "до какой вертикали: x, от −100 до 100", kind: "number" }],
  },
  {
    id: "diagonal",
    name: "диагональный полёт",
    source: "ISKCB III.AA, стр. 11",
    into: "`line`, `nose` числом",
    asks: "куда; курс носа",
    fields: [X, Y, { key: "nose", label: COURSE_LABEL, kind: "number" }],
  },
  {
    id: "arc",
    name: "дуга и круг",
    source: "ISKCB II.O и II.X, стр. 9–10",
    into: "`arc`",
    asks: "центр, сторона, угол; нос — вперёд, назад, внутрь, наружу или постоянный курс",
    fields: [
      { key: "cx", label: "центр: x", kind: "number" },
      { key: "cy", label: "центр: y", kind: "number" },
      SIDE,
      { key: "sweep", label: "угол, градусы: больше 0 и не больше 360; 360 — круг", kind: "number" },
      {
        key: "nose",
        label: "нос",
        kind: "choice",
        options: [
          { value: "forward", label: "вперёд" },
          { value: "backward", label: "назад" },
          { value: "in", label: "внутрь" },
          { value: "out", label: "наружу" },
          { value: "course", label: "постоянный курс" },
        ],
      },
      { key: "course", label: COURSE_LABEL, kind: "number", when: ["nose", "course"] },
    ],
  },
  {
    id: "spin",
    name: "поворот на месте",
    source: "ISKCB III.EE, стр. 11",
    into: '`rotate`, `about: "center"`',
    asks: "угол, сторона",
    fields: [{ key: "degrees", label: "угол, градусы", kind: "number" }, SIDE],
  },
  {
    id: "tip-spin",
    name: "поворот вокруг законцовки",
    source: "ISKCB III.EE, стр. 11",
    into: "`rotate`, `about` — законцовка, `to`",
    asks: "угол меньше 360°, сторона, которая законцовка, куда пришёл нос",
    fields: [
      { key: "degrees", label: "угол, градусы: меньше 360", kind: "number" },
      SIDE,
      {
        key: "about",
        label: "которая законцовка — как их видит пилот у кайта носом вверх",
        kind: "choice",
        options: [
          { value: "left-tip", label: "левая" },
          { value: "right-tip", label: "правая" },
        ],
      },
      { key: "x", label: "куда пришёл нос: x, от −100 до 100", kind: "number" },
      { key: "y", label: "куда пришёл нос: y, от 0 до 100", kind: "number" },
    ],
  },
  {
    id: "stop",
    name: "остановка",
    source: "ISKCB II.R, стр. 9",
    into: '`mark: "stall"`',
    asks: "сколько секунд; курс носа",
    fields: [{ key: "nose", label: COURSE_LABEL, kind: "number" }],
  },
  { id: "launch", name: "взлёт", source: "ISKCB II.K, стр. 8", into: '`mark: "launch"`', asks: "—", fields: [] },
  {
    id: "landing",
    name: "посадка",
    source: "ISKCB II.L–M, стр. 8",
    into: '`mark: "landing"`',
    asks: "вид: на переднюю кромку либо не назван",
    fields: [
      {
        key: "style",
        label: "вид",
        kind: "choice",
        options: [
          { value: "none", label: "не назван" },
          { value: "leading-edge", label: "на переднюю кромку" },
        ],
      },
    ],
  },
];

export const elementBy = (id: string): ElementDef | undefined => ELEMENTS.find((item) => item.id === id);

// Чего в словаре нет: строки таблицы «Что осталось снаружи и почему» разбора —
// что, почему и при каком условии вернуть.
export const OUTSIDE: readonly { what: string; why: string; back: string }[] = [
  {
    what: "Inverted Flight, Turn, Ground Pass",
    why: "определены, но это свойство шага или стык шагов, а не шаг (4.2). Отдельным элементом они записали бы то же второй раз",
    back: "если проверке разнообразия нужны как метки — выводить из шагов, не хранить",
  },
  { what: "Pivot, Hover", why: "не определены; pivot — сочетание элементов 10 и 8", back: "пилот подтвердит, что это самостоятельные элементы с названием" },
  { what: "взлёт и посадка на законцовке", why: "в определениях посадок такой нет, вида в формате нет", back: "раздел 7, требование 4" },
  {
    what: "Push Stall, Snap Stall, Two-Point Landing и его виды, Belly Landing, Axel",
    why: "определены и записываются, но в мультистропных фигурах не встречаются — второе условие",
    back: "второй слой словаря для двухстропных дисциплин; либо пилот скажет, что четырёхстропный кайт их летает",
  },
  { what: "Half axel", why: "не определён; встречается только в двухстропных фигурах", back: "вместе с двухстропным слоем, с пометкой «определения нет»" },
  { what: "slack-line трюки, кроме акселя", why: "ни определения, ни имени", back: "раздел 7, требование 3, и ответ пилота" },
  { what: "поворот на ходу", why: "допущен определением, шагом не выражается", back: "раздел 7, требование 5, и ответ пилота" },
  { what: "кривая, оборот вокруг законцовки на 360°", why: "не выражаются; в фигурах не встречаются", back: "появится пример" },
  { what: "манёвры зала", why: "другая дисциплина", back: "не возвращать в рамках технической рутины" },
  { what: "multi-line effects, multi-line aspects, «change the plane», daring maneuvers", why: "не определены", back: "появится определение" },
];

// Набор рассчитан на одиночника с четырёхстропным кайтом (разбор, раздел 6).
export const ELEMENTS_FOR = "multi-line-individual";

// Число в поле элемента: до четырёх цифр и до двух знаков после запятой или
// точки — точность самих координат; минус — для левой половины окна. Запятая
// без цифр за ней читается как целое, как в поле длительности.
const NUMBER = /^[-−]?\d{1,4}(?:[.,]\d{0,2})?$/;

export type Values = Record<string, number | string>;
export type Read = { values: Values; missing: string[]; bad: string[] };

// Какие поля у элемента при таких значениях: поле с `when` появляется, когда
// выбрано названное значение.
export function fieldsOf(def: ElementDef, raw: Readonly<Record<string, string>>): Field[] {
  return def.fields.filter((field) => field.when === undefined || raw[field.when[0]] === field.when[1]);
}

// Что записано в полях элемента: значения, пустые поля и поля с не-числом.
// Пустое поле остаётся пустым — значения за автора нет ни у одного.
export function readValues(def: ElementDef, raw: Readonly<Record<string, string>>): Read {
  const result: Read = { values: {}, missing: [], bad: [] };
  for (const field of fieldsOf(def, raw)) {
    const text = (raw[field.key] ?? "").trim();
    if (text === "") {
      result.missing.push(field.key);
    } else if (field.kind === "choice") {
      if (field.options.some((option) => option.value === text)) {
        result.values[field.key] = text;
      } else {
        result.bad.push(field.key);
      }
    } else if (NUMBER.test(text)) {
      // «−0» записало бы в файл ноль с минусом; ноль у нас один.
      result.values[field.key] = Number(text.replace("−", "-").replace(",", ".")) + 0;
    } else {
      result.bad.push(field.key);
    }
  }
  return result;
}

// Курс движения в градусах: 0 — вверх, 90 — вправо.
function courseOf(from: Point, to: Point): number {
  return ((Math.atan2(to[0] - from[0], to[1] - from[1]) * 180) / Math.PI + 360) % 360;
}

// На сколько градусов расходятся два курса, от 0 до 180.
function apart(a: number, b: number): number {
  const gap = Math.abs(a - b) % 360;
  return Math.min(gap, 360 - gap);
}

// С каким допуском курс носа считается лежащим на линии хода — тот же, с
// каким разбор словаря относил отрезки каталога к виду.
const ON_COURSE = 0.5;

const round2 = (value: number): number => Math.round(value * 100) / 100 + 0;
const show = (point: Point): string => `[${point.join(", ")}]`;

// Взлёт и посадка — на земле: так говорят определения, а формат отметку к
// земле не привязывает, это делает словарь.
const onGround = (position: Point): boolean => Math.abs(position[1] - GRID.yMin) <= TOLERANCE;

type Raw = Record<string, unknown>;

// Элемент с параметрами — в шаги пути, как их пишут в файле рутины.
// `position` — где кайт стоит перед элементом. Геометрию шага (сетка окна,
// законцовка с названной стороны, нулевая длина) сверяет разбор рутины; здесь
// — только то, что говорит само определение элемента.
export function expand(id: ElementId, values: Values, position: Point): Raw[] {
  const def = elementBy(id)!;
  const number = (key: string): number => {
    const value = values[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`${def.name}: не задано «${key}»`);
    }
    return value;
  };
  const choice = (key: string): string => {
    const field = def.fields.find((item) => item.key === key);
    const value = values[key];
    if (typeof value !== "string" || field?.kind !== "choice" || !field.options.some((option) => option.value === value)) {
      throw new Error(`${def.name}: не выбрано «${key}»`);
    }
    return value;
  };
  switch (id) {
    case "forward":
      return [{ kind: "line", to: [number("x"), number("y")] }];
    case "backward":
      return [{ kind: "line", to: [number("x"), number("y")], nose: "backward" }];
    case "slide-horizontal":
      return [{ kind: "line", to: [number("x"), position[1]], nose: 0 }];
    case "slide-vertical":
      return [{ kind: "line", to: [position[0], number("y")], nose: Number(choice("nose")) }];
    case "slide-inverted":
      return [{ kind: "line", to: [number("x"), position[1]], nose: 180 }];
    case "diagonal": {
      const to: Point = [number("x"), number("y")];
      const nose = number("nose");
      if (Math.abs(to[0] - position[0]) < TOLERANCE || Math.abs(to[1] - position[1]) < TOLERANCE) {
        throw new Error(`${def.name}: из ${show(position)} в ${show(to)} — не диагональ, точка лежит на той же ${Math.abs(to[0] - position[0]) < TOLERANCE ? "вертикали" : "высоте"}`);
      }
      const course = courseOf(position, to);
      if (apart(nose, course) <= ON_COURSE || apart(nose, course + 180) <= ON_COURSE) {
        const same = apart(nose, course) <= ON_COURSE ? "forward" : "backward";
        throw new Error(`${def.name}: курс носа ${nose}° лежит на линии хода — это ${elementBy(same)!.name}; одну запись у одного курса словарь держит словом носа`);
      }
      return [{ kind: "line", to, nose }];
    }
    case "arc": {
      const center: Point = [number("cx"), number("cy")];
      const direction = choice("direction") as "cw" | "ccw";
      const sweep = number("sweep");
      const nose = choice("nose");
      if (!(sweep > 0 && sweep <= 360)) {
        throw new Error(`${def.name}: угол — больше 0 и не больше 360 градусов`);
      }
      // Круг кончается там же, где начался; конец дуги следует из центра, стороны и угла.
      const end = sweep === 360 ? position : arcPoint(position, center, direction, sweep);
      return [
        {
          kind: "arc",
          to: [round2(end[0]), round2(end[1])],
          center,
          direction,
          sweep,
          ...(nose === "forward" ? {} : { nose: nose === "course" ? number("course") : nose }),
        },
      ];
    }
    case "spin":
      return [{ kind: "rotate", degrees: number("degrees"), direction: choice("direction"), about: "center" }];
    case "tip-spin": {
      const degrees = number("degrees");
      if (!(degrees > 0 && degrees < 360)) {
        throw new Error(`${def.name}: угол — больше 0 и меньше 360 градусов`);
      }
      return [{ kind: "rotate", degrees, direction: choice("direction"), about: choice("about"), to: [number("x"), number("y")] }];
    }
    case "stop":
      return [{ kind: "mark", mark: "stall", nose: number("nose") }];
    case "launch":
    case "landing": {
      if (!onGround(position)) {
        throw new Error(`${def.name} — на земле (${def.source}), а кайт стоит в ${show(position)}`);
      }
      if (id === "launch") {
        return [{ kind: "mark", mark: "launch" }];
      }
      const style = choice("style");
      return [{ kind: "mark", mark: "landing", ...(style === "none" ? {} : { style }) }];
    }
  }
}

// Какой элемент словаря записан этим шагом; `null` — никакой. `position` — где
// кайт стоит перед шагом; `null` — места ещё нет.
//
// Три решения, которых книга не принимает, приняты здесь (разбор, раздел 7):
// - отрезок, которому определения имени не дают (горизонталь с носом 45°), —
//   не элемент: словарь такого шага не порождает и имени ему не даёт;
// - на диагонали решает слово носа: `forward` и `backward` — полёт вперёд и
//   назад, число — диагональный полёт;
// - нос числом, лежащий на линии хода, — тот же полёт, что нос словом.
//
// Не элемент и всё, что осталось снаружи: вызовы, виды остановки, посадка на
// две точки и на лицевую сторону, аксель; и шаг фигуры с записью «книга не
// говорит» — без названной точки поворота, без курса метки, с незаданным местом.
export function elementOf(step: Step | OwnStep, position: Point | null): ElementId | null {
  switch (step.kind) {
    case "start":
      return null;
    case "line": {
      if ("unset" in step && step.unset !== undefined) {
        return null;
      }
      if (step.nose === "forward" || step.nose === "backward") {
        return step.nose;
      }
      if (typeof step.nose !== "number" || position === null) {
        return null;
      }
      const course = courseOf(position, step.to);
      if (apart(step.nose, course) <= ON_COURSE) {
        return "forward";
      }
      if (apart(step.nose, course + 180) <= ON_COURSE) {
        return "backward";
      }
      const level = Math.abs(step.to[1] - position[1]) < TOLERANCE;
      const plumb = Math.abs(step.to[0] - position[0]) < TOLERANCE;
      if (level) {
        return step.nose === 0 ? "slide-horizontal" : step.nose === 180 ? "slide-inverted" : null;
      }
      if (plumb) {
        return step.nose === 90 || step.nose === 270 ? "slide-vertical" : null;
      }
      return "diagonal";
    }
    case "arc":
      return "arc";
    case "rotate":
      if (typeof step.about !== "string" || ("basis" in step && step.basis === "unspecified")) {
        return null;
      }
      return step.about === "center" ? "spin" : step.to === undefined ? null : "tip-spin";
    case "mark":
      if (step.mark === "stall") {
        return step.style === undefined && typeof step.nose === "number" ? "stop" : null;
      }
      if (step.mark === "launch") {
        return position !== null && onGround(position) ? "launch" : null;
      }
      if (step.mark === "landing") {
        return (step.style === undefined || step.style === "leading-edge") && position !== null && onGround(position) ? "landing" : null;
      }
      return null;
  }
}

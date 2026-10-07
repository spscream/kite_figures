// Шаги пути кайта словами — подпись к схеме: порядок проходов, которого по
// одному рисунку не прочесть, и всё, чего рисунок не показывает (нос кайта,
// вид остановки и посадки, одновременность). Формулировки свои и строятся из
// тех же данных, что и чертёж.

import { isSwing, type Basis, type Kite, type Point, type Step } from "./geometry";

// Пометка шага, которую читатель обязан увидеть: направление не показано
// первоисточником либо координата взята не с подписанной линии сетки.
export type Tag = "unmarked" | Exclude<Basis, "grid">;

// Пометка стоит сразу за перемещением, до событий в точке: она про
// координату шага, а не про остановку или выход. Кружок и квадрат — те же
// значки, что на схеме и в её легенде; `unmarked` в это число не входит: его
// разметка выделяет отдельно.
const TAG_TEXT: Record<Exclude<Tag, "unmarked">, string> = {
  derived: " ○",
  measured: " □",
  text: " (число из текста страницы)",
};

// Шаг нарисован и назван в том порядке, в каком записан в данных; пометка
// говорит, что первоисточник этого порядка не показывает.
export const UNMARKED_TEXT = "направление в книге не показано";

export type StepLine = {
  // Перемещение (или точка старта) и события в точке, куда оно привело.
  head: string;
  events: string[];
  tags: Tag[];
  // Метки одновременности: шаги разных кайтов с одной меткой заканчиваются
  // в один момент.
  sync: string[];
};

function num(value: number): string {
  return String(value).replace("-", "−").replace(".", ",");
}

function point([x, y]: Point): string {
  return `(${num(x)}; ${num(y)})`;
}

const DIRECTION = { cw: "по часовой стрелке", ccw: "против часовой стрелки" } as const;

const COURSE: Record<number, string> = { 0: "вверх", 90: "вправо", 180: "вниз", 270: "влево" };

function nose(step: Extract<Step, { kind: "line" | "arc" }>): string {
  switch (step.nose) {
    case "forward":
      return "";
    case "backward":
      return ", полёт назад";
    case "out":
      return ", нос наружу круга";
    case "in":
      return ", нос внутрь круга";
    default:
      return `, нос ${COURSE[step.nose] ?? `по курсу ${num(step.nose)}°`}`;
  }
}

const STYLE: Record<string, string> = {
  "two-point": " на две точки",
  "snap-two-point": " рывком на две точки",
  "stall-two-point": " из остановки на две точки",
  "spin-two-point": " с вращением на две точки",
  "leading-edge": " на переднюю кромку",
  belly: " на живот",
  push: " толчком (push)",
  snap: " рывком (snap)",
};

const MARK = {
  in: "вход (IN)",
  out: "выход (OUT)",
  launch: "взлёт",
  landing: "посадка",
  stall: "остановка",
  axel: "аксель",
  "half-axel": "половина акселя",
} as const;

const ABOUT = {
  center: " вокруг центра",
  "left-tip": " вокруг левой законцовки",
  "right-tip": " вокруг правой законцовки",
} as const;

// Точка поворота названа всегда — либо сказано, что книга её не называет.
// Выведенная отличается от прочитанной словами: значка на схеме у неё нет.
export const ABOUT_MISSING_TEXT = " (точка поворота в книге не названа)";
export const ABOUT_DERIVED_TEXT = " (выведено, книгой не названо)";

function turn(step: Extract<Step, { kind: "rotate" }>): string {
  const about =
    typeof step.about === "string"
      ? ABOUT[step.about] + (step.about_basis === "derived" ? ABOUT_DERIVED_TEXT : "")
      : ABOUT_MISSING_TEXT;
  const to = isSwing(step) ? ` до ${point(step.to)}` : "";
  return `оворот на ${num(step.degrees)}° ${DIRECTION[step.direction]}${about}${to}`;
}

function head(step: Step): string {
  switch (step.kind) {
    case "start":
      return `Точка ${point(step.at)}`;
    case "line":
      return `Прямая до ${point(step.to)}${nose(step)}`;
    case "arc": {
      const turn = ` ${DIRECTION[step.direction]}`;
      return step.sweep === 360
        ? `Полный круг${turn} вокруг ${point(step.center)}${nose(step)}`
        : `Дуга ${num(step.sweep)}°${turn} вокруг ${point(step.center)} до ${point(step.to)}${nose(step)}`;
    }
    case "mark":
      return (
        MARK[step.mark] +
        (step.style ? STYLE[step.style] : "") +
        // Курс метки, которой книга рисует кайт в остановке; где метки нет,
        // строка о носе молчит.
        (typeof step.nose === "number" ? `, на схеме книги кайт носом ${COURSE[step.nose] ?? `по курсу ${num(step.nose)}°`}` : "")
      );
    case "rotate":
      // Поворот со смещением — перемещение, и строка у него своя.
      return (isSwing(step) ? "П" : "п") + turn(step);
  }
}

// Строка на каждое перемещение — отрезок, дугу и поворот, который сам
// перемещает кайт; события в точке, куда оно привело (отметки и повороты на
// месте), дописываются к нему же. Первая строка — точка старта.
export function describeKite(kite: Kite): StepLine[] {
  const lines: StepLine[] = [];
  for (const step of kite.path) {
    if (step.kind === "start" || step.kind === "line" || step.kind === "arc" || isSwing(step)) {
      const tags: Tag[] = [];
      if ((step.kind === "line" || step.kind === "arc") && step.unmarked) {
        tags.push("unmarked");
      }
      if (step.basis !== undefined && step.basis !== "grid") {
        tags.push(step.basis);
      }
      lines.push({ head: head(step), events: [], tags, sync: [] });
    } else {
      lines[lines.length - 1].events.push(head(step));
    }
    const line = lines[lines.length - 1];
    if ("sync" in step && step.sync !== undefined && !line.sync.includes(step.sync)) {
      line.sync.push(step.sync);
    }
  }
  return lines;
}

// Строка шага одним текстом. Метки одновременности нужны только там, где
// кайтов несколько.
export function lineText(line: StepLine, many: boolean): string {
  const tags = line.tags.map((tag) => (tag === "unmarked" ? "" : TAG_TEXT[tag])).join("");
  const events = line.events.length > 0 ? ` — ${line.events.join(", ")}` : "";
  return line.head + tags + events + (many && line.sync.length > 0 ? ` [${line.sync.join(", ")}]` : "");
}

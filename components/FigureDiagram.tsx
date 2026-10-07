import { type Drawing, drawVariant, shape, type Shape, SHAPES } from "@/lib/diagram";
import type { Variant } from "@/lib/geometry";
import { describeKite, lineText, UNMARKED_TEXT } from "@/lib/steps";

// Схема фигуры рисуется на сборке из `data/figures/`, в обозначениях книги
// фигур. Ни одной картинки в репозитории нет: чертёж считает
// `lib/diagram.ts`, здесь только разметка. Оформление — классы `d-*` в `app/globals.css`.

const SHAPE_TEXT: Record<Shape, string> = {
  in: "вход (In), нос по курсу",
  out: "выход (Out)",
  stall: "остановка",
  turn: "поворот на месте",
  axel: "аксель или его половина",
  launch: "взлёт (значок под точкой)",
  landing: "посадка (значок под точкой)",
  derived: "координата выведена из подписей схемы, а не стоит на линии сетки (в шагах — ○)",
  measured: "координата снята замером по схеме, приблизительно (в шагах — □)",
};

// Числа сетки: сперва оси, потом остальные по порядку; число, которому не
// хватило места рядом с уже поставленным, пропускается — линия остаётся.
function ticks(mid: number, values: number[], room: number): number[] {
  const placed = [mid];
  for (const value of values) {
    if (placed.every((other) => Math.abs(other - value) >= room)) {
      placed.push(value);
    }
  }
  return placed;
}

// Кайты команды различаются цветом, как в книге, а без цвета — штрихом линии
// и номером у входа и выхода. Штрихов пять — по самому большому составу.
// Одиночный кайт летит чёрной сплошной.
const trackClass = (index: number, many: boolean) => `d-track k${many ? (index % 5) + 1 : 0}`;

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg className="d-icon" viewBox="-6 -6 12 12" aria-hidden="true">
      {children}
    </svg>
  );
}

// Легенда у каждой схемы своя и называет ровно то, что на этой схеме есть:
// лист с одним составом команды читается и в печати, без соседних.
function Legend({ drawing, kites }: { drawing: Drawing; kites: string[] }) {
  const used = SHAPES.filter((name) => drawing.shapes[name]);
  return (
    <ul className="d-legend">
      {kites.length > 1 &&
        kites.map((id, index) => (
          <li key={`kite-${id}`}>
            <svg className="d-icon d-icon-line" viewBox="0 -6 24 12" aria-hidden="true">
              <path className={trackClass(index, true)} d="M0 0h24" />
            </svg>
            {`кайт #${id}`}
          </li>
        ))}
      {drawing.arrows && (
        <li>
          <Icon>
            <path className="d-arrow" d="M5 0L-3 4V-4Z" />
          </Icon>
          направление движения
        </li>
      )}
      {used.map((name) => (
        <li key={name}>
          <Icon>
            <path className={`d-${name}`} d={shape(name, 0, 0)} />
          </Icon>
          {SHAPE_TEXT[name]}
        </li>
      ))}
    </ul>
  );
}

function Diagram({ drawing, label }: { drawing: Drawing; label: string }) {
  const { xs, ys } = drawing.grid;
  const many = drawing.tracks.length > 1;
  const lines = [...xs.map((x) => `M${x} 0v100`), ...ys.map((y) => `M-100 ${100 - y}h200`)].join("");
  return (
    <svg className="d-svg" viewBox={drawing.viewBox} role="img" aria-label={label}>
      {/* Линии сетки — только там, где проходит фигура; оси окна — всегда. */}
      {lines && <path className="d-grid" d={lines} />}
      <path className="d-mid" d="M0 0v100M-100 50h200" />
      <path className="d-frame" d="M-100 0h200v100h-200z" />
      {ticks(0, xs, 8).map((x) => (
        <text key={`x${x}`} className={x === 0 ? "d-tick d-mid" : "d-tick"} x={x} y={107.5}>
          {Math.abs(x)}
        </text>
      ))}
      {ticks(50, ys, 5.5).map((y) => (
        <text key={`y${y}`} className={y === 50 ? "d-tick d-tick-y d-mid" : "d-tick d-tick-y"} x={-102} y={100 - y + 1.6}>
          {y}
        </text>
      ))}
      {drawing.tracks.map((track, index) => (
        <path key={track.id} className={trackClass(index, many)} d={track.d} />
      ))}
      {drawing.arrows && <path className="d-arrow" d={drawing.arrows} />}
      {SHAPES.map(
        (name) => drawing.shapes[name] && <path key={name} className={`d-${name}`} d={drawing.shapes[name]} />,
      )}
      {drawing.labels.map(({ x, y, text, tone }, index) => (
        <text key={index} className={`d-label ${tone}`} x={x} y={y + 2}>
          {text}
        </text>
      ))}
    </svg>
  );
}

// `Heading` — уровень заголовка кайта: на ступень ниже заголовка варианта, а
// где его нет — сразу под заголовком страницы.
function Steps({ variant, Heading }: { variant: Variant; Heading: "h2" | "h3" }) {
  const many = variant.kites.length > 1;
  return (
    <div className="steps">
      {variant.kites.map((kite) => (
        <section key={kite.id}>
          {many && <Heading>{`Кайт ${kite.id}`}</Heading>}
          <ol>
            {describeKite(kite).map((line, index) => (
              <li key={index}>
                {lineText(line, many)}
                {line.tags.includes("unmarked") && (
                  <>
                    {" "}
                    <strong className="unmarked">{UNMARKED_TEXT}</strong>
                  </>
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

type Props = {
  title: string;
  variants: Variant[];
  // Адрес страницы первоисточника по её номеру: у варианта она бывает своя.
  pageUrl: (page: number) => string;
};

export function FigureDiagrams({ title, variants, pageUrl }: Props) {
  const drawings = variants.map(drawVariant);
  return (
    <>
      {variants.map((variant, index) => {
        const heading =
          variant.team_size !== undefined
            ? `Состав: ${variant.team_size}`
            : variants.length > 1
              ? `Вариант «${variant.id}»`
              : null;
        return (
          <section key={variant.id} className="variant">
            {heading && (
              <h2>
                {heading}
                {variant.page !== undefined && (
                  <>
                    {" "}
                    <a className="variant-page" href={pageUrl(variant.page)} rel="noreferrer">
                      {`стр. ${variant.page}`}
                    </a>
                  </>
                )}
              </h2>
            )}
            <figure className="diagram">
              <Diagram
                drawing={drawings[index]}
                label={`Схема фигуры ${title}${heading ? `, ${heading.toLowerCase()}` : ""}`}
              />
              <figcaption>
                <Legend drawing={drawings[index]} kites={variant.kites.map((kite) => kite.id)} />
                {index === 0 && (
                  <p className="note">
                    Окно полёта — 200 на 100 единиц, как его видит пилот; числа у рамки — высота и расстояние
                    от середины окна. Стрелки идут в порядке полёта. Курс носа на каждом шаге, вид остановок и
                    посадок
                    {variant.kites.length > 1
                      ? ", одновременность (одинаковые метки в квадратных скобках) и порядок там, где кайты летят по одной линии и штрихи сливаются,"
                      : ""}{" "}
                    — в шагах ниже.
                  </p>
                )}
              </figcaption>
            </figure>
            <Steps variant={variant} Heading={heading ? "h3" : "h2"} />
          </section>
        );
      })}
    </>
  );
}

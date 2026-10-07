import { type Drawing, drawVariant, KITE_SHAPES, shape, type Shape, SHAPES, wordOf, WORDS } from "@/lib/diagram";
import type { Variant } from "@/lib/geometry";
import { describeKite, lineText, UNMARKED_TEXT } from "@/lib/steps";

// Схема фигуры рисуется на сборке из `data/figures/`, в обозначениях книги
// фигур. Ни одной картинки в репозитории нет: чертёж считает
// `lib/diagram.ts`, здесь только разметка. Оформление — классы `d-*` в `app/globals.css`.

const SHAPE_TEXT: Record<Shape, string> = {
  in: "вход (In): кайт носом по курсу, координата — по носу",
  out: "выход (Out)",
  stall: "кайт в точке остановки",
  pass: "кайт в пути: куда смотрит нос",
  turn: "поворот на месте: сторона и угол",
  axel: "аксель или его половина",
  derived: "координата выведена из подписей схемы, а не стоит на линии сетки (в шагах — ○)",
  measured: "координата снята замером по схеме, приблизительно (в шагах — □)",
};

// У четырёхстропного кайта значок в пути показывает только нос, у
// двухстропного — ещё и направление: он летит носом вперёд.
const PASS_TEXT_DELTA = "кайт в пути: летит туда, куда смотрит нос, если рядом нет стрелки";

// Поворот, который сам перемещает кайт: линии пролёта у него нет.
const SWING_TEXT = "поворот со смещением: кайт переходит в новую точку самим поворотом, нос идёт по дуге; стрелка — сторона, число — угол";

// Вспомогательная линия книги — не путь: по ней никто не летит.
const GUIDE_TEXT = "вспомогательная линия книги: на ней кайты стоят в один момент";

// Слои схемы снизу вверх: пустой выход лежит под залитым входом и остановкой.
const LAYERS: Shape[] = ["out", "pass", "in", "stall", "turn", "axel", "derived", "measured"];

const isKite = (name: Shape) => (KITE_SHAPES as readonly string[]).includes(name);

// Числа сетки: сперва оси, потом остальные; число, которому не
// хватило места рядом с уже поставленным, пропускается — линия остаётся.
function ticks(mid: number, values: number[], room: number): number[] {
  const placed = [mid];
  // От оси наружу: зеркальная сетка получает зеркальные числа.
  for (const value of [...values].sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))) {
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
function Legend({ drawing, kites, rev }: { drawing: Drawing; kites: string[]; rev: boolean }) {
  const used = SHAPES.filter((name) => drawing.shapes[name]);
  // Слова подписей схемы — как в книге, по-английски; легенда их переводит.
  const words = [...new Set(drawing.labels.filter((label) => label.kind === "note").map((label) => wordOf(label.text)))].filter(
    (word) => word in WORDS,
  );
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
      {used.map((name) => (
        <li key={name}>
          <Icon>
            <path
              className={isKite(name) && kites.length > 1 ? `d-${name} g-k1` : `d-${name}`}
              d={shape(name, 0, isKite(name) ? (rev ? -1.7 : -3) : name === "turn" ? 1.5 : 0, undefined, 1, rev)}
            />
          </Icon>
          {name === "pass" && !rev ? PASS_TEXT_DELTA : SHAPE_TEXT[name]}
        </li>
      ))}
      {drawing.arrows.length > 0 && (
        <li>
          <Icon>
            <path className="d-arrow" d="M-5 0L5 0M5 0L2.4 1.1L2.4 -1.1Z" />
          </Icon>
          {drawing.arrows.some(({ tone }) => tone !== "mid")
            ? "направление движения (стрелка идёт рядом с линией; зелёная — от входа, красная — к выходу)"
            : "направление движения (стрелка идёт рядом с линией)"}
        </li>
      )}
      {drawing.swings && (
        <li>
          <Icon>
            <path className="d-swing" d="M0 4A4 4 0 0 0 0 -4M3 -1.9L4 0L5 -1.9" />
          </Icon>
          {SWING_TEXT}
        </li>
      )}
      {drawing.guides && (
        <li>
          <svg className="d-icon d-icon-line" viewBox="0 -6 24 12" aria-hidden="true">
            <path className="d-guide" d="M0 0h24" />
          </svg>
          {GUIDE_TEXT}
        </li>
      )}
      {words.map((word) => (
        <li key={word} className="d-word">
          <b>{word}</b>
          {` — ${WORDS[word]}`}
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
      {ticks(0, xs, 9).map((x) => (
        <text key={`x${x}`} className={x === 0 ? "d-tick d-mid" : "d-tick"} x={x} y={107.5}>
          {Math.abs(x)}
        </text>
      ))}
      {ticks(50, ys, 6).map((y) => (
        <text key={`y${y}`} className={y === 50 ? "d-tick d-tick-y d-mid" : "d-tick d-tick-y"} x={-102} y={100 - y + 1.6}>
          {y}
        </text>
      ))}
      {/* Вспомогательная линия книги — под путями: она их не перечёркивает. */}
      {drawing.guides && <path className="d-guide" d={drawing.guides} />}
      {drawing.tracks.map((track, index) => (
        <path key={track.id} className={trackClass(index, many)} d={track.d} />
      ))}
      {/* Поворот со смещением — тонкой дугой: это не пролёт. */}
      {drawing.swings && <path className="d-swing" d={drawing.swings} />}
      {LAYERS.flatMap((name) =>
        (drawing.shapes[name] ?? []).map(({ tone, d }) => (
          <path key={`${name}${tone}`} className={tone ? `d-${name} g-${tone}` : `d-${name}`} d={d} />
        )),
      )}
      {/* Стрелки — поверх значков: в тесном месте наконечник не должен уйти под кайт. */}
      {drawing.arrows.map(({ tone, d }) => (
        <path key={tone} className={`d-arrow a-${tone}`} d={d} />
      ))}
      {drawing.labels.map(({ x, y, text, tone, kind }, index) =>
        kind === "name" ? (
          <text key={index} className={`d-label ${tone}`} x={x} y={y + 2}>
            {text}
          </text>
        ) : (
          <text key={index} className="d-note" x={x} y={y + 1.5}>
            {text}
          </text>
        ),
      )}
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
  // Четырёхстропный кайт рисуется своим силуэтом.
  multiline: boolean;
};

export function FigureDiagrams({ title, variants, pageUrl, multiline }: Props) {
  const drawings = variants.map((variant) => drawVariant(variant, multiline));
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
                <Legend drawing={drawings[index]} kites={variant.kites.map((kite) => kite.id)} rev={multiline} />
                {index === 0 && (
                  <p className="note">
                    Окно полёта — 200 на 100 единиц, как его видит пилот; числа у рамки — высота и расстояние
                    от середины окна. Обозначения — как на схемах книги: значок кайта стоит носом в точке и смотрит туда же,
                    куда кайт{multiline ? "; тонкая стрелка рядом с линией показывает, куда он летит" : ", и летит он носом вперёд — кроме шагов, у которых рядом с линией стоит стрелка"}
                    {variants.some((item) => item.kites.some((kite) => kite.path.some((step) => "unmarked" in step && step.unmarked)))
                      ? ". На шагах с пометкой «" + UNMARKED_TEXT + "» знака направления нет: книга его не показывает"
                      : ""}
                    . Курс носа на каждом шаге, вид остановок и посадок
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

import Link from "next/link";

import { Diagram, Legend } from "@/components/FigureDiagram";
import { type Drawing, SHAPES } from "@/lib/diagram";
import { type Clock, clockText, type Frame, type FramePart, overviewOf, spanText, type Storyboard } from "@/lib/frames";
import { figurePath } from "@/lib/paths";
import { UNMARKED_TEXT } from "@/lib/steps";

// Страница рутины: обзорная схема, лента кадров и шаги со временем. Всё
// считает `lib/frames.ts`, здесь только разметка; оформление — классы `r-*` и
// `o-*` в `app/globals.css`. Страница читается без JavaScript: номера кадров на
// обзоре и в оглавлении — обычные ссылки на якоря.

export const frameId = (number: number) => `kadr-${number}`;

const ORIGIN_TEXT = { own: "своя работа", link: "связка" } as const;

// Время, которого автор не записал, числом не становится.
export const NO_TEMPO_TEXT = "темп не задан";
export const NO_CLOCK_TEXT = "—";

function Part({ part }: { part: FramePart }) {
  return part.figure ? (
    <>
      {"фигура "}
      <Link href={figurePath(part.figure.slug)}>{part.figure.title}</Link>
    </>
  ) : (
    ORIGIN_TEXT[part.origin as keyof typeof ORIGIN_TEXT]
  );
}

// Откуда взят кадр. Части без перемещения, показанные в нём заодно, названы
// тоже, но одно и то же происхождение дважды подряд не повторяется.
function Origins({ parts }: { parts: FramePart[] }) {
  const named = parts.filter((part, index) => part.figure || parts[index - 1]?.figure || part.origin !== parts[index - 1]?.origin);
  return (
    <>
      {named.map((part, index) => (
        <span key={part.segment}>
          {index > 0 && ", "}
          <Part part={part} />
        </span>
      ))}
    </>
  );
}

function Overview({ frames, name, many }: { frames: Frame[]; name: string; many: boolean }) {
  const overview = overviewOf(frames);
  return (
    <svg className="d-svg r-over" viewBox={overview.viewBox} role="img" aria-label={`Обзор рутины «${name}»: весь путь одной линией`}>
      <path className="d-mid" d="M0 0v100M-100 50h200" />
      <path className="d-frame" d="M-100 0h200v100h-200z" />
      <text className="d-tick d-mid" x={0} y={107.5}>
        0
      </text>
      <text className="d-tick d-tick-y d-mid" x={-102} y={51.6}>
        50
      </text>
      {overview.tracks.map((track, index) => (
        <path key={index} className={`o-track k${many ? track.color : 0}`} d={track.d} />
      ))}
      {overview.swings && <path className="o-swing" d={overview.swings} />}
      {overview.leads && <path className="o-lead" d={overview.leads} />}
      {overview.labels.map((label) => (
        <a key={label.frame} href={`#${frameId(label.frame)}`}>
          <text className="d-label t-frame" x={label.x} y={label.y}>
            {label.text}
          </text>
        </a>
      ))}
    </svg>
  );
}

function Steps({ frame, many }: { frame: Frame; many: boolean }) {
  // Кайт, у которого в кадре нет ни одной строки, списка не получает.
  const told = frame.kites.filter((kite) => kite.lines.length > 0);
  return (
    <div className="steps">
      {told.map((kite) => (
        <section key={kite.id}>
          {many && <h4>{`Кайт ${kite.id}`}</h4>}
          <ol className="r-steps" start={kite.first}>
            {kite.lines.map((line, index) => (
              <li key={index}>
                <span className="r-at">{line.at === null ? NO_CLOCK_TEXT : clockText(line.at)}</span> {line.text}
                {line.unmarked && (
                  <>
                    {" "}
                    <strong className="unmarked">{UNMARKED_TEXT}</strong>
                  </>
                )}
                {line.seconds !== 0 && (
                  <>
                    {" "}
                    <span className="r-span">{line.seconds === null ? NO_TEMPO_TEXT : spanText(line.seconds)}</span>
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

// Сколько шагов без темпа — словами: «у 1 шага», «у 3 шагов».
const untimedText = (count: number) => `у ${count} ${count % 10 === 1 && count % 100 !== 11 ? "шага" : "шагов"}`;

// Время от IN до OUT названо, когда оно известно и от всего пути отличается, —
// в том числе когда весь путь не складывается из-за шага после OUT.
export function timeText(clock: Clock): string {
  const whole =
    clock.total === null
      ? `время не складывается: ${untimedText(clock.untimed)} ${NO_TEMPO_TEXT}`
      : `весь записанный путь — ${clockText(clock.total)}`;
  return clock.judged === null || clock.judged === clock.total ? whole : `от IN до OUT — ${clockText(clock.judged)}, ${whole}`;
}

// Одна легенда на всю ленту: кайты и обозначения у кадров одни, и под каждым
// из них она повторялась бы слово в слово.
function union(frames: Frame[]): Pick<Drawing, "shapes" | "labels" | "arrows" | "swings" | "guides"> {
  const drawings = frames.map((frame) => frame.drawing);
  return {
    shapes: Object.fromEntries(SHAPES.filter((name) => drawings.some((drawing) => drawing.shapes[name])).map((name) => [name, []])),
    labels: drawings.flatMap((drawing) => drawing.labels),
    arrows: drawings.flatMap((drawing) => drawing.arrows),
    swings: drawings.map((drawing) => drawing.swings).join(""),
    guides: drawings.map((drawing) => drawing.guides).join(""),
  };
}

type Props = {
  name: string;
  board: Storyboard;
  // Четырёхстропный кайт рисуется своим силуэтом.
  multiline: boolean;
};

export function RoutineView({ name, board, multiline }: Props) {
  const { frames, clocks } = board;
  const many = clocks.length > 1;
  const kites = clocks.map((clock, order) => ({ id: clock.kite, color: (order % 5) + 1 }));
  return (
    <>
      <ul className="r-time">
        {clocks.map((clock) => (
          <li key={clock.kite}>{`${many ? `Кайт ${clock.kite}: ` : "Время: "}${timeText(clock)}.`}</li>
        ))}
      </ul>
      {many && <p className="note">Время каждого кайта отсчитано от его первого шага, а не от общего начала рутины.</p>}
      <section className="r-overview">
        <h2>Обзор</h2>
        <figure className="diagram">
          <Overview frames={frames} name={name} many={many} />
          <figcaption className="note">
            Весь путь одной тонкой линией — видно, какую часть окна рутина занимает. Значков, стрелок и слов здесь нет: путь
            много раз проходит по одним и тем же местам, и линия, пройденная дважды, выглядит как пройденная один раз. Число —
            номер кадра у точки, где кадр начинается; порядок и события читаются по кадрам ниже.
          </figcaption>
        </figure>
        <ol className="r-toc">
          {frames.map((frame) => (
            <li key={frame.number}>
              <a href={`#${frameId(frame.number)}`}>{`Кадр ${frame.number}`}</a>
              {" — "}
              <Origins parts={frame.parts} />
              {!many && frame.at !== null && <span className="r-span">{` с ${clockText(frame.at)}`}</span>}
            </li>
          ))}
        </ol>
      </section>
      <section className="r-strip">
        <h2>Кадры</h2>
        {frames.map((frame) => (
          <section key={frame.number} className="r-frame" id={frameId(frame.number)}>
            <h3>
              {`Кадр ${frame.number}: `}
              <Origins parts={frame.parts} />
            </h3>
            <figure className="diagram">
              <Diagram
                drawing={frame.drawing}
                label={`Кадр ${frame.number} рутины «${name}»`}
                colors={frame.variant.kites.map((kite, order) => kite.color ?? order + 1)}
                team={many}
              />
            </figure>
            <Steps frame={frame} many={many} />
          </section>
        ))}
      </section>
      <section className="r-legend">
        <h2>Обозначения</h2>
        <Legend drawing={union(frames)} kites={kites} rev={multiline} />
        <p className="note">
          Кадр — окно полёта целиком, 200 на 100 единиц, как его видит пилот; числа у рамки — высота и расстояние от
          середины окна. Обозначения — те же, что на схемах фигур: значок кайта стоит носом в точке и смотрит туда же, куда
          кайт{multiline ? "; тонкая стрелка рядом с линией показывает, куда он летит" : ", и летит он носом вперёд — кроме шагов, у которых рядом с линией стоит стрелка"}
          .{many && " Одинаковые метки в квадратных скобках в шагах разных кайтов — шаги, которые кончаются одновременно."} Серое число — номер кадра там, где кадр начинается; число со стрелкой — где он кончается и начинается следующий.
        </p>
      </section>
    </>
  );
}

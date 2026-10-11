"use client";

import { useMemo, useState, useSyncExternalStore } from "react";

import { checkRoutine, clock, findingText, judgedTimes, type State } from "@/lib/routine-checks";
import type { Routine } from "@/lib/routines";
import { BAD, fieldsOf, fileWithDurations, readField, routineFileText, slotsOf, timetable, timeText, withDurations } from "@/lib/tempo";

// Редактор длительностей рутины. Что длится, как читается поле и каким выходит
// файл, решает `lib/tempo.ts`; находки считает `lib/routine-checks.ts`; здесь
// поля ввода и разметка. Оформление — классы `te-*` в `app/globals.css`.
//
// Редактор ничего не сохраняет: сайт — статические файлы. Он отдаёт текст файла
// рутины, и кладёт его в `data/routines/` автор.
//
// Числа он не предлагает: в пустом поле нет ни значения, ни подсказки-числа, и
// шаг с пустым полем остаётся шагом, чей темп не задан.
//
// Без JavaScript поля мертвы, поэтому блок собран скрытым и открывается, когда
// страница ожила; о том, что редактору нужен JavaScript, говорит сама страница.

const never = () => () => {};

// Что проверка увидела — словом перед находкой. Ни балла, ни доли, ни размера
// штрафа здесь нет и быть не должно: находка — подсказка, а не оценка.
export const STATE_TEXT: Record<State, string> = {
  ok: "Выполнено",
  violation: "Нарушено",
  unknown: "По записи не решить",
  unchecked: "По записи не проверяется",
  fact: "Число без вывода",
};

export const BAD_TEXT = "Длительность — положительное число секунд, до 9999, не больше трёх знаков после запятой. Пустое поле — темп шага не задан.";
export const NO_TEMPO_TEXT = "темп не задан";

type Props = {
  routine: Routine;
  // Разобранный JSON файла рутины: он возвращается автору с новыми длительностями.
  file: unknown;
  fileName: string;
  // Заголовок каждой части рутины, по её номеру в файле.
  parts: string[];
};

export function TempoEditor({ routine, file, fileName, parts }: Props) {
  const live = useSyncExternalStore(never, () => true, () => false);
  const slots = useMemo(() => slotsOf(routine), [routine]);
  const [fields, setFields] = useState(() => fieldsOf(slots));
  const many = routine.kites.length > 1;

  const read = slots.map((slot) => ({ slot, value: readField(fields[slot.key] ?? "") }));
  const bad = read.filter((item) => item.value === BAD).length;
  // Пока в каком-то поле не число, рутины с такими длительностями нет: ни
  // времени, ни находок, ни файла по прежним значениям редактор не показывает.
  const durations = new Map(read.flatMap(({ slot, value }): [string, number][] => (typeof value === "number" ? [[slot.key, value]] : [])));
  const edited = bad > 0 ? null : withDurations(routine, durations);
  const table = edited && timetable(edited);
  const text = edited && routineFileText(fileWithDurations(file, routine, durations));

  return (
    <div className="tempo" hidden={!live}>
      <section className="te-parts">
        <h2>Длительности шагов</h2>
        {routine.segments.map((_, segment) => {
          const here = read.filter((item) => item.slot.segment === segment);
          if (here.length === 0) {
            return null;
          }
          return (
            <section key={segment} className="te-part">
              <h3>{parts[segment]}</h3>
              <ol className="te-rows">
                {here.map(({ slot, value }) => {
                  const id = `te-${slot.key.replaceAll("/", "-")}`;
                  const starts = table?.starts.get(slot.key);
                  return (
                    <li key={slot.key}>
                      <label htmlFor={id}>{`${many ? `Кайт ${slot.kite}. ` : ""}${slot.text}`}</label>
                      <span className="te-field">
                        <input
                          id={id}
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          size={7}
                          value={fields[slot.key] ?? ""}
                          aria-invalid={value === BAD}
                          onChange={(event) => setFields((old) => ({ ...old, [slot.key]: event.target.value }))}
                        />
                        {" с"}
                      </span>
                      <span className="te-at">
                        {value === BAD ? "не число секунд" : value === null ? NO_TEMPO_TEXT : starts == null ? "" : `начало — ${clock(starts)}`}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
        <div className="te-buttons">
          <button type="button" onClick={() => setFields(fieldsOf(slots))}>
            Вернуть длительности файла
          </button>
          <button type="button" onClick={() => setFields(fieldsOf(slots, true))}>
            Снять все длительности
          </button>
        </div>
      </section>
      {/* Об ошибке в поле говорит само поле (`aria-invalid` и слова рядом); этот
          абзац в живую область не входит, чтобы не звучать посреди набора числа. */}
      {bad > 0 && <p className="te-bad">{`Полей, в которых записана не длительность, — ${bad}. ${BAD_TEXT} Пока они не исправлены, времени, проверок и файла нет.`}</p>}
      <div aria-live="polite">
        {edited !== null && table !== null && text !== null && (
          <>
            <section className="te-total">
              <h2>Время</h2>
              <ul className="te-time">
                {judgedTimes(edited).map((judged, order) => (
                  <li key={routine.kites[order]}>{`${many ? `Кайт ${routine.kites[order]}: ` : ""}${timeText(judged, table.kites[order])}.`}</li>
                ))}
              </ul>
            </section>
            <section className="te-checks">
              <h2>Проверки</h2>
              <ul className="te-findings">
                {checkRoutine(edited).map((finding) => (
                  <li key={finding.code} className={`te-${finding.state}`}>
                    <b>{`${STATE_TEXT[finding.state]}.`}</b> {findingText(finding)}
                  </li>
                ))}
              </ul>
            </section>
            <section className="te-out">
              <h2>Файл рутины</h2>
              <p className="note">
                {"Текст файла с этими длительностями. Редактор его никуда не отправляет и не сохраняет: сохраните его сами как "}
                <code>{`data/routines/${fileName}`}</code>
                {"."}
              </p>
              <textarea className="te-file" readOnly rows={text.split("\n").length} value={text} aria-label={`Текст файла ${fileName}`} spellCheck={false} />
              <p>
                <a className="te-save" download={fileName} href={`data:application/json;charset=utf-8,${encodeURIComponent(text)}`}>
                  {`Скачать ${fileName}`}
                </a>
              </p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

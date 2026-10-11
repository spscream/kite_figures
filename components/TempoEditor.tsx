"use client";

import { Fragment, useMemo, useState, useSyncExternalStore } from "react";

import { type Draft, type Editing, elementsOf, insertElement, placesOf, preview } from "@/lib/compose";
import { type ElementDef, elementBy, ELEMENTS, ELEMENTS_FOR, fieldsOf as elementFields, OUTSIDE } from "@/lib/elements";
import type { Figure } from "@/lib/figures";
import { checkRoutine, clock, findingText, judgedTimes, type State } from "@/lib/routine-checks";
import type { Routine } from "@/lib/routines";
import { BAD, fieldsOf, fileWithDurations, readField, routineFileText, slotsOf, stepJson, timetable, timeText, withDurations } from "@/lib/tempo";

// Редактор рутины: длительности шагов и элементы словаря. Что длится, как
// читается поле и каким выходит файл, решает `lib/tempo.ts`; какие есть
// элементы и в какие шаги они разворачиваются — `lib/elements.ts`; как элемент
// встаёт в рутину — `lib/compose.ts`; находки считает `lib/routine-checks.ts`;
// здесь поля ввода и разметка. Оформление — классы `te-*` и `el-*` в
// `app/globals.css`.
//
// Редактор ничего не сохраняет: сайт — статические файлы. Он отдаёт текст файла
// рутины, и кладёт его в `data/routines/` автор.
//
// Числа он не предлагает: в пустом поле нет ни значения, ни подсказки-числа, и
// шаг с пустым полем остаётся шагом, чей темп не задан. То же у элемента: ни
// элемент, ни место, ни один параметр не выбраны заранее, и пока задано не
// всё, шагов нет.
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
export const NO_ELEMENTS_TEXT = "Набор элементов рассчитан на одиночника с четырёхстропным кайтом; у рутины другого раздела его нет.";
export const OUTSIDE_GROUP = "В словаре нет — причина в таблице под редактором";

const NO_DRAFT: Draft = { element: "", place: "", values: {}, seconds: "" };

type Props = {
  routine: Routine;
  // Разобранный JSON файла рутины: он возвращается автору с новыми длительностями.
  file: unknown;
  fileName: string;
  // Заголовок каждой части рутины, по её номеру в файле.
  parts: string[];
  // Фигуры каталога, на которые рутина ссылается: с ними рутину с новым шагом
  // читает разбор.
  figures: Figure[];
};

export function TempoEditor({ routine: given, file: givenFile, fileName, parts, figures }: Props) {
  const live = useSyncExternalStore(never, () => true, () => false);
  const [editing, setEditing] = useState<Editing>(() => ({ doc: { file: givenFile, routine: given }, fields: fieldsOf(slotsOf(given)) }));
  const [draft, setDraft] = useState(NO_DRAFT);
  const { doc, fields } = editing;
  const { routine, file } = doc;
  const setFields = (change: (old: Record<string, string>) => Record<string, string>) => setEditing((old) => ({ ...old, fields: change(old.fields) }));
  const slots = useMemo(() => slotsOf(routine), [routine]);
  const many = routine.kites.length > 1;

  // Словарь элементов: имя у шага, который им записан, и новый шаг из элемента.
  const worded = routine.discipline === ELEMENTS_FOR;
  const names = useMemo(() => (worded ? elementsOf(routine) : new Map<string, ElementDef>()), [worded, routine]);
  const places = useMemo(() => (worded ? placesOf(routine, parts) : []), [worded, routine, parts]);
  const chosen = elementBy(draft.element);
  const made = worded ? preview(doc, places, draft, fileName, figures) : null;

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
                      {names.has(slot.key) && <span className="te-el">{names.get(slot.key)?.name}</span>}
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
          <button type="button" onClick={() => setFields(() => fieldsOf(slots))}>
            Вернуть длительности файла
          </button>
          <button type="button" onClick={() => setFields(() => fieldsOf(slots, true))}>
            Снять все длительности
          </button>
        </div>
      </section>
      <section className="el-add">
        <h2>Добавить элемент</h2>
        {!worded ? (
          <p className="note">{NO_ELEMENTS_TEXT}</p>
        ) : (
          <>
            <p className="note">
              Элемент словаря встаёт в рутину шагом пути — в свою часть или в связку; шаги фигуры каталога не правятся. Ни
              элемент, ни место, ни один параметр не выбраны заранее: пока задано не всё, шагов нет. Шаги после нового
              остаются как записаны, и рутину с ним читает тот же разбор, что читает файл: не сошлась — шаг не встаёт, а
              причина названа.
            </p>
            <div className="el-form">
              <label htmlFor="el-kind">Элемент</label>
              <select id="el-kind" value={draft.element} onChange={(event) => setDraft({ ...draft, element: event.target.value, values: {} })}>
                <option value="">— не выбран —</option>
                <optgroup label="Словарь элементов">
                  {ELEMENTS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={OUTSIDE_GROUP}>
                  {OUTSIDE.map((item) => (
                    <option key={item.what} disabled>
                      {item.what}
                    </option>
                  ))}
                </optgroup>
              </select>
              <label htmlFor="el-place">Место в рутине</label>
              <select id="el-place" value={draft.place} onChange={(event) => setDraft({ ...draft, place: event.target.value })}>
                <option value="">— не выбрано —</option>
                {places.map((place) => (
                  <option key={place.key} value={place.key}>
                    {place.text}
                  </option>
                ))}
              </select>
              {chosen &&
                elementFields(chosen, draft.values).map((field) => {
                  const id = `el-f-${field.key}`;
                  const change = (value: string) => setDraft({ ...draft, values: { ...draft.values, [field.key]: value } });
                  return (
                    <Fragment key={field.key}>
                      <label htmlFor={id}>{field.label}</label>
                      {field.kind === "choice" ? (
                        <select id={id} value={draft.values[field.key] ?? ""} onChange={(event) => change(event.target.value)}>
                          <option value="">— не выбрано —</option>
                          {field.options.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input id={id} type="text" autoComplete="off" size={7} value={draft.values[field.key] ?? ""} onChange={(event) => change(event.target.value)} />
                      )}
                    </Fragment>
                  );
                })}
              {chosen && (
                <>
                  <label htmlFor="el-seconds">длительность, с; пустое поле — темп не задан</label>
                  <input
                    id="el-seconds"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    size={7}
                    value={draft.seconds}
                    onChange={(event) => setDraft({ ...draft, seconds: event.target.value })}
                  />
                </>
              )}
            </div>
            <div aria-live="polite">
              {chosen && <p className="note el-source">{`${chosen.name}: определение — ${chosen.source}.`}</p>}
              {made?.state === "bad" && <p className="el-bad">{made.message}</p>}
              {made?.state === "empty" && chosen && <p className="note el-wait">Шагов пока нет: задано не всё.</p>}
              {made?.state === "ready" && (
                <ul className="el-steps">
                  {made.steps.map((step, index) => (
                    <li key={index}>
                      <code>{stepJson(made.seconds === null ? step : { ...step, seconds: made.seconds })}</code>
                      {` — ${made.words[index]}`}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="te-buttons">
              <button
                type="button"
                id="el-put"
                disabled={made?.state !== "ready"}
                onClick={() => {
                  setEditing(insertElement(editing, places, draft, fileName, figures));
                  setDraft({ ...NO_DRAFT, element: draft.element });
                }}
              >
                Поставить в рутину
              </button>
              {file !== givenFile && (
                <button type="button" id="el-drop" onClick={() => setEditing({ doc: { file: givenFile, routine: given }, fields: fieldsOf(slotsOf(given)) })}>
                  Вернуть рутину как в файле
                </button>
              )}
            </div>
          </>
        )}
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

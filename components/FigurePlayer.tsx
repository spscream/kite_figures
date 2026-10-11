"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { Step } from "@/lib/geometry";
import {
  back,
  type Cursor,
  forward,
  frameAt,
  GAP_TEXT,
  NO_SYNC_TEXT,
  PACE_TEXT,
  pause,
  play,
  sceneOf,
  START,
  stopText,
  TEAM_GAP_TEXT,
  TEAM_PACE_TEXT,
  teamFrameAt,
  teamOf,
  tick,
} from "@/lib/playback";

// Проигрывание пути поверх готовой схемы: одного кайта — по строкам списка
// шагов, пары и команды — от одной общей метки одновременности до следующей.
// Что показать и как шагать, решает `lib/playback.ts`; здесь кнопки и слой со
// значками. Оформление — классы `p-*` в `app/globals.css`.
//
// Вариант с несколькими кайтами и без единой метки не проигрывается: вместо
// кнопок — строка о том, почему.
//
// Без JavaScript страница остаётся прежней: схема приходит готовой разметкой
// (`children`), слой поверх неё не рисуется, а блок с кнопками скрыт, пока
// страница не ожила.

const never = () => () => {};

const STILL = "(prefers-reduced-motion: reduce)";

function watchStill(notify: () => void) {
  const query = window.matchMedia(STILL);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}

// Дольше этого между кадрами — вкладка была скрыта: путь за это время не летел.
const LONGEST_FRAME = 100;

type Props = {
  // Кайты варианта с их цветом на схеме.
  kites: { id: string; path: Step[]; color: number }[];
  // Четырёхстропный кайт: свой силуэт и свой курс в остановке.
  rev: boolean;
  // Строки шагов одного кайта словами — те же, что в списке под схемой, по
  // порядку; у пары и команды шаг показа — не строка списка.
  rows: string[];
  viewBox: string;
  children: React.ReactNode;
};

// Значок на слое: чей он, линия вместо него и где стоит номер кайта.
type Mark = {
  key: string;
  // Класс цвета кайта команды; у одного кайта пусто.
  tone: string;
  track: string;
  unknown: boolean;
  glyph: { kind: "kite" | "spot"; d: string } | null;
  unsure: boolean;
  tag: [number, number] | null;
};

export function FigurePlayer({ kites, rev, rows, viewBox, children }: Props) {
  const solo = kites.length === 1;
  const scene = useMemo(() => (solo ? sceneOf(kites[0].path, rev) : null), [solo, kites, rev]);
  const team = useMemo(() => (solo ? null : teamOf(kites, rev)), [solo, kites, rev]);
  const paced = scene ?? team;
  const live = useSyncExternalStore(never, () => true, () => false);
  // Посетитель просил без движения: шаг ставит кайт сразу в конец строки.
  const still = useSyncExternalStore(watchStill, () => window.matchMedia(STILL).matches, () => false);
  const [cursor, setCursor] = useState<Cursor>(START);
  const running = cursor.run !== "rest";

  useEffect(() => {
    if (!running || !paced) {
      return;
    }
    let seen: number | null = null;
    let frame = requestAnimationFrame(function next(now: number) {
      const passed = seen === null ? 0 : Math.min(now - seen, LONGEST_FRAME) / 1000;
      seen = now;
      setCursor((at) => tick(paced, at, passed));
      frame = requestAnimationFrame(next);
    });
    return () => cancelAnimationFrame(frame);
  }, [running, paced]);

  if (!paced) {
    return (
      <>
        <div className="p-stage">{children}</div>
        <div className="player" hidden={!live}>
          <p className="p-gap">{NO_SYNC_TEXT}</p>
        </div>
      </>
    );
  }

  let marks: Mark[];
  let now: string;
  let gaps: string[];
  if (scene) {
    const { row, glyph, unsure } = frameAt(scene, cursor);
    marks = [{ key: "1", tone: "", track: row.track, unknown: row.unmarked, glyph, unsure, tag: null }];
    now = rows[cursor.row];
    gaps = row.gaps.map((gap) => GAP_TEXT[gap]);
  } else {
    const frame = teamFrameAt(team!, cursor);
    marks = frame.kites.map(({ id, color, glyph, unsure, track, tag }) => ({ key: id, tone: ` p-team p-k${color}`, track, unknown: true, glyph, unsure, tag }));
    now = stopText(team!, cursor.row);
    gaps = frame.row.gaps.map((gap) => TEAM_GAP_TEXT[gap]);
  }
  const atEnd = cursor.row === paced.rows.length - 1 && cursor.t >= 1;

  return (
    <>
      <div className="p-stage">
        {children}
        {live && (
          <svg className="p-svg" viewBox={viewBox} aria-hidden="true">
            {marks.map(({ key, tone, track, unknown }) => track && <path key={key} className={`p-track${unknown ? " p-unknown" : ""}${tone}`} d={track} />)}
            {marks.map(
              ({ key, tone, glyph, unsure }) =>
                glyph && <path key={key} className={`p-${glyph.kind}${glyph.kind === "spot" || unsure ? " p-unsure" : ""}${tone}`} d={glyph.d} />,
            )}
            {/* Номер кайта у значка: без цвета кайты команды иначе не различить. */}
            {marks.map(
              ({ key, tone, tag }) =>
                tag && (
                  <text key={key} className={`p-tag${tone}`} x={tag[0]} y={tag[1] + 1.6}>
                    {key}
                  </text>
                ),
            )}
          </svg>
        )}
      </div>
      <div className="player" hidden={!live}>
        {/* Кнопка, которой сейчас некуда вести, остаётся в обходе с клавиатуры:
            `disabled` снял бы с неё фокус прямо под пальцами. */}
        <div className="p-buttons" role="group" aria-label={solo ? "Пролёт по шагам" : "Пролёт от метки до метки"}>
          <button type="button" onClick={() => setCursor(START)} aria-disabled={cursor.row === 0}>
            В начало
          </button>
          <button type="button" onClick={() => setCursor((at) => back(at))} aria-disabled={cursor.row === 0}>
            ← Назад
          </button>
          <button type="button" onClick={() => setCursor((at) => forward(paced, at, still))} aria-disabled={atEnd}>
            Вперёд →
          </button>
          {/* Идущий путь можно остановить всегда — и когда движение отключили уже на лету. */}
          {cursor.run === "all" ? (
            <button type="button" onClick={() => setCursor(pause)}>
              Пауза
            </button>
          ) : (
            !still && (
              <button type="button" onClick={() => setCursor((at) => play(paced, at))}>
                {atEnd ? "Сначала" : "Весь путь"}
              </button>
            )
          )}
        </div>
        <div className="p-now" aria-live="polite">
          <p className="p-step">
            <b>{`Шаг ${cursor.row + 1} из ${paced.rows.length}.`}</b> {now}
          </p>
          {gaps.map((gap) => (
            <p key={gap} className="p-gap">
              {gap}
            </p>
          ))}
        </div>
        <p className="note">{solo ? PACE_TEXT : TEAM_PACE_TEXT}</p>
      </div>
    </>
  );
}

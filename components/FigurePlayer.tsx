"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { Step } from "@/lib/geometry";
import { back, type Cursor, forward, frameAt, GAP_TEXT, PACE_TEXT, pause, play, sceneOf, START, tick } from "@/lib/playback";

// Проигрывание пути одного кайта поверх готовой схемы. Что показать и как
// шагать, решает `lib/playback.ts`; здесь кнопки и слой со значком. Оформление —
// классы `p-*` в `app/globals.css`.
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
  path: Step[];
  // Четырёхстропный кайт: свой силуэт и свой курс в остановке.
  rev: boolean;
  // Строки шагов словами — те же, что в списке под схемой, по порядку.
  rows: string[];
  viewBox: string;
  children: React.ReactNode;
};

export function FigurePlayer({ path, rev, rows, viewBox, children }: Props) {
  const scene = useMemo(() => sceneOf(path, rev), [path, rev]);
  const live = useSyncExternalStore(never, () => true, () => false);
  // Посетитель просил без движения: шаг ставит кайт сразу в конец строки.
  const still = useSyncExternalStore(watchStill, () => window.matchMedia(STILL).matches, () => false);
  const [cursor, setCursor] = useState<Cursor>(START);
  const running = cursor.run !== "rest";

  useEffect(() => {
    if (!running) {
      return;
    }
    let seen: number | null = null;
    let frame = requestAnimationFrame(function next(now: number) {
      const passed = seen === null ? 0 : Math.min(now - seen, LONGEST_FRAME) / 1000;
      seen = now;
      setCursor((at) => tick(scene, at, passed));
      frame = requestAnimationFrame(next);
    });
    return () => cancelAnimationFrame(frame);
  }, [running, scene]);

  const { row, glyph, unsure } = frameAt(scene, cursor);
  const atEnd = cursor.row === scene.rows.length - 1 && cursor.t >= 1;

  return (
    <>
      <div className="p-stage">
        {children}
        {live && (
          <svg className="p-svg" viewBox={viewBox} aria-hidden="true">
            {row.track && <path className={row.unmarked ? "p-track p-unknown" : "p-track"} d={row.track} />}
            {glyph && <path className={glyph.kind === "spot" || unsure ? `p-${glyph.kind} p-unsure` : `p-${glyph.kind}`} d={glyph.d} />}
          </svg>
        )}
      </div>
      <div className="player" hidden={!live}>
        <div className="p-buttons" role="group" aria-label="Пролёт по шагам">
          <button type="button" onClick={() => setCursor(START)} disabled={cursor.row === 0}>
            В начало
          </button>
          <button type="button" onClick={() => setCursor(back)} disabled={cursor.row === 0}>
            ← Назад
          </button>
          <button type="button" onClick={() => setCursor((at) => forward(scene, at, still))} disabled={atEnd}>
            Вперёд →
          </button>
          {!still &&
            (cursor.run === "all" ? (
              <button type="button" onClick={() => setCursor(pause)}>
                Пауза
              </button>
            ) : (
              <button type="button" onClick={() => setCursor((at) => play(scene, at))}>
                {atEnd ? "Сначала" : "Весь путь"}
              </button>
            ))}
        </div>
        <div className="p-now" aria-live="polite">
          <p className="p-step">
            <b>{`Шаг ${cursor.row + 1} из ${scene.rows.length}.`}</b> {rows[cursor.row]}
          </p>
          {row.gaps.map((gap) => (
            <p key={gap} className="p-gap">
              {GAP_TEXT[gap]}
            </p>
          ))}
        </div>
        <p className="note">{PACE_TEXT}</p>
      </div>
    </>
  );
}

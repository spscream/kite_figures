// Метки одновременности (`sync`): шаги разных кайтов с одной меткой
// заканчиваются в один момент. Здесь метки сверяются между кайтами одной схемы
// и выстраиваются в общий порядок; времени в модуле нет.
//
// Три условия, без которых метка момента не называет:
// - метка стоит хотя бы у двух кайтов — у одного кайта сводить нечего;
// - у одного кайта метка стоит один раз. Повтор допустим только на соседнем
//   шаге и без перемещения: пролёт и событие в точке, куда он привёл (посадка,
//   остановка), несут одну метку — момент тогда наступает с концом последнего
//   такого шага;
// - порядок общих меток у кайтов один: момент, который у одного кайта раньше
//   другого, у соседа не может быть позже.
//
// Модуль исполняется и в браузере: по этому же порядку проигрывание сводит
// кайты (`lib/playback.ts`).

import type { OwnStep, Step } from "./geometry";

// Момент на пути одного кайта: метка и номер шага пути, с концом которого он
// наступает.
export type Meet = { label: string; step: number };

export type Sync = {
  // Моменты каждого кайта по порядку пути; кайты — в том порядке, в каком даны.
  meets: Meet[][];
  // Все метки в общем порядке: ни у одного кайта он не нарушен.
  order: string[];
};

type Flier = { id: string; path: readonly (Step | OwnStep)[] };

// Шаг с меткой перемещает кайт: пролёт. Поворот метки не несёт.
const moves = (step: Step | OwnStep) => step.kind === "line" || step.kind === "arc";

function meetsOf({ id, path }: Flier): Meet[] {
  const found: Meet[] = [];
  path.forEach((step, index) => {
    const label = "sync" in step ? step.sync : undefined;
    if (label === undefined) {
      return;
    }
    const last = found[found.length - 1];
    const earlier = found.find((meet) => meet.label === label);
    if (last !== undefined && last.label === label && last.step === index - 1 && !moves(step)) {
      last.step = index;
    } else if (earlier !== undefined) {
      throw new Error(
        `метка «${label}» у кайта «${id}» стоит на шагах ${earlier.step} и ${index}: повторить метку можно только на соседнем шаге, ` +
          "который кайт не перемещает, — один момент дважды не наступает",
      );
    } else {
      found.push({ label, step: index });
    }
  });
  return found;
}

// Метки одной схемы: моменты каждого кайта и их общий порядок. Непарная метка,
// метка, стоящая у кайта дважды, и порядок, который у кайтов не сходится, —
// ошибка с названием метки и кайта.
export function syncOf(kites: readonly Flier[]): Sync {
  const meets = kites.map(meetsOf);
  const order: string[] = [];
  const holders = new Map<string, string[]>();
  meets.forEach((list, kite) => {
    for (const { label } of list) {
      holders.set(label, [...(holders.get(label) ?? []), kites[kite].id]);
    }
  });
  for (const [label, ids] of holders) {
    if (ids.length < 2) {
      throw new Error(`метка «${label}» стоит только у кайта «${ids[0]}»: одновременность — это шаги разных кайтов, метке нужна пара`);
    }
  }
  // Общий порядок: метка встаёт в него, когда встали все, что хоть у одного
  // кайта стоят раньше неё.
  const before = new Map<string, Set<string>>([...holders.keys()].map((label) => [label, new Set<string>()]));
  for (const list of meets) {
    list.forEach(({ label }, index) => {
      if (index > 0) {
        before.get(label)!.add(list[index - 1].label);
      }
    });
  }
  const left = [...holders.keys()];
  while (left.length > 0) {
    const next = left.findIndex((label) => [...before.get(label)!].every((earlier) => order.includes(earlier)));
    if (next < 0) {
      // В круге — только метки, от которых ещё кто-то зависит.
      for (let loose = 0; loose >= 0; ) {
        loose = left.findIndex((label) => !left.some((later) => before.get(later)!.has(label)));
        if (loose >= 0) {
          left.splice(loose, 1);
        }
      }
      throw new Error(clash(kites, meets, left));
    }
    order.push(...left.splice(next, 1));
  }
  return { meets, order };
}

// Какие две метки у каких двух кайтов стоят в разном порядке.
function clash(kites: readonly Flier[], meets: Meet[][], left: string[]): string {
  const places = meets.map((list) => new Map(list.map(({ label }, index) => [label, index])));
  for (let a = 0; a < places.length; a += 1) {
    for (let b = a + 1; b < places.length; b += 1) {
      for (const [x, ax] of places[a]) {
        for (const [y, ay] of places[a]) {
          const bx = places[b].get(x);
          const by = places[b].get(y);
          if (ax < ay && bx !== undefined && by !== undefined && bx > by) {
            return `метки «${x}» и «${y}» у кайта «${kites[a].id}» идут в этом порядке, а у кайта «${kites[b].id}» — в обратном`;
          }
        }
      }
    }
  }
  return `порядок меток ${left.map((label) => `«${label}»`).join(", ")} у кайтов не сходится: по кругу момент оказывается раньше самого себя`;
}

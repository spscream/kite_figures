// Проигрывание пути на странице фигуры: что показать в каждый момент и как
// шагать по пути вперёд и назад — одному кайту и, во второй половине модуля,
// нескольким сразу. Своей геометрии здесь нет —
// положение и нос считает `lib/pose.ts`, значок и линию — `lib/diagram.ts`.
// Модуль ничего не знает про React и исполняется в браузере.
//
// Путь поделён на строки — те же, что в списке шагов под схемой: строка — одно
// перемещение и события в точке, куда оно привело. Строка и есть шаг
// проигрывания: «вперёд» пролетает её и встаёт, «назад» возвращает к началу.
//
// Темп условный. Скорости книга не задаёт, длительности остановки и поворота
// нет ни в данных, ни в книге; три числа ниже — условность показа, а не
// сведения о фигуре, и на экран они не выводятся. В данные фигур время не
// попадает: кому длительность известна (рутина), тот передаёт свой счёт.
//
// Чего книга не показала, проигрывание не достраивает: на шаге `unmarked`
// кайта нет вовсе, остаётся линия; поворот вокруг неназванной точки и место,
// объявленное незаданным, показаны с пометкой; аксель записан точкой, и его
// движения нет; между строками нос меняет курс скачком, как его выдаёт поза.

import { shape, trackOf } from "./diagram";
import { GRID, isSwing, type Step } from "./geometry";
import { type Doubt, type Leg, legsOf, type Pose, poseAt, poseOn, sharesOf, swingArc } from "./pose";
import { syncOf } from "./sync";

// Скорость носа, единиц сетки в секунду: одна на весь путь.
export const SPEED = 30;
// Поворот на месте, градусов в секунду.
export const TURN_RATE = 180;
// Сколько кайт стоит в остановке, после посадки и на акселе, секунд.
export const HOLD = 0.6;

const HELD = ["stall", "landing", "axel", "half-axel"];

// Сколько секунд показа занимает шаг пути.
export function paceOf(leg: Leg): number {
  const { step } = leg;
  if (leg.length > 0) {
    return leg.length / SPEED;
  }
  if (step.kind === "rotate") {
    return step.degrees / TURN_RATE;
  }
  return step.kind === "mark" && HELD.includes(step.mark) ? HOLD : 0;
}

// Чего на строке книга не показала: сомнения позы и аксель, у которого в
// данных нет самого движения.
export type Gap = Doubt | "axel";

export const GAPS: readonly Gap[] = ["order", "pivot", "span", "axel"];

export const GAP_TEXT: Record<Gap, string> = {
  order: "Порядок прохода этого шага книга не показывает: пока шаг идёт, кайта на схеме нет, выделена только линия.",
  pivot: "Вокруг чего кайт поворачивается, книга не называет: на повороте и после него значок обведён пунктиром, повёрнут он вокруг носа условно.",
  span: "Это место книга объявляет незаданным: значок там стоит по размаху нашего значка кайта и обведён пунктиром.",
  axel: "Аксель записан точкой: самого движения в данных нет, и здесь оно не показано — на акселе и после него значок стоит на месте и обведён пунктиром.",
};

// Подпись под кнопками: темп условный, и это сказано на странице.
export const PACE_TEXT =
  "Темп условный: скорости книга не задаёт. Кайт идёт с постоянной скоростью; сколько длятся остановка, посадка и поворот на месте, " +
  "книга не говорит, и здесь они показаны условно. Времени на экране нет: судить по этому показу о ритме нельзя, он показывает порядок шагов. " +
  "На стыке шагов нос меняет курс скачком: как кайт доворачивает, книга не показывает.";

// Строка шагов: перемещение и события в точке, куда оно привело. Первая строка
// пути — точка старта с её событиями — перемещения не имеет.
export type Row = {
  legs: Leg[];
  // Доли строки, которые занимает каждый её шаг; у первой строки пусто.
  shares: [number, number][];
  seconds: number;
  gaps: Gap[];
  // Линия перемещения строки для SVG; у первой строки пусто.
  track: string;
  // Порядок прохода перемещения книгой не показан.
  unmarked: boolean;
};

export type Scene = {
  rev: boolean;
  rows: Row[];
  // Поза до первого шага — доля пути ноль.
  opening: Pose;
};

// Шаг открывает строку: пролёт или поворот со смещением.
const moves = (step: Step) => step.kind === "line" || step.kind === "arc" || isSwing(step);

function trackOfLeg({ step, from }: Leg): string {
  if (step.kind === "line" || step.kind === "arc") {
    return trackOf(from, step);
  }
  return isSwing(step) ? trackOf(from, swingArc(from, step)) : "";
}

function gapsOf(legs: Leg[]): Gap[] {
  const found = new Set<Gap>();
  for (const leg of legs) {
    for (const t of [0, 0.5, 1]) {
      poseOn(leg, t).doubts.forEach((doubt) => found.add(doubt));
    }
    if (leg.step.kind === "mark" && (leg.step.mark === "axel" || leg.step.mark === "half-axel")) {
      found.add("axel");
    }
  }
  return GAPS.filter((gap) => found.has(gap));
}

// Путь кайта, разложенный для проигрывания. `rev` — кайт четырёхстропный;
// `pace` — сколько секунд занимает шаг.
export function sceneOf(path: Step[], rev: boolean, pace: (leg: Leg) => number = paceOf): Scene {
  const groups: Leg[][] = [[]];
  for (const leg of legsOf(path, rev)) {
    if (moves(leg.step)) {
      groups.push([]);
    }
    groups[groups.length - 1].push(leg);
  }
  const opening = poseAt(path, 0, rev);
  const rows = groups.map((legs, index): Row => {
    // Первая строка не проигрывается: кайт в ней стоит так, как его ставит
    // доля пути ноль, и сомнения у неё — этой позы.
    if (index === 0) {
      return { legs, shares: [], seconds: 0, gaps: GAPS.filter((gap) => gap !== "axel" && opening.doubts.includes(gap)), track: "", unmarked: false };
    }
    const weights = legs.map(pace);
    const seconds = weights.reduce((sum, weight) => sum + weight, 0);
    const first = legs[0];
    return {
      legs,
      // Строка, которой свой счёт времени не дал ни секунды, проходится сразу.
      shares: seconds > 0 ? sharesOf(legs, (leg) => weights[legs.indexOf(leg)]) : [],
      seconds,
      gaps: gapsOf(legs),
      track: trackOfLeg(first),
      unmarked: "unmarked" in first.step && first.step.unmarked === true,
    };
  });
  return { rev, rows, opening };
}

// Где проигрывание: строка и пройденная её доля. `rest` — стоит, `step` —
// долетает строку, `all` — идёт до конца пути.
export type Cursor = { row: number; t: number; run: "rest" | "step" | "all" };

export const START: Cursor = { row: 0, t: 1, run: "rest" };

// То, по чему шагает курсор: строки одного кайта либо шаги показа команды.
type Paced = { rows: readonly { seconds: number }[] };

const last = (scene: Paced) => scene.rows.length - 1;

// Следующая строка. Пока строка летится — встать в её конец; строку, прерванную
// паузой, долететь. `instant` — без движения: сразу в конец строки.
export function forward(scene: Paced, at: Cursor, instant = false): Cursor {
  if (at.run !== "rest") {
    return { row: at.row, t: 1, run: "rest" };
  }
  if (at.t < 1) {
    return instant ? { row: at.row, t: 1, run: "rest" } : { ...at, run: "step" };
  }
  if (at.row >= last(scene)) {
    return at;
  }
  return instant ? { row: at.row + 1, t: 1, run: "rest" } : { row: at.row + 1, t: 0, run: "step" };
}

// К началу строки, то есть к концу предыдущей. Назад кайт не летит: обратного
// прохода в данных нет.
export function back(at: Cursor): Cursor {
  return { row: Math.max(0, at.row - 1), t: 1, run: "rest" };
}

// Весь путь подряд; с конца пути — заново с начала.
export function play(scene: Paced, at: Cursor): Cursor {
  const from = at.row >= last(scene) && at.t >= 1 ? START : at;
  if (from.t < 1) {
    return { ...from, run: "all" };
  }
  return from.row >= last(scene) ? from : { row: from.row + 1, t: 0, run: "all" };
}

export function pause(at: Cursor): Cursor {
  return { ...at, run: "rest" };
}

// Прошло `seconds` секунд показа.
export function tick(scene: Paced, at: Cursor, seconds: number): Cursor {
  if (at.run === "rest" || !(seconds > 0)) {
    return at;
  }
  let { row, t } = at;
  let left = seconds;
  for (;;) {
    const whole = scene.rows[row].seconds;
    const rest = (1 - t) * whole;
    if (left < rest) {
      return { row, t: t + left / whole, run: at.run };
    }
    if (at.run === "step" || row >= last(scene)) {
      return { row, t: 1, run: "rest" };
    }
    left -= rest;
    row += 1;
    t = 0;
  }
}

export type Frame = {
  row: Row;
  pose: Pose;
  // Значок на схеме: кайт носом по курсу, а где курс из пути не следует —
  // кольцо в точке. Там, где порядок прохода книгой не показан, значка нет.
  glyph: { kind: "kite" | "spot"; d: string } | null;
  // Значок стоит условно: точка поворота не названа, место не задано либо
  // идёт аксель, движения которого в данных нет. В конце строки — если в ней
  // было хоть одно из трёх: после акселя неизвестен и курс.
  unsure: boolean;
};

// Значок проигрывания крупнее значков схемы: он лежит поверх них.
const SCALE = 1.25;
// Кольцо там, где курс из пути не следует: крупнее значка выведенной координаты.
const SPOT_R = 3;
const spot = (x: number, y: number) => `M${x - SPOT_R} ${y}a${SPOT_R} ${SPOT_R} 0 1 0 ${2 * SPOT_R} 0a${SPOT_R} ${SPOT_R} 0 1 0 ${-2 * SPOT_R} 0`;

function glyphOf({ point, nose }: Pose, rev: boolean): Frame["glyph"] {
  if (point === null) {
    return null;
  }
  return nose === null
    ? { kind: "spot", d: spot(point[0], GRID.yMax - point[1]) }
    : { kind: "kite", d: shape("pass", point[0], GRID.yMax - point[1], nose, SCALE, rev, true) };
}

const isAxel = (leg: Leg) => leg.step.kind === "mark" && (leg.step.mark === "axel" || leg.step.mark === "half-axel");

// Что показать в этом месте проигрывания.
export function frameAt(scene: Scene, at: Cursor): Frame {
  const row = scene.rows[at.row];
  let pose = scene.opening;
  let leg: Leg | undefined;
  if (at.row > 0) {
    const index = row.shares.findIndex(([, to]) => to > at.t);
    if (index < 0) {
      pose = poseOn(row.legs[row.legs.length - 1], 1);
    } else {
      const [from, to] = row.shares[index];
      leg = row.legs[index];
      pose = poseOn(leg, Math.max(0, at.t - from) / (to - from));
    }
  }
  const axel = leg !== undefined && isAxel(leg);
  const glyph = glyphOf(pose, scene.rev);
  const rested = at.row > 0 && leg === undefined && row.gaps.some((gap) => gap !== "order");
  return { row, pose, glyph, unsure: rested || axel || pose.doubts.includes("pivot") || pose.doubts.includes("span") };
}

// Несколько кайтов одной схемы. Сводит их поле `sync`: шаги разных кайтов с
// одной меткой заканчиваются в один момент. Между двумя своими метками кайт
// идёт с одной скоростью — такой, чтобы прийти к метке вместе с остальными:
// условный темп его шагов растянут на этот промежуток целиком, и остановка с
// поворотом растянуты вместе с пролётом. Тот, кому между метками лететь
// дольше всех, идёт с условной скоростью одного кайта.
//
// Чего метки не говорят, показ не достраивает:
// - до первой метки и после последней кайт ничем не связан с остальными. Там
//   он идёт с условной скоростью сам по себе — к первой метке так, чтобы прийти
//   вовремя, — и шаг показа несёт об этом строку (`loose`);
// - где кайты относительно друг друга между метками, из данных не следует.
//   Значки на встречных курсах проходят один сквозь другой: разводить их
//   значило бы выдумать манёвр;
// - вариант без единой метки не проигрывается вовсе (`teamOf` отдаёт `null`):
//   общего момента у его кайтов нет ни одного, и любой показ был бы
//   допущением — «шаг к шагу» или «с равной скоростью от старта».
//
// Шаг показа команды — от одной общей метки до следующей, а не строка списка:
// строки у кайтов свои, общее у них только метки.

export type TeamGap = Gap | "loose";

export const TEAM_GAPS: readonly TeamGap[] = ["loose", ...GAPS];

export const TEAM_GAP_TEXT: Record<TeamGap, string> = {
  ...GAP_TEXT,
  loose:
    "Здесь есть пролёты до первой общей метки или после последней: там кайты ничем не связаны. Каждый идёт с условной скоростью сам по себе — " +
    "к первой метке так, чтобы прийти вовремя: кому до неё ближе, тот стоит в точке старта и вылетает позже. Это условность показа: " +
    "где кайты в это время относительно друг друга, из данных не следует.",
};

export const TEAM_PACE_TEXT =
  "Темп условный: скорости книга не задаёт. Шаг показа — от одной общей метки одновременности до следующей; метки стоят в квадратных скобках " +
  "в шагах ниже. К метке кайты приходят в один момент, а между двумя метками каждый идёт со своей постоянной скоростью — такой, чтобы успеть. " +
  "Где кайты относительно друг друга между метками, данные не говорят: разойдутся ли они на встречных курсах, из них не следует, и показ кайты " +
  "не разводит — значки могут пройти один сквозь другой. Остановка, посадка и поворот на месте показаны условно, на стыке шагов нос меняет курс " +
  "скачком. Времени на экране нет: судить по этому показу о ритме нельзя.";

// Вместо кнопок у варианта без меток.
export const NO_SYNC_TEXT =
  "Этот вариант не проигрывается: общих меток одновременности в его данных нет, и свести кайты во времени не по чему. " +
  "Что кайты идут шаг в шаг или с равной скоростью, книга не подтверждает, и показ этого не допускает.";

export type Member = {
  id: string;
  // Номер цвета кайта на схеме.
  color: number;
  scene: Scene;
  // Шаги пути подряд и строка списка, в которую входит каждый.
  legs: Leg[];
  rowOf: number[];
  // Когда идёт каждый шаг, в секундах показа от общего начала.
  spans: [number, number][];
  // Шаг лежит до первой метки кайта или после последней.
  free: boolean[];
};

// Шаг показа команды: от прошлой общей метки до этой.
export type Stop = {
  from: number;
  seconds: number;
  // Метки, которые наступают в конце шага; у последнего шага их может не быть.
  labels: string[];
  gaps: TeamGap[];
};

export type Team = { rev: boolean; kites: Member[]; rows: Stop[] };

// Два времени — один момент: суммы долей секунды сходятся не до последнего знака.
const SAME = 1e-6;

// Команда, разложенная для проигрывания, либо `null` — меток у варианта нет.
// Непарная метка и порядок меток, который у кайтов не сходится, — ошибка: такой
// файл не проходит и разбор.
export function teamOf(kites: { id: string; path: Step[]; color: number }[], rev: boolean, pace: (leg: Leg) => number = paceOf): Team | null {
  const { meets, order } = syncOf(kites);
  if (order.length === 0) {
    return null;
  }
  const scenes = kites.map(({ path }) => sceneOf(path, rev, pace));
  const legs = scenes.map((scene) => scene.rows.flatMap((row) => row.legs));
  const paces = legs.map((list) => list.map(pace));
  // Моменты кайта как места в его списке шагов: метка наступает с концом шага.
  const cuts = meets.map((list, kite) => list.map(({ label, step }) => ({ label, leg: legs[kite].findIndex((leg) => leg.index === step) })));
  const sum = (kite: number, from: number, to: number) => paces[kite].slice(from, to + 1).reduce((total, part) => total + part, 0);
  // Время метки: к ней успевает и тот, кому от прошлой метки дольше всех.
  const when = new Map<string, number>();
  for (const label of order) {
    let latest = 0;
    cuts.forEach((list, kite) => {
      const at = list.findIndex((cut) => cut.label === label);
      if (at >= 0) {
        const since = at > 0 ? list[at - 1] : null;
        latest = Math.max(latest, (since ? when.get(since.label)! : 0) + sum(kite, since ? since.leg + 1 : 0, list[at].leg));
      }
    });
    when.set(label, latest);
  }
  const members = kites.map(({ id, color }, kite): Member => {
    const list = cuts[kite];
    const own = paces[kite];
    const spans: [number, number][] = [];
    const free = own.map((_, index) => list.length === 0 || index <= list[0].leg || index > list[list.length - 1].leg);
    // Отрезок пути от шага `from` до шага `to`, растянутый на время от `since`
    // до `until`; отрезок без единой секунды своего темпа стоит до конца.
    const lay = (from: number, to: number, since: number, until: number) => {
      const whole = sum(kite, from, to);
      let passed = since;
      for (let index = from; index <= to; index += 1) {
        const next = whole > 0 ? passed + (own[index] * (until - since)) / whole : until;
        spans.push(whole > 0 ? [passed, next] : [until, until]);
        passed = next;
      }
    };
    if (list.length === 0) {
      lay(0, own.length - 1, 0, sum(kite, 0, own.length - 1));
    } else {
      const first = when.get(list[0].label)!;
      const head = sum(kite, 0, list[0].leg);
      lay(0, list[0].leg, first - head, first);
      for (let at = 1; at < list.length; at += 1) {
        lay(list[at - 1].leg + 1, list[at].leg, when.get(list[at - 1].label)!, when.get(list[at].label)!);
      }
      const end = when.get(list[list.length - 1].label)!;
      const tail = list[list.length - 1].leg + 1;
      lay(tail, own.length - 1, end, end + sum(kite, tail, own.length - 1));
    }
    const rowOf = scenes[kite].rows.flatMap((row, index) => row.legs.map(() => index));
    return { id, color, scene: scenes[kite], legs: legs[kite], rowOf, spans, free };
  });
  const end = Math.max(...members.map(({ spans }) => (spans.length > 0 ? spans[spans.length - 1][1] : 0)));
  const bounds = [...when.values(), end].sort((a, b) => a - b).filter((time, index, all) => time > SAME && (index === 0 || time - all[index - 1] > SAME));
  const rows = [0, ...bounds].map((to, index, all): Stop => {
    const from = index === 0 ? 0 : all[index - 1];
    const found = new Set<TeamGap>();
    for (const member of members) {
      if (index === 0) {
        member.scene.rows[0].gaps.forEach((gap) => found.add(gap));
      }
      member.spans.forEach(([since, until], leg) => {
        // Шаг идёт в этом шаге показа либо, не занимая времени, приходится на него.
        const inside = until > since ? until > from + SAME && since < to - SAME : index === 0 ? until <= SAME : until > from + SAME && until <= to + SAME;
        if (inside) {
          member.scene.rows[member.rowOf[leg]].gaps.forEach((gap) => found.add(gap));
          if (member.free[leg] && until > since) {
            found.add("loose");
          }
        }
      });
    }
    return {
      from,
      seconds: to - from,
      labels: order.filter((label) => Math.abs(when.get(label)! - to) <= SAME),
      gaps: TEAM_GAPS.filter((gap) => found.has(gap)),
    };
  });
  return { rev, kites: members, rows };
}

// Шаг показа словами: до каких меток он ведёт.
export function stopText(team: Team, index: number): string {
  const { labels } = team.rows[index];
  const names = `[${labels.join(", ")}]`;
  if (index === 0) {
    return labels.length > 0 ? `Начало — общая метка ${names}.` : "Начало: до первой общей метки.";
  }
  if (labels.length === 0) {
    return "После последней общей метки — до конца путей.";
  }
  return `До общей метки ${names}: кайты приходят к ней в один момент.`;
}

export type TeamFrame = {
  row: Stop;
  kites: {
    id: string;
    color: number;
    pose: Pose;
    glyph: Frame["glyph"];
    unsure: boolean;
    // Линия шага там, где самого кайта на схеме нет: порядок прохода не показан.
    track: string;
    // Где поставить номер кайта рядом со значком, в координатах схемы.
    tag: [number, number] | null;
  }[];
};

// Номер кайта стоит сбоку от значка и позади носа: значки кайтов различаются
// и без цвета.
const TAG_BACK = 4;
const TAG_ASIDE = 7;

// Что показать в этом месте проигрывания команды.
export function teamFrameAt(team: Team, at: Cursor): TeamFrame {
  const row = team.rows[at.row];
  const time = row.from + at.t * row.seconds;
  const kites = team.kites.map(({ id, color, scene, legs, rowOf, spans }) => {
    // Шаги, которые к этому времени кончились, и шаг, который идёт.
    let done = -1;
    while (done + 1 < legs.length && spans[done + 1][1] <= time + SAME) {
      done += 1;
    }
    const going = done + 1 < legs.length && spans[done + 1][0] < time - SAME ? done + 1 : -1;
    let pose = scene.opening;
    let unsure = false;
    if (going >= 0) {
      const [since, until] = spans[going];
      pose = poseOn(legs[going], Math.min(1, (time - since) / (until - since)));
      unsure = isAxel(legs[going]);
    } else if (done >= 0) {
      pose = poseOn(legs[done], 1);
      // Строка пройдена целиком — как в покое после строки у одного кайта.
      const whole = done + 1 >= legs.length || rowOf[done + 1] !== rowOf[done];
      unsure = whole && rowOf[done] > 0 && scene.rows[rowOf[done]].gaps.some((gap) => gap !== "order");
    }
    const glyph = glyphOf(pose, team.rev);
    const { point, nose } = pose;
    const [x, y] = point === null ? [0, 0] : [point[0], GRID.yMax - point[1]];
    return {
      id,
      color,
      pose,
      glyph,
      unsure: unsure || pose.doubts.includes("pivot") || pose.doubts.includes("span"),
      track: glyph === null ? scene.rows[rowOf[going >= 0 ? going : Math.max(done, 0)]].track : "",
      tag:
        point === null
          ? null
          : nose === null
            ? ([x + TAG_ASIDE, y - TAG_ASIDE / 2] as [number, number])
            : ([x - nose[0] * TAG_BACK + nose[1] * TAG_ASIDE, y + nose[1] * TAG_BACK + nose[0] * TAG_ASIDE] as [number, number]),
    };
  });
  return { row, kites };
}

#!/usr/bin/env node
// Проверка готовой статики: в `out/` есть главная с разделами, по странице на
// каждую дисциплину и на каждый файл из `data/figures/` и индекс поиска, а на
// странице фигуры — схема по её геометрии. Тесты
// `lib/` доказывают, что каталог читается; этот скрипт — что прочитанное дошло
// до собранного сайта. Запуск после сборки:
//
//     npm run build && npm run check:export
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const out = path.join(root, "out");
const figuresDir = path.join(root, "data", "figures");
const { documents } = JSON.parse(fs.readFileSync(path.join(root, "data", "sources.json"), "utf8"));

// Разделы книги и их префиксы — из того же файла, что читает lib/figures.ts:
// список один, и своей копии у скрипта нет. Название раздела и склонение числа
// фигур ниже повторены намеренно: скрипт сверяет собранную страницу с файлом
// данных, а не с тем, что из него вычитал проверяемый код.
const PREFIXES = JSON.parse(fs.readFileSync(path.join(root, "lib", "disciplines.json"), "utf8"));
const ORDER = Object.keys(PREFIXES);

const STATUSES = [
  ["current", "Действующие"],
  ["obsolete", "Выведены из действующей редакции"],
];
const OBSOLETE_NOTE = '<p class="status">Фигура выведена из действующей редакции правил.</p>';
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

// Дата редакции словами — повторено намеренно, как и названия разделов ниже.
function longDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year} года`;
}

const problems = [];

function page(relative) {
  const file = path.join(out, relative, "index.html");
  if (!fs.existsSync(file)) {
    problems.push(`нет страницы ${path.relative(root, file)}`);
    return null;
  }
  return fs.readFileSync(file, "utf8");
}

// Текст попадает в HTML экранированным; сравнивать надо с тем же видом.
function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}

function plural(count, one, few, many) {
  const tens = count % 100;
  const units = count % 10;
  if (units === 1 && tens !== 11) {
    return one;
  }
  return units >= 2 && units <= 4 && (tens < 12 || tens > 14) ? few : many;
}

function countFigures(count) {
  return `${count} ${plural(count, "фигура", "фигуры", "фигур")}`;
}

function countObsolete(count) {
  return `${count} ${plural(count, "выведена", "выведены", "выведены")} из действующей редакции`;
}

// «dual-line-individual» → «Dual-line Individual».
function sectionTitle(discipline) {
  return discipline
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
    .replace(/^(\S+) Line\b/, "$1-line");
}

function figureTitle({ discipline, number, name }) {
  return `${PREFIXES[discipline]} ${String(number).padStart(2, "0")} — ${name}`;
}

// Содержимое страницы: от <main> до </main>. Дальше в файле идут скрипты с
// данными для клиентской навигации — это не то, что видит посетитель.
function mainOf(html) {
  const start = html.indexOf("<main");
  const end = html.indexOf("</main>", start);
  return start === -1 || end === -1 ? "" : html.slice(start, end);
}

// Ссылки куска разметки по порядку: адрес, подпись и `rel`. Подпись и адрес
// берутся из одного тега — верная подпись при чужом адресе не проходит.
function anchors(html) {
  return [...html.matchAll(/<a\b([^>]*)>(.*?)<\/a>/gs)].map(([, attributes, text]) => ({
    href: attributes.match(/\bhref=(?:"([^"]*)"|'([^']*)')/)?.slice(1).find((value) => value !== undefined) ?? "",
    rel: attributes.match(/\brel="([^"]*)"/)?.[1] ?? "",
    text,
  }));
}

function isFigureLink({ href }) {
  return /(^|\/)figures\/[^/]/.test(href);
}

function show(links) {
  return links.map((link) => `${link.href} «${link.text}»`).join(", ") || "ничего";
}

// Сверка списка ссылок с ожидаемым: те же адреса с теми же подписями в том же
// порядке.
function expectLinks(where, actual, expected) {
  const same =
    actual.length === expected.length &&
    expected.every((link, at) => actual[at].href === link.href && actual[at].text === escapeHtml(link.text));
  if (!same) {
    problems.push(`${where}: ожидалось ${show(expected)}; на странице ${show(actual)}`);
  }
}

const count = (text, pattern) => (text.match(pattern) ?? []).length;

// Подписи легенды повторены здесь намеренно: скрипт
// сверяет страницу с данными, а не с таблицей проверяемого компонента.
const LEGEND = {
  in: "вход (In): кайт носом по курсу, координата — по носу",
  out: "выход (Out)",
  stall: "кайт в точке остановки",
  turn: "поворот на месте: сторона и угол",
  axel: "аксель или его половина",
  derived: "координата выведена из подписей схемы, а не стоит на линии сетки (в шагах — ○)",
  measured: "координата снята замером по схеме, приблизительно (в шагах — □)",
  unspecified: "книга объявляет положение незаданным; на схеме оно стоит по размаху значка кайта (в шагах — ◇)",
};
// Значок кайта в пути у двухстропного показывает и направление, у
// четырёхстропного — только нос: тот летает и задом, и боком.
const PASS = {
  delta: "кайт в пути: летит туда, куда смотрит нос, если рядом нет стрелки",
  rev: "кайт в пути: куда смотрит нос",
};

// Слова книги на схеме и их перевод в легенде — тоже повторены.
const STOPS = { snap: "Snap Stall", push: "Push Stall" };
const LANDINGS = {
  "two-point": "2-point landing",
  "snap-two-point": "Snap landing",
  "stall-two-point": "Stall landing",
  "spin-two-point": "Spin landing",
  "leading-edge": "Leading-edge landing",
  belly: "Belly landing",
};
const GLOSS = {
  Stop: "остановка",
  Stall: "остановка",
  "Snap Stall": "остановка рывком",
  "Push Stall": "остановка толчком",
  Launch: "взлёт",
  Landing: "посадка",
  "2-point landing": "посадка на две точки",
  "Snap landing": "посадка рывком на две точки",
  "Stall landing": "посадка из остановки на две точки",
  "Spin landing": "посадка с вращением на две точки",
  "Leading-edge landing": "посадка на переднюю кромку",
  "Belly landing": "посадка на живот",
  Axel: "аксель",
  "½ Axel": "половина акселя",
};

// Поворот со смещением в легенде и слова шагов о точке поворота — тоже повторены.
const SWING = "поворот со смещением: кайт переходит в новую точку самим поворотом, нос идёт по дуге; стрелка — сторона, число — угол";
const ABOUT_WORDS = { center: " вокруг центра", "left-tip": " вокруг левой законцовки", "right-tip": " вокруг правой законцовки" };
const ABOUT_DERIVED = " (выведено, книгой не названо)";
const ABOUT_MISSING = " (точка поворота в книге не названа)";

// Поворот, который сам перемещает кайт: у него записано, куда пришёл нос.
function isSwing(step) {
  return step.kind === "rotate" && Array.isArray(step.to);
}

// Размах значка четырёхстропного кайта на схеме — повторён, как и подписи.
const REV_SPAN = 8.4;

// Куда смотрит нос после отрезка или дуги: курс числом, полёт назад, нос
// наружу или внутрь круга, иначе — по ходу.
function noseAfter(from, step) {
  if (typeof step.nose === "number") {
    const angle = (step.nose * Math.PI) / 180;
    return [Math.sin(angle), Math.cos(angle)];
  }
  let ahead;
  if (step.kind === "line") {
    const size = Math.hypot(step.to[0] - from[0], step.to[1] - from[1]);
    ahead = [(step.to[0] - from[0]) / size, (step.to[1] - from[1]) / size];
  } else {
    const size = Math.hypot(step.to[0] - step.center[0], step.to[1] - step.center[1]);
    const radial = [(step.to[0] - step.center[0]) / size, (step.to[1] - step.center[1]) / size];
    if (step.nose === "out" || step.nose === "in") {
      return step.nose === "out" ? radial : [-radial[0], -radial[1]];
    }
    ahead = step.direction === "ccw" ? [-radial[1], radial[0]] : [radial[1], -radial[0]];
  }
  return step.nose === "backward" ? [-ahead[0], -ahead[1]] : ahead;
}

// Величина, которую книга объявила незаданной, в данных числа не несёт: у
// поворота «to» — запись «unspecified», у отрезка на месте координаты — null.
// Место на схеме следует из остального: нос уходит вокруг названной законцовки
// на размах значка, отрезок остаётся на координате, с которой пришёл. Здесь это
// посчитано заново, своим кодом; шаги получают пометки `open` и `unset`, а
// поворот — `seen`: известен ли перед ним курс носа (от него зависит, стоит
// ли у поворота значок кайта).
function resolved(geometry) {
  if (geometry.status !== "ok") {
    return geometry;
  }
  const variants = geometry.variants.map((variant) => ({
    ...variant,
    kites: variant.kites.map((kite) => {
      let here = null;
      let nose = null;
      let seen = false;
      const path = kite.path.map((raw) => {
        const step = { ...raw };
        if (step.kind === "start") {
          here = step.at;
        } else if (isMove(step)) {
          if (step.kind === "line" && step.to.includes(null)) {
            step.unset = step.to.indexOf(null);
            step.to = step.to.map((part, axis) => (part === null ? here[axis] : part));
          }
          nose = step.unmarked === true ? null : noseAfter(here, step);
          seen = step.unmarked !== true;
          here = step.to;
        } else if (step.kind === "rotate") {
          const turn = ((step.direction === "cw" ? step.degrees : -step.degrees) * Math.PI) / 180;
          if (step.to !== undefined && !Array.isArray(step.to)) {
            const side = step.about === "left-tip" ? [-nose[1], nose[0]] : [nose[1], -nose[0]];
            const pivot = [here[0] + (side[0] * REV_SPAN) / 2, here[1] + (side[1] * REV_SPAN) / 2];
            const [dx, dy] = [here[0] - pivot[0], here[1] - pivot[1]];
            // В сетке угол растёт против часовой: поворот по часовой — отрицательный.
            step.to = [pivot[0] + dx * Math.cos(-turn) - dy * Math.sin(-turn), pivot[1] + dx * Math.sin(-turn) + dy * Math.cos(-turn)].map(
              (part) => Math.round(part * 100) / 100 + 0,
            );
            step.open = true;
          }
          step.seen = seen && nose !== null;
          step.from = here;
          if (nose !== null) {
            nose = [nose[0] * Math.cos(turn) + nose[1] * Math.sin(turn), nose[1] * Math.cos(turn) - nose[0] * Math.sin(turn)];
          }
          if (isSwing(step)) {
            here = step.to;
          }
        }
        return step;
      });
      return { ...kite, path };
    }),
  }));
  return { ...geometry, variants };
}

const isOpen = (step) => step.open === true || step.unset !== undefined;

// Вспомогательная линия книги в легенде — тоже повторена.
const GUIDE = "вспомогательная линия книги: на ней кайты стоят в один момент";

// Метки кайта в остановках, которые обязаны быть на схеме: по одной на каждый
// курс носа, записанный с метки книги, в каждой точке у каждого кайта. Где
// книга метки не рисует («not_found»), нет её и на схеме.
// Как шаги называют курс носа по сторонам окна.
const COURSE_WORDS = { 0: "вверх", 90: "вправо", 180: "вниз", 270: "влево" };

function expectedStalls(variant) {
  const seen = new Set();
  variant.kites.forEach((kite, order) => {
    let here = null;
    for (const step of kite.path) {
      if (step.kind === "start") {
        here = step.at;
      } else if (isMove(step) || isSwing(step)) {
        here = step.to;
      } else if (step.kind === "mark" && step.mark === "stall" && typeof step.nose === "number") {
        // Курс сверяется до градуса: так же схема решает, одна метка в точке или две.
        seen.add(`${order} ${here.join(" ")} ${Math.round(step.nose) % 360}`);
      }
    }
  });
  return [...seen].map((key) => {
    const [, x, y, nose] = key.split(" ").map(Number);
    return { x, y, nose };
  });
}

// Какие значки обязаны быть на схеме варианта — по его данным.
function expectedShapes(variant) {
  const steps = variant.kites.flatMap((kite) => kite.path);
  const mark = (...names) => steps.some((step) => step.kind === "mark" && names.includes(step.mark));
  return {
    in: true,
    out: true,
    stall: expectedStalls(variant).length > 0,
    // Знак поворота на месте — только у поворота, который кайт не перемещает.
    turn: steps.some((step) => step.kind === "rotate" && !isSwing(step)),
    axel: mark("axel", "half-axel"),
    derived: steps.some((step) => step.basis === "derived"),
    measured: steps.some((step) => step.basis === "measured"),
    unspecified: steps.some(isOpen),
  };
}

// Какими словами книги схема обязана подписать события варианта.
function expectedWords(variant, rev) {
  const words = new Set();
  for (const step of variant.kites.flatMap((kite) => kite.path)) {
    if (step.kind !== "mark") {
      continue;
    }
    if (step.mark === "stall") {
      words.add(STOPS[step.style] ?? (rev ? "Stop" : "Stall"));
    } else if (step.mark === "launch") {
      words.add("Launch");
    } else if (step.mark === "landing") {
      words.add(LANDINGS[step.style] ?? "Landing");
    } else if (step.mark === "axel" || step.mark === "half-axel") {
      words.add(step.mark === "axel" ? "Axel" : "½ Axel");
    }
  }
  return [...words];
}

function isMove(step) {
  return step.kind === "line" || step.kind === "arc";
}

// Схема на странице сверяется с файлом данных, а не с тем, что насчитал
// lib/diagram.ts. На каждый вариант — свой блок: схема, её легенда и шаги.
// В схеме по линии своего штриха на кайт. Направление показано, как в книге:
// у четырёхстропного — стрелкой рядом с линией на каждом шаге, у
// двухстропного — значком кайта в пути. Шаг «unmarked» знака направления не
// получает вовсе, а в списке шагов несёт пометку «направление в книге не
// показано». Значки, слова и легенда — ровно те, что следуют из данных.
// Картинок на странице нет вовсе: схемы свои и рисуются из данных.
function checkDiagrams(slug, html, raw, documentUrl, rev) {
  const geometry = resolved(raw);
  const where = `на странице figures/${slug}/`;
  const bad = (message) => problems.push(`${where} ${message}`);
  if (/<img|<canvas|<image|<picture|<object|<embed|<iframe|<video|<use\b|type="image"|url\(|image-set\(/i.test(html)) {
    bad("есть картинка: схемы рисуются из данных, в SVG");
  }
  const blocks = html.split('<section class="variant">').slice(1);
  if (geometry.status !== "ok") {
    if (blocks.length > 0 || html.includes('class="d-svg"')) {
      bad("нарисована схема, а геометрии в данных нет");
    }
    if (!html.includes("Схемы нет.") || !html.includes(escapeHtml(geometry.reason))) {
      bad("не сказано, почему схемы нет");
    }
    return;
  }
  if (blocks.length !== geometry.variants.length) {
    bad(`схем ${blocks.length}, а вариантов в данных ${geometry.variants.length}`);
    return;
  }
  geometry.variants.forEach((variant, index) => {
    const block = blocks[index];
    const say = (message) => bad(`в схеме «${variant.id}» ${message}`);
    const diagrams = block.match(/<svg class="d-svg"[\s\S]*?<\/svg>/g) ?? [];
    if (diagrams.length !== 1) {
      say(`схем ${diagrams.length} вместо одной`);
      return;
    }
    const svg = diagrams[0];
    const kites = variant.kites;
    const many = kites.length > 1;
    // Цвет кайта — по месту в списке, пока данные не назвали другой.
    const colorOf = (order) => kites[order].color ?? (order % 5) + 1;

    if (variant.team_size !== undefined && !block.includes(`<h2>Состав: ${variant.team_size}`)) {
      say(`нет заголовка «Состав: ${variant.team_size}»`);
    }
    if (variant.page !== undefined) {
      const href = escapeHtml(`${documentUrl}#page=${variant.page}`);
      if (!block.includes(`href="${href}"`) || !block.includes(`>стр. ${variant.page}</a>`)) {
        say(`нет ссылки на страницу ${variant.page} первоисточника`);
      }
    }

    // Линии: по одной на кайт, штрих — по цвету кайта.
    const tracks = [...svg.matchAll(/<path class="d-track k(\d)"/g)].map((match) => Number(match[1]));
    // Одиночный кайт летит чёрной сплошной, без штриха команды.
    const strokes = kites.map((_, kite) => (many ? colorOf(kite) : 0));
    if (tracks.join() !== strokes.join()) {
      say(`штрихи линий [${tracks.join()}], а по кайтам нужны [${strokes.join()}]`);
    }

    // Поворот со смещением: линия кайта на нём рвётся — пролёта между точками
    // нет, — а на схеме стоит дуга носа, и кончается она в точке из данных.
    const point = ([x, y]) => `${Math.round(x * 100) / 100} ${Math.round((100 - y) * 100) / 100}`;
    const trackPaths = [...svg.matchAll(/<path class="d-track k\d" d="([^"]*)"/g)].map((match) => match[1]);
    const swung = kites.flatMap((kite) => kite.path.filter(isSwing));
    kites.forEach((kite, order) => {
      const own = kite.path.filter(isSwing);
      const parts = count(trackPaths[order] ?? "", /M/g);
      if (parts !== own.length + 1) {
        say(`линия кайта ${kite.id} из ${parts} кусков, а поворотов со смещением ${own.length}: на каждом линия рвётся, и только на них`);
      }
      let here = null;
      for (const step of kite.path) {
        if (isSwing(step) && (trackPaths[order] ?? "").includes(`${point(here)}L${point(step.to)}`)) {
          say(`у кайта ${kite.id} поворот в (${step.to.join("; ")}) нарисован прямой линией пролёта`);
        }
        here = step.kind === "start" ? step.at : isMove(step) || isSwing(step) ? step.to : here;
      }
    });
    const swingPaths = [...svg.matchAll(/<path class="d-swing" d="([^"]*)"/g)].map((match) => match[1]);
    // Кусок с дугой кончается в точке, куда поворот привёл нос; за ним — стрелка.
    const swingEnds = swingPaths.flatMap((d) =>
      d.split("M").filter((part) => part.includes("A")).map((part) => part.match(/(-?[\d.]+ -?[\d.]+)$/)?.[1] ?? "?"),
    );
    if (swingPaths.length !== (swung.length > 0 ? 1 : 0) || swingEnds.join("|") !== swung.map((step) => point(step.to)).join("|")) {
      say(`повороты со смещением приводят в [${swingEnds.join("|")}], а по данным — в [${swung.map((step) => point(step.to)).join("|")}]`);
    }
    const swingTold = block.includes(`</path></svg>${SWING}</li>`);
    if (swingTold !== swung.length > 0 || count(block, /class="d-swing"/g) !== (swung.length > 0 ? 2 : 0)) {
      say("легенда расходится со схемой в поворотах со смещением");
    }

    const moves = kites.flatMap((kite) => kite.path.filter(isMove));
    const directed = moves.filter((step) => step.unmarked !== true).length;
    // Стрелка — замкнутый треугольник из трёх разных точек; считаются все
    // пути стрелок схемы. Стрелки есть только у четырёхстропных: по одной на
    // шаг с известным направлением и ни одной на шаге «unmarked».
    const corner = "(-?[\\d.]+ -?[\\d.]+)";
    const triangle = new RegExp(`M${corner}L${corner}L${corner}Z`, "g");
    const arrowPaths = [...svg.matchAll(/<path class="d-arrow a-(in|out|mid)" d="([^"]*)"/g)];
    const arrows = arrowPaths.reduce(
      (sum, match) =>
        sum + [...match[2].matchAll(triangle)].filter(([, a, b, c]) => a !== b && b !== c && a !== c).length,
      0,
    );
    // У двухстропного стрелку получает только шаг, который он летит не носом
    // вперёд: там значок кайта направления не показывает.
    const wanted = moves.filter((step) => step.unmarked !== true && (rev || (step.nose ?? "forward") !== "forward")).length;
    if (arrows !== wanted) {
      say(`стрелок ${arrows}, а нужно ${wanted}: шагов с известным направлением ${directed}`);
    }
    if (count(svg, /<path class="d-arrow/g) !== arrowPaths.length) {
      say("есть стрелка с незнакомым классом");
    }
    // Цвет стрелки — только у одного кайта: от входа и к выходу.
    if (many && arrowPaths.some((match) => match[1] !== "mid")) {
      say("у команды стрелки цветные");
    }
    // Значок кайта в пути ставится не на каждый шаг (соседний значок с тем же
    // носом его заменяет), но никогда не чаще, чем есть шагов с направлением.
    // Значки кайта: путь на вид и цвет, в пути — по замкнутому контуру на
    // значок. У команды каждый путь несёт цвет кайта, у одного кайта — нет.
    const glyphs = (name) =>
      [...svg.matchAll(new RegExp(`<path class="d-${name}( g-k\\d)?" d="([^"]*)"`, "g"))].map((match) => ({
        tone: match[1]?.trim() ?? "",
        parts: match[2].split("Z").filter(Boolean),
      }));
    const total = (name) => glyphs(name).reduce((sum, item) => sum + item.parts.length, 0);
    const passes = total("pass");
    const stalls = expectedStalls(variant);
    for (const [name, needed] of [["in", kites.length], ["out", kites.length], ["stall", stalls.length]]) {
      if (total(name) !== needed) {
        say(`значков «${name}» ${total(name)}, а по данным нужно ${needed}`);
      }
    }
    // Метка остановки стоит носом в точке и смотрит по курсу, записанному с
    // метки книги: у дельты нос — первая вершина, у четырёхстропного —
    // середина передней кромки, первых двух вершин; вырез хвоста — напротив.
    const stood = glyphs("stall").flatMap(({ parts }) =>
      parts.map((part) => {
        const points = [...part.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((match) => [Number(match[1]), Number(match[2])]);
        const front = rev ? [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2] : points[0];
        const notch = rev ? points[3] : points[2];
        const nose = (Math.atan2(front[0] - notch[0], notch[1] - front[1]) * 180) / Math.PI;
        return { x: front[0], y: 100 - front[1], nose: (Math.round(nose) + 360) % 360 };
      }),
    );
    const key = (item) => `(${Math.round(item.x * 10) / 10}; ${Math.round(item.y * 10) / 10}) нос ${item.nose}°`;
    // Кайт у самой земли поднят на неё целиком: его точка на схеме выше записанной.
    const lifted = (item) => stalls.some((want) => want.nose === item.nose && Math.abs(want.x - item.x) < 0.05 && item.y - want.y >= -0.05 && item.y - want.y < 7 && want.y < 7);
    const placed = (item) => stalls.some((want) => want.nose === item.nose && Math.abs(want.x - item.x) < 0.06 && Math.abs(want.y - item.y) < 0.06);
    const strayed = stood.filter((item) => !placed(item) && !lifted(item));
    if (strayed.length > 0) {
      say(`метки остановки стоят не по данным: ${strayed.map(key).join(", ")}; по данным — ${stalls.map(key).join(", ")}`);
    }
    for (const name of ["in", "out", "stall", "pass"]) {
      for (const { tone, parts } of glyphs(name)) {
        if ((tone !== "") !== many) {
          say(`значок «${name}» ${many ? "без цвета кайта" : "с цветом кайта у одиночной фигуры"}`);
        }
        // Силуэт по разделу: у четырёхстропного пять вершин, у дельты четыре.
        if (parts.some((part) => count(part, /L/g) + 1 !== (rev ? 5 : 4))) {
          say(`значок «${name}» не того силуэта: ${rev ? "четырёхстропный рисуется передней кромкой и парусом с вырезом" : "двухстропный рисуется дельтой"}`);
        }
      }
    }
    // Вход и выход каждого кайта — его цветом.
    if (many) {
      const tones = (name) => glyphs(name).map((item) => `${item.tone}×${item.parts.length}`).sort().join();
      const byKite = {};
      kites.forEach((_, order) => {
        const tone = `g-k${colorOf(order)}`;
        byKite[tone] = (byKite[tone] ?? 0) + 1;
      });
      const need = Object.entries(byKite).map(([tone, number]) => `${tone}×${number}`).sort().join();
      for (const name of ["in", "out"]) {
        if (tones(name) !== need) {
          say(`цвета значков «${name}» [${tones(name)}], а по кайтам нужны [${need}]`);
        }
      }
    }
    // Кайт до и после поворота со смещением стоит значком: по меткам, стоящим
    // законцовка к законцовке, виден сам переход. Значок — в пути либо вход,
    // выход, остановка в той же точке. Где курс носа перед поворотом из пути не
    // следует, значка нет.
    const fronts = ["in", "out", "stall", "pass"].flatMap((name) =>
      glyphs(name).flatMap(({ parts }) =>
        parts.map((part) => {
          const points = [...part.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((match) => [Number(match[1]), Number(match[2])]);
          return rev ? [(points[0][0] + points[1][0]) / 2, 100 - (points[0][1] + points[1][1]) / 2] : [points[0][0], 100 - points[0][1]];
        }),
      ),
    );
    const swingSpots = new Set();
    for (const step of swung.filter((item) => item.seen)) {
      for (const end of [step.from, step.to]) {
        swingSpots.add(end.join(" "));
        if (!fronts.some((front) => Math.hypot(front[0] - end[0], front[1] - end[1]) < 0.06)) {
          say(`у поворота со смещением в точке (${end.join("; ")}) нет значка кайта`);
        }
      }
    }
    // Где значки в пути сняты с книги, их ровно столько, сколько записано на
    // шагах; в остальных вариантах число на шаге не пишется вовсе.
    const written = moves.reduce((sum, step) => sum + (step.kites ?? 0), 0);
    if (variant.path_kites === "book") {
      if (passes < written || passes > written + swingSpots.size) {
        say(`значков кайта в пути ${passes}, а с книги записано ${written}`);
      }
    } else if (written > 0) {
      say("число значков на шаге записано в варианте без path_kites «book»");
    } else if (passes > directed + swingSpots.size) {
      say(`значков кайта в пути ${passes}, а шагов с известным направлением ${directed} и точек поворотов со смещением ${swingSpots.size}`);
    }
    // Величина, которую книга объявила незаданной, линии сетки не получает,
    // а заданная координата того же отрезка — получает, с числом у рамки.
    // Линии сетки читаются числами, а не подстрокой: высота вида 68,4 в
    // разметке стоит с хвостом плавающей точки.
    const gridPath = svg.match(/<path class="d-grid" d="([^"]*)"/)?.[1] ?? "";
    const drawnLines = [
      [...gridPath.matchAll(/M(-?[\d.]+) 0v100/g)].map((match) => Number(match[1])),
      [...gridPath.matchAll(/M-100 (-?[\d.]+)h200/g)].map((match) => 100 - Number(match[1])),
    ];
    const drawnTicks = [
      [...svg.matchAll(/<text class="d-tick(?: d-mid)?" x="(-?[\d.]+)"/g)].map((match) => Number(match[1])),
      [...svg.matchAll(/<text class="d-tick d-tick-y(?: d-mid)?"[^>]*>([^<]*)<\/text>/g)].map((match) => Number(match[1].replace(",", ".").replace("−", "-"))),
    ];
    // Линии сетки — ровно те, что записаны в данных как проведённые книгой;
    // оси окна (x = 0, y = 50) рисуются отдельным путём и тоже по данным.
    const MID = [0, 50];
    for (const axis of [0, 1]) {
      const wantedLines = variant.grid[axis === 0 ? "x" : "y"].filter((value) => value !== MID[axis]);
      if ([...drawnLines[axis]].sort((a, b) => a - b).join() !== wantedLines.join()) {
        say(`линии сетки по ${axis === 0 ? "x" : "y"} [${drawnLines[axis].join()}], а в данных [${wantedLines.join()}]`);
      }
      const all = variant.grid[axis === 0 ? "x" : "y"];
      const strayTicks = drawnTicks[axis].filter((value) => !all.includes(value));
      if (strayTicks.length > 0) {
        say(`число у рамки [${strayTicks.join()}] стоит там, где линии в данных нет`);
      }
      // Число пропускается только в тесноте: линия, от которой до соседних не
      // меньше 9 единиц, подписана всегда.
      const lonely = all.filter((value) => all.every((other) => other === value || Math.abs(other - value) >= 9));
      const bare = lonely.filter((value) => !drawnTicks[axis].includes(value));
      if (bare.length > 0) {
        say(`у линий ${axis === 0 ? "x" : "y"} = [${bare.join()}] нет числа у рамки`);
      }
    }
    const wantedMid = `${variant.grid.x.includes(0) ? "M0 0v100" : ""}${variant.grid.y.includes(50) ? "M-100 50h200" : ""}`;
    const drawnMid = svg.match(/<path class="d-mid" d="([^"]*)"/)?.[1] ?? "";
    if (drawnMid !== wantedMid) {
      say(`оси окна «${drawnMid}», а по данным «${wantedMid}»`);
    }
    const near = (list, value, by = 0.01) => list.some((other) => Math.abs(other - value) < by);
    const AXIS = ["x", "y"];
    const steps = kites.flatMap((kite) => kite.path);
    // Координаты, которые книга задаёт: у старта, у обычных шагов и заданная
    // половина отрезка с одной незаданной координатой.
    const given = [[], []];
    for (const step of steps) {
      const at = step.kind === "start" ? step.at : isMove(step) || isSwing(step) ? step.to : null;
      for (const axis of at === null || step.open ? [] : [0, 1]) {
        if (step.unset !== axis) {
          given[axis].push(at[axis]);
        }
      }
    }
    for (const step of steps.filter(isOpen)) {
      for (const axis of [0, 1]) {
        const value = step.to[axis];
        const free = step.open === true || step.unset === axis;
        if (free && !near(given[axis], value) && (near(drawnLines[axis], value) || (axis === 1 && near(drawnTicks[axis], value)))) {
          say(`линия сетки или число у рамки стоит на ${AXIS[axis]} = ${value} — величине, которую книга объявила незаданной`);
        }
      }
    }
    if (svg.includes("d-ask") || svg.includes("d-launch") || svg.includes("d-landing")) {
      say("есть значок, которого в обозначениях книги нет");
    }

    // Подписи входа и выхода с их цветом: «In» и «Out» по разу, а у
    // нескольких кайтов ещё номер каждого его цветом, дважды.
    const labels = [...svg.matchAll(/<text class="d-label t-([^"]*)"[^>]*>([^<]*)<\/text>/g)].map(
      (match) => `${match[1]}:${match[2]}`,
    );
    const names = [
      "in:In",
      "out:Out",
      ...kites.flatMap((kite, order) => (many ? Array(2).fill(`k${colorOf(order)}:#${kite.id}`) : [])),
    ];
    if ([...labels].sort().join() !== [...names].sort().join()) {
      say(`подписи входа и выхода [${labels.join()}], а нужны [${names.join()}]`);
    }

    // Значок есть на схеме тогда и только тогда, когда он следует из данных,
    // и тогда же он назван в легенде этой схемы — своими словами.
    const drawn = (name) => new RegExp(`<path class="d-${name}(?: g-k\\d)?" d="[^"]+"`).test(svg);
    // В легенде команды значок кайта показан цветом первого кайта.
    const told = (name, text) =>
      new RegExp(
        `<path class="d-${name}${many && ["in", "out", "stall", "pass"].includes(name) ? ` g-k${colorOf(0)}` : ""}" d="[^"]+"></path></svg>${text.replace(/[()]/g, "\\$&")}</li>`,
      ).test(block);
    for (const [name, expected] of Object.entries(expectedShapes(variant))) {
      if (drawn(name) !== expected) {
        say(`значок «${name}» ${expected ? "не нарисован" : "нарисован без данных"}`);
      }
      // Текст легенды сверяется целиком, до конца строки.
      if (told(name, LEGEND[name]) !== expected) {
        say(`легенда ${expected ? "не объясняет" : "объясняет лишний"} значок «${name}»`);
      }
    }
    if (told("pass", rev ? PASS.rev : PASS.delta) !== passes > 0 || told("pass", rev ? PASS.delta : PASS.rev)) {
      say("легенда расходится со схемой в значке кайта в пути");
    }
    // Вспомогательная линия книги: на схеме ровно та, что записана в данных, и
    // тогда же она названа в легенде; у варианта без неё нет ни того, ни другого.
    const num = (value) => String(Math.round(value * 100) / 100);
    const guide =
      variant.guides.status === "ok"
        ? variant.guides.lines.map(({ from, to }) => `M${num(from[0])} ${num(100 - from[1])}L${num(to[0])} ${num(100 - to[1])}`).join("")
        : "";
    const guidePaths = [...svg.matchAll(/<path class="d-guide" d="([^"]*)"/g)].map((match) => match[1]);
    if (guidePaths.join("|") !== guide) {
      say(`вспомогательные линии [${guidePaths.join("|")}], а по данным нужны [${guide}]`);
    }
    const guideTold = block.includes(`<path class="d-guide" d="M0 0h24"></path></svg>${GUIDE}</li>`);
    if (guideTold !== (guide !== "") || count(block, /class="d-guide"/g) !== (guide !== "" ? 2 : 0)) {
      say("легенда расходится со схемой во вспомогательной линии");
    }
    const coloured = arrowPaths.some((match) => match[1] !== "mid");
    const arrowText = `направление движения (стрелка идёт рядом с линией${coloured ? "; зелёная — от входа, красная — к выходу" : ""})</li>`;
    if (block.includes(arrowText) !== arrows > 0 || count(block, /направление движения \(/g) !== (arrows > 0 ? 1 : 0)) {
      say("легенда расходится со схемой в стрелках");
    }

    // Слова книги: каждое событие подписано на схеме и переведено в легенде,
    // лишних переводов нет. Номер остановки («Stop #2») к слову не относится.
    const noteTexts = [...svg.matchAll(/<text class="d-note"[^>]*>([^<]*)<\/text>/g)].map((match) => match[1]);
    const notes = new Set(noteTexts.map((text) => text.replace(/ #\d+$/, "")));
    const glossary = [...block.matchAll(/<li class="d-word"><b>([^<]*)<\/b> — ([^<]*)<\/li>/g)].map(
      (match) => `${match[1]} — ${match[2]}`,
    );
    const words = expectedWords(variant, rev);
    for (const word of words) {
      if (!notes.has(word)) {
        say(`на схеме нет подписи «${word}»`);
      }
    }
    if ([...glossary].sort().join("|") !== words.map((word) => `${word} — ${GLOSS[word]}`).sort().join("|")) {
      say(`легенда переводит [${glossary.join("; ")}], а слова на схеме — [${words.join("; ")}]`);
    }
    // Лишних подписей нет: каждая — слово события из данных либо угол поворота
    // из данных, и каждый угол из данных на схеме есть.
    const angles = new Set(
      kites.flatMap((kite) => kite.path.filter((step) => step.kind === "rotate").map((step) => `${String(step.degrees).replace(".", ",")}°`)),
    );
    for (const note of notes) {
      if (!words.includes(note) && !angles.has(note)) {
        say(`на схеме подпись «${note}», которой нет в данных`);
      }
    }
    for (const angle of angles) {
      if (!notes.has(angle)) {
        say(`на схеме нет угла поворота «${angle}»`);
      }
    }
    // У одного кайта остановки подписаны все и по порядку, с номером, когда
    // их несколько.
    if (!many) {
      const marks = kites[0].path.filter((step) => step.kind === "mark" && step.mark === "stall");
      const needed = marks.map(
        (step, at) => (STOPS[step.style] ?? (rev ? "Stop" : "Stall")) + (marks.length > 1 ? ` #${at + 1}` : ""),
      );
      const shown = noteTexts.filter((text) => /^(Stop|Stall|Snap Stall|Push Stall)( #\d+)?$/.test(text));
      if ([...shown].sort().join() !== [...needed].sort().join()) {
        say(`остановки подписаны [${shown.join()}], а по данным нужны [${needed.join()}]`);
      }
    }
    // В легенде нет строк сверх названных: кайты, значки, стрелка, поворот со
    // смещением, вспомогательная линия, слова.
    const legend = block.match(/<ul class="d-legend">[\s\S]*?<\/ul>/)?.[0] ?? "";
    const rows =
      (many ? kites.length : 0) +
      Object.values(expectedShapes(variant)).filter(Boolean).length +
      (passes > 0 ? 1 : 0) +
      (arrows > 0 ? 1 : 0) +
      (swung.length > 0 ? 1 : 0) +
      (guide !== "" ? 1 : 0) +
      words.length;
    if (count(legend, /<li/g) !== rows) {
      say(`в легенде строк ${count(legend, /<li/g)}, а по данным нужно ${rows}`);
    }
    // Шаг без направления назван в пояснении к схеме.
    const caveat = "На шагах с пометкой «направление в книге не показано» знака направления нет";
    if (index === 0 && block.includes(caveat) !== geometry.variants.some((item) => item.kites.some((kite) => kite.path.some((step) => step.unmarked === true)))) {
      say("пояснение расходится с данными в шагах без направления");
    }
    // Рамка окна есть всегда; оси сверены выше по данным.
    if (!svg.includes('<path class="d-frame"')) {
      say("нет рамки окна");
    }
    const legendKites = [...block.matchAll(/<path class="d-track k(\d)" d="M0 0h24"><\/path><\/svg>кайт #([^<]*)<\/li>/g)].map(
      (match) => `${match[1]}:${match[2]}`,
    );
    const wantedKites = many ? kites.map((kite, order) => `${colorOf(order)}:${kite.id}`) : [];
    if (legendKites.join() !== wantedKites.join()) {
      say(`легенда кайтов [${legendKites.join()}], а нужна [${wantedKites.join()}]`);
    }

    // Шаги: список на кайт, строка на старт и на каждое перемещение — отрезок,
    // дугу и поворот со смещением, — пометка на каждом шаге без направления.
    const lists = block.match(/<ol>[\s\S]*?<\/ol>/g) ?? [];
    if (lists.length !== kites.length) {
      say(`списков шагов ${lists.length}, а кайтов ${kites.length}`);
      return;
    }
    kites.forEach((kite, order) => {
      const own = kite.path.filter(isMove);
      const lines = count(lists[order], /<li>[^<]/g);
      const swings = kite.path.filter(isSwing).length;
      if (lines !== own.length + swings + 1) {
        say(`у кайта ${kite.id} строк шагов ${lines}, а нужно ${own.length + swings + 1}`);
      }
      // Точка каждого поворота названа в шагах так, как записана: словом, с
      // оговоркой у выведенной, либо признанием, что книга её не называет.
      const turns = [...lists[order].matchAll(/[Пп]оворот на [\d,]+° (?:по|против) часовой стрелк[еи]((?: вокруг (?:центра|левой законцовки|правой законцовки))?(?: \((?:выведено, книгой не названо|точка поворота в книге не названа)\))?)/g)].map((match) => match[1]);
      const abouts = kite.path
        .filter((step) => step.kind === "rotate")
        .map((step) =>
          typeof step.about === "string" ? ABOUT_WORDS[step.about] + (step.about_basis === "derived" ? ABOUT_DERIVED : "") : ABOUT_MISSING,
        );
      // Куда привёл поворот со смещением, сказано в его строке.
      const told = [...lists[order].matchAll(/<li>Поворот на [^<]*? до \(([−\d,]+); ([−\d,]+)\)/g)].map((match) => `${match[1]}; ${match[2]}`);
      // Положение, которое книга объявила незаданным, числом в шагах не названо.
      const reached = kite.path
        .filter((step) => isSwing(step) && !isOpen(step))
        .map((step) => step.to.map((part) => String(part).replace("-", "−").replace(".", ",")).join("; "));
      const open = kite.path.filter(isOpen);
      const openTold =
        count(lists[order], /, положение после поворота книгой не задано ◇/g) + count(lists[order], /<li>Прямая до \((?:не задано; [−\d,]+|[−\d,]+; не задано)\)[^<◇]*◇/g);
      if (openTold !== open.length || count(lists[order], /◇/g) !== open.length) {
        say(`у кайта ${kite.id} пометок «не задано» ${openTold} (ромбов ${count(lists[order], /◇/g)}), а величин, объявленных книгой незаданными, ${open.length}`);
      }
      for (const step of open) {
        const hidden = String(step.unset === 0 ? step.to[0] : step.to[1]).replace("-", "−").replace(".", ",");
        if (new RegExp(`[(;] ?${hidden}[;)]`).test(lists[order].replace(/<li>Точка[^<]*/, ""))) {
          say(`у кайта ${kite.id} в шагах названо числом ${hidden} — место на схеме, а не величина из книги`);
        }
      }
      if (told.join("|") !== reached.join("|")) {
        say(`у кайта ${kite.id} повороты со смещением в шагах приводят в [${told.join("|")}], а по данным — в [${reached.join("|")}]`);
      }
      if (turns.join("|") !== abouts.join("|")) {
        say(`у кайта ${kite.id} точки поворотов названы [${turns.join("|")}], а по данным — [${abouts.join("|")}]`);
      }
      // Курс метки книги в остановке назван в шагах — у каждой остановки, где
      // книга метку рисует.
      // Сверяется и сам курс, по порядку остановок: «вверх» у каждой
      // остановки сошлось бы по числу и при неверных словах.
      const noses = [...lists[order].matchAll(/, на схеме книги кайт носом (вверх|вправо|вниз|влево|по курсу [\d,]+°)/g)].map((match) => match[1]);
      const shown = kite.path
        .filter((step) => step.kind === "mark" && step.mark === "stall" && typeof step.nose === "number")
        .map((step) => COURSE_WORDS[step.nose] ?? `по курсу ${String(step.nose).replace(".", ",")}°`);
      if (noses.join("; ") !== shown.join("; ")) {
        say(`у кайта ${kite.id} курс носа в остановках назван «${noses.join("; ")}», а по данным — «${shown.join("; ")}»`);
      }
      const flagged = count(lists[order], / <strong class="unmarked">направление в книге не показано<\/strong>/g);
      const unmarked = own.filter((step) => step.unmarked === true).length;
      if (flagged !== unmarked) {
        say(`у кайта ${kite.id} пометок «направление в книге не показано» ${flagged}, а шагов «unmarked» ${unmarked}`);
      }
    });
  });
  for (const note of geometry.notes ?? []) {
    if (!html.includes(`<li>${escapeHtml(note)}</li>`)) {
      bad(`нет заметки о геометрии «${note.slice(0, 40)}…»`);
    }
  }
}

// Различие кайтов без цвета держится на штрихе линии, а он задан в CSS: без
// него все линии сплошные, и разметка страницы этого не покажет.
function checkStyles() {
  const files = fs
    .readdirSync(out, { recursive: true })
    .map((name) => String(name))
    .filter((name) => name.endsWith(".css"));
  const css = files.map((name) => fs.readFileSync(path.join(out, name), "utf8")).join("\n");
  // Заливка отличает вход от выхода и остановки без цвета.
  // У команды заливку значка задаёт цвет кайта (.g-kN), и пустым выход держит
  // только правило сильнее него — на схеме и в легенде.
  if (!/\.d-out\{[^}]*fill:var\(--bg\)/.test(css) || !/\.d-svg \.d-out,\.d-icon \.d-out\{fill:var\(--bg\)\}/.test(css)) {
    problems.push("в стилях значок выхода не пустой (.d-out): без цвета он сольётся со входом");
  }
  if ([...css.matchAll(/[^{}]*\.d-out[^{}]*\{([^}]*)\}/g)].some(([, body]) => /(^|;)fill:(?!var\(--bg\))/.test(body))) {
    problems.push("в стилях есть правило, которое заливает значок выхода");
  }
  const dashes = [2, 3, 4, 5].map((kite) => css.match(new RegExp(`\\.k${kite}\\{[^}]*stroke-dasharray:([^;}]*)`))?.[1]);
  dashes.forEach((dash, at) => {
    if (dash === undefined || dash === "none") {
      problems.push(`в стилях у линии кайта ${at + 2} нет своего штриха (.k${at + 2})`);
    }
  });
  if (new Set(dashes).size !== dashes.length) {
    problems.push("в стилях у двух кайтов один и тот же штрих линии");
  }
  // Вспомогательная линия книги от линии сетки отличается штрихом: без него
  // в печати она слилась бы с сеткой.
  const guideDash = css.match(/\.d-guide\{[^}]*stroke-dasharray:([^;}]*)/)?.[1];
  const gridDash = css.match(/\.d-grid,\.d-mid\{[^}]*stroke-dasharray:([^;}]*)/)?.[1];
  if (guideDash === undefined || guideDash === "none" || guideDash === gridDash) {
    problems.push("в стилях у вспомогательной линии (.d-guide) нет своего штриха");
  }
  // Дуга поворота со смещением — линия: без своего правила путь SVG залился
  // бы чёрным.
  if (!/\.d-swing\{[^}]*fill:none/.test(css) || !/\.d-swing\{[^}]*stroke:var\(--fg\)/.test(css)) {
    problems.push("в стилях дуга поворота со смещением (.d-swing) не линия: нужны fill:none и своя обводка");
  }
  // Значок незаданной величины — пустой ромб, как кружок и квадрат: без своего
  // правила он залился бы чёрным.
  if (!/\.d-derived,\.d-measured,\.d-unspecified\{[^}]*fill:var\(--bg\)/.test(css)) {
    problems.push("в стилях значок незаданной величины (.d-unspecified) не пустой");
  }
  if (css.includes("url(")) {
    problems.push("стили подключают внешний файл через url(): схемы рисуются из данных, без картинок");
  }
}

if (!fs.existsSync(out)) {
  console.error("Каталога out/ нет: сначала `npm run build`.");
  process.exit(1);
}

const slugs = fs
  .readdirSync(figuresDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
  .map((entry) => path.basename(entry.name, ".json"))
  .sort();

if (slugs.length === 0) {
  problems.push("в data/figures/ нет ни одной фигуры");
}

const records = new Map(
  slugs.map((slug) => [slug, JSON.parse(fs.readFileSync(path.join(figuresDir, `${slug}.json`), "utf8"))]),
);

// Раздел, которого нет в общем списке, остался бы без префикса и без места в
// порядке книги.
for (const [slug, record] of records) {
  if (!Object.hasOwn(PREFIXES, record.discipline)) {
    problems.push(`в data/figures/${slug}.json дисциплина «${record.discipline}», которой нет в lib/disciplines.json`);
  }
}

// Разделы — дисциплины, которые встречаются в файлах данных, в порядке книги;
// у каждой — её фигуры по номеру.
const sections = new Map();
for (const discipline of [...new Set([...records.values()].map((record) => record.discipline))].sort(
  (a, b) => ORDER.indexOf(a) - ORDER.indexOf(b),
)) {
  sections.set(
    discipline,
    [...records]
      .filter(([, record]) => record.discipline === discipline)
      .map(([slug, record]) => ({ slug, ...record }))
      .sort((a, b) => a.number - b.number),
  );
}
// Каталог в порядке сайта: по разделам книги, внутри раздела по номеру.
const catalogue = [...sections.values()].flat();

function figureLink(figure, text = figureTitle(figure)) {
  return { href: `/figures/${figure.slug}/`, text };
}

// Поле поиска стоит в шапке каждой страницы.
function expectSearch(where, html) {
  const header = html.slice(0, Math.max(html.indexOf("<main"), 0));
  if (!/<input\b[^>]*\btype="search"/.test(header)) {
    problems.push(`${where} в шапке нет поля поиска`);
  }
}

const home = page("");
if (home !== null) {
  // Главная — вход в каталог: разделы с числом фигур, без списка самих фигур.
  // Ссылок на фигуры нет ни в содержимом, ни в шапке.
  expectSearch("на главной", home);
  const main = mainOf(home);
  const linked = anchors(home.slice(0, home.indexOf("</main>"))).filter(isFigureLink);
  if (linked.length > 0) {
    problems.push(`на главной ${linked.length} ссылок на фигуры, а должны быть только разделы`);
  }
  if (!main.includes(`: ${countFigures(slugs.length)} по разделам`)) {
    problems.push(`на главной не названо общее число фигур — «${countFigures(slugs.length)}»`);
  }
  // Карточка раздела — один пункт списка: ссылка с названием, число фигур и,
  // если есть выведенные, их число.
  const cards = [...main.matchAll(/<li>(.*?)<\/li>/gs)].map((match) => match[1]);
  expectLinks(
    "на главной разделы",
    cards.flatMap(anchors),
    [...sections.keys()].map((discipline) => ({
      href: `/disciplines/${discipline}/`,
      text: sectionTitle(discipline),
    })),
  );
  for (const [discipline, figures] of sections) {
    const card = cards.find((item) => item.includes(`href="/disciplines/${discipline}/"`));
    if (card === undefined) {
      continue;
    }
    const spans = (name) =>
      [...card.matchAll(new RegExp(`<span class="${name}">([^<]*)</span>`, "g"))].map((match) => match[1]);
    const obsolete = figures.filter((figure) => figure.status === "obsolete").length;
    const count = countFigures(figures.length);
    if (spans("count").join("|") !== count) {
      problems.push(`на главной у раздела ${discipline} названо «${spans("count").join("|")}», а не «${count}»`);
    }
    const note = obsolete > 0 ? `из них ${countObsolete(obsolete)}` : "";
    if (spans("note").join("|") !== note) {
      problems.push(`на главной у раздела ${discipline} о выведенных сказано «${spans("note").join("|")}», а не «${note}»`);
    }
  }
}

for (const [discipline, figures] of sections) {
  const html = page(path.join("disciplines", discipline));
  if (html === null) {
    continue;
  }
  const where = `на странице disciplines/${discipline}/`;
  expectSearch(where, html);
  const main = mainOf(html);
  if (!main.includes(`<h1>${escapeHtml(sectionTitle(discipline))}</h1>`)) {
    problems.push(`${where} нет заголовка «${sectionTitle(discipline)}»`);
  }
  const lead = `Раздел ${PREFIXES[discipline]} книги фигур: <span class="count">${countFigures(figures.length)}</span>`;
  if (!main.includes(lead)) {
    problems.push(`${where} не сказано «Раздел ${PREFIXES[discipline]} книги фигур: ${countFigures(figures.length)}»`);
  }
  expectLinks(`${where} над заголовком`, anchors(main.slice(0, main.indexOf("<h1>"))), [
    { href: "/", text: "Все разделы" },
  ]);
  // Список раздела — ровно его фигуры: сначала действующие, потом выведенные,
  // каждый блок под своим заголовком и только если в нём есть фигуры.
  const blocks = [...main.matchAll(/<section id="([^"]*)">(.*?)<\/section>/gs)];
  const expected = STATUSES.map(([status, label]) => ({
    status,
    label,
    figures: figures.filter((figure) => figure.status === status),
  })).filter((block) => block.figures.length > 0);
  if (blocks.map((block) => block[1]).join(" ") !== expected.map((block) => block.status).join(" ")) {
    problems.push(
      `${where} блоки списка — «${blocks.map((block) => block[1]).join(" ")}», а по данным — «${expected.map((block) => block.status).join(" ")}»`,
    );
    continue;
  }
  expected.forEach((block, at) => {
    const part = blocks[at][2];
    const heading = `<h2>${block.label} — ${block.figures.length}</h2>`;
    if (!part.includes(heading)) {
      problems.push(`${where} у списка «${block.status}» нет заголовка «${block.label} — ${block.figures.length}»`);
    }
    expectLinks(`${where} список «${block.status}»`, anchors(part), block.figures.map((figure) => figureLink(figure)));
  });
  const all = anchors(main).filter(isFigureLink).length;
  if (all !== figures.length) {
    problems.push(`${where} ${all} ссылок на фигуры, а в разделе их ${figures.length}`);
  }
}

for (const slug of slugs) {
  const record = records.get(slug);
  const { discipline, summary, source } = record;
  const title = figureTitle(record);
  const document = documents.find(
    (item) => item.id === source.document && item.version === source.version,
  );
  const html = page(path.join("figures", slug));
  if (html === null) {
    continue;
  }
  const where = `на странице figures/${slug}/`;
  expectSearch(where, html);
  const main = mainOf(html);
  // Название есть ещё и в <title>, поэтому ищется именно разметка шаблона:
  // пустая страница с верными метаданными проверку не проходит.
  if (!main.includes(`<h1>${escapeHtml(title)}</h1>`)) {
    problems.push(`${where} нет заголовка «${title}»`);
  }
  if (!main.includes(`<p>${escapeHtml(summary)}</p>`)) {
    problems.push(`${where} нет описания`);
  }
  // Ссылка на первоисточник — одно из четырёх правил docs/sources.md: она
  // ведёт на официальный документ, открытый на странице этой фигуры.
  const href = escapeHtml(`${document?.url}#page=${source.page}`);
  if (!main.includes(`href="${href}"`)) {
    problems.push(`${where} нет ссылки на первоисточник (${href})`);
  }
  if (!main.includes(`страница ${source.page}</a>`)) {
    problems.push(`${where} не названа страница первоисточника ${source.page}`);
  }
  checkDiagrams(slug, main, record.geometry, document?.url, discipline.startsWith("multi-line"));
  // Со страницы фигуры виден её раздел, и переход ведёт именно в него.
  expectLinks(`${where} над заголовком`, anchors(main.slice(0, main.indexOf("<h1>"))), [
    { href: "/", text: "Все разделы" },
    { href: `/disciplines/${discipline}/`, text: sectionTitle(discipline) },
  ]);
  // Соседи — предыдущая и следующая фигуры раздела по номеру, и только они.
  const figures = sections.get(discipline);
  const at = figures.findIndex((figure) => figure.slug === slug);
  const neighbours = anchors(main).filter((link) => link.rel === "prev" || link.rel === "next");
  const expected = [];
  if (figures[at - 1]) {
    expected.push({ rel: "prev", ...figureLink(figures[at - 1], `← ${figureTitle(figures[at - 1])}`) });
  }
  if (figures[at + 1]) {
    expected.push({ rel: "next", ...figureLink(figures[at + 1], `${figureTitle(figures[at + 1])} →`) });
  }
  expectLinks(`${where} соседи`, neighbours, expected);
  if (neighbours.map((link) => link.rel).join(" ") !== expected.map((link) => link.rel).join(" ")) {
    problems.push(`${where} у ссылок на соседей rel — «${neighbours.map((link) => link.rel).join(" ")}»`);
  }
  // Отметка о выведенной фигуре есть у выведенных, и только у них.
  const marked = main.split(OBSOLETE_NOTE).length - 1;
  if (marked !== (record.status === "obsolete" ? 1 : 0) || main.split('class="status"').length - 1 !== marked) {
    problems.push(
      record.status === "obsolete"
        ? `${where} не сказано, что фигура выведена из действующей редакции`
        : `${where} действующая фигура помечена выведенной`,
    );
  }
  // Действующая редакция — первый документ реестра. Страница фигуры, снятой с
  // другой редакции, называет её версию и дату, и ссылка на первоисточник
  // говорит, какой это версии документ; у остальных такой отметки нет.
  const earlier = document !== undefined && document !== documents[0];
  const editions = main.split('class="edition"').length - 1;
  if (editions !== (earlier ? 1 : 0)) {
    problems.push(
      earlier
        ? `${where} не сказано, что схема снята с версии ${source.version}`
        : `${where} есть отметка о прежней редакции, а фигура снята с действующей`,
    );
  }
  if (earlier) {
    const note = `<p class="edition">Схема и шаги сняты с прежней редакции книги фигур — версии ${escapeHtml(source.version)} от ${longDate(document.dated)}: в действующей версии ${escapeHtml(documents[0].version)} страницы этой фигуры нет.</p>`;
    if (!main.includes(note)) {
      problems.push(`${where} отметка о прежней редакции не называет версию ${source.version} и её дату`);
    }
    // Две отметки стоят подряд: сначала «выведена», сразу за ней — редакция.
    const status = main.indexOf('class="status"');
    if (status === -1 || !main.startsWith(note, main.indexOf("</p>", status) + "</p>".length)) {
      problems.push(`${where} отметка о прежней редакции стоит не сразу за отметкой о выведенной фигуре`);
    }
    if (!main.includes(`в первоисточнике версии ${escapeHtml(source.version)}, страница ${source.page}</a>`)) {
      problems.push(`${where} ссылка на первоисточник не называет версию ${source.version}`);
    }
  } else if (!main.includes(`в первоисточнике, страница ${source.page}</a>`)) {
    problems.push(`${where} ссылка на первоисточник действующей редакции названа иначе`);
  }
}

checkStyles();

// Индекс поиска: запись на каждую фигуру в порядке каталога и ничего, кроме
// строки выдачи. Геометрии и описаний в нём быть не должно — это каталог, а не
// выгрузка.
const INDEX_FILE = "search-index.json";
const INDEX_KEYS = ["slug", "code", "name", "obsolete"];
const indexFile = path.join(out, INDEX_FILE);
let indexBytes = 0;
function checkIndex() {
  if (!fs.existsSync(indexFile)) {
    problems.push(`нет индекса поиска out/${INDEX_FILE}`);
    return;
  }
  indexBytes = fs.statSync(indexFile).size;
  let index;
  try {
    index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
  } catch (error) {
    problems.push(`индекс поиска — не JSON (${error.message})`);
    return;
  }
  if (!Array.isArray(index)) {
    problems.push("индекс поиска — не список");
    return;
  }
  const listed = index.map((entry) => (typeof entry?.slug === "string" ? entry.slug : "?"));
  if (listed.join(" ") !== catalogue.map((figure) => figure.slug).join(" ")) {
    problems.push(
      `в индексе поиска ${index.length} записей, и это не фигуры каталога (${slugs.length}) в его порядке`,
    );
  }
  for (const entry of index) {
    if (typeof entry !== "object" || entry === null) {
      problems.push("в индексе поиска запись — не объект");
      continue;
    }
    const record = records.get(entry.slug);
    const extra = Object.keys(entry).filter((key) => !INDEX_KEYS.includes(key));
    if (extra.length > 0) {
      problems.push(`в индексе поиска у ${entry.slug} лишние поля: ${extra.join(", ")}`);
    }
    if (!record) {
      continue;
    }
    if (
      typeof entry.code !== "string" ||
      typeof entry.name !== "string" ||
      `${entry.code} — ${entry.name}` !== figureTitle(record)
    ) {
      problems.push(`в индексе поиска ${entry.slug} подписана «${entry.code} — ${entry.name}»`);
    }
    // Отметка либо `true`, либо её нет: выдача читает её как «есть — нет».
    const obsolete = record.status === "obsolete";
    if (obsolete ? entry.obsolete !== true : Object.hasOwn(entry, "obsolete")) {
      problems.push(`в индексе поиска у ${entry.slug} статус не тот, что в данных`);
    }
  }
}
checkIndex();

// Поле поиска ходит за индексом по адресу, зашитому в клиентский код. Файл
// собран под одним именем, а код просит другое — поиск молча не работает.
function scripts(dir) {
  return fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const file = path.join(dir, entry.name);
        return entry.isDirectory() ? scripts(file) : entry.name.endsWith(".js") ? [file] : [];
      })
    : [];
}
if (!scripts(path.join(out, "_next")).some((file) => fs.readFileSync(file, "utf8").includes(`"/${INDEX_FILE}"`))) {
  problems.push(`клиентский код не обращается к /${INDEX_FILE}`);
}

// В out/figures/ и out/disciplines/ — ровно по каталогу на фигуру и на
// раздел: лишнее — это страница, у которой больше нет данных.
for (const [dir, expected] of [
  ["figures", slugs],
  ["disciplines", [...sections.keys()]],
]) {
  const built = path.join(out, dir);
  for (const entry of fs.existsSync(built) ? fs.readdirSync(built, { withFileTypes: true }) : []) {
    if (!entry.isDirectory() || !expected.includes(entry.name)) {
      problems.push(`в out/${dir}/ лишнее: ${entry.name}`);
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) {
    console.error(`check-export: ${problem}`);
  }
  process.exit(1);
}
console.log(
  `check-export: главная, ${sections.size} стр. разделов и ${slugs.length} стр. фигур на месте; индекс поиска — ${indexBytes} байт.`,
);

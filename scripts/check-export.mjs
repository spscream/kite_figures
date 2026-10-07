#!/usr/bin/env node
// Проверка готовой статики: в `out/` есть главная с разделами, по странице на
// каждую дисциплину и на каждый файл из `data/figures/` и индекс поиска. Тесты
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

// Префиксы разделов — те же, что `DISCIPLINES` в lib/figures.ts. Они повторены
// здесь намеренно: скрипт сверяет собранную страницу с файлом данных, а не с
// тем, что из него вычитал проверяемый код. По той же причине ниже повторены
// название раздела и склонение числа фигур.
const PREFIXES = {
  "dual-line-individual": "DI",
  "dual-line-pair": "DP",
  "dual-line-team": "DT",
  "multi-line-individual": "MI",
  "multi-line-pair": "MP",
  "multi-line-team": "MT",
};
const ORDER = Object.keys(PREFIXES);

const STATUSES = [
  ["current", "Действующие"],
  ["obsolete", "Выведены из действующей редакции"],
];
const OBSOLETE_NOTE = '<p class="status">Фигура выведена из действующей редакции правил.</p>';

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
}

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

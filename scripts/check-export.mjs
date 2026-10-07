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
// тем, что из него вычитал проверяемый код.
const PREFIXES = {
  "dual-line-individual": "DI",
  "dual-line-pair": "DP",
  "dual-line-team": "DT",
  "multi-line-individual": "MI",
  "multi-line-pair": "MP",
  "multi-line-team": "MT",
};

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

// Склонение повторено здесь по той же причине, что и префиксы.
function countFigures(count) {
  const tens = count % 100;
  const units = count % 10;
  if (units === 1 && tens !== 11) {
    return `${count} фигура`;
  }
  return units >= 2 && units <= 4 && (tens < 12 || tens > 14) ? `${count} фигуры` : `${count} фигур`;
}

const records = new Map(
  slugs.map((slug) => [slug, JSON.parse(fs.readFileSync(path.join(figuresDir, `${slug}.json`), "utf8"))]),
);

// Разделы — дисциплины, которые встречаются в файлах данных; у каждой — её
// фигуры по номеру.
const sections = new Map();
for (const [slug, record] of records) {
  if (!sections.has(record.discipline)) {
    sections.set(record.discipline, []);
  }
  sections.get(record.discipline).push({ slug, ...record });
}
for (const figures of sections.values()) {
  figures.sort((a, b) => a.number - b.number);
}

function figureTitle({ discipline, number, name }) {
  return `${PREFIXES[discipline]} ${String(number).padStart(2, "0")} — ${name}`;
}

// Ссылки страницы на фигуры, по порядку в разметке.
function figureLinks(html) {
  return [...html.matchAll(/<a\b[^>]*\bhref="\/figures\/([^"/]+)\/"/g)].map((match) => match[1]);
}

// Кусок страницы раздела с данным `id`: от открывающего тега до закрывающего.
function block(html, id) {
  const start = html.indexOf(`<section id="${id}">`);
  return start === -1 ? null : html.slice(start, html.indexOf("</section>", start));
}

const home = page("");
if (home !== null) {
  // Главная — вход в каталог: разделы с числом фигур, без списка самих фигур.
  // Ищется в <main>: поле поиска в шапке к содержимому страницы не относится.
  const main = home.slice(home.indexOf("<main"));
  const linked = figureLinks(main);
  if (linked.length > 0) {
    problems.push(`на главной ${linked.length} ссылок на фигуры, а должны быть только разделы`);
  }
  const listed = [...main.matchAll(/href="\/disciplines\/([^"/]+)\/"/g)].map((match) => match[1]);
  for (const discipline of listed) {
    if (!sections.has(discipline)) {
      problems.push(`на главной раздел ${discipline}, которого нет в данных`);
    }
  }
  for (const [discipline, figures] of sections) {
    const at = main.indexOf(`href="/disciplines/${discipline}/"`);
    if (at === -1) {
      problems.push(`на главной нет ссылки на раздел disciplines/${discipline}/`);
      continue;
    }
    // Число стоит в карточке своего раздела, то есть до конца её <li>.
    const card = main.slice(at, main.indexOf("</li>", at));
    const count = countFigures(figures.length);
    if (!card.includes(`<span class="count">${count}</span>`)) {
      problems.push(`на главной у раздела ${discipline} не названо «${count}»`);
    }
  }
}

for (const [discipline, figures] of sections) {
  const html = page(path.join("disciplines", discipline));
  if (html === null) {
    continue;
  }
  const where = `на странице disciplines/${discipline}/`;
  const main = html.slice(html.indexOf("<main"));
  const count = countFigures(figures.length);
  if (!main.includes(`<span class="count">${count}</span>`)) {
    problems.push(`${where} не названо «${count}»`);
  }
  // Список раздела — ровно его фигуры, по номеру внутри каждого статуса.
  for (const status of ["current", "obsolete"]) {
    const expected = figures.filter((figure) => figure.status === status);
    const part = block(main, status);
    const actual = part === null ? [] : figureLinks(part);
    if (actual.join(" ") !== expected.map((figure) => figure.slug).join(" ")) {
      problems.push(
        `${where} в списке «${status}» ${actual.length} фигур, а в данных их ${expected.length}, либо порядок не тот`,
      );
    }
    for (const figure of expected) {
      if (part !== null && !part.includes(`>${escapeHtml(figureTitle(figure))}</a>`)) {
        problems.push(`${where} ссылка на figures/${figure.slug}/ не подписана «${figureTitle(figure)}»`);
      }
    }
  }
  if (figureLinks(main).length !== figures.length) {
    problems.push(`${where} ${figureLinks(main).length} ссылок на фигуры, а в разделе их ${figures.length}`);
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
  if (html !== null) {
    // Название есть ещё и в <title>, поэтому ищется именно разметка шаблона:
    // пустая страница с верными метаданными проверку не проходит.
    if (!html.includes(`<h1>${escapeHtml(title)}</h1>`)) {
      problems.push(`на странице figures/${slug}/ нет заголовка «${title}»`);
    }
    if (!html.includes(`<p>${escapeHtml(summary)}</p>`)) {
      problems.push(`на странице figures/${slug}/ нет описания`);
    }
    // Ссылка на первоисточник — одно из четырёх правил docs/sources.md: она
    // ведёт на официальный документ, открытый на странице этой фигуры.
    const href = escapeHtml(`${document?.url}#page=${source.page}`);
    if (!html.includes(`href="${href}"`)) {
      problems.push(`на странице figures/${slug}/ нет ссылки на первоисточник (${href})`);
    }
    if (!html.includes(`страница ${source.page}</a>`)) {
      problems.push(`на странице figures/${slug}/ не названа страница первоисточника ${source.page}`);
    }
  }
  if (html !== null) {
    const main = html.slice(html.indexOf("<main"));
    // Со страницы фигуры виден её раздел, и переход ведёт именно в него.
    const crumbs = main.slice(0, main.indexOf("<h1>"));
    const to = [...crumbs.matchAll(/href="\/disciplines\/([^"/]+)\/"/g)].map((match) => match[1]);
    if (to.join(" ") !== discipline) {
      problems.push(`на странице figures/${slug}/ переход в раздел ведёт в «${to.join(" ")}», а не в ${discipline}`);
    }
    // Соседи — предыдущая и следующая фигуры раздела по номеру.
    const figures = sections.get(discipline);
    const at = figures.findIndex((figure) => figure.slug === slug);
    for (const [rel, neighbour] of [
      ["prev", figures[at - 1]],
      ["next", figures[at + 1]],
    ]) {
      const link = main.match(new RegExp(`<a\\b[^>]*\\brel="${rel}"[^>]*>`))?.[0] ?? null;
      const expected = neighbour ? `href="/figures/${neighbour.slug}/"` : null;
      if (expected === null ? link !== null : link === null || !link.includes(expected)) {
        problems.push(
          `на странице figures/${slug}/ ссылка rel="${rel}" — ${link ?? "нет"}, а сосед по разделу — ${neighbour?.slug ?? "нет"}`,
        );
      }
    }
    if (record.status === "obsolete" && !main.includes('<p class="status">')) {
      problems.push(`на странице figures/${slug}/ не сказано, что фигура выведена из действующей редакции`);
    }
  }
}

// Индекс поиска: запись на каждую фигуру и ничего, кроме строки выдачи.
// Геометрии и описаний в нём быть не должно — это каталог, а не выгрузка.
const INDEX_KEYS = ["slug", "code", "name", "obsolete"];
const indexFile = path.join(out, "search-index.json");
let indexBytes = 0;
if (!fs.existsSync(indexFile)) {
  problems.push("нет индекса поиска out/search-index.json");
} else {
  indexBytes = fs.statSync(indexFile).size;
  const index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
  if (index.map((entry) => entry.slug).sort().join(" ") !== slugs.join(" ")) {
    problems.push(`в индексе поиска ${index.length} записей, и это не фигуры каталога (${slugs.length})`);
  }
  for (const entry of index) {
    const record = records.get(entry.slug);
    const extra = Object.keys(entry).filter((key) => !INDEX_KEYS.includes(key));
    if (extra.length > 0) {
      problems.push(`в индексе поиска у ${entry.slug} лишние поля: ${extra.join(", ")}`);
    }
    if (!record) {
      continue;
    }
    if (`${entry.code} — ${entry.name}` !== figureTitle(record)) {
      problems.push(`в индексе поиска ${entry.slug} подписана «${entry.code} — ${entry.name}»`);
    }
    if ((entry.obsolete === true) !== (record.status === "obsolete")) {
      problems.push(`в индексе поиска у ${entry.slug} статус не тот, что в данных`);
    }
  }
}

// Страниц разделов — ровно по числу дисциплин в данных.
const builtSections = fs.existsSync(path.join(out, "disciplines"))
  ? fs
      .readdirSync(path.join(out, "disciplines"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  : [];
for (const discipline of builtSections) {
  if (!sections.has(discipline)) {
    problems.push(`в out/disciplines/ лишняя страница ${discipline}/`);
  }
}

// Страниц фигур в out/ должно быть ровно столько, сколько файлов в каталоге:
// лишняя — это страница, у которой больше нет данных.
const builtDir = path.join(out, "figures");
const built = fs.existsSync(builtDir)
  ? fs
      .readdirSync(builtDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  : [];
for (const slug of built) {
  if (!slugs.includes(slug)) {
    problems.push(`в out/figures/ лишняя страница ${slug}/`);
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

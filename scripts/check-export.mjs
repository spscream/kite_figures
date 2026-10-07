#!/usr/bin/env node
// Проверка готовой статики: в `out/` есть главная и по странице на каждый файл
// из `data/figures/`. Тесты `lib/` доказывают, что каталог читается; этот
// скрипт — что прочитанное дошло до собранного сайта. Запуск после сборки:
//
//     npm run build && npm run check:export
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const out = path.join(root, "out");
const figuresDir = path.join(root, "data", "figures");

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

const home = page("");
for (const slug of slugs) {
  const { title, summary, fictional } = JSON.parse(
    fs.readFileSync(path.join(figuresDir, `${slug}.json`), "utf8"),
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
    if (html.includes('class="fictional"') !== (fictional === true)) {
      problems.push(`на странице figures/${slug}/ плашка вымышленной записи не совпадает с данными`);
    }
  }
  if (home !== null && !home.includes(`href="/figures/${slug}/"`)) {
    problems.push(`на главной нет ссылки на figures/${slug}/`);
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
console.log(`check-export: главная и ${slugs.length} стр. фигур на месте.`);

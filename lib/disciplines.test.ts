import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import disciplines from "./disciplines.json";
import { DISCIPLINES, FIGURES_DIR } from "./figures";

// Список разделов книги один — `lib/disciplines.json`. Эти тесты держат его
// единственным: данные не называют раздела, которого в нём нет, а код, скрипт
// проверки статики и описание формата берут разделы из него, а не ведут свои.
const root = process.cwd();
const known = Object.keys(disciplines);

// Разделы, названные в файлах данных: значение поля и файлы, где оно стоит.
function used(dir: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const name of fs.readdirSync(dir).filter((item) => item.endsWith(".json")).sort()) {
    const { discipline } = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as { discipline: unknown };
    const key = String(discipline);
    found.set(key, [...(found.get(key) ?? []), name]);
  }
  return found;
}

// Чего в списке нет: «раздел (первый файл с ним)».
function unknown(dir: string): string[] {
  return [...used(dir)].filter(([discipline]) => !known.includes(discipline)).map(([discipline, files]) => `${discipline} (${files[0]})`);
}

describe("список дисциплин", () => {
  it("каждая дисциплина из data/figures/ есть в lib/disciplines.json", () => {
    expect(unknown(FIGURES_DIR)).toEqual([]);
  });

  it("незнакомую дисциплину в данных называет вместе с файлом", () => {
    const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? "/tmp"), "disciplines-"));
    try {
      fs.writeFileSync(path.join(dir, "di-01-a.json"), JSON.stringify({ discipline: "dual-line-individual" }));
      fs.writeFileSync(path.join(dir, "pk-01-b.json"), JSON.stringify({ discipline: "power-kiting" }));
      expect(unknown(dir)).toEqual(["power-kiting (pk-01-b.json)"]);
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });

  it("префикс раздела — две заглавные латинские буквы, и они не повторяются", () => {
    const prefixes = Object.values(disciplines);
    expect(prefixes.filter((prefix) => !/^[A-Z]{2}$/.test(prefix))).toEqual([]);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it("код берёт разделы из этого списка", () => {
    expect(DISCIPLINES).toBe(disciplines);
  });

  // Проводка: второго списка нет ни в одном исходнике. Строка с названием
  // раздела вне списка — это его копия, которая разойдётся с ним молча.
  it("ни код, ни скрипт проверки статики не ведут своего списка", () => {
    const script = fs.readFileSync(path.join(root, "scripts", "check-export.mjs"), "utf8");
    expect(script).toContain('path.join(root, "lib", "disciplines.json")');
    const sources = ["app", "components", "lib", "scripts"].flatMap((dir) =>
      fs
        .readdirSync(path.join(root, dir), { recursive: true })
        .map((name) => path.join(dir, String(name)))
        .filter((name) => /\.(ts|tsx|mjs)$/.test(name) && !/\.test\.tsx?$/.test(name)),
    );
    const copies = sources.filter((name) => {
      const text = fs.readFileSync(path.join(root, name), "utf8");
      // Кавычки любые: литерал в одинарных — та же копия.
      return known.filter((discipline) => new RegExp(`["'\`]${discipline}["'\`]`).test(text)).length > 1;
    });
    expect(copies).toEqual([]);
  });

  it("таблица разделов в data/figures/README.md — тот же список в том же порядке", () => {
    const readme = fs.readFileSync(path.join(FIGURES_DIR, "README.md"), "utf8");
    const rows = [...readme.matchAll(/^\| `([a-z-]+)` \| ([A-Z]{2}) \| /gm)].map((match) => [match[1], match[2]]);
    expect(rows).toEqual(Object.entries(disciplines));
  });
});

import { describe, expect, it } from "vitest";

import { isDate, loadSources, parseSources } from "./sources";

const DOCUMENT = {
  id: "book",
  version: "1.0",
  title: "Книга",
  dated: "2020-01-01",
  publisher: "Издатель",
  url: "https://example.org/book.pdf",
  landing: "https://example.org/",
  pages: 125,
  bytes: 10,
  sha256: "0".repeat(64),
  checked_on: "2026-10-07",
};

const parse = (documents: unknown, rest: Record<string, unknown> = {}) =>
  parseSources("sources.json", JSON.stringify({ documents, ...rest }));

describe("parseSources", () => {
  it("читает реестр", () => {
    expect(parse([DOCUMENT])).toEqual([DOCUMENT]);
  });

  it.each([
    ["id", { id: "" }, /поле «id»/],
    ["version", { version: 3 }, /поле «version»/],
    ["title", { title: " " }, /поле «title»/],
    ["publisher", { publisher: null }, /поле «publisher»/],
    ["url не адрес", { url: "book.pdf" }, /поле «url» должно быть адресом/],
    ["url с якорем", { url: "https://example.org/book.pdf#page=3" }, /поле «url» должно быть адресом http\(s\) без «#»/],
    ["landing", { landing: "ftp://example.org/" }, /поле «landing»/],
    ["dated", { dated: "01-APRIL-2017" }, /поле «dated» должно быть датой/],
    ["checked_on", { checked_on: "2026-13-01" }, /поле «checked_on» должно быть датой/],
    ["pages ноль", { pages: 0 }, /поле «pages»/],
    ["pages дробное", { pages: 12.5 }, /поле «pages»/],
    ["pages строкой", { pages: "125" }, /поле «pages»/],
    ["bytes", { bytes: -1 }, /поле «bytes»/],
    ["sha256", { sha256: "zz" }, /поле «sha256»/],
    ["незнакомое поле", { pagess: 1 }, /незнакомое поле «pagess»/],
  ])("отвергает документ: %s", (_label, over, message) => {
    expect(() => parse([{ ...DOCUMENT, ...over }])).toThrow(message);
  });

  it.each(Object.keys(DOCUMENT))("отвергает документ без поля «%s»", (key) => {
    const document: Record<string, unknown> = { ...DOCUMENT };
    delete document[key];
    expect(() => parse([document])).toThrow(new RegExp(`поле «${key}»`));
  });

  it("отвергает пустой реестр, повтор документа и незнакомое поле верхнего уровня", () => {
    expect(() => parse([])).toThrow(/непустым списком «documents»/);
    expect(() => parseSources("sources.json", "[]")).toThrow(/непустым списком «documents»/);
    expect(() => parseSources("sources.json", "{")).toThrow(/sources\.json: не JSON/);
    expect(() => parse([DOCUMENT, DOCUMENT])).toThrow(/документ book@1\.0 уже есть в реестре/);
    expect(() => parse([DOCUMENT], { document: [] })).toThrow(/незнакомое поле «document»/);
    expect(parse([DOCUMENT, { ...DOCUMENT, version: "2.0" }])).toHaveLength(2);
  });
});

describe("isDate", () => {
  it("принимает только существующий день в виде ГГГГ-ММ-ДД", () => {
    expect(isDate("2026-10-07")).toBe(true);
    expect(isDate("2026-02-30")).toBe(false);
    expect(isDate("2026-1-7")).toBe(false);
    expect(isDate(20261007)).toBe(false);
  });
});

describe("реестр репозитория", () => {
  it("читается", () => {
    expect(loadSources().length).toBeGreaterThan(0);
  });
});

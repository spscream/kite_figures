"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";

import { SEARCH_INDEX_PATH, type SearchEntry, searchFigures } from "@/lib/search";

// Сколько строк выдачи показывать: дальше запрос пора уточнять.
const LIMIT = 12;

// Поиск фигуры по названию и номеру. Индекс — отдельный файл, и за ним браузер
// идёт, только когда посетитель встал в поле: страницам, где не ищут, он не
// стоит ничего.
export function Search() {
  const id = useId();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<SearchEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const requested = useRef(false);

  function load() {
    if (requested.current) {
      return;
    }
    requested.current = true;
    setFailed(false);
    fetch(SEARCH_INDEX_PATH)
      .then((response) => {
        if (!response.ok) {
          throw new Error(String(response.status));
        }
        return response.json() as Promise<SearchEntry[]>;
      })
      .then(setIndex)
      .catch(() => {
        // Следующая попытка — при следующем обращении к полю.
        requested.current = false;
        setFailed(true);
      });
  }

  const asked = query.trim() !== "";
  const found = index && asked ? searchFigures(index, query) : [];

  return (
    <search className="search">
      <label htmlFor={id}>Поиск фигуры</label>
      <input
        id={id}
        type="search"
        value={query}
        placeholder="Название или номер, например DI 02"
        autoComplete="off"
        onFocus={load}
        onChange={(event) => {
          load();
          setQuery(event.target.value);
        }}
      />
      <noscript>
        <p className="note">Поиску нужен JavaScript; без него фигуры есть в разделах каталога.</p>
      </noscript>
      <div className="search-results" aria-live="polite">
        {asked && failed && <p className="note">Не удалось загрузить индекс поиска.</p>}
        {asked && !failed && !index && <p className="note">Загружается индекс поиска…</p>}
        {asked && index && found.length === 0 && <p className="note">Ничего не найдено.</p>}
        {found.length > 0 && (
          <>
            <ul>
              {found.slice(0, LIMIT).map((entry) => (
                <li key={entry.slug}>
                  <Link href={`/figures/${entry.slug}/`} onClick={() => setQuery("")}>
                    {`${entry.code} — ${entry.name}`}
                  </Link>
                  {entry.obsolete && <span className="tag">выведена из действующей редакции</span>}
                </li>
              ))}
            </ul>
            {found.length > LIMIT && (
              <p className="note">{`Показаны первые ${LIMIT} из ${found.length} — уточните запрос.`}</p>
            )}
          </>
        )}
      </div>
    </search>
  );
}

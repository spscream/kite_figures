"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { figurePath } from "@/lib/paths";
import { parseSearchIndex, SEARCH_INDEX_PATH, type SearchEntry, searchFigures } from "@/lib/search";

// Сколько строк выдачи показывать: дальше запрос пора уточнять.
const LIMIT = 12;

// Поиск фигуры по названию и номеру. Индекс — отдельный файл, и за ним браузер
// идёт, только когда посетитель встал в поле: страницам, где не ищут, он не
// стоит ничего.
export function Search() {
  const id = useId();
  const router = useRouter();
  const pathname = usePathname();
  // Запрос живёт, пока посетитель на странице, где его набрал: поле стоит в
  // общей шапке, и после перехода выдача над новой страницей уже ни к чему.
  const [typed, setTyped] = useState({ text: "", at: pathname });
  const [index, setIndex] = useState<SearchEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const requested = useRef(false);
  const input = useRef<HTMLInputElement>(null);

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
        return response.json();
      })
      .then((raw) => setIndex(parseSearchIndex(raw)))
      .catch(() => setFailed(true));
  }

  // После неудачи новая попытка — по кнопке или при новом входе в поле, а не
  // на каждую набранную букву.
  function retry() {
    requested.current = false;
    load();
  }

  // Набранное до того, как страница ожила, React не видел: поле уже с
  // текстом, а запроса нет.
  useEffect(() => {
    const text = input.current?.value ?? "";
    if (text !== "") {
      setTyped({ text, at: window.location.pathname });
      load();
    }
    // Один раз, при появлении поля на странице.
  }, []);

  const query = typed.at === pathname ? typed.text : "";
  const asked = query.trim() !== "";
  const found = index && asked ? searchFigures(index, query) : [];

  return (
    <search className="search">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (failed) {
            retry();
          } else if (found.length > 0) {
            router.push(figurePath(found[0].slug));
          }
        }}
      >
        <label htmlFor={id}>Поиск фигуры</label>
        <input
          ref={input}
          id={id}
          type="search"
          value={query}
          placeholder="Название или номер, например DI 02"
          autoComplete="off"
          onFocus={failed ? retry : load}
          onChange={(event) => {
            load();
            setTyped({ text: event.target.value, at: pathname });
          }}
        />
      </form>
      <noscript>
        <p className="note">Поиску нужен JavaScript; без него фигуры есть в разделах каталога.</p>
      </noscript>
      <div className="search-results" aria-live="polite">
        {asked && failed && (
          <p className="note">
            Не удалось загрузить индекс поиска.{" "}
            <button type="button" onClick={retry}>
              Повторить
            </button>
          </p>
        )}
        {asked && !failed && !index && <p className="note">Загружается индекс поиска…</p>}
        {asked && index && found.length === 0 && <p className="note">Ничего не найдено.</p>}
        {found.length > 0 && (
          <>
            <ul>
              {found.slice(0, LIMIT).map((entry) => (
                <li key={entry.slug}>
                  <Link href={figurePath(entry.slug)}>{`${entry.code} — ${entry.name}`}</Link>
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

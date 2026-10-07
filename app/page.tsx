import Link from "next/link";

import { listFigures } from "@/lib/figures";

export default function HomePage() {
  const figures = listFigures();
  return (
    <>
      <h1>Фигуры для спортивных кайтов</h1>
      <p className="note">
        Сайт в работе: каталог обязательных фигур со своими схемами и ссылками на официальные
        правила появится здесь позже.
      </p>
      <h2>Фигуры</h2>
      <ul className="figure-list">
        {figures.map((figure) => (
          <li key={figure.slug}>
            <Link href={`/figures/${figure.slug}/`}>{figure.title}</Link>
          </li>
        ))}
      </ul>
    </>
  );
}

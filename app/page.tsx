import Link from "next/link";

import { figureTitle, listFigures } from "@/lib/figures";

export default function HomePage() {
  const figures = listFigures();
  return (
    <>
      <h1>Фигуры для спортивных кайтов</h1>
      <p className="note">
        Сайт в работе: в каталоге пока один раздел правил, свои схемы фигур появятся здесь
        позже.
      </p>
      <h2>Фигуры</h2>
      <ul className="figure-list">
        {figures.map((figure) => (
          <li key={figure.slug}>
            <Link href={`/figures/${figure.slug}/`}>{figureTitle(figure)}</Link>
          </li>
        ))}
      </ul>
    </>
  );
}

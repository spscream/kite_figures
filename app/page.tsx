import Link from "next/link";

import { countFigures, countObsolete, listSections, sectionPath } from "@/lib/catalog";

export default function HomePage() {
  const sections = listSections();
  const total = sections.reduce((sum, section) => sum + section.figures.length, 0);
  return (
    <>
      <h1>Фигуры для спортивных кайтов</h1>
      <p className="note">
        {`Каталог обязательных фигур соревнований по спортивному кайту: ${countFigures(total)} по разделам книги фигур.`}
      </p>
      <h2>Разделы</h2>
      <ul className="section-list">
        {sections.map((section) => (
          <li key={section.discipline}>
            <Link href={sectionPath(section.discipline)}>{section.title}</Link>
            <span className="count">{countFigures(section.figures.length)}</span>
            {section.obsolete.length > 0 && (
              <span className="note">{`из них ${countObsolete(section.obsolete.length)}`}</span>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

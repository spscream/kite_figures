import Link from "next/link";

import { countFigures, countObsolete, listSections, sectionPath } from "@/lib/catalog";
import { routinePath } from "@/lib/paths";
import { listRoutines } from "@/lib/routines";

export default function HomePage() {
  const sections = listSections();
  const total = sections.reduce((sum, section) => sum + section.figures.length, 0);
  const routines = listRoutines();
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
      {/* Рутины — своя работа, не часть книги: отдельным списком и только когда они есть. */}
      {routines.length > 0 && (
        <>
          <h2>Рутины</h2>
          <ul className="routine-list">
            {routines.map((routine) => (
              <li key={routine.slug}>
                <Link href={routinePath(routine.slug)}>{routine.name}</Link>
                {routine.summary && <span className="note">{routine.summary}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

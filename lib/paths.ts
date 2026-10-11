// Адреса страниц каталога. Модуль ничего не читает с диска: им пользуются и
// страницы при сборке, и поле поиска в браузере.
export function sectionPath(discipline: string): string {
  return `/disciplines/${discipline}/`;
}

export function figurePath(slug: string): string {
  return `/figures/${slug}/`;
}

export function routinePath(slug: string): string {
  return `/routines/${slug}/`;
}

// Редактор длительностей рутины.
export function routineTempoPath(slug: string): string {
  return `/routines/${slug}/tempo/`;
}

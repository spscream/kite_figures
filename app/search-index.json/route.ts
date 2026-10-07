import { listFigures } from "@/lib/figures";
import { buildSearchIndex } from "@/lib/search";

// Индекс поиска — файл, который сборка кладёт в `out/search-index.json`.
// Обработчик исполняется один раз при сборке: в проде сервера нет.
export const dynamic = "force-static";

export function GET() {
  return Response.json(buildSearchIndex(listFigures()));
}

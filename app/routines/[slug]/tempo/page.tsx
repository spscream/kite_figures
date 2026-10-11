import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ElementDictionary } from "@/components/ElementDictionary";
import { TempoEditor } from "@/components/TempoEditor";
import { editorProps } from "@/lib/editor";
import { routinePath } from "@/lib/paths";
import { getRoutine, listRoutines } from "@/lib/routines";

type Props = { params: Promise<{ slug: string }> };

// Редактор рутины (длительности и элементы словаря) — по странице на рутину каталога `data/routines/`.
export const dynamicParams = false;

export function generateStaticParams() {
  return listRoutines().map((routine) => ({ slug: routine.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const routine = getRoutine((await params).slug);
  return routine ? { title: `Длительности: ${routine.name}`, description: `Редактор длительностей шагов рутины «${routine.name}».` } : {};
}

export default async function TempoPage({ params }: Props) {
  const { slug } = await params;
  // Автору возвращается его же файл: редактор меняет в нём длительности и
  // ставит в него шаги элементов.
  const props = editorProps(slug);
  if (!props) {
    notFound();
  }
  const { routine } = props;
  return (
    <article>
      <nav className="crumbs" aria-label="Положение на сайте">
        <Link href="/">Все разделы</Link>
        {" / Рутины / "}
        <Link href={routinePath(slug)}>{routine.name}</Link>
      </nav>
      <h1>{`Длительности: ${routine.name}`}</h1>
      <p className="note">
        Темп рутины задаёт её автор: ни книга фигур, ни правила длительности шага не называют. Поэтому редактор чисел не
        предлагает — пустое поле остаётся пустым, и шаг с ним остаётся шагом, чей темп не задан. Длительность есть у всего,
        что занимает время: у пролёта, у остановки, у поворота на месте, у посадки. У старта и вызовов IN и OUT её нет.
      </p>
      <p className="note">
        Редактор ничего не сохраняет: сайт — статические файлы. Правки живут, пока открыта страница; внизу — текст файла
        рутины с ними, его сохраняет сам автор. Проверки под полями — подсказки по условиям правил, а не судейская оценка.
      </p>
      <p className="note">
        Здесь же в рутину ставится элемент словаря: автор выбирает элемент, называет его параметры и получает шаг пути.
        Какие элементы есть и чего среди них нет — в таблицах под редактором.
      </p>
      <noscript>
        <p className="te-nojs">
          Редактору нужен JavaScript: без него поля ввода не показаны. Сама рутина со схемами и шагами читается и без него —
          на <a href={routinePath(slug)}>её странице</a>.
        </p>
      </noscript>
      <TempoEditor {...props} />
      <ElementDictionary />
    </article>
  );
}

import { ELEMENTS, OUTSIDE } from "@/lib/elements";

// Словарь элементов рутины таблицами: что в него вошло и чего в нём нет.
// Обе таблицы — строки разбора `docs/routine-elements.md`, раздел 6, слово в
// слово: причины отсутствия здесь не пересказываются. Разметка статическая и
// читается без JavaScript.

// Текст ячейки разбора: слово в обратных кавычках — поле или значение формата.
function cell(text: string) {
  return text.split("`").map((part, index) => (index % 2 === 1 ? <code key={index}>{part}</code> : part));
}

export const DICTIONARY_DOC = "docs/routine-elements.md";

export function ElementDictionary() {
  return (
    <section className="el-dict">
      <h2>Словарь элементов</h2>
      <p className="note">
        {`Элементов в словаре — ${ELEMENTS.length}: у каждого есть определение в книге фигур, он встречается в фигурах четырёхстропного кайта и записывается шагом пути. Русские имена — наши: книга называет элементы только по-английски. Откуда взят список — в разборе `}
        <code>{DICTIONARY_DOC}</code>
        {" в репозитории сайта; номера разделов и требований в таблицах ниже — его."}
      </p>
      <table className="el-in">
        <thead>
          <tr>
            <th>№</th>
            <th>Элемент</th>
            <th>Источник</th>
            <th>Разворачивается в</th>
            <th>Параметры</th>
          </tr>
        </thead>
        <tbody>
          {ELEMENTS.map((item, index) => (
            <tr key={item.id}>
              <td>{index + 1}</td>
              <th scope="row">{item.name}</th>
              <td>{item.source}</td>
              <td>{cell(item.into)}</td>
              <td>{item.asks}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">У каждого элемента есть ещё длительность; её, как и любой другой параметр, называет автор рутины.</p>
      <h3>Чего в словаре нет и почему</h3>
      <p className="note">
        Того, что перечислено ниже, редактор не ставит. Это не значит, что такого нет в правилах: у каждой строки своя
        причина, и условие, при котором строку вернут.
      </p>
      <table className="el-out">
        <thead>
          <tr>
            <th>Что</th>
            <th>Почему снаружи</th>
            <th>При каком условии вернуть</th>
          </tr>
        </thead>
        <tbody>
          {OUTSIDE.map((item) => (
            <tr key={item.what}>
              <th scope="row">{item.what}</th>
              <td>{item.why}</td>
              <td>{item.back}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

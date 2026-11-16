/** Типы блоков как CLASSES_MAP в ETL hybrid_extract.py */

export const ETL_CHUNK_TYPES = [
  { id: "Title", label: "Заголовок" },
  { id: "Section-header", label: "Заголовок раздела" },
  { id: "Text", label: "Текст" },
  { id: "List-item", label: "Элемент списка" },
  { id: "Table", label: "Таблица" },
  { id: "Document Index", label: "Содержание" },
  { id: "Caption", label: "Подпись" },
  { id: "Picture", label: "Картинка" },
  { id: "Page-header", label: "Колонтитул сверху" },
  { id: "Page-footer", label: "Колонтитул снизу" },
  { id: "Footnote", label: "Сноска" },
  { id: "Formula", label: "Формула" },
  { id: "Code", label: "Код" },
  { id: "Form", label: "Форма" },
  { id: "Key-Value Region", label: "Ключ–значение" },
  { id: "Checkbox-Selected", label: "Чекбокс выбран" },
  { id: "Checkbox-Unselected", label: "Чекбокс пустой" },
] as const;

export type EtlChunkTypeId = (typeof ETL_CHUNK_TYPES)[number]["id"];

export const ETL_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  ETL_CHUNK_TYPES.map((item) => [item.id, item.label]),
);

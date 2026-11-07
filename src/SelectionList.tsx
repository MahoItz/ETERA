import type { SelectionItem } from "../lib/cart";
import { selectionPath } from "../lib/cart";
import { CatalogImage } from "./CatalogImage";

export const selectionMoney = (price: number | null) => price === null ? "Цена по запросу" : `${new Intl.NumberFormat("ru-RU").format(price)} ₽`;

export function SelectionList({ items }: { items: SelectionItem[] }) {
  return <ul className="selection-list" aria-label="Выбранные фигурки">
    {items.map((item, index) => <li key={index}>
      {item.image_url && <CatalogImage src={item.image_url} alt="" loading="lazy" />}
      <div><a href={selectionPath(item, import.meta.env.BASE_URL)}>{item.variant_name || item.title}</a>
        {item.variant_name && <small>{item.title}</small>}
        {item.sold_as_set && <small>Набор целиком</small>}
        <small>{selectionMoney(item.price)}</small>
      </div>
    </li>)}
  </ul>;
}

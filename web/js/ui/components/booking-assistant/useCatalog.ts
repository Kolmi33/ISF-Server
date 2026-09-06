import * as React from 'react';
import { type CatalogCategory, type Device } from '../../../core/booking-assistant-types.ts';

/** Eine Kategorie samt der Geräte, die die aktuelle Suche übrig lässt. */
export interface CatalogEntry {
  category: CatalogCategory;
  devices: Device[];
}

/** Der Katalog ist zweistufig: Oberkategorien ("Maschinen", "Messtechnik") klappen ihre
 *  Bereiche auf, alles ohne Oberkategorie (die Favoriten) steht direkt oben. */
export type CatalogNode =
  | { kind: 'category'; id: string; entry: CatalogEntry }
  | { kind: 'section'; id: string; label: string; count: number; entries: CatalogEntry[] };

export function useCatalog(catalog: CatalogCategory[]) {
  const [query, setQuery] = React.useState('');
  /* Beim Öffnen ist nur aufgeklappt, was `starred` ist — die Favoriten. Alles andere fehlt in
     der Map und gilt damit als zu; erst ein Klick trägt es ein. */
  const [openCategories, setOpenCategories] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(catalog.filter((c) => c.starred).map((c) => [c.id, true])),
  );
  const filteredCatalog = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const nodes: CatalogNode[] = [];
    const sections = new Map<string, Extract<CatalogNode, { kind: 'section' }>>();
    for (const category of catalog) {
      const devices = q
        ? category.devices.filter((d) => `${d.name} ${d.code} ${d.lab}`.toLowerCase().includes(q))
        : category.devices;
      if (devices.length === 0) continue;
      const entry = { category, devices };
      if (!category.section) {
        nodes.push({ kind: 'category', id: category.id, entry });
        continue;
      }
      let section = sections.get(category.section.id);
      if (!section) {
        section = { kind: 'section', ...category.section, count: 0, entries: [] };
        sections.set(section.id, section);
        nodes.push(section);
      }
      section.entries.push(entry);
      section.count += devices.length;
    }
    return nodes;
  }, [catalog, query]);
  /* Während gesucht wird, steht alles offen: sonst verstecken die zugeklappten Rubriken
     genau die Treffer, nach denen gerade gesucht wird. */
  const searching = query.trim().length > 0;
  const isCatalogOpen = (id: string) => searching || openCategories[id] === true;
  const toggleCatalogOpen = (id: string) =>
    setOpenCategories((state) => ({ ...state, [id]: !state[id] }));

  return { query, setQuery, filteredCatalog, isCatalogOpen, toggleCatalogOpen };
}

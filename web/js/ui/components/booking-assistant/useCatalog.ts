import * as React from 'react';
import { type CatalogCategory } from '../../../core/booking-assistant-types.ts';

export function useCatalog(catalog: CatalogCategory[]) {
  const [query, setQuery] = React.useState('');
  const [openCategories, setOpenCategories] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(catalog.map((c) => [c.id, true])),
  );
  const filteredCatalog = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog
      .map((category) => ({
        category,
        devices: q
          ? category.devices.filter((d) => `${d.name} ${d.code} ${d.lab}`.toLowerCase().includes(q))
          : category.devices,
      }))
      .filter((entry) => entry.devices.length > 0);
  }, [catalog, query]);

  return { query, setQuery, openCategories, setOpenCategories, filteredCatalog };
}

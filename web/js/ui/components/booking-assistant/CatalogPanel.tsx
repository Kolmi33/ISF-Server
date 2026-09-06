import { Search } from 'lucide-react';
import { Badge } from './primitives.tsx';
import { Input } from './primitives.tsx';
import { ScrollArea } from './primitives.tsx';
import { SECTION_LABEL_CLASS } from './styles.ts';
import { CatalogTree } from './Catalog.tsx';
import { type AssistantState } from './useAssistantState.ts';

export function CatalogPanel({ state }: { state: AssistantState }) {
  const {
    selectedDeviceIds,
    query,
    setQuery,
    filteredCatalog,
    isCatalogOpen,
    toggleCatalogOpen,
    toggleDevice,
  } = state;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden border-b border-border px-6 py-5 sm:px-7 md:basis-1/2 md:border-b-0 md:border-r">
      <div className="flex shrink-0 items-center gap-3">
        <h2 className={SECTION_LABEL_CLASS}>Geräte auswählen</h2>
        <Badge variant="secondary">{selectedDeviceIds.length} aktiv</Badge>
      </div>

      <div className="relative shrink-0">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Gerät suchen…"
          aria-label="Gerät suchen"
          className="h-10 rounded-lg pl-9"
        />
      </div>

      <ScrollArea className="-mr-3 min-h-0 flex-1 pr-3">
        {filteredCatalog.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Kein Gerät passt zu „{query}“.
          </p>
        ) : (
          <CatalogTree
            nodes={filteredCatalog}
            isOpen={isCatalogOpen}
            onToggleOpen={toggleCatalogOpen}
            selectedIds={selectedDeviceIds}
            onToggleDevice={toggleDevice}
          />
        )}
      </ScrollArea>
    </div>
  );
}

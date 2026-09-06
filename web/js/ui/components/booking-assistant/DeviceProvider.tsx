import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { CatalogCategory, Device } from '../../../core/booking-assistant-types.ts';

const DeviceContext = createContext<Record<string, Device>>({});

/** All supplied cards resolve the injected live catalog, including drag overlays. */
export function DeviceProvider({
  catalog,
  children,
}: {
  catalog: CatalogCategory[];
  children: ReactNode;
}) {
  const devices = useMemo(
    () => Object.fromEntries(catalog.flatMap((c) => c.devices).map((d) => [d.id, d])),
    [catalog],
  );
  return <DeviceContext.Provider value={devices}>{children}</DeviceContext.Provider>;
}

export function useDevices() {
  return useContext(DeviceContext);
}

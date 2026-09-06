import { type Device } from '../../../core/booking-assistant-types.ts';

/** Zweite Zeile jeder Gerätezeile: zuerst der Bereich, dahinter die Info-Notiz aus der
 *  Maschinenverwaltung — dieselbe, die im Plan am Info-Symbol der Maschine hängt. Lange
 *  Notizen werden abgeschnitten und stehen dann im `title`. */
export function DeviceSubtitle({ device }: { device: Device }) {
  const text = device.info ? `${device.lab} · ${device.info}` : device.lab;
  return (
    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground" title={text}>
      {text}
    </span>
  );
}

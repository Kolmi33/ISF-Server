import { AppDialogHeader } from '../app/AppDialog.tsx';
import { X } from 'lucide-react';
import { Button } from '../../../components/ui/app-button.tsx';

/* Derselbe Kompass wie in der Toolbar (`#i-compass`, `web/index.html`). Bewusst inline und
   nicht per `<use href="#i-compass">`: das Sprite-Symbol trägt keine eigenen Mal-Attribute,
   die kommen aus der `.ic`-Regel (app.css) — und die nagelt die Größe auf 13 px fest, hier
   werden aber 24 px gebraucht. */
function CompassIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M10.5 5.5 9.2 9.2 5.5 10.5l1.3-3.7z" />
    </svg>
  );
}

export function AssistantHeader({ onClose }: { onClose?: () => void }) {
  return (
    <AppDialogHeader
      icon={<CompassIcon className="size-6" />}
      title="Buchungsassistent"
      titleId="buchungsassistent-title"
      actions={
        <Button variant="ghost" size="icon" aria-label="Schließen" onClick={onClose}>
          <X className="size-5" />
        </Button>
      }
      subtitle="Laborgeräte reservieren"
    />
  );
}

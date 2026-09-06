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

export function AssistantHeader() {
  return (
    <header className="flex shrink-0 items-start gap-4 px-6 py-5 sm:px-7 sm:py-6">
      <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary-deep">
        <CompassIcon className="size-6" />
      </div>
      <div className="min-w-0 flex-1">
        <h1
          id="buchungsassistent-title"
          className="text-[22px] font-semibold leading-tight tracking-tight text-foreground"
        >
          Buchungsassistent
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Laborgeräte reservieren</p>
      </div>
    </header>
  );
}

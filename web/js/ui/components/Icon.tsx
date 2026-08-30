// A named icon from the inline SVG sprite defined at the top of index.html. React
// equivalent of legacy.js's `ic(name)` string helper (`'<svg class="ic" ...><use href="#i-
// '+name+'"/></svg>'`) — same markup, same sprite, just JSX instead of a template string.

export interface IconProps {
  name: string;
}

export function Icon({ name }: IconProps) {
  return (
    <svg className="ic" aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}

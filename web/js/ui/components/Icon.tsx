// =======================================================================================
// ICON COMPONENT (web/js/ui/components/Icon.tsx)
// =======================================================================================
//
// A named icon from the inline SVG sprite defined at the top of `index.html`.
//
// =======================================================================================

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

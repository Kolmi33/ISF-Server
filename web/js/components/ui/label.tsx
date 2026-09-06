import type { ComponentProps } from 'react';

/** A plain `<label>`. Exists so a row can be wrapped in one label (making the whole row
 *  clickable) without every call site importing raw JSX conventions of its own. */
export function Label(props: ComponentProps<'label'>) {
  return <label {...props} />;
}

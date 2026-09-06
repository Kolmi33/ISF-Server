# UI style guide — derived from the Buchungsassistent

**Status:** normative for every _secondary_ window (dialogs, filter popovers, management
screens). The main booking grid is explicitly out of scope — it is a dense primary
workspace with its own requirements (see §19).

This guide is **not** an invented design system. Every rule below was read out of the
Buchungsassistent's actual implementation (`web/js/ui/components/booking-assistant/`,
`web/css/ui-scope.css`) and is stated with the Tailwind utility or token that implements
it. When this document and that code disagree, the code wins and this document is wrong —
fix it here.

---

## 1. Visual principles

The Assistant's look comes from five decisions, in order of how much they carry:

1. **Surfaces are quiet, borders do the work.** One flat `bg-card` sheet, one hairline
   `border-border`, one big shadow at the dialog edge. Inside the dialog there is no second
   shadow anywhere — regions are separated by a 1px border or by whitespace, never by a
   raised panel.
2. **Green is meaning, not decoration.** `primary` marks selection, insertion and the one
   affirmative action per surface. A screen with nothing selected has almost no green on it.
3. **Labels are small, uppercase and tracked; content is normal-case and dark.** The
   contrast between a 10–11px tracked uppercase label and 14px foreground content is the
   main typographic device. There are no mid-weight "heading" sizes between them.
4. **Density is calm.** Rows are 40–48px, sections are separated by `gap-4` (16px), and the
   dialog's outer padding is 24px (28px from `sm`). Nothing is tighter than 8px.
5. **The frame is fixed, the middle scrolls.** Header and footer never move; exactly one
   region in the middle scrolls, and it owns the scrollbar.

---

## 2. The scope class — how a window opts into this system

The design system is delivered by the CSS class **`.ui-scope`** (`web/css/ui-scope.css`).
It does three things that nothing else in the app does:

| Job               | Mechanism                                                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Palette           | Sets `--background`/`--foreground`/`--primary`/… on the scope root. Tailwind's `@theme inline` block (`web/css/tailwind.css`) maps these to `bg-card`, `text-muted-foreground`, … |
| Local reset       | `box-sizing`, zeroed margin/padding, `border: 0 solid`, `font: inherit` on `button`/`input`, unstyled `h1–h3`/`ul` — the Preflight the app deliberately does **not** load globally |
| Legacy isolation  | `all: revert-layer` on every descendant, which drops the unlayered `app.css` rules and lets the Tailwind `utilities` layer through                                 |

**Consequences you must know:**

- A window is migrated when its root element carries `ui-scope`. Until then it is styled by
  `app.css` and Tailwind utilities on it will mostly lose.
- Because `app.css` is neutralised inside the scope, **old class names left on an element
  are inert** — they no longer style anything. Keep them where a test or another module
  queries them; they cost nothing.
- Portalled content (Base UI popovers, tooltips) leaves the DOM subtree, so its positioner
  must carry `ui-scope` itself. The shared `PopoverContent`/`TooltipContent` already do this.
- `#modal`/`#overlay` chrome is overridden for `.ui-scope` children: transparent background,
  no padding, `border-radius: 16px`, `overflow: hidden`, `max-height: calc(100dvh - 32px)`,
  and `#overlay` padding drops to 16px. The dialog paints its own surface.

---

## 3. Typography hierarchy

Font stack: `Inter Variable` (`--font-sans`), numerals `tabular-nums` wherever a number can
change, `JetBrains Mono Variable` (`font-mono`) for codes and counters only.

| Role             | Utilities                                                                                            | Where                     |
| ---------------- | ---------------------------------------------------------------------------------------------------- | ------------------------- |
| Dialog title     | `text-[22px] font-semibold leading-tight tracking-tight text-foreground`                               | `AppDialogHeader`         |
| Dialog subtitle  | `text-sm text-muted-foreground` (`mt-1`)                                                               | `AppDialogHeader`         |
| Section heading  | `text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground` (`SECTION_LABEL_CLASS`)  | `SectionHeading`          |
| Field label      | `text-[10px] font-semibold uppercase leading-none tracking-[0.16em] text-muted-foreground` (`LABEL_CLASS`) | `FieldLabel`, `NumberField` |
| Row title        | `text-sm font-medium text-foreground`                                                                  | list rows, cards          |
| Body             | `text-sm text-foreground`                                                                              | prose, values             |
| Secondary        | `text-sm text-muted-foreground`                                                                        | subtitles, hints          |
| Metadata         | `text-[11px] text-muted-foreground` (+ `tabular-nums` for dates/counts)                                | row subtitles, footnotes  |
| Micro / pill     | `text-[10px] font-semibold uppercase tracking-[0.12em]`                                                | status pills, `oder`      |
| Button text      | inherited `text-sm font-medium`                                                                        | shadcn `Button`           |
| Empty state      | `text-sm text-muted-foreground`, capped `max-w-[26ch]`–`max-w-[30ch]`                                  | `EmptyState`              |

Rules: never introduce a size between 14px and 22px; never bold body text to create a
heading — use `SectionHeading`; never set a colour on text other than `text-foreground`,
`text-muted-foreground`, `text-primary`, `text-destructive` or a `*-foreground` pair.

---

## 4. Colour semantics

Defined once on `.ui-scope`, with a `[data-theme='dark']` override. Use the **semantic**
name, never a hex or an `hsl()` literal.

| Token                                    | Utility                                                | Meaning                                                                                                                                 |
| ---------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `--background` / `--card` / `--popover`  | `bg-background`, `bg-card`, `bg-popover`               | Sheet surfaces. `card` is the dialog itself.                                                                                             |
| `--foreground`                           | `text-foreground`                                      | Primary ink.                                                                                                                             |
| `--muted`                                | `bg-muted`, `bg-muted/50`, `bg-muted/40`               | Recessed strips: footer, toolbars, resting rows.                                                                                         |
| `--muted-foreground`                     | `text-muted-foreground`                                | Secondary ink, labels, inactive icons.                                                                                                   |
| `--primary`                              | `bg-primary`, `border-primary/45`, `bg-primary/[0.08]` | Selection, insertion markers, focus ring.                                                                                                |
| `--primary-deep`                         | `bg-primary-deep`                                      | The one filled affirmative button (better contrast on white than `primary`).                                                             |
| `--secondary` / `--secondary-foreground` | `bg-secondary`                                         | Neutral counters and device chips.                                                                                                       |
| `--brand-accent` (+ `-soft`, `-foreground`) | `text-brand`, `bg-brand-soft`, `text-brand-foreground` | The _alternative / OR_ concept: group rings, `oder` separators, "resolved from a group" chips, open-ended results. Amber, not green.      |
| `--accent`                               | `bg-accent`                                            | Hover fill on ghost/icon buttons and calendar days.                                                                                      |
| `--destructive`                          | `text-destructive`, `bg-destructive/10`                | Delete affordances only. Destructive buttons are **tinted, not filled**.                                                                  |
| `--border`                               | `border-border`, `bg-border`                           | Every hairline and separator.                                                                                                            |
| `--input`                                | `border-input`                                         | Form-control borders (one step darker than `border`).                                                                                    |
| `--ring`                                 | `ring-ring`                                            | Focus ring, always at `/50` with `ring-3`.                                                                                               |

Disabled = `disabled:opacity-50 disabled:pointer-events-none` (shadcn `Button`) or
`opacity-50` on a soft-disabled stepper. There is no separate "disabled colour".

---

## 5. Spacing scale

Only these values appear; treat anything else as a mistake.

| px  | Tailwind                | Use                                                      |
| --- | ----------------------- | -------------------------------------------------------- |
| 2   | `gap-0.5`, `mt-0.5`     | icon nudges, label→subtitle                              |
| 4   | `gap-1`, `p-1`          | stepper internals, tight icon rows                       |
| 6   | `gap-1.5`               | icon + text inside a chip or heading                     |
| 8   | `gap-2`, `px-2`         | button groups, chip padding                              |
| 10  | `py-2.5`, `px-2.5`      | list-row vertical padding, badge padding                 |
| 12  | `gap-3`, `px-3`, `pr-3` | row internals, scroll gutter, footer block gaps          |
| 16  | `gap-4`, `p-4`          | **section rhythm** — between parts of a panel, card padding |
| 20  | `py-5`                  | panel vertical padding                                   |
| 24  | `px-6`, `py-12`         | dialog horizontal padding, empty-state height            |
| 28  | `sm:px-7`               | dialog horizontal padding from `sm` up                   |

Header padding `px-6 py-5 sm:px-7 sm:py-6`; panel padding `px-6 py-5 sm:px-7`; footer
padding `px-6 py-4 sm:px-7`. Intra-panel rhythm is `gap-4`. Lists use `gap-1`–`gap-1.5`
between rows and `gap-3`–`gap-4` between groups.

---

## 6. Border radii

`--radius: 0.65rem`, and the scale is derived (`web/css/tailwind.css`):

| Utility        | Value    | Use                                                                    |
| -------------- | -------- | ---------------------------------------------------------------------- |
| `rounded-md`   | 0.52rem  | steppers, small toggles, tooltips                                      |
| `rounded-lg`   | 0.65rem  | **default control radius** — buttons, inputs, list rows, icon buttons  |
| `rounded-xl`   | 0.91rem  | cards, plan entries, popovers, empty states, header icon tile          |
| `rounded-2xl`  | 1.17rem  | the dialog sheet itself                                                |
| `rounded-full` | —        | counters, pills, scrollbar thumb                                       |

`#modal`'s own clip is a fixed `16px` so the sheet's `rounded-2xl` is never cut.

---

## 7. Dialog sizing and structure

```
AppDialog                     rounded-2xl border border-border bg-card shadow-2xl
                              flex flex-col overflow-hidden
                              max-h-[calc(100dvh-32px)] w-full max-w-<size>
├─ AppDialogHeader            px-6 py-5 sm:px-7 sm:py-6 · icon tile + title + subtitle
├─ AppDialogBody              border-t border-border · flex-1 min-h-0 · the ONLY scroller
└─ AppDialogFooter            border-t border-border bg-muted/50 px-6 py-4 sm:px-7
```

- **Height:** as tall as the content, capped at `calc(100dvh - 32px)`. The body shrinks
  (`flex-1 min-h-0`); header and footer are `shrink-0`. Never let the dialog itself scroll —
  the footer must stay reachable on a short window.
- **Width:** pick one of `AppDialog`'s sizes rather than a one-off `max-w-[…]`:
  `sm` 480px (prompts), `md` 640px (forms — matches the legacy `#modal` width),
  `lg` 820px (lists), `xl` 1040px (the Assistant, statistics).
- **Responsive:** side-by-side panels are `md:flex-row` + `md:basis-1/2`, stacked below;
  footer control blocks wrap below `sm` and their vertical separators hide.
- **Dismissal:** dialogs whose accidental dismissal would lose work open `sticky`
  (`openReactModal(node, { sticky: true })`) and offer an explicit "Abbrechen".

---

## 8. Buttons

Always the shadcn `Button` (`web/js/components/ui/button.tsx`); never a bare `<button>` with
hand-rolled padding.

| Intent              | Props                              | Notes                                                            |
| ------------------- | ---------------------------------- | ---------------------------------------------------------------- |
| Primary action      | `<Button>`                         | one per surface; `bg-primary-deep hover:bg-primary-deep/90`      |
| Secondary           | `variant="outline"`                | bordered, `bg-background`                                        |
| Tertiary / cancel   | `variant="ghost"`                  | "Abbrechen", "Zurück", back links                                |
| Destructive         | `variant="destructive"`            | tinted (`bg-destructive/10 text-destructive`), never filled red  |
| Icon-only           | `size="icon"` + `aria-label`       | `size-8 rounded-lg text-muted-foreground` in rows; `size-9` alone |

Heights (app wrapper in `web/js/components/ui/app-button.tsx`): `sm` = 32px,
`default` = 36px, `lg` = 40px, `icon` = 36px. Footer actions use `size="lg"`; in-row
actions use `sm`/`icon`. Icons inside buttons are `size-4`, gap `gap-2`.

Row-level icon buttons carry their intent in the hover, not the resting state:
`hover:bg-accent hover:text-foreground`, or `hover:bg-destructive/10 hover:text-destructive`,
or `hover:bg-primary/10 hover:text-primary`.

---

## 9. Form controls

| Control     | Implementation                                              | Size                                                     |
| ----------- | ----------------------------------------------------------- | -------------------------------------------------------- |
| Text input  | shadcn `Input`                                              | `h-10 rounded-lg` in panels; `h-8`/`h-9` inline          |
| Search      | `SearchField` (icon + `Input h-10 rounded-lg pl-9`)         | icon `size-4` at `left-3`                                |
| Checkbox    | shadcn `Checkbox`                                           | `size-4` default, `size-5 rounded-[6px]` in selection lists |
| Number      | `NumberInput` (− / centered mono input / +)                 | `size-8` steppers, `h-8 w-12` field; `compact` = `size-6` |
| Select      | `NativeSelect` — a real `<select>` wearing `Input`'s classes | `h-10 rounded-lg` (`sm`: `h-8`)                          |
| Date range  | `DateRangeField` → `Popover` + `react-day-picker` `Calendar` | presets + Übernehmen/Zurücksetzen footer                 |
| Slider      | native `range`, `accent-primary`                            | Settings only                                            |

**Why `NativeSelect` and not a shadcn listbox:** the app's selects carry `<optgroup>`s built
from live data and are driven in tests via `selectOptions`; swapping in a listbox would
change keyboard and mobile behaviour, which this refactor is explicitly not allowed to do.
The control therefore stays a native `<select>` and only borrows the visual treatment. It is
the single deliberate deviation from "use the shadcn primitive".

Labels sit **above** their control (`FormField`: `flex flex-col gap-1.5` + `FieldLabel`), not
beside it. The legacy `.formrow` label-on-the-left layout is retired inside `ui-scope`.

---

## 10. Section headers

`SectionHeading` — a `gap-2`/`gap-3` row of: the uppercase label, an optional `Badge`
count, an optional info tooltip, and optional right-aligned actions via `ml-auto`. It is
`shrink-0` and sits directly above its content with the panel's `gap-4` doing the spacing.
No underline, no background, no icon on the left.

---

## 11. Empty states

`EmptyState`: centered column, `gap-3`, `rounded-xl border border-dashed border-border`,
`py-12`, a `size-7 text-muted-foreground/60` Lucide icon (`Inbox` unless something more
specific reads better), and one sentence at `text-sm text-muted-foreground` capped to
`max-w-[26ch]`/`max-w-[30ch]`. No illustration, no call-to-action unless the empty state is
genuinely actionable.

Filtered-to-nothing and nothing-at-all are different sentences — keep both.

---

## 12. Lists and rows

Two shapes only.

**Selection row** (catalog, filter lists): `flex items-center gap-3 rounded-lg border
px-3 py-2.5 transition-colors`; unselected `border-transparent hover:bg-muted`, selected
`border-primary/45 bg-primary/[0.08]`. Wrap the whole row in a `<label>` so all of it is
clickable — do not hide an `sr-only` input (it breaks scroll anchoring inside a
`ScrollArea`). Title `text-sm font-medium` + `truncate`; subtitle `text-[11px]
text-muted-foreground` + `truncate` with the full text in `title`.

**Data card** (results, bookings, log entries): `rounded-xl border border-border bg-card
p-4 transition-colors hover:border-primary/40`, laid out `flex flex-wrap items-center
gap-x-6 gap-y-4` with the actions in a `shrink-0` column on the right. Lists of cards use
`flex flex-col gap-3`; lists of rows use `gap-1`.

Scrolling is always `ScrollArea` with the `-mr-3 … pr-3` gutter so the thumb sits outside
the content.

---

## 13. Icons

- **Lucide** (`lucide-react`) inside `ui-scope`: `size-4` in buttons and rows, `size-3.5`
  for info affordances, `size-5` for a field's leading icon, `size-6` in the header tile,
  `size-7` in empty states. Colour is `text-muted-foreground` unless the icon _is_ the
  meaning.
- **Tabler** via `<Icon name="…"/>` is the legacy `.ic` API used outside `ui-scope`. Inside
  the scope `.ic`'s sizing is reverted away, so pass Lucide icons directly instead.

---

## 14. Borders and separators

One hairline colour (`border-border`) at one width. Use shadcn `Separator` for a standalone
rule (it carries the right role), and a plain `border-t`/`border-b` where the border belongs
to a region (header, footer, panel edges). Vertical separators are `orientation="vertical"`
with an explicit height and hide below `sm`. Dashed borders mean "drop target" or "empty".

---

## 15. Hover / focus / active / disabled states

| State                | Treatment                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| Hover (row)          | `hover:bg-muted`                                                                                        |
| Hover (card)         | `hover:border-primary/40`                                                                               |
| Hover (icon button)  | `hover:bg-accent hover:text-foreground` (or the destructive/primary tint)                                |
| Focus                | `focus-visible:ring-3 focus-visible:ring-ring/50` (+ `focus-visible:border-ring` on inputs). Never remove the ring without replacing it. |
| Selected             | `border-primary/45 bg-primary/[0.08]`                                                                   |
| Active (pressed)     | shadcn `Button`'s `active:translate-y-px`                                                               |
| Disabled             | `disabled:opacity-50 disabled:pointer-events-none`                                                      |
| At-limit (soft)      | `aria-disabled` + `opacity-50`, still clickable so it can explain itself                                |
| Drag source          | `opacity-40`                                                                                            |
| Drop marker          | `h-0.5 rounded-full bg-primary` in the gap                                                              |

---

## 16. Responsive behaviour

- Breakpoints used: `sm` (640) for padding and wrapping, `md` (768) for two-column panels.
  Nothing else.
- Two-column panel layout collapses to stacked below `md`, with the divider flipping from
  `md:border-r` to `border-b`.
- Footers wrap below `sm`; their vertical separators disappear rather than shrink.
- Popovers cap themselves at `max-w-[calc(100vw-24px)]` and `max-h-[var(--available-height)]`.

---

## 17. Which shadcn / Base UI primitive to reach for

| Need               | Use                                | Do **not**                                          |
| ------------------ | ---------------------------------- | --------------------------------------------------- |
| Dialog shell       | `AppDialog` + parts                | hand-roll a `<div>` sheet                           |
| Button             | `components/ui/button.tsx`         | `<button className="btn">`                          |
| Text input         | `components/ui/input.tsx`          | bare `<input>`                                      |
| Checkbox           | `components/ui/checkbox.tsx`       | `<input type="checkbox">`                           |
| Separator          | `components/ui/separator.tsx`      | `<div className="border-t">` for standalone rules   |
| Counter / pill     | `components/ui/badge.tsx`          | a hand-rolled `<span className="tag">`              |
| Scrolling region   | `components/ui/scroll-area.tsx`    | `overflow-auto` with a native scrollbar             |
| Floating panel     | `components/ui/popover.tsx`        | absolutely-positioned `<div>` + outside-click code  |
| Hint on hover      | `components/ui/tooltip.tsx`        | `title=` for anything longer than a few words       |
| Empty region       | `EmptyState`                       | a bare `<p className="hint">`                       |
| Section label      | `SectionHeading`                   | `<h3>` with ad-hoc classes                          |
| Search box         | `SearchField`                      | `Input` + a hand-placed icon                        |
| Label + control    | `FormField` / `FieldLabel`         | `.formrow`                                          |
| KPI number         | `StatTile`                         | a hand-rolled stat `<div>`                          |

---

## 18. Patterns that must NOT be recreated by hand

- **The dialog frame.** Sizing, radius, scroll containment and the `#modal` overrides are
  one mechanism; a second one will drift.
- **Focus rings.** They come from the primitives. Do not restyle `outline`.
- **Popover/tooltip portalling.** Always through the shared `PopoverContent`/`TooltipContent`,
  which portal into `#modal` and re-apply `ui-scope`.
- **Colour.** No hex, no `hsl()`, no `--app-*` token inside `ui-scope`.
- **Spacing.** No `style={{ margin… }}`, no `mt-[7px]`. Use §5.
- **A second dark-mode mechanism.** Dark comes from `html[data-theme='dark']`, already
  handled by the scope.
- **Global CSS.** Nothing in this system may add an unlayered global rule; `app.css` keeps
  owning the un-migrated screens and the grid until they are retired.

---

## 19. Out of scope

The main booking grid (`web/js/ui/components/Grid*.tsx`, `web/js/ui/grid*.ts` and their
`app.css` rules) is a dense data workspace. It legitimately runs at a different density and
keeps its own styling. Toolbar chrome in `index.html` likewise stays on `app.css` until it
is migrated deliberately.

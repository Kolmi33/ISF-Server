/* The Assistant's primitive surface. Phase 15 moved every one of these into the shared
   `web/js/components/ui/` set — the Assistant now consumes exactly what the rest of the
   application does; this file is the (unchanged) import name its own modules use. */

export { Input } from '../../../components/ui/input.tsx';
export { Checkbox } from '../../../components/ui/checkbox.tsx';
export { Separator } from '../../../components/ui/separator.tsx';
export { Label } from '../../../components/ui/label.tsx';
export { Badge } from '../../../components/ui/badge.tsx';
export { Button } from '../../../components/ui/app-button.tsx';
export { ScrollArea } from '../../../components/ui/scroll-area.tsx';
export { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover.tsx';
export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../components/ui/tooltip.tsx';
export { Calendar } from './SuppliedCalendar.tsx';

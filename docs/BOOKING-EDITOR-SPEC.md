# Booking editor interaction specification

- Show month and year above contiguous date columns; retain weekday/day labels.
- Load every editable calendar day, including booked Saturdays and Sundays. Shade weekend columns through the header and body. Saving preserves explicitly selected weekends.
- Move a row or the whole group in calendar-day increments. Clamp at the visible axis instead of reverting to the original position. Measure pointer offsets against the actual cell rectangle; clean up on cancellation and unmount.
- Provide Fill and Remove modes. Drag across date headers to apply to whole columns; drag across device labels to apply to whole rows over the current group's date span. Blocked additions are skipped. Preserve at least one day per row; removing a device remains an explicit row-menu action.
- Distinguish colleague bookings with a red patterned cell and lock icon, maintenance with amber and a warning icon. Keep explanations in tooltips and show conflicts before saving.
- Existing backend weekend bridging remains authoritative: a Friday/Monday booking can recreate the intervening weekend. This editor does not redefine that application-wide rule.
- Save remains atomic with ownership, live conflict and stale-data checks.

// Vitest setup: pin the timezone to UTC so date helpers that read *local* calendar
// components (mondayOfDate, todayAsIsoDateString) are deterministic regardless of the
// host timezone. The dev container already runs in UTC; this makes tests reproducible
// anywhere.
process.env.TZ = 'UTC';

// React Testing Library's jest-dom matchers (toBeInTheDocument, toHaveTextContent, ...).
// Harmless to import for non-component tests — it only extends `expect`, no DOM required
// until a matcher is actually called.
import '@testing-library/jest-dom/vitest';

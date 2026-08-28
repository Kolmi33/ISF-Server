// Vitest setup: pin the timezone to UTC so date helpers that read *local* calendar
// components (mondayOf, todayStr) are deterministic regardless of the host timezone.
// The dev container already runs in UTC; this makes the tests reproducible anywhere.
process.env.TZ = 'UTC';

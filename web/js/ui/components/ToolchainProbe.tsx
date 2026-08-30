// Phase 7 slice B0 — proves the React toolchain (tsc's jsx transform, ESLint's react-hooks
// rules, Prettier, knip, and Vitest+jsdom+React-Testing-Library) all work together, before
// any real screen is mounted into the app. Not wired into index.html/app.ts.
//
// Delete this file once B1 lands a real component — it exists only to prove the pipeline.

export interface ToolchainProbeProps {
  /** Echoed back verbatim, so the test can assert a prop actually reached the DOM. */
  label: string;
}

export function ToolchainProbe({ label }: ToolchainProbeProps) {
  return <p data-testid="toolchain-probe">React works: {label}</p>;
}

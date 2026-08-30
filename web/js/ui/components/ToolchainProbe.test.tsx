// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ToolchainProbe } from './ToolchainProbe.tsx';

describe('ToolchainProbe', () => {
  it('renders the given label, proving tsx + jsdom + RTL all work together', () => {
    render(<ToolchainProbe label="Phase 7 B0" />);
    expect(screen.getByTestId('toolchain-probe')).toHaveTextContent('React works: Phase 7 B0');
  });
});

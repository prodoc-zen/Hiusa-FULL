import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import DrawnCheck from './DrawnCheck';

describe('DrawnCheck', () => {
  it('carries accessible text describing the success it draws', () => {
    render(<DrawnCheck label="Your vote is in" />);
    expect(screen.getByRole('img', { name: 'Your vote is in' })).toBeInTheDocument();
  });

  it('defaults to a generic success label', () => {
    render(<DrawnCheck />);
    expect(screen.getByRole('img', { name: 'Success' })).toBeInTheDocument();
  });

  it('draws the checkmark with the reduced-motion-aware animation hook', () => {
    render(<DrawnCheck />);
    const path = document.querySelector('path.drawn-check-path');
    expect(path).not.toBeNull();
    expect(path).toHaveAttribute('pathLength', '1');
  });
});

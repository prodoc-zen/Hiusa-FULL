import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Skeleton, { SkeletonTable } from './Skeleton';

describe('Skeleton', () => {
  it('draws a static block with no shimmer', () => {
    const { container } = render(<Skeleton className="h-3 w-10" />);
    expect(container.firstChild.className).not.toMatch(/shimmer|animate-/);
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('SkeletonTable is a header row plus the requested rows, each with one cell per column', () => {
    render(<SkeletonTable rows={3} columns={4} />);
    const table = screen.getByRole('status', { name: 'Loading table' });
    expect(table.children).toHaveLength(4);
    for (const row of Array.from(table.children)) {
      expect(row.children).toHaveLength(4);
    }
    expect(table.querySelectorAll('.skeleton-shimmer')).toHaveLength(0);
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import EmptyState from './EmptyState';

describe('EmptyState', () => {
  it('renders a Clear filters action for the filtered kind when onClearFilters is given', () => {
    const onClearFilters = vi.fn();
    render(<EmptyState kind="filtered" query="budget report" onClearFilters={onClearFilters} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it('prefers a custom action over the default clear filters button', () => {
    const onClearFilters = vi.fn();
    render(<EmptyState kind="filtered" onClearFilters={onClearFilters} action={<button type="button">Custom action</button>} />);
    expect(screen.getByRole('button', { name: 'Custom action' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('renders no action when the filtered kind has neither action nor onClearFilters', () => {
    render(<EmptyState kind="filtered" query="budget report" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

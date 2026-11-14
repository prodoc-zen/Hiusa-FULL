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

  it('treats none-match like the filtered kind and offers a Clear filters link', () => {
    const onClearFilters = vi.fn();
    render(<EmptyState kind="none-match" description="Nothing matches." onClearFilters={onClearFilters} />);
    expect(screen.getByText('No results')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it('is left aligned with a small title and no decorative shape', () => {
    const { container } = render(<EmptyState title="No applications to review." description="New ones appear here." action={<button type="button">Open list</button>} />);
    expect(container.firstChild.className).toMatch(/items-start/);
    expect(container.firstChild.className).not.toMatch(/text-center|py-14/);
    expect(screen.getByText('No applications to review.')).toHaveClass('text-sm', 'font-semibold');
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('draws no icon even when a caller passes one, so every empty state looks the same', () => {
    const Icon = (props) => <svg data-testid="icon" {...props} />;
    render(<EmptyState title="No files" icon={Icon} />);
    expect(screen.getByText('No files')).toBeInTheDocument();
    expect(screen.queryByTestId('icon')).toBeNull();
  });

  it('shows no button for the restricted kind', () => {
    render(<EmptyState kind="restricted" title="No access" action={<button type="button">Nope</button>} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

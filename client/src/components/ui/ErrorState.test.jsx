import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ErrorState from './ErrorState';

describe('ErrorState', () => {
  it('is left aligned with a title, one sentence and one retry button', () => {
    const onRetry = vi.fn();
    const { container } = render(<ErrorState description="The list could not be loaded." onRetry={onRetry} />);
    expect(container.firstChild.className).toMatch(/items-start/);
    expect(container.firstChild.className).not.toMatch(/text-center|py-12/);
    expect(screen.getByText('Something went wrong')).toHaveClass('text-sm', 'font-semibold');
    expect(container.querySelector('.rounded-full')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders the title as the page heading when it is the only content on the page', () => {
    const { rerender } = render(<ErrorState title="This link has expired" />);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    rerender(<ErrorState pageHeading title="This link has expired" />);
    expect(screen.getByRole('heading', { level: 1, name: 'This link has expired' })).toBeInTheDocument();
  });

  it('shows no button without onRetry and honours a custom retry label', () => {
    const { rerender } = render(<ErrorState title="Could not load" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(<ErrorState title="Could not load" onRetry={() => {}} retryLabel="Reload list" />);
    expect(screen.getByRole('button', { name: 'Reload list' })).toBeInTheDocument();
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PaginationControls from './PaginationControls';

describe('PaginationControls', () => {
  it('hides when all records fit on one page', () => {
    const { container } = render(
      <PaginationControls currentPage={1} totalItems={10} onPageChange={() => {}} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('reports the visible range and changes pages', () => {
    const onPageChange = vi.fn();
    render(
      <PaginationControls
        currentPage={2}
        totalItems={25}
        pageSize={10}
        label="members"
        onPageChange={onPageChange}
      />,
    );

    expect(screen.getByText('11-20')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText((_, element) => (
      element.tagName === 'P' && element.textContent.includes('members')
    ))).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Previous page of members' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next page of members' }));

    expect(onPageChange).toHaveBeenNthCalledWith(1, 1);
    expect(onPageChange).toHaveBeenNthCalledWith(2, 3);
  });
});

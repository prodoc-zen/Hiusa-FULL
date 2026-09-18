import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TableFilterBar from './TableFilterBar';

describe('TableFilterBar', () => {
  it('keeps secondary filters collapsed until requested', () => {
    render(<TableFilterBar searchValue="" onSearchChange={() => {}}><select aria-label="Role"><option>All roles</option></select></TableFilterBar>);

    expect(screen.queryByLabelText('Role')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /filters/i }));
    expect(screen.getByLabelText('Role')).toBeInTheDocument();
  });

  it('clears search and all active filters from explicit controls', () => {
    const onSearchChange = vi.fn();
    const onClear = vi.fn();
    render(<TableFilterBar searchValue="student" onSearchChange={onSearchChange} activeFilters={['Role: Student']} onClear={onClear}><div>Options</div></TableFilterBar>);

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onSearchChange).toHaveBeenCalledWith('');
    expect(onClear).toHaveBeenCalledOnce();
  });
});

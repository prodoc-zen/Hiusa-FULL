import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CommandPalette from './CommandPalette';

function PaletteHarness({ onClose }) {
  const location = useLocation();
  return <>
    <CommandPalette open onClose={onClose} role="STUDENT" />
    <output data-testid="path">{location.pathname}</output>
  </>;
}

describe('CommandPalette', () => {
  beforeEach(() => localStorage.clear());

  it('shows a viewport overlay and navigates to a role-available page with Enter', () => {
    const onClose = vi.fn();
    render(<MemoryRouter initialEntries={['/dashboard/student']}><PaletteHarness onClose={onClose} /></MemoryRouter>);

    const dialog = screen.getByRole('dialog', { name: 'Go to page' });
    expect(dialog).toHaveClass('fixed', 'inset-0');
    const search = screen.getByRole('combobox', { name: 'Search pages' });
    fireEvent.change(search, { target: { value: 'Announcements Feed' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.queryByText('Manage Users')).not.toBeInTheDocument();
    fireEvent.keyDown(search, { key: 'Enter' });

    expect(screen.getByTestId('path')).toHaveTextContent('/dashboard/announcements/view-announcements');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes from the backdrop and Escape', () => {
    const onClose = vi.fn();
    render(<MemoryRouter><PaletteHarness onClose={onClose} /></MemoryRouter>);
    fireEvent.mouseDown(screen.getByRole('dialog', { name: 'Go to page' }));
    expect(onClose).toHaveBeenCalledOnce();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

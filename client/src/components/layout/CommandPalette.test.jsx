import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CommandPalette from './CommandPalette';

function PaletteHarness({ onClose, role = 'STUDENT' }) {
  const location = useLocation();
  return <>
    <CommandPalette open onClose={onClose} role={role} />
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

  it.each([
    ['ADMIN', 'Digital Ledger', 'Ledger', '/dashboard/finance/financial-ledger'],
    ['ADMIN', 'Manage Users', 'People', '/dashboard/admin/users'],
    ['ADMIN', 'Validate Tokens', 'Claim desk', '/dashboard/merchandise/claim-tokens'],
    ['ADMIN', 'Transaction History', 'Financial reports', '/dashboard/finance/transaction-history'],
    ['SBO_OFFICER', 'Participant Biometrics', 'Members and fingerprints', '/dashboard/admin/users'],
    ['SUPER_ADMIN', 'Academic Years', 'Academic years', '/dashboard/super-admin/academic-years'],
  ])('finds %s page by its old name %s and shows the new label %s', (role, oldName, newLabel, path) => {
    localStorage.setItem('hiusa_recent_pages', '[]');
    render(<MemoryRouter initialEntries={['/dashboard']}><PaletteHarness onClose={() => {}} role={role} /></MemoryRouter>);
    fireEvent.change(screen.getByRole('combobox', { name: 'Search pages' }), { target: { value: oldName } });

    expect(screen.getAllByRole('option')[0]).toHaveTextContent(newLabel);
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search pages' }), { key: 'Enter' });
    expect(screen.getByTestId('path')).toHaveTextContent(path);
  });

  it('finds the new label and the pages that left the Admin menu', () => {
    render(<MemoryRouter initialEntries={['/dashboard']}><PaletteHarness onClose={() => {}} role="ADMIN" /></MemoryRouter>);
    const search = screen.getByRole('combobox', { name: 'Search pages' });

    fireEvent.change(search, { target: { value: 'Claim desk' } });
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('Claim desk');

    fireEvent.change(search, { target: { value: 'Create Task' } });
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('New task');
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(screen.getByTestId('path')).toHaveTextContent('/dashboard/tasks/task-board');
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

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AccreditationTab from './AccreditationTab';

describe('Accreditation past-deadline explanation', () => {
  it('explains that both missing and submitted files count until approved and lets SAO inspect their deadlines', () => {
    render(<AccreditationTab overview={{ loading: false, error: '', academicYear: '2026-2027', organizations: [{
      organization_id: 7, organization_name: 'Computing Club', accreditation_status: 'incomplete', requirements: [
        { requirement_type_id: 1, requirement_name: 'Constitution', status: 'not_submitted', deadline_at: '2020-01-01' },
        { requirement_type_id: 2, requirement_name: 'Member list', status: 'submitted', deadline_at: '2020-01-01' },
        { requirement_type_id: 3, requirement_name: 'Annual report', status: 'approved', deadline_at: '2020-01-01' },
      ],
    }] }} />);
    expect(screen.getByText(/This includes files awaiting SAO review/)).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Past deadline' })).toBeInTheDocument();
    const row = within(table).getByText('Computing Club').closest('tr');
    expect(within(row).getByText('2', { exact: true })).toHaveClass('text-danger-strong');
    fireEvent.click(within(row).getByRole('button', { name: 'Actions for Computing Club' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'View requirements' }));
    const dialog = screen.getByRole('dialog', { name: 'Computing Club' });
    expect(within(dialog).getAllByText('Constitution').length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText('Member list').length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText('Annual report').length).toBeGreaterThan(0);
  });
});

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AccreditationTab from './AccreditationTab';

describe('Accreditation requirements', () => {
  it('draws a fully met requirements bar as progress, not as a failure', () => {
    render(<AccreditationTab overview={{ loading: false, error: '', academicYear: '2026-2027', organizations: [{
      organization_id: 8, organization_name: 'Nursing Student Council', accreditation_status: 'accredited', requirements: [
        { requirement_type_id: 1, requirement_name: 'Constitution', status: 'approved', deadline_at: '2026-01-01' },
        { requirement_type_id: 2, requirement_name: 'Member list', status: 'approved', deadline_at: '2026-01-01' },
      ],
    }] }} />);
    const bar = within(screen.getByRole('table')).getAllByRole('progressbar').find((meter) => !meter.hasAttribute('aria-label'));
    expect(bar).toHaveAttribute('aria-valuenow', '2');
    expect(bar.firstChild).not.toHaveClass('bg-danger');
  });

  it('says no organization matches a search instead of saying none exist yet', () => {
    render(<AccreditationTab overview={{ loading: false, error: '', academicYear: '2026-2027', organizations: [{
      organization_id: 7, organization_name: 'Computing Club', accreditation_status: 'incomplete', requirements: [],
    }] }} />);
    fireEvent.change(screen.getByLabelText('Search organizations'), { target: { value: 'zzz' } });
    expect(screen.getByText('No results for "zzz"')).toBeInTheDocument();
    expect(screen.queryByText('No organizations to track yet')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getAllByText('Computing Club').length).toBeGreaterThan(0);
  });

  it('omits the past-deadline column while retaining requirement details', () => {
    render(<AccreditationTab overview={{ loading: false, error: '', academicYear: '2026-2027', organizations: [{
      organization_id: 7, organization_name: 'Computing Club', accreditation_status: 'incomplete', requirements: [
        { requirement_type_id: 1, requirement_name: 'Constitution', status: 'not_submitted', deadline_at: '2020-01-01' },
        { requirement_type_id: 2, requirement_name: 'Member list', status: 'submitted', deadline_at: '2020-01-01' },
        { requirement_type_id: 3, requirement_name: 'Annual report', status: 'approved', deadline_at: '2020-01-01' },
      ],
    }] }} />);
    const table = screen.getByRole('table');
    expect(within(table).queryByRole('columnheader', { name: 'Past deadline' })).not.toBeInTheDocument();
    const row = within(table).getByText('Computing Club').closest('tr');
    fireEvent.click(within(row).getByRole('button', { name: 'Actions for Computing Club' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'View requirements' }));
    const dialog = screen.getByRole('dialog', { name: 'Computing Club' });
    expect(within(dialog).getAllByText('Constitution').length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText('Member list').length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText('Annual report').length).toBeGreaterThan(0);
  });
});

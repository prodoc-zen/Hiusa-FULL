import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import OrganizationsHealthTable from './OrganizationsHealthTable';

const organizations = [
  {
    id: 3,
    name: 'Computer Science Society',
    abbreviation: 'CSS',
    accreditation_status: 'pending_review',
    budget_utilization_percent: 63.7,
    financial_reports_pending: 1,
    open_elections: 1,
    last_activity_at: '2026-09-20T08:00:00+00:00',
  },
];

describe('OrganizationsHealthTable', () => {
  it('shows the first-run empty state when there are no organizations', () => {
    render(<MemoryRouter><OrganizationsHealthTable organizations={[]} /></MemoryRouter>);
    expect(screen.getByText('No organizations yet')).toBeInTheDocument();
  });

  it('renders each organization with its accreditation badge and pending counts', () => {
    render(<MemoryRouter><OrganizationsHealthTable organizations={organizations} /></MemoryRouter>);

    expect(screen.getAllByText('Computer Science Society')).toHaveLength(2);
    expect(screen.getAllByText('Pending Review')).toHaveLength(2);
  });

  it('surfaces a retryable error state', () => {
    const onRetry = () => {};
    render(<MemoryRouter><OrganizationsHealthTable organizations={[]} loading={false} error="Unable to load organizations." onRetry={onRetry} /></MemoryRouter>);
    expect(screen.getByText('Unable to load organizations.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import ActivityFeed from './ActivityFeed';

describe('ActivityFeed', () => {
  it('shows an empty state when there is no recent activity', () => {
    render(<ActivityFeed items={[]} />);
    expect(screen.getByText('No recent activity')).toBeInTheDocument();
  });

  it('renders the actor, action, and subject for each entry', () => {
    render(
      <MemoryRouter>
        <ActivityFeed items={[{ id: 'audit-101', actor: 'Juan Dela Cruz', action: 'Created', subject: 'SAO registered a student organization.', at: '2026-09-20T08:00:00+00:00', href: null }]} />
      </MemoryRouter>
    );

    expect(screen.getByText('Juan Dela Cruz')).toBeInTheDocument();
    expect(screen.getByText('SAO registered a student organization.')).toBeInTheDocument();
  });

  it('makes the row one link with an Open label', () => {
    render(
      <MemoryRouter>
        <ActivityFeed items={[{ id: 'audit-7', actor: 'Ana Reyes', action: 'Approved', subject: 'Budget for Foundation Week', at: '2026-09-20T08:00:00+00:00', href: '/dashboard/finance/budget-allocation' }]} />
      </MemoryRouter>
    );

    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/dashboard/finance/budget-allocation');
    expect(screen.getByRole('link')).toHaveTextContent('Open');
  });

  it('builds the deep link from entity_type and entity_id when the server gave no href', () => {
    render(
      <MemoryRouter>
        <ActivityFeed role="ADMIN" items={[{ id: 'audit-8', actor: 'Ana Reyes', action: 'Submitted', subject: 'Budget for Foundation Week', at: '2026-09-20T08:00:00+00:00', href: null, entity_type: 'budget', entity_id: 5 }]} />
      </MemoryRouter>
    );

    expect(screen.getByRole('link')).toHaveAttribute('href', '/dashboard/finance/budget-allocation?record=5');
  });
});

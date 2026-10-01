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
});

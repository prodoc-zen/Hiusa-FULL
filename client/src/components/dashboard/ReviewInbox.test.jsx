import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import ReviewInbox from './ReviewInbox';

describe('ReviewInbox', () => {
  it('shows a count per area, links the ones with a destination and marks a capped count', () => {
    render(
      <MemoryRouter>
        <ReviewInbox areas={[
          { key: 'registrations', label: 'Registrations awaiting review', count: 3, truncated: false, href: '/dashboard/super-admin/organizations?status=pending' },
          { key: 'budgets', label: 'Budgets to approve', count: 8, truncated: true, href: null },
        ]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: /3\s*Registrations awaiting review/ })).toHaveAttribute('href', '/dashboard/super-admin/organizations?status=pending');
    expect(screen.getByText('8+')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('says nothing is waiting when no area has work', () => {
    render(<MemoryRouter><ReviewInbox areas={[]} /></MemoryRouter>);
    expect(screen.getByText('No reviews are waiting')).toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import AttentionList from './AttentionList';

describe('AttentionList', () => {
  it('shows a calm caught-up state when there is nothing to act on', () => {
    render(<AttentionList items={[]} />);
    expect(screen.getByText("You're all caught up")).toBeInTheDocument();
  });

  it('renders a deep link when href is present and plain text when it is null', () => {
    render(
      <MemoryRouter>
        <AttentionList
          items={[
            { id: 'a', type: 'approval', severity: 'high', title: 'Foundation Week', detail: 'Requested 2 days ago', due_at: null, href: '/dashboard/approvals' },
            { id: 'b', type: 'grievances_urgent', severity: 'high', title: 'Urgent grievances unresolved', detail: '2 remain unresolved', due_at: null, href: null },
          ]}
        />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: /Foundation Week/i })).toHaveAttribute('href', '/dashboard/approvals');
    expect(screen.getByText('Urgent grievances unresolved')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Urgent grievances unresolved/i })).not.toBeInTheDocument();
  });

  it('shows a relative due time when due_at is set', () => {
    const soon = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    render(
      <MemoryRouter>
        <AttentionList items={[{ id: 'c', type: 'election_closing', severity: 'medium', title: 'Election closing soon', detail: 'Closes soon', due_at: soon, href: null }]} />
      </MemoryRouter>
    );
    expect(screen.getByText(/in 3 hours/i)).toBeInTheDocument();
  });
});

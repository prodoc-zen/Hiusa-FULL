import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import AttentionList from './AttentionList';

describe('AttentionList', () => {
  it('shows a calm caught-up state when there is nothing to act on', () => {
    render(<AttentionList items={[]} />);
    expect(screen.getByText('Nothing is waiting on you')).toBeInTheDocument();
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

  it('makes the whole row one link with an Open label and no second link inside it', () => {
    render(
      <MemoryRouter>
        <AttentionList items={[{ id: 'approval-4', type: 'approval', severity: 'high', title: 'Foundation Week', detail: 'Requested 2 days ago', due_at: null, href: '/dashboard/super-admin/compliance?tab=events' }]} />
      </MemoryRouter>
    );

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/dashboard/super-admin/compliance?tab=events');
    expect(links[0]).toHaveTextContent('Open');
    expect(links[0]).toHaveTextContent('Foundation Week');
  });

  it('builds the deep link from entity_type and entity_id when the server gave no href', () => {
    render(
      <MemoryRouter>
        <AttentionList role="ADMIN" items={[{ id: 'e', type: 'event', severity: 'low', title: 'Foundation Week', detail: 'Stale', due_at: null, href: null, entity_type: 'event', entity_id: 12 }]} />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: /Foundation Week/i })).toHaveAttribute('href', '/dashboard/events/manage-events?record=12');
  });

  it('keeps the server href even when an entity is present', () => {
    render(
      <MemoryRouter>
        <AttentionList role="ADMIN" items={[{ id: 'e', severity: 'low', title: 'Budget', detail: 'Near limit', href: '/dashboard/finance/budget-allocation?record=3', entity_type: 'budget', entity_id: 9 }]} />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: /Budget/i })).toHaveAttribute('href', '/dashboard/finance/budget-allocation?record=3');
  });

  it('shows no link and no Open label when the role cannot open the entity', () => {
    render(
      <MemoryRouter>
        <AttentionList role="STUDENT" items={[{ id: 'o', severity: 'low', title: 'Merchandise payment', detail: 'Waiting', href: null, entity_type: 'budget', entity_id: 2 }]} />
      </MemoryRouter>
    );

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText('Open')).not.toBeInTheDocument();
  });

  it('sends the Department Head to the one approvals route and keeps the record', () => {
    render(
      <MemoryRouter>
        <AttentionList
          role="DEPARTMENT_HEAD"
          items={[
            { id: 'approval-1', severity: 'low', title: 'Foundation Week', detail: 'Event requested', href: '/dashboard/approvals' },
            { id: 'approval-2', severity: 'low', title: 'Welcome Night', detail: 'Event requested', href: null, entity_type: 'approval_request', entity_id: 2 },
          ]}
        />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: /Foundation Week/i })).toHaveAttribute('href', '/dashboard/department-head/approvals');
    expect(screen.getByRole('link', { name: /Welcome Night/i })).toHaveAttribute('href', '/dashboard/department-head/approvals?record=2');
  });

  it('names who the item is waiting on when the server says', () => {
    render(
      <MemoryRouter>
        <AttentionList role="ADMIN" items={[{ id: 'w', severity: 'low', title: 'Foundation Week', detail: 'Event proposal', href: '/dashboard/events/manage-events?record=1', waiting_on: 'DEPARTMENT_HEAD' }]} />
      </MemoryRouter>
    );

    expect(screen.getByText('Waiting on Department Head')).toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import AgendaList from './AgendaList';

describe('AgendaList', () => {
  it('shows an empty state naming what will appear here', () => {
    render(<AgendaList items={[]} />);
    expect(screen.getByText('Nothing on the calendar yet')).toBeInTheDocument();
  });

  it('renders upcoming items as deep links with location', () => {
    render(
      <MemoryRouter>
        <AgendaList items={[{ id: 'event-9', title: 'General Assembly', starts_at: '2026-10-01T09:00:00+00:00', location: 'Gym', href: '/dashboard/events/manage-events' }]} />
      </MemoryRouter>
    );

    const link = screen.getByRole('link', { name: /General Assembly/i });
    expect(link).toHaveAttribute('href', '/dashboard/events/manage-events');
    expect(link).toHaveTextContent('Gym');
  });

  it('makes the row one link with an Open label', () => {
    render(
      <MemoryRouter>
        <AgendaList items={[{ id: 'event-9', title: 'General Assembly', starts_at: '2026-10-01T09:00:00+00:00', href: '/dashboard/events/activity-calendar' }]} />
      </MemoryRouter>
    );

    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link')).toHaveTextContent('Open');
  });

  it('builds the record link for an entity without an href and shows plain text when the role has no page', () => {
    render(
      <MemoryRouter>
        <AgendaList
          role="STUDENT"
          items={[
            { id: 'event-9', title: 'General Assembly', starts_at: '2026-10-01T09:00:00+00:00', href: null, entity_type: 'event', entity_id: 9 },
            { id: 'task-1', title: 'Setup crew', starts_at: '2026-10-02T09:00:00+00:00', href: null, entity_type: 'task', entity_id: 1 },
          ]}
        />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: /General Assembly/i })).toHaveAttribute('href', '/dashboard/events/activity-calendar?record=9');
    expect(screen.queryByRole('link', { name: /Setup crew/i })).not.toBeInTheDocument();
    expect(screen.getByText(/setup crew/i)).toBeInTheDocument();
  });
});

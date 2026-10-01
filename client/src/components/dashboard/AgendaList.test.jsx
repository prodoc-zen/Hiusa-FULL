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
});

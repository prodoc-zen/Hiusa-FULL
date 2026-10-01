import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import BriefingHeader from './BriefingHeader';

const user = {
  first_name: 'Maria',
  role: 'ADMIN',
  organization: { id: 3, name: 'Computer Science Society', abbreviation: 'CSS', logo_url: null },
};

describe('BriefingHeader', () => {
  beforeEach(() => localStorage.clear());

  it('greets the user by first name, role, organization, and the headline sentence', () => {
    render(<MemoryRouter><BriefingHeader user={user} summary={{ attention_count: 3, headline: 'Two approvals and one closing election need you today.' }} /></MemoryRouter>);

    expect(screen.getByRole('heading', { level: 1, name: /Good (morning|afternoon|evening), Maria/ })).toBeInTheDocument();
    expect(screen.getByText(/Admin/)).toBeInTheDocument();
    expect(screen.getByText(/Computer Science Society/)).toBeInTheDocument();
    expect(screen.getByText('Two approvals and one closing election need you today.')).toBeInTheDocument();
  });

  it('renders one or two primary actions as links', () => {
    render(
      <MemoryRouter>
        <BriefingHeader
          user={user}
          summary={{ attention_count: 0, headline: "You're all caught up." }}
          actions={[{ label: 'Create Announcement', to: '/dashboard/announcements/create-announcement' }]}
        />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: 'Create Announcement' })).toHaveAttribute('href', '/dashboard/announcements/create-announcement');
  });

  it('falls back to a university-wide scope label when there is no organization', () => {
    render(<MemoryRouter><BriefingHeader user={{ ...user, role: 'SUPER_ADMIN', organization: null }} summary={{ attention_count: 0, headline: "You're all caught up." }} /></MemoryRouter>);
    expect(screen.getByText(/University-wide/)).toBeInTheDocument();
  });
});

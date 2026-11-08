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

  it('shows the headline sentence and no greeting, date or role line, because the page title is the welcome', () => {
    render(<MemoryRouter><BriefingHeader user={user} summary={{ attention_count: 3, headline: 'Two approvals and one closing election need you today.' }} /></MemoryRouter>);

    expect(screen.getByText('Two approvals and one closing election need you today.')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByText(/Good (morning|afternoon|evening)/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Organization Admin/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Computer Science Society/)).not.toBeInTheDocument();
  });

  it('renders actions as links, the first one filled and the rest secondary', () => {
    render(
      <MemoryRouter>
        <BriefingHeader
          user={user}
          summary={{ attention_count: 0, headline: 'Nothing needs you today.' }}
          actions={[
            { label: 'Create announcement', to: '/dashboard/announcements/create-announcement' },
            { label: 'Open approvals', to: '/dashboard/approvals' },
          ]}
        />
      </MemoryRouter>
    );

    const first = screen.getByRole('link', { name: 'Create announcement' });
    expect(first).toHaveAttribute('href', '/dashboard/announcements/create-announcement');
    expect(first).toHaveClass('bg-brand-700');
    expect(screen.getByRole('link', { name: 'Open approvals' })).not.toHaveClass('bg-brand-700');
  });

  it('leaves the SAO without a headline, since the review inbox says it', () => {
    render(<MemoryRouter><BriefingHeader user={{ ...user, role: 'SUPER_ADMIN', organization: null }} summary={{ attention_count: 0, headline: 'server headline' }} actions={[{ label: 'Review applications', to: '/x' }]} /></MemoryRouter>);

    expect(screen.queryByText('server headline')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review applications' })).toBeInTheDocument();
  });

  it('renders nothing when there is no headline and no action', () => {
    const { container } = render(<MemoryRouter><BriefingHeader user={{ ...user, role: 'SUPER_ADMIN' }} summary={{ attention_count: 0, headline: 'x' }} /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});

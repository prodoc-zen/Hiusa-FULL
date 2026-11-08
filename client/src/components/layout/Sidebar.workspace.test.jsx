import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Sidebar from './Sidebar';
import { SUB_ACCOUNT_KEY } from '../../utils/subAccountStore';

vi.mock('../../services/authService', () => ({ logout: vi.fn() }));

function Where() {
  return <output data-testid="where">{useLocation().pathname}{useLocation().search}</output>;
}

function renderSidebar(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar isOpen={false} onClose={() => {}} desktopCollapsed={false} onToggleDesktop={() => {}} />
      <Where />
    </MemoryRouter>,
  );
}

describe('Sidebar inside an organization space', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    localStorage.setItem('user', JSON.stringify({ role: 'DEPARTMENT_HEAD', first_name: 'Dana', last_name: 'Cruz' }));
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
  });

  it('keeps the college menu while no space is open', () => {
    renderSidebar('/dashboard/department-head');

    expect(screen.getByRole('link', { name: 'Organization applications' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back to my college' })).not.toBeInTheDocument();
  });

  it('switches to the organization menu with its own five pages', () => {
    sessionStorage.setItem(SUB_ACCOUNT_KEY, JSON.stringify({ id: 12, name: 'Computing Society' }));
    renderSidebar('/dashboard/department-head/org/12?tab=finance');

    expect(screen.getByText('Computing Society')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/dashboard/department-head/org/12');
    expect(screen.getByRole('link', { name: 'People and access' })).toHaveAttribute('href', '/dashboard/department-head/org/12?tab=people');
    expect(screen.getByRole('link', { name: 'Events' })).toHaveAttribute('href', '/dashboard/department-head/org/12?tab=events');
    expect(screen.getByRole('link', { name: 'Finance' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Documents' })).toHaveAttribute('href', '/dashboard/department-head/org/12?tab=documents');
    expect(screen.queryByRole('link', { name: 'Organization applications' })).not.toBeInTheDocument();
  });

  it('marks Overview current when no tab is chosen', () => {
    sessionStorage.setItem(SUB_ACCOUNT_KEY, JSON.stringify({ id: 12, name: 'Computing Society' }));
    renderSidebar('/dashboard/department-head/org/12');

    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Finance' })).not.toHaveAttribute('aria-current');
  });

  it('goes back to the college and closes the space', () => {
    sessionStorage.setItem(SUB_ACCOUNT_KEY, JSON.stringify({ id: 12, name: 'Computing Society' }));
    renderSidebar('/dashboard/department-head/org/12');

    fireEvent.click(screen.getByRole('button', { name: 'Back to my college' }));

    expect(screen.getByTestId('where')).toHaveTextContent('/dashboard/department-head');
    expect(sessionStorage.getItem(SUB_ACCOUNT_KEY)).toBeNull();
    expect(screen.getByRole('link', { name: 'Organization applications' })).toBeInTheDocument();
  });
});

describe('Sidebar for an officer with chosen modules', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  });

  afterEach(() => {
    localStorage.clear();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
  });

  it('hides the pages of modules the officer was not given', () => {
    localStorage.setItem('user', JSON.stringify({ role: 'SBO_OFFICER', first_name: 'Olive', last_name: 'Officer', modules: ['events', 'announcements'] }));
    renderSidebar('/dashboard/officer');

    expect(screen.getByRole('button', { name: 'Events and tasks' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Updates' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Finance/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Voting' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Store' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Members and fingerprints' })).not.toBeInTheDocument();
  });

  it('shows everything when the profile has no module list', () => {
    localStorage.setItem('user', JSON.stringify({ role: 'SBO_OFFICER', first_name: 'Olive', last_name: 'Officer', modules: null }));
    renderSidebar('/dashboard/officer');

    expect(screen.getByRole('button', { name: /Finance/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Voting' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Members and fingerprints' })).toBeInTheDocument();
  });

  it('never narrows an org head, whatever the list says', () => {
    localStorage.setItem('user', JSON.stringify({ role: 'ADMIN', first_name: 'Ana', last_name: 'Head', modules: ['events'] }));
    renderSidebar('/dashboard/admin');

    expect(screen.getByRole('button', { name: 'Finance' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Voting' })).toBeInTheDocument();
  });
});

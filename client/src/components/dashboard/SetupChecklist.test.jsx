import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import SetupChecklist from './SetupChecklist';

const setup = {
  completed: 1,
  total: 3,
  steps: [
    { key: 'positions', label: 'Set up your officer positions', detail: 'Positions decide task delegation.', done: true, href: null },
    { key: 'members', label: 'Add your members', detail: 'Import a roster from a CSV file.', done: false, href: '/dashboard/admin/users' },
    { key: 'fingerprint', label: 'Enroll your fingerprint', detail: 'Visit your SBO officers once.', done: false, href: null },
  ],
};

const renderChecklist = (props = {}) => render(<MemoryRouter><SetupChecklist setup={setup} userKey="900001.ADMIN.1" {...props} /></MemoryRouter>);

describe('SetupChecklist', () => {
  beforeEach(() => localStorage.clear());

  it('shows progress, links open steps, and marks finished ones for screen readers', () => {
    renderChecklist();

    expect(screen.getByText('1 of 3 done')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Progress' })).toHaveAttribute('aria-valuenow', '1');
    expect(screen.getByRole('link', { name: /Add your members/ })).toHaveAttribute('href', '/dashboard/admin/users');
    expect(screen.queryByRole('link', { name: /Enroll your fingerprint/ })).not.toBeInTheDocument();
    expect(screen.getByText('(done)')).toBeInTheDocument();
    expect(screen.queryByText('Positions decide task delegation.')).not.toBeInTheDocument();
  });

  it('stays hidden for this person once hidden', () => {
    const { unmount } = renderChecklist();
    fireEvent.click(screen.getByRole('button', { name: 'Hide checklist' }));
    expect(screen.queryByText('Getting started')).not.toBeInTheDocument();
    unmount();

    renderChecklist();
    expect(screen.queryByText('Getting started')).not.toBeInTheDocument();
    renderChecklist({ userKey: '2100142.STUDENT.1' });
    expect(screen.getByText('Getting started')).toBeInTheDocument();
  });

  it('disappears when every step is done or the role has none', () => {
    const { container, rerender } = renderChecklist({ setup: { ...setup, completed: 3 } });
    expect(container).toBeEmptyDOMElement();
    rerender(<MemoryRouter><SetupChecklist setup={null} userKey="x" /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});

import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import SetupChecklist from './SetupChecklist';

const setup = {
  completed: 2,
  total: 6,
  steps: [
    { key: 'a', label: 'Done one', detail: 'Done one detail.', done: true, href: null },
    { key: 'b', label: 'Add your members', detail: 'Import a roster from a CSV file.', done: false, href: '/dashboard/admin/users', action: 'Add members' },
    { key: 'c', label: 'Wait for the semester', detail: 'Hidden detail.', done: false, href: null, blocked: true, note: 'Waiting for the SAO to open the semester' },
    { key: 'd', label: 'Enroll your fingerprint', detail: 'Visit your SBO officers once.', done: false, href: null, inPerson: true },
    { key: 'e', label: 'Fourth open step', detail: 'Fourth detail.', done: false, href: '/four' },
    { key: 'f', label: 'Done two', detail: 'Done two detail.', done: true, href: null },
  ],
};

const renderChecklist = (props = {}) => render(<MemoryRouter><SetupChecklist setup={setup} {...props} /></MemoryRouter>);
const rowLabels = () => screen.getAllByRole('listitem').map((row) => row.querySelector('p, span').textContent.replace(' (done)', ''));

describe('SetupChecklist', () => {
  it('shows progress and only the next three open steps, finished ones collapsed', () => {
    renderChecklist();

    expect(screen.getByText('2 of 6 done')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Progress' })).toHaveAttribute('aria-valuenow', '2');
    expect(rowLabels()).toEqual(['Add your members', 'Wait for the semester', 'Enroll your fingerprint']);
    expect(screen.queryByText('Done one')).not.toBeInTheDocument();
    expect(screen.queryByText('Fourth open step')).not.toBeInTheDocument();
  });

  it('gives every open step a real link or button, and a blocked step its note and nothing to press', () => {
    renderChecklist();
    const [members, blocked, fingerprint] = screen.getAllByRole('listitem');

    expect(within(members).getByRole('link', { name: 'Add members' })).toHaveAttribute('href', '/dashboard/admin/users');
    expect(within(blocked).getByText('Waiting for the SAO to open the semester')).toBeInTheDocument();
    expect(within(blocked).getByText('Blocked.')).toHaveClass('sr-only');
    expect(within(blocked).queryByRole('link')).not.toBeInTheDocument();
    expect(within(blocked).queryByRole('button')).not.toBeInTheDocument();
    expect(within(blocked).queryByText('Hidden detail.')).not.toBeInTheDocument();
    expect(within(fingerprint).getByRole('button', { name: 'Where to go' })).toBeInTheDocument();
  });

  it('falls back to a plain Open label when a step brings none', () => {
    renderChecklist({ setup: { completed: 0, total: 1, steps: [{ key: 'x', label: 'Plain', detail: 'd', done: false, href: '/x' }] } });
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/x');
  });

  it('reveals the in-person explanation on demand', () => {
    renderChecklist();
    const where = screen.getByRole('button', { name: 'Where to go' });
    expect(where).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(where);
    expect(where).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(where.getAttribute('aria-controls'))).toHaveTextContent('done in person');
  });

  it('shows every step, finished ones marked for screen readers, behind Show all', () => {
    renderChecklist();
    fireEvent.click(screen.getByRole('button', { name: 'Show all 6 steps' }));

    expect(rowLabels()).toEqual(['Done one', 'Add your members', 'Wait for the semester', 'Enroll your fingerprint', 'Fourth open step', 'Done two']);
    expect(screen.getAllByText('(done)')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Show fewer' })).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(rowLabels()).toHaveLength(3);
  });

  it('offers no Show all when everything already fits', () => {
    renderChecklist({ setup: { completed: 0, total: 2, steps: setup.steps.slice(1, 2).concat(setup.steps.slice(4, 5)) } });
    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument();
  });

  it('makes only the first actionable step the filled button, unless the page already has one', () => {
    const { unmount } = renderChecklist();
    expect(screen.getByRole('link', { name: 'Add members' })).toHaveClass('bg-brand-700');
    expect(screen.getByRole('button', { name: 'Where to go' })).not.toHaveClass('bg-brand-700');
    unmount();

    renderChecklist({ primaryFirst: false });
    expect(screen.getByRole('link', { name: 'Add members' })).not.toHaveClass('bg-brand-700');
  });

  it('uses the given title and description and reports a hide request', () => {
    const onHide = vi.fn();
    renderChecklist({ title: 'Next for you', description: 'Set up HIUSA for Robotics Club.', onHide });
    expect(screen.getByRole('heading', { name: 'Next for you' })).toBeInTheDocument();
    expect(screen.getByText('Set up HIUSA for Robotics Club.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide checklist' }));
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it('disappears when every step is done or the role has none', () => {
    const { container, rerender } = renderChecklist({ setup: { ...setup, completed: 6 } });
    expect(container).toBeEmptyDOMElement();
    rerender(<MemoryRouter><SetupChecklist setup={null} /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});

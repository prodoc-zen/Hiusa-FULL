import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import NextStep from './NextStep';

function renderStep(props) {
  return render(
    <MemoryRouter>
      <NextStep {...props} />
    </MemoryRouter>,
  );
}

describe('NextStep', () => {
  it('waiting tone names the owner, shows no button and is announced as status', () => {
    renderStep({
      tone: 'waiting',
      title: 'Waiting for Department Head approval',
      body: 'No action needed from you.',
      actorRole: 'Department Head',
      primary: { label: 'Open approval', to: '/x' },
    });
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for Department Head approval');
    expect(screen.getByRole('status')).toHaveTextContent('No action needed from you.');
    expect(screen.getByText('Owner: Department Head')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('done tone is announced as status and renders a secondary link', () => {
    renderStep({ tone: 'done', title: 'Results released', primary: { label: 'View results', to: '/dashboard/results' } });
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View results' })).toHaveAttribute('href', '/dashboard/results');
  });

  it('action tone uses a router Link when given `to`, and is not an alert', () => {
    renderStep({ tone: 'action', title: 'Propose the event budget', primary: { label: 'Propose budget', to: '/dashboard/finance/budget-allocation?event=4' } });
    expect(screen.getByRole('link', { name: 'Propose budget' })).toHaveAttribute('href', '/dashboard/finance/budget-allocation?event=4');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('action tone renders a button that calls onClick', () => {
    const onClick = vi.fn();
    renderStep({ tone: 'action', title: 'Start this task', primary: { label: 'Start task', onClick } });
    fireEvent.click(screen.getByRole('button', { name: 'Start task' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('shows a disabled primary with its reason as visible text, linked by aria-describedby', () => {
    const onClick = vi.fn();
    renderStep({
      tone: 'blocked',
      title: 'Cannot finalize yet',
      primary: { label: 'Finalize ballot', onClick, disabledReason: 'Add a candidate to every position first.' },
    });
    const button = screen.getByRole('button', { name: 'Finalize ballot' });
    expect(button).toBeDisabled();
    const reason = screen.getByText('Add a candidate to every position first.');
    expect(reason).toBeVisible();
    expect(button).toHaveAttribute('aria-describedby', reason.id);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders a disabled button instead of a link when `to` is given with a disabled reason', () => {
    renderStep({ tone: 'action', title: 'Register', primary: { label: 'Register', to: '/r', disabledReason: 'Waiting for the SAO to open the semester.' } });
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Register' })).toBeDisabled();
  });

  it('renders at most one button', () => {
    renderStep({ tone: 'action', title: 'Do it', primary: { label: 'Do it', to: '/x' } });
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('renders without a primary', () => {
    renderStep({ tone: 'blocked', title: 'Cancelled', body: 'Nothing more to do.' });
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

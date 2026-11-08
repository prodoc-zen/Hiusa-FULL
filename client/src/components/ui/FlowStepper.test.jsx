import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import FlowStepper from './FlowStepper';

const STEPS = [
  { key: 'proposal', label: 'Proposal', state: 'done', actor: 'Admin' },
  { key: 'requirements', label: 'Requirements', state: 'skipped' },
  { key: 'approval', label: 'Approval', state: 'current', actor: 'Department Head', note: 'Waiting' },
  { key: 'funding', label: 'Funding', state: 'blocked', note: 'Returned' },
  { key: 'prepare', label: 'Prepare', state: 'upcoming' },
];

describe('FlowStepper default', () => {
  it('is the one-line compact form unless a caller asks for the full list', () => {
    render(<FlowStepper steps={STEPS} ariaLabel="Event stage" />);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Event stage' })).toHaveAttribute('aria-valuetext', 'Step 2 of 4: Approval');
  });

  it('renders the labelled list only for variant="full"', () => {
    render(<FlowStepper variant="full" steps={STEPS} ariaLabel="Event stage" />);
    expect(screen.getByRole('list', { name: 'Event stage' })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});

describe('FlowStepper full variant', () => {
  it('marks a stopped step with the Stopped state word and its note', () => {
    const steps = [
      { key: 'a', label: 'Reserved', state: 'done' },
      { key: 'b', label: 'Payment check', state: 'stopped', note: 'Cancelled' },
      { key: 'c', label: 'Claimed', state: 'skipped' },
    ];
    render(<FlowStepper variant="full" steps={steps} ariaLabel="Order progress" />);
    const item = within(screen.getByRole('list', { name: 'Order progress' })).getAllByRole('listitem')[1];
    expect(within(item).getByText(/^Stopped:/)).toHaveClass('sr-only');
    expect(within(item).getByText('Cancelled')).toBeInTheDocument();
  });

  it('renders an ordered list with the aria label and one item per step, in order', () => {
    render(<FlowStepper variant="full" steps={STEPS} ariaLabel="Event progress" />);
    const list = screen.getByRole('list', { name: 'Event progress' });
    expect(list.tagName).toBe('OL');
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Proposal'),
      expect.stringContaining('Requirements'),
      expect.stringContaining('Approval'),
      expect.stringContaining('Funding'),
      expect.stringContaining('Prepare'),
    ]);
  });

  it('puts a state word in text on every step, hidden visually with sr-only', () => {
    render(<FlowStepper variant="full" steps={STEPS} />);
    for (const word of ['Done', 'Current step', 'Blocked', 'Upcoming', 'Skipped']) {
      const node = screen.getByText(new RegExp(`^${word}:`));
      expect(node).toHaveClass('sr-only');
    }
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Done: Proposal');
    expect(items[2]).toHaveTextContent('Current step: Approval');
    expect(items[3]).toHaveTextContent('Blocked: Funding');
  });

  it('marks only the current step with aria-current="step"', () => {
    render(<FlowStepper variant="full" steps={STEPS} />);
    const items = screen.getAllByRole('listitem');
    expect(items.map((item) => item.getAttribute('aria-current'))).toEqual([null, null, 'step', null, null]);
  });

  it('shows actor and note as visible text', () => {
    render(<FlowStepper variant="full" steps={STEPS} />);
    expect(screen.getByText('Department Head')).toBeVisible();
    expect(screen.getByText('Waiting')).toBeVisible();
    expect(screen.getByText('Returned')).toBeVisible();
  });

  it('draws no focusable elements, so keyboard order is the page order', () => {
    const { container } = render(<FlowStepper variant="full" steps={STEPS} />);
    expect(container.querySelectorAll('a, button, [tabindex]')).toHaveLength(0);
  });

  it('falls back to an upcoming look for an unknown state instead of throwing', () => {
    render(<FlowStepper variant="full" steps={[{ key: 'x', label: 'Odd', state: 'mystery' }]} />);
    expect(screen.getByText(/^Upcoming:/)).toHaveClass('sr-only');
  });

  it('renders nothing for an empty step list', () => {
    const { container } = render(<FlowStepper variant="full" steps={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('FlowStepper step limit', () => {
  const make = (count, extra = []) => [
    ...Array.from({ length: count }, (_, index) => ({ key: `s${index}`, label: `Step ${index}`, state: index === 0 ? 'done' : index === 1 ? 'current' : 'upcoming' })),
    ...extra,
  ];

  it('lists six steps in full', () => {
    render(<FlowStepper variant="full" steps={make(6)} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
  });

  it('falls back to the one-line summary past six counted steps', () => {
    render(<FlowStepper variant="full" steps={make(7)} ariaLabel="Long flow" />);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Long flow' })).toHaveAttribute('aria-valuemax', '7');
  });

  it('does not count skipped steps toward the limit', () => {
    render(<FlowStepper variant="full" steps={make(6, [{ key: 'x', label: 'Skipped one', state: 'skipped' }])} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
  });
});

describe('FlowStepper compact variant', () => {
  it('shows one line "Step 3 of 4" that ignores skipped steps, with a progress meter', () => {
    render(<FlowStepper steps={STEPS} variant="compact" ariaLabel="Event stage" />);
    expect(screen.getByText('Step 2 of 4: Approval')).toBeInTheDocument();
    const meter = screen.getByRole('progressbar', { name: 'Event stage' });
    expect(meter).toHaveAttribute('aria-valuenow', '1');
    expect(meter).toHaveAttribute('aria-valuemax', '4');
    expect(meter).toHaveAttribute('aria-valuetext', 'Step 2 of 4: Approval');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('carries the state word for the focused step', () => {
    render(<FlowStepper steps={STEPS} variant="compact" />);
    expect(screen.getByText(/^Current step:/)).toHaveClass('sr-only');
  });

  it('reports a blocked step as the focus with the Blocked state word', () => {
    const steps = [
      { key: 'a', label: 'Draft', state: 'done' },
      { key: 'b', label: 'Review', state: 'blocked' },
    ];
    render(<FlowStepper steps={steps} variant="compact" />);
    expect(screen.getByText('Step 2 of 2: Review')).toBeInTheDocument();
    expect(screen.getByText(/^Blocked:/)).toHaveClass('sr-only');
  });

  it('reports a stopped record as stopped, never Complete', () => {
    const steps = [
      { key: 'a', label: 'Reserved', state: 'done' },
      { key: 'b', label: 'Payment check', state: 'stopped', note: 'Cancelled' },
      { key: 'c', label: 'Claimed', state: 'skipped' },
    ];
    render(<FlowStepper steps={steps} variant="compact" />);
    expect(screen.getByText('Stopped at step 2 of 2: Payment check')).toBeInTheDocument();
    expect(screen.getByText(/^Stopped:/)).toHaveClass('sr-only');
    expect(screen.queryByText(/Complete/)).not.toBeInTheDocument();
  });

  it('says Complete when every step is done', () => {
    const steps = [
      { key: 'a', label: 'Draft', state: 'done' },
      { key: 'b', label: 'Approved', state: 'done' },
    ];
    render(<FlowStepper steps={steps} variant="compact" />);
    expect(screen.getByText('Complete: 2 of 2 steps done')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
  });

  it('counts progress when no step is current, as for a clearance with every line pending', () => {
    const steps = [
      { key: 'a', label: 'SAO', state: 'done' },
      { key: 'b', label: 'Adviser', state: 'upcoming' },
    ];
    render(<FlowStepper steps={steps} variant="compact" />);
    expect(screen.getByText('1 of 2 steps done')).toBeInTheDocument();
  });

  it('offers the summary alone on narrow screens when one is passed', () => {
    render(<FlowStepper steps={STEPS} variant="compact" summary="Waiting for Department Head approval" />);
    expect(screen.getByText('Waiting for Department Head approval')).toHaveClass('sm:hidden');
    expect(screen.getByText('Step 2 of 4: Approval')).toHaveClass('hidden', 'sm:inline');
    expect(screen.getByRole('progressbar')).toHaveClass('max-sm:hidden');
  });
});

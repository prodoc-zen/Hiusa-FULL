import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import AnswerBlocks from './AnswerBlocks';

const row = (n, extra = {}) => ({ id: `r${n}`, primary: `Record ${n}`, secondary: `Detail ${n}`, ...extra });

const payload = {
  highlights: [{ label: 'Organizations missing files', value: '3', tone: 'danger' }],
  sections: [
    {
      id: 's1',
      title: 'Missing Requirements',
      layout: 'table',
      rows: [
        row(1, { status: 'Missing', status_tone: 'danger', meta: '2 item(s)', href: '/dashboard/compliance', action_label: 'Review' }),
        row(2, { ask_question: 'How do I submit it?' }),
      ],
    },
    {
      id: 's2',
      title: 'How To Submit',
      layout: 'steps',
      rows: [row(1, { step: 1, href: '/dashboard/files' }), row(2, { step: 2 })],
    },
  ],
  charts: [{ id: 'c1', type: 'bar', title: 'By College', items: [{ label: 'CAS', value: 3, display_value: '3', percent: 60, tone: 'danger' }] }],
  recommended_action: { title: 'Follow up with the three organizations', detail: 'They are overdue.', href: '/dashboard/compliance', action_label: 'Open compliance' },
  follow_ups: [{ label: 'What about finance?', question: 'What about finance?', topic: 'finance' }],
};

function renderBlocks(props = {}) {
  const onAsk = vi.fn();
  render(
    <MemoryRouter>
      <AnswerBlocks payload={payload} onAsk={onAsk} {...props} />
    </MemoryRouter>,
  );
  return onAsk;
}

describe('AnswerBlocks', () => {
  it('renders nothing for a missing or empty payload', () => {
    const { container, rerender } = render(<AnswerBlocks payload={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<AnswerBlocks payload={{ highlights: [], sections: [], charts: [], follow_ups: [], recommended_action: null }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders highlights as stats', () => {
    renderBlocks();
    expect(screen.getByText('Organizations missing files')).toBeInTheDocument();
    expect(screen.getByText('3', { selector: 'dd' })).toHaveClass('text-danger-strong');
  });

  it('labels each section disclosure with title and row count, opening only the first', () => {
    renderBlocks();
    const [first, second] = document.querySelectorAll('details');
    expect(first).toHaveTextContent('Missing requirements');
    expect(first).toHaveTextContent('2 rows');
    expect(first).toHaveAttribute('open');
    expect(second).toHaveTextContent('How to submit');
    expect(second).not.toHaveAttribute('open');
  });

  it('keeps the first section closed when it has more than 6 rows', () => {
    const rows = Array.from({ length: 7 }, (_, i) => row(i + 1));
    renderBlocks({ payload: { sections: [{ id: 'big', title: 'Big', layout: 'table', rows }] } });
    expect(document.querySelector('details')).not.toHaveAttribute('open');
    expect(document.querySelector('details')).toHaveTextContent('7 rows');
  });

  it('renders table rows with a status badge, a link button and a Show steps button', () => {
    const onAsk = renderBlocks();
    const table = screen.getByRole('table', { name: 'Missing requirements' });
    expect(within(table).getByText('Missing')).toBeInTheDocument();
    expect(within(table).getByText('2 items')).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'Review' })).toHaveAttribute('href', '/dashboard/compliance');
    fireEvent.click(within(table).getByRole('button', { name: 'Show steps' }));
    expect(onAsk).toHaveBeenCalledWith('How do I submit it?', 'how_to_guide');
  });

  it('renders the steps layout as a numbered list', () => {
    renderBlocks();
    const steps = screen.getByRole('list', { name: 'How to submit', hidden: true });
    expect(within(steps).getAllByRole('listitem', { hidden: true })).toHaveLength(2);
    expect(within(steps).getByRole('link', { name: 'Go to page', hidden: true })).toHaveAttribute('href', '/dashboard/files');
  });

  it('renders charts as labelled bars in the tone colour', () => {
    renderBlocks();
    expect(screen.getByText('By college')).toBeInTheDocument();
    const bar = document.querySelector('.bg-danger');
    expect(bar).toHaveStyle({ width: '60%' });
    expect(screen.getByText('CAS')).toBeInTheDocument();
  });

  it('renders the recommended action as one line with a link button', () => {
    renderBlocks();
    expect(screen.getByText(/Recommended next step/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open compliance' })).toHaveAttribute('href', '/dashboard/compliance');
  });

  it('calls onAsk with the question and topic from a follow-up chip', () => {
    const onAsk = renderBlocks();
    fireEvent.click(screen.getByRole('button', { name: 'What about finance?' }));
    expect(onAsk).toHaveBeenCalledWith('What about finance?', 'finance');
  });

  it('disables chips and Show steps while disabled', () => {
    renderBlocks({ disabled: true });
    expect(screen.getByRole('button', { name: 'What about finance?' })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Show steps' })[0]).toBeDisabled();
  });

  it('shows the empty message of a section with no rows', () => {
    renderBlocks({ payload: { sections: [{ id: 'e', title: 'Late Files', rows: [], empty_message: 'Nothing is late.' }] } });
    expect(screen.getByText('Nothing is late.')).toBeInTheDocument();
    expect(document.querySelector('details')).toBeNull();
  });
});

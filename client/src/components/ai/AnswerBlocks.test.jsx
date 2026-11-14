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
  charts: [{
    id: 'c1',
    type: 'distribution',
    title: 'By College',
    items: [
      { label: 'CAS', value: 3, display_value: '3', percent: 60, tone: 'danger' },
      { label: 'CBA', value: 1, display_value: '1', percent: 20, tone: 'warning' },
      { label: 'COE', value: 1, display_value: '1', percent: 20, tone: 'success' },
    ],
  }],
  recommended_action: { title: 'Follow up with the three organizations', detail: 'They are overdue.', href: '/dashboard/compliance/overview', action_label: 'Open compliance' },
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

  it('labels each section disclosure with title and count, opening only the first of a records-only answer', () => {
    renderBlocks({ payload: { ...payload, recommended_action: null } });
    const [first, second] = document.querySelectorAll('details');
    expect(first).toHaveTextContent('Missing requirements (2)');
    expect(first).toHaveAttribute('open');
    expect(second).toHaveTextContent('How to submit (2)');
    expect(second).not.toHaveAttribute('open');
  });

  it('keeps the first section closed when it has more than 6 rows', () => {
    const rows = Array.from({ length: 7 }, (_, i) => row(i + 1));
    renderBlocks({ payload: { sections: [{ id: 'big', title: 'Big', layout: 'table', rows }] } });
    expect(document.querySelector('details')).not.toHaveAttribute('open');
    expect(document.querySelector('details')).toHaveTextContent('Big (7)');
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
    expect(within(steps).getByRole('link', { name: 'Open', hidden: true })).toHaveAttribute('href', '/dashboard/files');
  });

  it('keeps every section closed when the model wrote the answer', () => {
    renderBlocks({ payload: { ...payload, model_written: true } });
    const all = document.querySelectorAll('details');
    expect(all).toHaveLength(2);
    all.forEach((details) => expect(details).not.toHaveAttribute('open'));
  });

  it('hides a section description that has rows and keeps the message of an empty section', () => {
    renderBlocks({
      payload: {
        sections: [
          { id: 'a', title: 'Late Files', description: 'Late files restated.', layout: 'table', rows: [row(1)] },
          { id: 'b', title: 'Done', description: 'Done restated.', rows: [], empty_message: 'Nothing is done.' },
        ],
      },
    });
    expect(screen.queryByText('Late files restated.')).not.toBeInTheDocument();
    expect(screen.getByText('Nothing is done.')).toBeInTheDocument();
  });

  it('renders a distribution chart with 3 or more items as labelled bars in the tone colour', () => {
    renderBlocks();
    expect(screen.getByText('By college')).toBeInTheDocument();
    expect(document.querySelector('.bg-danger')).toHaveStyle({ width: '60%' });
    expect(screen.getByText('CAS')).toBeInTheDocument();
  });

  it('never renders a bar chart or a distribution with fewer than 3 items', () => {
    const items = payload.charts[0].items;
    renderBlocks({
      payload: {
        highlights: payload.highlights,
        charts: [
          { id: 'bar', type: 'bar', title: 'Key metrics comparison', items },
          { id: 'few', type: 'distribution', title: 'Record status breakdown', items: items.slice(0, 2) },
        ],
      },
    });
    expect(screen.queryByText('Key metrics comparison')).not.toBeInTheDocument();
    expect(screen.queryByText('Record status breakdown')).not.toBeInTheDocument();
  });

  it('shows the recommended action as one line above the stats when the answer is records only', () => {
    renderBlocks();
    const line = screen.getByText(/Recommended next step/);
    expect(screen.getByRole('link', { name: 'Open compliance' })).toHaveAttribute('href', '/dashboard/compliance/overview');
    const stats = document.querySelector('dl');
    expect(line.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('leaves the recommended action out when the model wrote the answer', () => {
    renderBlocks({ payload: { ...payload, model_written: true } });
    expect(screen.queryByText(/Recommended next step/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open compliance' })).not.toBeInTheDocument();
  });

  it('labels the fourth column Info, since it holds dates, places and counts', () => {
    renderBlocks();
    const table = screen.getByRole('table', { name: 'Missing requirements' });
    expect(within(table).getByRole('columnheader', { name: 'Info' })).toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: 'Count' })).not.toBeInTheDocument();
  });

  describe('a records-only answer with one missing record', () => {
    const single = {
      highlights: [
        { label: 'Missing requirements', value: '1', tone: 'danger' },
        { label: 'Events missing files', value: '0', tone: 'success' },
      ],
      sections: [
        {
          id: 'req',
          title: 'Missing Requirements',
          layout: 'table',
          rows: [{
            id: 'fs',
            primary: 'Financial Statement',
            secondary: 'Returned: add the signed page',
            meta: 'Due Dec 1, 2026',
            href: '/dashboard/requirements/3',
            action_label: 'Upload',
          }],
        },
        { id: 'events', title: 'Events Missing Required Proposal Documents', rows: [], empty_message: 'All current events have their required proposal documents uploaded.' },
        { id: 'fin', title: 'Financial Report', rows: [], empty_message: 'No financial report deadline has been set yet.' },
      ],
      recommended_action: { title: 'Financial Statement', detail: 'Returned: add the signed page', href: '/dashboard/requirements/3', action_label: 'Upload' },
    };

    it('shows the record once, with one Upload control and no empty-section headings', () => {
      renderBlocks({ payload: single });
      expect(screen.getAllByRole('link', { name: 'Upload' })).toHaveLength(1);
      expect(screen.getAllByText('Financial Statement')).toHaveLength(1);
      expect(screen.queryByText(/Recommended next step/)).not.toBeInTheDocument();
      expect(screen.queryByRole('heading')).not.toBeInTheDocument();
      expect(screen.queryByText('All current events have their required proposal documents uploaded.')).not.toBeInTheDocument();
      expect(screen.getByText('Due Dec 1, 2026')).toBeInTheDocument();
      expect(document.querySelector('details')).toHaveAttribute('open');
    });

    it('keeps the empty messages as plain lines when there are no stats', () => {
      renderBlocks({ payload: { ...single, highlights: [], recommended_action: null } });
      expect(screen.getByText('No financial report deadline has been set yet.')).toBeInTheDocument();
      expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    });

    it('keeps the recommended step, and closes the table, when it names a record that is not listed', () => {
      renderBlocks({ payload: { ...single, recommended_action: { title: 'Call the adviser', href: '/dashboard/advisers' } } });
      expect(screen.getByText(/Recommended next step/)).toBeInTheDocument();
      expect(document.querySelector('details')).not.toHaveAttribute('open');
    });
  });

  it('gives a steps row a single action', () => {
    renderBlocks({
      payload: { sections: [{ id: 'st', title: 'Steps', layout: 'steps', rows: [row(1, { step: 1, href: '/dashboard/files', ask_question: 'Why?' })] }] },
    });
    const steps = screen.getByRole('list', { name: 'Steps', hidden: true });
    expect(within(steps).getAllByRole('link', { hidden: true })).toHaveLength(1);
    expect(within(steps).queryByRole('button', { name: 'Show steps', hidden: true })).not.toBeInTheDocument();
  });

  it('keeps short count values on one line', () => {
    renderBlocks();
    expect(screen.getByText('2 items')).toHaveClass('whitespace-nowrap');
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

  it('renders a row link or the recommended step as text when it starts a conversation', () => {
    const unsafe = {
      ...payload,
      sections: [{
        id: 's1',
        title: 'Rows',
        layout: 'table',
        rows: [
          row(1, { href: '/dashboard/ask-ai?q=do%20it', action_label: 'Sneaky' }),
          row(2, { href: '/dashboard/compliance?topic=x', action_label: 'Topic link' }),
          row(3, { href: '/dashboard/compliance?tab=files', action_label: 'Files' }),
        ],
      }],
      recommended_action: { title: 'Follow up', href: '/dashboard/ask-ai?q=x', action_label: 'Take sneaky action' },
    };
    renderBlocks({ payload: unsafe });
    expect(screen.queryByRole('link', { name: /Sneaky/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Topic link/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Take sneaky action/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Files' })).toHaveAttribute('href', '/dashboard/compliance?tab=files');
    expect(screen.getByText('Record 1')).toBeInTheDocument();
  });
});

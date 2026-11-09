import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AskAiPage from './AskAiPage';

const serviceMocks = vi.hoisted(() => ({
  getAiAssistantOverview: vi.fn(),
  askAiAssistant: vi.fn(),
}));

vi.mock('../../../services/askAiService', () => serviceMocks);

const sampleOverview = {
  role: 'SUPER_ADMIN',
  role_label: 'SAO Operations',
  scope_label: 'University-wide student organizations',
  daily_briefing: {
    title: "Today's SAO Action Plan",
    summary:
      'Today you have 3 university-wide item(s) awaiting SAO action: 1 pending organization registration(s) and 2 compliance submission(s).',
    highlights: [
      { label: 'Total action items', value: '3', tone: 'warning' },
      { label: 'Compliance to review', value: '2', tone: 'warning' },
    ],
    priorities: [],
    sections: [
      {
        id: 'sao-daily-queues',
        title: 'Prioritized SAO Queues for Today',
        description: 'Items ordered by urgency across university-wide oversight queues.',
        empty_message: 'Every SAO queue is clear today.',
        rows: [
          {
            id: 'prio-compliance',
            primary: 'Audit submitted compliance and accreditation files',
            secondary: '2 compliance document(s) have been uploaded by organizations and await review.',
            status: 'Pending review',
            status_tone: 'warning',
            meta: '2 submitted',
            href: '/dashboard/super-admin/compliance?tab=review',
            action_label: 'Review compliance',
          },
        ],
      },
    ],
  },
  suggested_questions: [
    {
      id: 'sao-today',
      topic: 'daily_priorities',
      label: 'What should I do today?',
      question: 'What should I do today across student organizations?',
    },
    {
      id: 'sao-missing',
      topic: 'missing_submissions',
      label: "Who hasn't submitted requirements?",
      question: "Which organizations haven't submitted compliance or financial reports?",
    },
  ],
  recent_queries: [],
};

describe('AskAiPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.getAiAssistantOverview.mockResolvedValue({ data: sampleOverview });
    serviceMocks.askAiAssistant.mockResolvedValue({
      data: {
        id: 42,
        question: "Which organizations haven't submitted compliance or financial reports?",
        intent: 'missing_submissions',
        title: 'Organizations With Missing or Returned Submissions',
        answer:
          'Out of 4 student organization(s) in scope, 1 organization(s) still have missing or returned compliance requirements.',
        highlights: [{ label: 'Orgs missing compliance', value: '1', tone: 'warning' }],
        formatted_blocks: {
          headline: 'Organizations With Missing or Returned Submissions',
          summary:
            'Out of 4 student organization(s) in scope, 1 organization(s) still have missing or returned compliance requirements.',
          key_findings: [],
          recommended_action: {
            title: 'Supreme Student Council (SSC)',
            detail: 'Not submitted: Constitution & By-Laws',
            href: '/dashboard/super-admin/compliance',
            action_label: 'Inspect',
          },
        },
        charts: [
          {
            id: 'missing_submissions-highlights-chart',
            type: 'bar',
            title: 'Key Metrics Comparison',
            subtitle: 'Live indicator breakdown for this query',
            items: [
              {
                label: 'Orgs missing compliance',
                value: 1,
                display_value: '1',
                percent: 100,
                tone: 'warning',
              },
            ],
          },
        ],
        sections: [
          {
            id: 'orgs-missing-compliance',
            title: 'Organizations Missing Compliance Documents',
            rows: [
              {
                id: 'missing-comp-1',
                primary: 'Supreme Student Council (SSC)',
                secondary: 'Not submitted: Constitution & By-Laws',
                status: 'Missing files',
                status_tone: 'warning',
                meta: '1/2 submitted',
                progress_percent: 50,
                href: '/dashboard/super-admin/compliance',
                action_label: 'Inspect',
              },
            ],
          },
        ],
        follow_ups: [
          {
            topic: 'submitted_documents',
            label: 'Who HAS submitted documents?',
            question: 'Who has submitted compliance documents or reports for review?',
          },
        ],
      },
    });
  });

  it('loads the role daily briefing and answers suggested or custom questions', async () => {
    render(
      <MemoryRouter initialEntries={['/dashboard/ask-ai']}>
        <AskAiPage />
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { level: 1, name: 'Ask AI' })).toBeInTheDocument();
    expect(screen.getByText(/Audit submitted compliance and accreditation files/i)).toBeInTheDocument();
    expect(screen.getByText(/3 university-wide items awaiting SAO action/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Prioritized SAO queues for today' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Ask a question')).toBeInTheDocument();

    fireEvent.click(
      screen.getAllByRole('button', { name: /Who hasn't submitted requirements\?/i })[0]
    );

    await waitFor(() => {
      expect(serviceMocks.askAiAssistant).toHaveBeenCalledWith({
        question: "Which organizations haven't submitted compliance or financial reports?",
        topic: 'missing_submissions',
      });
    });

    expect(
      await screen.findByRole('heading', { name: 'Organizations with missing or returned submissions' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Key Metrics Comparison' })).not.toBeInTheDocument();
    expect(screen.getByText('Orgs missing compliance')).toBeInTheDocument();
    expect(
      screen.getByText(/Out of 4 student organizations in scope, 1 organization still have/i)
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\(s\)/);
    expect(screen.getByText(/Recommended next step:/i)).toBeInTheDocument();
    expect(screen.getAllByText('Supreme Student Council (SSC)').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Not submitted: Constitution & By-Laws/i).length).toBeGreaterThan(0);
  });

  it('folds the suggested questions behind a toggle on a phone while the briefing is showing', async () => {
    render(
      <MemoryRouter initialEntries={['/dashboard/ask-ai']}>
        <AskAiPage />
      </MemoryRouter>
    );

    const toggle = await screen.findByRole('button', { name: 'Show suggested questions' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const suggestion = screen.getAllByRole('button', { name: /Who hasn't submitted requirements\?/i })[0];
    expect(suggestion.closest('[class~="max-sm:hidden"]')).not.toBeNull();

    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Hide suggested questions' })).toHaveAttribute('aria-expanded', 'true');
    expect(suggestion.closest('[class~="max-sm:hidden"]')).toBeNull();
  });

  it('automatically executes a question passed via the URL query string from the dashboard', async () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/dashboard/ask-ai?q=Which%20organizations%20haven't%20submitted%20compliance%20or%20financial%20reports%3F&topic=missing_submissions",
        ]}
      >
        <AskAiPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(serviceMocks.askAiAssistant).toHaveBeenCalledWith({
        question: "Which organizations haven't submitted compliance or financial reports?",
        topic: 'missing_submissions',
      });
    });

    expect((await screen.findAllByText('Supreme Student Council (SSC)')).length).toBeGreaterThan(0);
  });
});

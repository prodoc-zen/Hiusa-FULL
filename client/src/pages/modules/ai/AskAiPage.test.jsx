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
  role_label: 'SAO Operations Copilot',
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

    expect(await screen.findByRole('heading', { name: 'SAO Operations Copilot' })).toBeInTheDocument();
    expect(screen.getByText(/Audit submitted compliance and accreditation files/i)).toBeInTheDocument();

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
      await screen.findByRole('heading', { name: 'Organizations With Missing or Returned Submissions' })
    ).toBeInTheDocument();
    expect(screen.getByText('Supreme Student Council (SSC)')).toBeInTheDocument();
    expect(screen.getByText('Not submitted: Constitution & By-Laws')).toBeInTheDocument();
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

    expect(await screen.findByText('Supreme Student Council (SSC)')).toBeInTheDocument();
  });
});

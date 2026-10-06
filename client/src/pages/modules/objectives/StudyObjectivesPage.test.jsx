import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StudyObjectivesPage from './StudyObjectivesPage';

const objectivesMock = vi.hoisted(() => ({ getObjectivesOverview: vi.fn() }));
vi.mock('../../../services/objectivesService', () => objectivesMock);

function buildObjective(overrides) {
  return {
    code: 'GO',
    title: 'General objective',
    statement: 'Statement text from the paper.',
    mechanism: 'A named mechanism.',
    status: 'live',
    evidence: [],
    last_activity_at: null,
    ...overrides,
  };
}

const FULL_PAYLOAD = {
  scope: { type: 'organization', organization: { id: 1, name: 'Test Org' } },
  objectives: [
    buildObjective({
      code: 'GO',
      title: 'Improve SBO management through a centralized platform',
      statement: 'Analyze, design, develop, test, and evaluate a student body organization management system.',
      mechanism: 'OLS, Budget Advisory System, Rule-Based Weighted Scoring, Groq LLM together',
      status: 'live',
      evidence: [{ label: 'Modules demonstrated', value: 6, unit: 'count', href: null }],
      last_activity_at: '2026-09-20T10:00:00Z',
    }),
    buildObjective({
      code: 'SO1',
      title: 'Assess current governance and financial practices',
      mechanism: 'Study research process outside the application',
      status: 'no_data',
      evidence: [{ label: 'Assessments run', value: 0, unit: 'count', href: null }],
      last_activity_at: null,
    }),
    buildObjective({
      code: 'SO2.1',
      title: 'Financial management mechanism',
      mechanism: 'OLS Linear Regression and the Budget Advisory System',
      status: 'live',
      evidence: [
        { label: 'Forecasts generated', value: 12, unit: 'count', href: '/dashboard/finance/financial-insights' },
        { label: 'Budget advisories issued', value: 5, unit: 'count', href: null },
      ],
      last_activity_at: '2026-09-27T08:00:00Z',
    }),
    buildObjective({
      code: 'SO2.2',
      title: 'Event management mechanism',
      mechanism: 'Event Planning Assistant and biometric attendance',
      status: 'partial',
      evidence: [{ label: 'Check-in rate', value: 76, unit: 'percent', href: '/dashboard/events' }],
      last_activity_at: '2026-09-25T08:00:00Z',
    }),
    buildObjective({ code: 'SO2.3', title: 'Task management mechanism', status: 'live' }),
    buildObjective({ code: 'SO2.4', title: 'Elections mechanism', status: 'live' }),
    buildObjective({ code: 'SO2.5', title: 'Merchandise management mechanism', status: 'partial' }),
    buildObjective({ code: 'SO2.6', title: 'Organizational communication mechanism', status: 'live' }),
    buildObjective({
      code: 'SO3',
      title: 'Define and develop the best features of the proposed system',
      status: 'live',
      evidence: [{ label: 'Areas proven', value: 6, unit: 'count', href: null }],
      last_activity_at: null,
    }),
    buildObjective({
      code: 'SO4',
      title: 'Evaluate the level of acceptability of the proposed system',
      mechanism: 'Weighted mean with Table 3 interpretation bands',
      status: 'no_data',
      evidence: [],
      last_activity_at: null,
    }),
  ],
};

function renderPage() {
  return render(
    <MemoryRouter>
      <StudyObjectivesPage />
    </MemoryRouter>
  );
}

describe('StudyObjectivesPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows an animated skeleton while loading', () => {
    objectivesMock.getObjectivesOverview.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole('status', { name: /loading study objectives/i })).toBeInTheDocument();
  });

  it('shows a server error with a working retry', async () => {
    objectivesMock.getObjectivesOverview
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ data: FULL_PAYLOAD });

    renderPage();

    expect(await screen.findByText('Study objectives could not be loaded')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText(/SO2: one system, six areas/)).toBeInTheDocument();
    expect(objectivesMock.getObjectivesOverview).toHaveBeenCalledTimes(2);
  });

  it('shows an honest empty state when the objectives catalog is empty', async () => {
    objectivesMock.getObjectivesOverview.mockResolvedValue({
      data: { scope: { type: 'organization', organization: { id: 1, name: 'Test Org' } }, objectives: [] },
    });

    renderPage();

    expect(await screen.findByText('No objectives are configured yet')).toBeInTheDocument();
  });

  it('shows a university-wide scope line for the SAO', async () => {
    objectivesMock.getObjectivesOverview.mockResolvedValue({
      data: { scope: { type: 'university' }, objectives: [buildObjective({ code: 'GO' })] },
    });

    renderPage();

    expect(await screen.findByText(/University-wide evidence across every organization/)).toBeInTheDocument();
  });

  it('renders every objective with its statement, mechanism, status, evidence, and links, scoped to the organization', async () => {
    objectivesMock.getObjectivesOverview.mockResolvedValue({ data: FULL_PAYLOAD });

    renderPage();

    expect(await screen.findByText(/Evidence scoped to Test Org only\./)).toBeInTheDocument();

    // General objective frames the page.
    expect(screen.getByText(/GO: Improve SBO management/)).toBeInTheDocument();

    // SO2 rendered as one system using pillars.js labels, not raw codes alone.
    expect(screen.getByText(/SO2: one system, six areas/)).toBeInTheDocument();
    expect(screen.getByText(/SO2\.1: Financial management/)).toBeInTheDocument();

    // An evidence item with a non-null href links to the feature that produces it.
    const forecastLink = screen.getByRole('link', { name: /12.*Forecasts generated/s });
    expect(forecastLink).toHaveAttribute('href', '/dashboard/finance/financial-insights');

    // An evidence item with a null href renders as plain text, never a link.
    expect(screen.getByText('Budget advisories issued')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Budget advisories issued/i })).not.toBeInTheDocument();

    // Percent evidence renders as an already-scaled percentage via lib/format.
    expect(screen.getByText('76%')).toBeInTheDocument();

    // Zero evidence is reported honestly, never padded, with a next action when one exists.
    expect(screen.getAllByText('No activity yet').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('link', { name: /evaluation/i })).not.toBeInTheDocument();

    // Research objectives have no in-app destination.
    expect(screen.getByText(/SO1: Assess current governance/)).toBeInTheDocument();
    expect(screen.queryAllByRole('link', { name: /^Open /i })).toHaveLength(0);

    // SO3 synthesizes everything above.
    expect(screen.getByText(/SO3: Define and develop the best features/)).toBeInTheDocument();

    // Last activity is shown per objective, including "no activity" for one with none.
    expect(screen.getAllByText(/Last activity/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText('No activity recorded yet.').length).toBeGreaterThan(0);
  });
});

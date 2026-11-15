import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SemesterNarrativeDrawer from './SemesterNarrativeDrawer';

const { service, notify } = vi.hoisted(() => ({
  service: { draftSemesterNarrative: vi.fn(), recordAiOutcome: vi.fn() },
  notify: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../services/aiDraftService', () => service);
vi.mock('../../lib/notify', () => ({ default: notify }));

const draft = {
  text: 'Accomplishments text\n\nImplementation text\n\nEvaluation text\n\nPlan text',
  sections: {
    accomplishments: 'Accomplishments text',
    implementation: 'Implementation text',
    evaluation: 'Evaluation text',
    next_semester_plan: 'Plan text',
  },
  engine: 'claude',
  ai_output_id: 41,
  facts: {
    semester: '1st Semester 2026-2027',
    events: [
      { title: 'Programming Contest', date: '2026-09-12', status: 'completed', attendance: 120, budget_allocated: 25000, budget_used: 18400 },
      { title: 'Foundation Day', date: '2026-10-02', status: 'cancelled', attendance: null, budget_allocated: null, budget_used: null },
    ],
    tasks: { completed: 14, overdue: 2, open: 3 },
    elections: [{ title: 'SBO Election', voters: 412, ballots: 266 }],
    merchandise: { orders: 38, claimed: 30 },
    announcements: { posted: 12 },
    finance: { income: 30000, expense: 18400, closing_balance: 11600 },
    upcoming_events: [{ title: 'Hackathon', date: '2026-12-05' }],
    officers: [{ name: 'Juan Dela Cruz', position: 'President' }],
  },
};

function renderDrawer(props = {}) {
  const onClose = vi.fn();
  render(<SemesterNarrativeDrawer open semesterId={7} onClose={onClose} {...props} />);
  return { onClose };
}

describe('SemesterNarrativeDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.draftSemesterNarrative.mockResolvedValue(draft);
    service.recordAiOutcome.mockResolvedValue({});
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  afterEach(() => vi.restoreAllMocks());

  it('asks for nothing while it is closed', () => {
    renderDrawer({ open: false });

    expect(service.draftSemesterNarrative).not.toHaveBeenCalled();
  });

  it('drafts the semester on open and shows the four sections with the engine and the draft line', async () => {
    renderDrawer();

    expect(await screen.findByText('Accomplishments text')).toBeInTheDocument();
    expect(service.draftSemesterNarrative).toHaveBeenCalledWith(7);
    ['Accomplishments', 'Implementation', 'Evaluation', 'Next semester plan'].forEach((name) => {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: `Copy ${name}` })).toBeInTheDocument();
    });
    expect(screen.getByText('Implementation text')).toBeInTheDocument();
    expect(screen.getByText('Claude')).toBeInTheDocument();
    expect(screen.getByText('Draft. Read and edit before you send.')).toBeInTheDocument();
  });

  it('names the built-in rules when no model wrote it', async () => {
    service.draftSemesterNarrative.mockResolvedValue({ ...draft, engine: 'template' });
    renderDrawer();

    expect(await screen.findByText('Built-in rules')).toBeInTheDocument();
  });

  it('lists the facts the draft was written from behind a Facts used disclosure', async () => {
    renderDrawer();
    await screen.findByText('Accomplishments text');

    const summary = screen.getByText('Facts used');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    expect(screen.getByText(/Programming Contest: completed, .*120 attended, budget used ₱18,400.00 of ₱25,000.00/)).toBeInTheDocument();
    expect(screen.getByText(/Foundation Day: cancelled/)).toBeInTheDocument();
    expect(screen.getByText('Tasks: 14 completed, 2 overdue, 3 open')).toBeInTheDocument();
    expect(screen.getByText('Election SBO Election: 266 ballots from 412 voters')).toBeInTheDocument();
    expect(screen.getByText(/Money: income ₱30,000.00, expenses ₱18,400.00, closing balance ₱11,600.00/)).toBeInTheDocument();
    expect(screen.getByText('Officers: Juan Dela Cruz (President)')).toBeInTheDocument();
  });

  it('says plainly when the semester had no events', async () => {
    service.draftSemesterNarrative.mockResolvedValue({ ...draft, facts: { ...draft.facts, events: [], elections: [], upcoming_events: [] } });
    renderDrawer();

    expect(await screen.findByText('No events were recorded.')).toBeInTheDocument();
  });

  it('copies a section and counts it as accepted, once', async () => {
    renderDrawer();
    await screen.findByText('Accomplishments text');

    fireEvent.click(screen.getByRole('button', { name: 'Copy Evaluation' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Evaluation text'));
    await waitFor(() => expect(notify.success).toHaveBeenCalledWith('Evaluation copied.'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy Implementation' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Implementation text'));

    expect(service.recordAiOutcome).toHaveBeenCalledTimes(1);
    expect(service.recordAiOutcome).toHaveBeenCalledWith(41, draft.text);
  });

  it('does not count a copy that failed and says so', async () => {
    navigator.clipboard.writeText.mockRejectedValue(new Error('denied'));
    renderDrawer();
    await screen.findByText('Accomplishments text');

    fireEvent.click(screen.getByRole('button', { name: 'Copy Accomplishments' }));

    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('Could not copy this section. Select the text and copy it instead.'));
    expect(service.recordAiOutcome).not.toHaveBeenCalled();
  });

  it('counts the draft as discarded when the drawer closes with nothing copied', async () => {
    const { onClose } = renderDrawer();
    await screen.findByText('Accomplishments text');

    fireEvent.click(screen.getByRole('button', { name: /close/i }));

    expect(onClose).toHaveBeenCalled();
    expect(service.recordAiOutcome).toHaveBeenCalledWith(41, null);
  });

  it('does not overwrite an accepted outcome when it closes after a copy', async () => {
    const { onClose } = renderDrawer();
    await screen.findByText('Accomplishments text');
    fireEvent.click(screen.getByRole('button', { name: 'Copy Evaluation' }));
    await waitFor(() => expect(service.recordAiOutcome).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /close/i }));

    expect(onClose).toHaveBeenCalled();
    expect(service.recordAiOutcome).toHaveBeenCalledTimes(1);
  });

  it('shows the server message and a retry when the draft fails, and records nothing', async () => {
    service.draftSemesterNarrative.mockRejectedValueOnce({ response: { data: { message: 'This semester has not started, so there is nothing to write about yet.' } } });
    const { onClose } = renderDrawer();

    expect(await screen.findByText('This semester has not started, so there is nothing to write about yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Accomplishments text')).toBeInTheDocument();
    expect(service.draftSemesterNarrative).toHaveBeenCalledTimes(2);
    expect(service.recordAiOutcome).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('swallows a failed outcome write', async () => {
    service.recordAiOutcome.mockRejectedValue(new Error('offline'));
    const { onClose } = renderDrawer();
    await screen.findByText('Accomplishments text');

    fireEvent.click(screen.getByRole('button', { name: /close/i }));

    expect(onClose).toHaveBeenCalled();
  });
});

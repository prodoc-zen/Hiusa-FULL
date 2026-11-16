import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DraftNoteButton from './DraftNoteButton';
import { draftReviewNote } from '../../services/aiDraftService';
import { PRIVACY_CONSENT_RECORDED_EVENT } from '../../utils/privacyNotice';

vi.mock('../../services/aiDraftService', () => ({ draftReviewNote: vi.fn() }));

const answer = (overrides = {}) => ({ data: { text: 'Please attach the signed proposal.', engine: 'claude', ai_output_id: 41, ...overrides } });

function renderButton(props = {}) {
  const onDraft = vi.fn();
  render(<DraftNoteButton flow="event" recordId={7} decision="returned" marks={[{ requirement: 'Activity Proposal', mark: 'needs_changes', note: 'No signature' }]} value="" onDraft={onDraft} {...props} />);
  return onDraft;
}

describe('DraftNoteButton', () => {
  beforeEach(() => vi.clearAllMocks());

  it('drafts into an empty field, names the engine and says the text is a draft', async () => {
    draftReviewNote.mockResolvedValue(answer());
    const onDraft = renderButton();

    fireEvent.click(screen.getByRole('button', { name: 'Draft the remarks' }));

    expect(draftReviewNote).toHaveBeenCalledWith({
      flow: 'event',
      record_id: 7,
      decision: 'returned',
      marks: [{ requirement: 'Activity Proposal', mark: 'needs_changes', note: 'No signature' }],
      reviewer_notes: '',
    });
    await waitFor(() => expect(onDraft).toHaveBeenCalledWith({ text: 'Please attach the signed proposal.', aiOutputId: 41, engine: 'claude' }));
    expect(screen.getByText('Claude')).toBeInTheDocument();
    expect(screen.getByText('Draft. Read and edit before you send.')).toBeInTheDocument();
  });

  it('shows the built-in rules in plain words when the template wrote the text', async () => {
    draftReviewNote.mockResolvedValue(answer({ engine: 'template' }));
    renderButton();

    fireEvent.click(screen.getByRole('button', { name: 'Draft the remarks' }));

    expect(await screen.findByText('Built-in rules')).toBeInTheDocument();
  });

  it('reads the response whether or not it is wrapped in data', async () => {
    draftReviewNote.mockResolvedValue({ data: { success: true, data: { text: 'Wrapped text.', engine: 'groq', ai_output_id: 5 } } });
    const onDraft = renderButton();

    fireEvent.click(screen.getByRole('button', { name: 'Draft the remarks' }));

    await waitFor(() => expect(onDraft).toHaveBeenCalledWith({ text: 'Wrapped text.', aiOutputId: 5, engine: 'groq' }));
  });

  it('offers to improve the wording when the field has text, and asks before replacing it', async () => {
    draftReviewNote.mockResolvedValue(answer({ text: 'Reworded.' }));
    const onDraft = renderButton({ value: 'pls fix the proposal' });

    fireEvent.click(screen.getByRole('button', { name: 'Improve my wording' }));

    expect(draftReviewNote).not.toHaveBeenCalled();
    expect(screen.getByText('Your remarks will be replaced with a reworded version. Replace them?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Replace my text' }));

    expect(draftReviewNote).toHaveBeenCalledWith(expect.objectContaining({ current_text: 'pls fix the proposal' }));
    await waitFor(() => expect(onDraft).toHaveBeenCalledWith(expect.objectContaining({ text: 'Reworded.' })));
  });

  it('keeps what the reviewer typed when they decline to replace it', async () => {
    const onDraft = renderButton({ value: 'pls fix the proposal' });

    fireEvent.click(screen.getByRole('button', { name: 'Improve my wording' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }));

    expect(draftReviewNote).not.toHaveBeenCalled();
    expect(onDraft).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Improve my wording' })).toBeInTheDocument();
  });

  it('leaves the field as it was and says so when the draft fails', async () => {
    draftReviewNote.mockRejectedValue({ response: { status: 500, data: { message: 'boom' } } });
    const onDraft = renderButton({ value: 'my own words' });

    fireEvent.click(screen.getByRole('button', { name: 'Improve my wording' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace my text' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not draft the remarks. What you typed is unchanged. Try again.');
    expect(onDraft).not.toHaveBeenCalled();
    expect(screen.queryByText('Draft. Read and edit before you send.')).not.toBeInTheDocument();
  });

  it('treats an empty draft as a failure instead of blanking the field', async () => {
    draftReviewNote.mockResolvedValue(answer({ text: '   ' }));
    const onDraft = renderButton();

    fireEvent.click(screen.getByRole('button', { name: 'Draft the remarks' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onDraft).not.toHaveBeenCalled();
  });

  it('passes the reviewer notes along and can be disabled', async () => {
    draftReviewNote.mockResolvedValue(answer());
    renderButton({ reviewerNotes: 'Budget lines do not add up.' });
    fireEvent.click(screen.getByRole('button', { name: 'Draft the remarks' }));
    expect(draftReviewNote).toHaveBeenCalledWith(expect.objectContaining({ reviewer_notes: 'Budget lines do not add up.' }));
  });

  it('does not call the service while disabled', () => {
    renderButton({ disabled: true });
    expect(screen.getByRole('button', { name: 'Draft the remarks' })).toBeDisabled();
  });

  it('shows words with the spinner while it drafts, and keeps the button marked busy', async () => {
    let finish;
    draftReviewNote.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderButton();

    fireEvent.click(screen.getByRole('button', { name: 'Draft the remarks' }));

    const busy = screen.getByRole('button', { name: 'Drafting...' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).toBeDisabled();
    expect(busy).toHaveTextContent('Drafting...');
    expect(busy.querySelector('.opacity-0')).toBeNull();

    await act(async () => { finish(answer()); });
    expect(screen.getByRole('button', { name: 'Draft the remarks' })).not.toHaveAttribute('aria-busy');
  });

  it('drops the consent error once the person has agreed, and keeps other errors', async () => {
    draftReviewNote.mockRejectedValue({ isPrivacyConsentRequired: true, response: { status: 403, data: { code: 'privacy_consent_required', message: 'Agree to the privacy notice first.' } } });
    renderButton();

    fireEvent.click(screen.getByRole('button', { name: 'Draft the remarks' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Agree to the privacy notice first.');

    act(() => { window.dispatchEvent(new Event(PRIVACY_CONSENT_RECORDED_EVENT)); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    draftReviewNote.mockRejectedValue({ response: { status: 500, data: { message: 'boom' } } });
    fireEvent.click(screen.getByRole('button', { name: 'Draft the remarks' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    act(() => { window.dispatchEvent(new Event(PRIVACY_CONSENT_RECORDED_EVENT)); });
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

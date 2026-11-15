import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from './api';
import { draftReviewNote, recordAiOutcome, recordDraftOutcome } from './aiDraftService';

vi.mock('./api', () => ({ default: { post: vi.fn() } }));

describe('aiDraftService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends the final text for the draft and returns the request', () => {
    const request = Promise.resolve({ data: { success: true } });
    api.post.mockReturnValue(request);

    expect(recordAiOutcome(12, 'Please attach the proposal.')).toBe(request);
    expect(api.post).toHaveBeenCalledWith('/ai/outputs/12/outcome', { final_text: 'Please attach the proposal.' });
  });

  it('sends null when the draft was dropped, whether null or undefined is passed', () => {
    recordAiOutcome(12, null);
    recordAiOutcome(13);
    expect(api.post).toHaveBeenNthCalledWith(1, '/ai/outputs/12/outcome', { final_text: null });
    expect(api.post).toHaveBeenNthCalledWith(2, '/ai/outputs/13/outcome', { final_text: null });
  });

  it('posts the reviewer context to the remarks drafter and returns the request', () => {
    const request = Promise.resolve({ data: { text: 'x' } });
    api.post.mockReturnValue(request);
    const payload = { flow: 'event', record_id: 3, decision: 'returned', marks: [], reviewer_notes: '' };

    expect(draftReviewNote(payload)).toBe(request);
    expect(api.post).toHaveBeenCalledWith('/ai/review-notes/draft', payload);
  });

  it('records a draft outcome, drops a failed write, and does nothing without a draft', async () => {
    api.post.mockRejectedValue(new Error('offline'));

    recordDraftOutcome(21, 'Final words.');
    recordDraftOutcome(null, 'Final words.');
    await Promise.resolve();

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/ai/outputs/21/outcome', { final_text: 'Final words.' });
  });
});

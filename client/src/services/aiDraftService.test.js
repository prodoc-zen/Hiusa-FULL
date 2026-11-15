import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from './api';
import { draftHandoverNote, draftSemesterNarrative, recordAiOutcome } from './aiDraftService';

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

  it('asks for the narrative of one semester and returns the draft', async () => {
    const draft = { text: 'x', sections: { accomplishments: 'x' }, engine: 'claude', ai_output_id: 5, facts: {} };
    api.post.mockResolvedValue({ data: draft });

    await expect(draftSemesterNarrative(7)).resolves.toBe(draft);
    expect(api.post).toHaveBeenCalledWith('/compliance/semester-narrative', { semester_id: 7 });
  });

  it('asks for the remarks of one handover item and returns the draft', async () => {
    const draft = { text: '- Nothing is recorded as unsettled.', engine: 'template', ai_output_id: 9 };
    api.post.mockResolvedValue({ data: draft });

    await expect(draftHandoverNote('finance')).resolves.toBe(draft);
    expect(api.post).toHaveBeenCalledWith('/officer-handovers/draft-note', { category: 'finance' });
  });
});

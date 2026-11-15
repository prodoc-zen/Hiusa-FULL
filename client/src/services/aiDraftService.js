import api from './api';

// Tells the server what became of a drafted text: the final text the person used, or null when they dropped it.
// The caller swallows a failure, because a note about the draft must never block the person's own action.
export const recordAiOutcome = (aiOutputId, finalText) =>
  api.post(`/ai/outputs/${aiOutputId}/outcome`, { final_text: finalText ?? null });

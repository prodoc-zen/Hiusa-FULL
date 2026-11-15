import api from './api';

// Tells the server what became of a drafted text: the final text the person used, or null when they dropped it.
// The caller swallows a failure, because a note about the draft must never block the person's own action.
export const recordAiOutcome = (aiOutputId, finalText) =>
  api.post(`/ai/outputs/${aiOutputId}/outcome`, { final_text: finalText ?? null });

// The four narrative sections of the Semestral Accomplishment Report for one semester: { text, sections, engine, ai_output_id, facts }.
export const draftSemesterNarrative = async (semesterId) => (await api.post('/compliance/semester-narrative', { semester_id: semesterId })).data;

// The remarks of one handover item (finance, events, tasks, organization, election or compliance): { text, engine, ai_output_id }.
export const draftHandoverNote = async (category) => (await api.post('/officer-handovers/draft-note', { category })).data;

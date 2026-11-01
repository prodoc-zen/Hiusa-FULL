import api from './api';

export const getAiAssistantOverview = () => api.get('/ai/assistant');

export const askAiAssistant = (payload) => api.post('/ai/assistant/ask', payload);


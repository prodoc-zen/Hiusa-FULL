import api from './api';

export const getStudentFeed = async (page = 1, perPage = 12) => {
  const response = await api.get('/student/feed', { params: { page, per_page: perPage } });
  return response.data;
};

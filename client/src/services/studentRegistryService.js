import api from './api';

const unwrap = (response) => response.data;

export const getStudentRegistry = async (params) => unwrap(await api.get('/students/registry', { params }));

export const previewStudentRegistry = async (file) => {
  const body = new FormData();
  body.append('file', file);
  return unwrap(await api.post('/students/registry/preview', body));
};

export const applyStudentRegistry = async (file, hash, previewToken) => {
  const body = new FormData();
  body.append('file', file);
  body.append('hash', hash);
  body.append('preview_token', previewToken);
  body.append('confirm', '1');
  return unwrap(await api.post('/students/registry/apply', body));
};

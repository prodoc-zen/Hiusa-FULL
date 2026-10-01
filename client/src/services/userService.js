import api from './api';

const unwrap = (response) => response.data;

export const getUsers = async (params) => unwrap(await api.get('/users', { params }));
export const createUser = async (payload) => unwrap(await api.post('/users', payload));
export const updateUser = async (id, payload) => unwrap(await api.put(`/users/${id}`, payload));
export const uploadUserPhoto = async (id, file) => {
  const body = new FormData();
  body.append('photo', file);
  return unwrap(await api.post(`/users/${id}/photo`, body));
};
export const importUsers = async (file, dryRun) => {
  const body = new FormData();
  body.append('file', file);
  body.append('dry_run', dryRun ? '1' : '0');
  return unwrap(await api.post('/users/import', body));
};
export const getSboPositions = async (params) => unwrap(await api.get('/sbo-positions', { params }));
export const createSboPosition = async (payload) => unwrap(await api.post('/sbo-positions', payload));
export const updateSboPosition = async (id, payload) => unwrap(await api.put(`/sbo-positions/${id}`, payload));
export const deleteSboPosition = async (id) => unwrap(await api.delete(`/sbo-positions/${id}`));
export const getAcademicStructure = async () => unwrap(await api.get('/academic-structure'));
export const createAcademicProgram = async (payload) => unwrap(await api.post('/academic-structure/programs', payload));
export const updateAcademicProgram = async (id, payload) => unwrap(await api.put(`/academic-structure/programs/${id}`, payload));
export const deleteAcademicProgram = async (id) => unwrap(await api.delete(`/academic-structure/programs/${id}`));
export const previewClassList = async (file) => {
  const body = new FormData();
  body.append('file', file);
  return unwrap(await api.post('/academic-structure/class-list/preview', body));
};
export const applyClassList = async (file, hash, previewToken) => {
  const body = new FormData();
  body.append('file', file);
  body.append('hash', hash);
  body.append('preview_token', previewToken);
  body.append('confirm', '1');
  return unwrap(await api.post('/academic-structure/class-list/apply', body));
};
export const disableUser = async (id) => unwrap(await api.post(`/users/${id}/disable`));
export const reactivateUser = async (id) => unwrap(await api.post(`/users/${id}/reactivate`));
export const deleteUser = async (id) => unwrap(await api.delete(`/users/${id}`));

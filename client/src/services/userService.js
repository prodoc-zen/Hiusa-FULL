import api from './api';

const unwrap = (response) => response.data;

export const getUsers = async (params) => unwrap(await api.get('/users', { params }));
export const createUser = async (payload) => unwrap(await api.post('/users', payload));
export const updateUser = async (id, payload) => unwrap(await api.put(`/users/${id}`, payload));
export const getSboPositions = async () => unwrap(await api.get('/sbo-positions'));
export const createSboPosition = async (payload) => unwrap(await api.post('/sbo-positions', payload));
export const disableUser = async (id) => unwrap(await api.post(`/users/${id}/disable`));
export const reactivateUser = async (id) => unwrap(await api.post(`/users/${id}/reactivate`));
export const deleteUser = async (id) => unwrap(await api.delete(`/users/${id}`));

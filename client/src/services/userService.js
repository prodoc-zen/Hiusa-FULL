import api from './api';

const unwrap = (response) => response.data;

export const getUsers = async () => unwrap(await api.get('/users'));
export const createUser = async (payload) => unwrap(await api.post('/users', payload));
export const updateUser = async (id, payload) => unwrap(await api.put(`/users/${id}`, payload));
export const disableUser = async (id) => unwrap(await api.post(`/users/${id}/disable`));
export const deleteUser = async (id) => unwrap(await api.delete(`/users/${id}`));

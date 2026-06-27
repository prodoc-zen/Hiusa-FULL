import api from './api';
import { register } from './authService';

const unwrap = (response) => response.data;

export const getUsers = async () => unwrap(await api.get('/users'));
export const updateUser = async (id, payload) => unwrap(await api.put(`/users/${id}`, payload));
export const disableUser = async (id) => unwrap(await api.post(`/users/${id}/disable`));
export const deleteUser = async (id) => unwrap(await api.delete(`/users/${id}`));

export const createUser = async (payload) => unwrap(await register(payload));

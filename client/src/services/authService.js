import api from './api';

export const login = (credentials) => {
  return api.post('/login', credentials);
};

export const register = (data) => {
  return api.post('/register', data);
};

export const logout = () => {
  return api.post('/logout').finally(() => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
  });
};

export const requestPasswordReset = (data) => {
  return api.post('/password/forgot', data);
};

export const validatePasswordResetToken = (data) => {
  return api.post('/password/reset/validate', data);
};

export const resetPassword = (data) => {
  return api.post('/password/reset', data);
};

export const getCurrentUser = async () => {
  const response = await api.get("/user");

  const user = response.data;

  localStorage.setItem("user", JSON.stringify(user));
  return user;
};
 




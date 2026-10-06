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

export const getAccountProfiles = () => api.get('/user/profiles');

export const switchAccountProfile = (profileId) => api.post(`/user/profiles/${profileId}/switch`);

export const inviteAccountProfile = (data) => api.post('/account-profiles/invite', data);
export const getProfileOrganizations = () => api.get('/account-profiles/organizations');
export const getProfileCandidates = (params) => api.get('/account-profiles/candidates', { params });
export const getManagedAccountProfiles = (params) => api.get('/account-profiles', { params });
export const deleteAccountProfile = (profileId) => api.delete(`/account-profiles/${profileId}`);
 




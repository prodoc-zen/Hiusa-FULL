import api from './api';

export const getAnnouncements = (params) =>
  api.get('/announcements', { params });

function toAnnouncementFormData(data, method = null) {
  const formData = new FormData();
  if (method) formData.append('_method', method);
  Object.entries(data).forEach(([key, value]) => {
    if (key === 'imageFile') {
      if (value) formData.append('image', value);
    } else if (value !== undefined && value !== null) {
      formData.append(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
    }
  });
  return formData;
}

export const createAnnouncement = (data) =>
  api.post('/announcements', data.imageFile ? toAnnouncementFormData(data) : data);

export const generateAnnouncementDraft = (data) =>
  api.post('/announcements/generate-draft', data);

export const updateAnnouncement = (id, data) => {
  if (data.imageFile || data.remove_image) {
    return api.post(`/announcements/${id}`, toAnnouncementFormData(data, 'PUT'));
  }
  return api.put(`/announcements/${id}`, data);
};

export const deleteAnnouncement = (id) =>
  api.delete(`/announcements/${id}`);

export const togglePublish = (id) =>
  api.patch(`/announcements/${id}/publish`);

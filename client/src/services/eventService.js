import api from './api';

export const getEvents = (params) =>
  api.get('/events', { params });

export const getEvent = (id) =>
  api.get(`/events/${id}`);

function toEventFormData(data, method = null) {
  const formData = new FormData();
  if (method) formData.append('_method', method);
  Object.entries(data).forEach(([key, value]) => {
    if (key === 'imageFile') {
      if (value) formData.append('image', value);
    } else if (key === 'planning_details') {
      Object.entries(value || {}).forEach(([detailKey, detailValue]) => formData.append(`planning_details[${detailKey}]`, detailValue || ''));
    } else if (value !== undefined && value !== null) {
      formData.append(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
    }
  });
  return formData;
}

export const createEvent = (data) =>
  api.post('/events', data.imageFile ? toEventFormData(data) : data);

export const updateEvent = (id, data) => data.imageFile || data.remove_image
  ? api.post(`/events/${id}`, toEventFormData(data, 'PUT'))
  : api.put(`/events/${id}`, data);

export const deleteEvent = (id) =>
  api.delete(`/events/${id}`);

export const updateEventStatus = (id, status) =>
  api.patch(`/events/${id}/status`, { status });

export const generateEventPlan = (id, data) =>
  api.post(`/events/${id}/generate-plan`, data);

export const getAttendance = (id) =>
  api.get(`/events/${id}/attendance`);

export const recordAttendance = (id, data) =>
  api.post(`/events/${id}/attendance`, data);

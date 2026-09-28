import api from './api';

export const getEvents = (params) =>
  api.get('/events', { params });

export const getEvent = (id) =>
  api.get(`/events/${id}`);

export const getEventRequirements = () => api.get('/event-requirements');
export const createEventRequirement = (data) => api.post('/event-requirements', data);
export const updateEventRequirement = (id, data) => api.put(`/event-requirements/${id}`, data);
export const reorderEventRequirements = (ids) => api.put('/event-requirements/order', { ids });
export const deleteEventRequirement = (id) => api.delete(`/event-requirements/${id}`);
export const getEventSubmission = (id) => api.get(`/events/${id}/submission`);
export const submitEventRequirements = (id, files) => {
  const data = new FormData();
  Object.entries(files).forEach(([requirementId, file]) => {
    if (file) data.append(`documents[${requirementId}]`, file);
  });
  return api.post(`/events/${id}/submission`, data);
};
export const downloadEventRequirementFile = (eventId, fileId) =>
  api.get(`/events/${eventId}/submission/files/${fileId}`, { responseType: 'blob' });

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

export const getEventWorkflowHistory = (id) =>
  api.get(`/events/${id}/workflows`);

export const confirmEventWorkflow = (eventId, outputId, tasks) =>
  api.post(`/events/${eventId}/workflows/${outputId}/confirm`, { tasks });

export const discardEventWorkflow = (eventId, outputId) =>
  api.patch(`/events/${eventId}/workflows/${outputId}/discard`);

export const getAttendance = (id, params) =>
  api.get(`/events/${id}/attendance`, { params });

export const recordAttendance = (id, data) =>
  api.post(`/events/${id}/attendance`, data);

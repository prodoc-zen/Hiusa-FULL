import api from './api';

const capturePayload = (capture) => ({ samples: capture.samples, sample_format: capture.sampleFormat });

export const enrollFingerprint = (userId, capture) => api.post(`/users/${userId}/fingerprint`, {
  ...capturePayload(capture),
  finger_index: 0,
  consent_confirmed: true,
});

export const removeFingerprint = (userId) => api.delete(`/users/${userId}/fingerprint`);
export const identifyFingerprint = (capture) => api.post('/fingerprints/identify', capturePayload(capture));
export const identifyAndAttend = (eventId, capture) => api.post(`/events/${eventId}/attendance/fingerprint`, capturePayload(capture));

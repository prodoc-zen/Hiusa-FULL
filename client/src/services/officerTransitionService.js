import api from './api';

const unwrap = (response) => response.data;

export const getOfficers = async (params = {}) => unwrap(await api.get('/officer-transition/officers', { params }));
export const getHandover = async () => unwrap(await api.get('/officer-transition/handover'));

export const prepareHandover = async (id, { attachmentFile, ...fields } = {}) => {
  const fd = new FormData();
  fd.append('_method', 'PUT');
  Object.entries(fields).forEach(([key, value]) => {
    if (value !== undefined && value !== null) fd.append(key, String(value));
  });
  if (attachmentFile) fd.append('attachment', attachmentFile);
  return unwrap(await api.post(`/officer-transition/handover/${id}`, fd));
};

export const acknowledgeHandover = async (id) => unwrap(await api.post(`/officer-transition/handover/${id}/acknowledge`));
// The attachment is private, so the page opens this path through openProtectedFile.
export const handoverAttachmentUrl = (id) => `/officer-transition/handover/${id}/attachment`;
export const getRenewalTracker = async () => unwrap(await api.get('/officer-transition/renewal'));

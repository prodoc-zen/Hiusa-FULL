import api from './api';

// SAO compliance requirement catalog (SUPER_ADMIN defines, ADMIN reads its own org's active set).
export const getRequirementTypes = (params) => api.get('/compliance/requirement-types', { params });
export const createRequirementType = (data) => api.post('/compliance/requirement-types', data);
export const updateRequirementType = (id, data) => api.put(`/compliance/requirement-types/${id}`, data);

// Accreditation status: SUPER_ADMIN gets every organization, ADMIN gets its own.
export const getComplianceStatus = (params) => api.get('/compliance/status', { params });

// Submissions: SUPER_ADMIN reviews across organizations, ADMIN sees its own.
export const getSubmissions = (params) => api.get('/compliance/submissions', { params });

export const submitComplianceDocument = (requirementTypeId, file, onUploadProgress) => {
  const formData = new FormData();
  formData.append('requirement_type_id', requirementTypeId);
  formData.append('document', file);
  return api.post('/compliance/submissions', formData, { onUploadProgress });
};

export const reviewSubmission = (id, data) => api.patch(`/compliance/submissions/${id}/review`, data);

export const downloadSubmissionDocument = (id) =>
  api.get(`/compliance/submissions/${id}/document`, { responseType: 'blob' });

import api from './api';

export const getApplicantGrants = () => api.get('/college/applicant-grants', { cache: false });
export const allowStudentToApply = (schoolId) => api.post('/college/applicant-grants', { school_id: schoolId });
export const revokeApplicantGrant = (id) => api.delete(`/college/applicant-grants/${id}`);

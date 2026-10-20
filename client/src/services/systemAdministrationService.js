import api from './api';

const unwrap = async (response) => (await response).data;

export const getSystemOverview = (params) => unwrap(api.get('/system/overview', { params }));
export const getSystemUsers = (params) => unwrap(api.get('/system/users', { params }));
export const getSystemUser = (schoolId) => unwrap(api.get(`/system/users/${schoolId}`));
export const deleteSystemUser = (schoolId) => unwrap(api.delete(`/system/users/${schoolId}`, { data: { school_id: schoolId } }));
export const getSystemOrganizations = (params) => unwrap(api.get('/system/organizations', { params }));
export const createUnifiedOrganization = (data) => unwrap(api.post('/system/unified-organizations', data));
export const updateSystemOrganization = (id, payload) => unwrap(api.put(`/system/organizations/${id}`, payload));
export const uploadSystemOrganizationLogo = (id, file) => {
  const data = new FormData();
  data.append('logo', file);
  return unwrap(api.post(`/system/organizations/${id}/logo`, data));
};
export const getSystemColleges = () => unwrap(api.get('/system/colleges'));
export const createSystemCollege = (payload) => unwrap(api.post('/system/colleges', payload));
export const uploadSystemCollegeLogo = (id, file) => {
  const data = new FormData();
  data.append('logo', file);
  return unwrap(api.post(`/system/colleges/${id}/logo`, data));
};
export const createDepartmentHead = (collegeId, payload) => unwrap(api.post(`/system/colleges/${collegeId}/department-head`, payload));
export const deleteSystemCollege = (id, transferToCollegeId) => unwrap(api.delete(`/system/colleges/${id}`, { data: { transfer_to_college_id: transferToCollegeId || null } }));
export const permanentlyDeleteCollege = (id, confirmationName) => unwrap(api.delete(`/system/colleges/${id}`, { data: { mode: 'permanent', confirmation_name: confirmationName } }));
export const archiveSystemCollege = (id) => unwrap(api.post(`/system/colleges/${id}/archive`));
export const restoreSystemCollege = (id) => unwrap(api.post(`/system/colleges/${id}/restore`));
export const deleteSystemOrganization = (id, confirmationName) => unwrap(api.delete(`/system/organizations/${id}`, { data: { confirmation_name: confirmationName } }));
export const updateDepartmentHead = (id, payload) => unwrap(api.put(`/system/department-heads/${id}`, payload));
export const resetDepartmentHeadPassword = (id) => unwrap(api.post(`/system/department-heads/${id}/password-reset`));
export const getAcademicYears = () => unwrap(api.get('/system/academic-years'));
export const getAcademicPeriods = () => unwrap(api.get('/academic-periods'));
export const getActiveAcademicPeriod = () => unwrap(api.get('/academic-periods/active'));
export const createAcademicSemester = (yearId, payload) => unwrap(api.post(`/system/academic-years/${yearId}/semesters`, payload));
export const activateAcademicSemester = (id) => unwrap(api.patch(`/system/academic-semesters/${id}/active`));
export const closeAcademicSemester = (id) => unwrap(api.patch(`/system/academic-semesters/${id}/close`));
export const createAcademicYear = (payload) => unwrap(api.post('/system/academic-years', payload));
export const updateAcademicYear = (id, payload) => unwrap(api.put(`/system/academic-years/${id}`, payload));
export const makeAcademicYearCurrent = (id) => unwrap(api.patch(`/system/academic-years/${id}/current`));
export const closeAcademicYear = (id) => unwrap(api.patch(`/system/academic-years/${id}/close`));
export const deleteAcademicYear = (id) => unwrap(api.delete(`/system/academic-years/${id}`));
export const getSystemAdmins = (params) => unwrap(api.get('/system/admins', { params }));
export const createSystemAdmin = (payload) => unwrap(api.post('/system/admins', payload));
export const updateSystemAdmin = (id, payload) => unwrap(api.put(`/system/admins/${id}`, payload));
export const deleteSystemAdmin = (id) => unwrap(api.delete(`/system/admins/${id}`));
export const initiateSystemAdminPasswordReset = (id) => unwrap(api.post(`/system/admins/${id}/password-reset`));
export const handoverSystemAdmin = (id, payload) => unwrap(api.post(`/system/admins/${id}/handover`, payload));
export const getSystemOrganizationMembers = (organizationId, params) => unwrap(api.get(`/system/organizations/${organizationId}/members`, { params }));
export const getGlobalAnnouncements = (params) => unwrap(api.get('/system/announcements', { params }));
function announcementUpload(payload, updating = false) {
  const { image, ...fields } = payload;
  if (!image) return payload;
  const data = new FormData();
  data.append('payload', JSON.stringify(fields));
  data.append('image', image);
  if (updating) data.append('_method', 'PUT');
  return data;
}
export const createGlobalAnnouncement = (payload) => unwrap(api.post('/system/announcements', announcementUpload(payload)));
export const updateGlobalAnnouncement = (id, payload) => unwrap(payload.image ? api.post(`/system/announcements/${id}`, announcementUpload(payload, true)) : api.put(`/system/announcements/${id}`, payload));
export const archiveGlobalAnnouncement = (id) => unwrap(api.patch(`/system/announcements/${id}/archive`));
export const getSystemAgency = (params) => unwrap(params ? api.get('/system/agency', { params }) : api.get('/system/agency'));
export const getSystemOrganizationOverview = (id) => unwrap(api.get(`/system/organizations/${id}/overview`));
export const reviewSystemOrganization = (id, payload) => unwrap(api.patch(`/system/organizations/${id}/review`, payload));
export const archiveSystemOrganization = (id, payload) => unwrap(api.post(`/system/organizations/${id}/archive`, payload));
export const restoreSystemOrganization = (id) => unwrap(api.post(`/system/organizations/${id}/restore`));
export const deleteAcademicSemester = (id) => unwrap(api.delete(`/system/academic-semesters/${id}`));
export const deleteGlobalAnnouncement = (id) => unwrap(api.delete(`/system/announcements/${id}`));

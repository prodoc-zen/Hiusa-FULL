import api from './api';

const unwrap = (response) => response.data;

export const getElections = async (params = {}) => unwrap(await api.get('/elections', { params }));
export const getElectionDetails = async (id) => unwrap(await api.get(`/elections/${id}`));
// Position keys that are only sent when the form set them, so the short form posts exactly what it did before.
const POSITION_TEXT_KEYS = ['description', 'other_qualifications', 'vote_limit'];

function toElectionFormData(payload, method = null) {
  const fd = new FormData();
  if (method) fd.append('_method', method);

  Object.entries(payload).forEach(([key, value]) => {
    if (key === 'imageFile') {
      if (value) fd.append('image', value);
      return;
    }
    if (key === 'informativeLetterFile') {
      if (value) fd.append('informative_letter', value);
      return;
    }
    if (key === 'positions') {
      value.forEach((position, index) => {
        fd.append(`positions[${index}][title]`, position.title);
        fd.append(`positions[${index}][max_winners]`, String(position.max_winners));
        POSITION_TEXT_KEYS.forEach((field) => {
          if (position[field] !== undefined && position[field] !== null) fd.append(`positions[${index}][${field}]`, String(position[field]));
        });
        ['is_executive', 'is_active'].forEach((field) => {
          if (position[field] !== undefined && position[field] !== null) fd.append(`positions[${index}][${field}]`, position[field] ? '1' : '0');
        });
        (position.eligible_year_levels ?? []).forEach((level) => {
          fd.append(`positions[${index}][eligible_year_levels][]`, String(level));
        });
      });
      return;
    }
    if (typeof value === 'boolean') {
      fd.append(key, value ? '1' : '0');
      return;
    }
    if (value !== undefined && value !== null) fd.append(key, String(value));
  });

  return fd;
}

// A request carries files or the positions with their new fields as FormData; anything else stays JSON, as today.
const needsFormData = (payload) => Boolean(payload.imageFile || payload.informativeLetterFile || Array.isArray(payload.positions));

export const createElection = async (payload) => {
  const requestPayload = needsFormData(payload) ? toElectionFormData(payload) : payload;
  return unwrap(await api.post('/elections', requestPayload));
};
export const updateElection = async (id, payload) => {
  if (needsFormData(payload) || payload.remove_image) {
    return unwrap(await api.post(`/elections/${id}`, toElectionFormData(payload, 'PUT')));
  }
  return unwrap(await api.put(`/elections/${id}`, payload));
};
export const submitElection = async (id) => unwrap(await api.post(`/elections/${id}/submit`));
export const suspendElection = async (id, reason) => unwrap(await api.post(`/elections/${id}/suspend`, { reason }));
export const resumeElection = async (id) => unwrap(await api.post(`/elections/${id}/resume`));
export const cancelElection = async (id, reason) => unwrap(await api.post(`/elections/${id}/cancel`, { reason }));
export const getApprovalHistory = async (id) => unwrap(await api.get(`/elections/${id}/approval-history`));
export const finalizeElection = async (id) => unwrap(await api.patch(`/elections/${id}/finalize`));
export const deleteElection = async (id, options = {}) => unwrap(await api.delete(`/elections/${id}`, { params: options }));

export const getElectionPositions = async (id) => unwrap(await api.get(`/elections/${id}/positions`));
export const createElectionPosition = async (id, payload) => unwrap(await api.post(`/elections/${id}/positions`, payload));
export const updateElectionPosition = async (id, positionId, payload) => unwrap(await api.put(`/elections/${id}/positions/${positionId}`, payload));
export const deleteElectionPosition = async (id, positionId) => unwrap(await api.delete(`/elections/${id}/positions/${positionId}`));

export const getElectionCandidates = async (id) => unwrap(await api.get(`/elections/${id}/candidates`));

function toCandidateFormData(payload) {
  const fd = new FormData();
  Object.entries(payload).forEach(([k, v]) => {
    if (k === 'imageFile') { if (v) fd.append('image', v); }
    else if (v !== undefined && v !== null) fd.append(k, String(v));
  });
  return fd;
}

export const createElectionCandidate = async (id, payload) =>
  unwrap(await api.post(`/elections/${id}/candidates`, toCandidateFormData(payload)));

export const updateElectionCandidate = async (id, candidateId, payload) => {
  const fd = toCandidateFormData(payload);
  fd.append('_method', 'PUT');
  return unwrap(await api.post(`/elections/${id}/candidates/${candidateId}`, fd));
};

export const deleteElectionCandidate = async (id, candidateId) => unwrap(await api.delete(`/elections/${id}/candidates/${candidateId}`));

function toPartylistFormData(payload) {
  const fd = new FormData();
  Object.entries(payload).forEach(([k, v]) => {
    if (k === 'bannerFile') { if (v) fd.append('banner', v); }
    else if (v !== undefined && v !== null) fd.append(k, String(v));
  });
  return fd;
}

export const getPartylists = async () => unwrap(await api.get('/partylists'));
export const createPartylist = async (payload) =>
  unwrap(await api.post('/partylists', toPartylistFormData(payload)));
export const updatePartylist = async (id, payload) => {
  const fd = toPartylistFormData(payload);
  fd.append('_method', 'PUT');
  return unwrap(await api.post(`/partylists/${id}`, fd));
};
export const deletePartylist = async (id) => unwrap(await api.delete(`/partylists/${id}`));

export const getUsers = async (params) => unwrap(await api.get('/users', { params }));

// selections: one { position_id, candidate_ids: [] } per position on the ballot; an empty list skips the position.
export const castVotes = async (electionId, selections) => unwrap(await api.post(`/elections/${electionId}/vote`, { selections }));
export const getElectionResults = async (id) => unwrap(await api.get(`/elections/${id}/results`));
export const getElectionVoters = async (id, params = {}) => unwrap(await api.get(`/elections/${id}/voters`, { params }));

// Candidacy filing and screening. Files travel as multipart; the payload names the file fields
// photoFile, cocFile, credentialsFile and bannerFile, the server reads photo, coc, credentials and banner.
const APPLICATION_FILE_FIELDS = {
  photoFile: 'photo',
  cocFile: 'coc',
  credentialsFile: 'credentials',
  bannerFile: 'banner',
};

function toFilingFormData(payload, method = null) {
  const fd = new FormData();
  if (method) fd.append('_method', method);
  Object.entries(payload).forEach(([key, value]) => {
    if (APPLICATION_FILE_FIELDS[key]) {
      if (value) fd.append(APPLICATION_FILE_FIELDS[key], value);
    } else if (typeof value === 'boolean') {
      fd.append(key, value ? '1' : '0');
    } else if (value !== undefined && value !== null) {
      fd.append(key, String(value));
    }
  });
  return fd;
}

export const getApplications = async (id, params = {}) => unwrap(await api.get(`/elections/${id}/applications`, { params }));
export const getMyApplications = async (id) => unwrap(await api.get(`/elections/${id}/applications/mine`));
export const fileApplication = async (id, payload) => unwrap(await api.post(`/elections/${id}/applications`, toFilingFormData(payload)));
export const updateApplication = async (id, applicationId, payload) =>
  unwrap(await api.post(`/elections/${id}/applications/${applicationId}`, toFilingFormData(payload, 'PUT')));
export const submitApplication = async (id, applicationId) => unwrap(await api.post(`/elections/${id}/applications/${applicationId}/submit`));
export const withdrawApplication = async (id, applicationId) => unwrap(await api.post(`/elections/${id}/applications/${applicationId}/withdraw`));
export const reviewApplication = async (id, applicationId, { decision, notes }) =>
  unwrap(await api.patch(`/elections/${id}/applications/${applicationId}/review`, { decision, notes }));
// Private documents open through the API in a new tab, so this is the path the page hands to the file opener.
export const applicationFileUrl = (id, applicationId, kind) => `/elections/${id}/applications/${applicationId}/files/${kind}`;

export const createSlate = async (id, payload) => unwrap(await api.post(`/elections/${id}/slates`, toFilingFormData(payload)));
export const updateSlate = async (id, partylistId, payload) =>
  unwrap(await api.post(`/elections/${id}/slates/${partylistId}`, toFilingFormData(payload, 'PUT')));
export const addSlateMember = async (id, partylistId, payload) =>
  unwrap(await api.post(`/elections/${id}/slates/${partylistId}/members`, toFilingFormData(payload)));
export const submitSlate = async (id, partylistId) => unwrap(await api.post(`/elections/${id}/slates/${partylistId}/submit`));

export const scheduleRunoff = async (id, payload) => unwrap(await api.post(`/elections/${id}/runoff`, payload));
export const resolveTie = async (id, positionId, payload) =>
  unwrap(await api.post(`/elections/${id}/positions/${positionId}/tie-resolution`, payload));

export const getElectionReport = async (id, type) => unwrap(await api.get(`/elections/${id}/reports/${type}`, { params: { format: 'json' } }));
export const electionReportPdfUrl = (id, type) => `/elections/${id}/reports/${type}?format=pdf`;

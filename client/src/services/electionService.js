import api from './api';

const unwrap = (response) => response.data;

export const getElections = async () => unwrap(await api.get('/elections'));
export const getElectionDetails = async (id) => unwrap(await api.get(`/elections/${id}`));
export const createElection = async (payload) => unwrap(await api.post('/elections', payload));
export const updateElection = async (id, payload) => unwrap(await api.put(`/elections/${id}`, payload));
export const deleteElection = async (id) => unwrap(await api.delete(`/elections/${id}`));

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

export const getUsers = async () => unwrap(await api.get('/users'));

export const castVotes = async (electionId, votesData) => unwrap(await api.post(`/elections/${electionId}/vote`, { votes: votesData }));
export const getElectionResults = async (id) => unwrap(await api.get(`/elections/${id}/results`));
export const getElectionVoters = async (id) => unwrap(await api.get(`/elections/${id}/voters`));

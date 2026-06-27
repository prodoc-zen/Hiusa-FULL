/* ──────────────────────────────────────────────────────────────────────────────
   Election Module — Mock Data
   All field names match the database schema exactly.
   ────────────────────────────────────────────────────────────────────────────── */

// ── Users (subset for candidate / voter display) ────────────────────────────
export const MOCK_USERS = [
  { id: 1, school_id: '2024-00127', first_name: 'Juan', last_name: 'Dela Cruz', email: 'j.delacruz@hiusa.edu', role: 'student', is_member: true },
  { id: 2, school_id: '2024-00156', first_name: 'Ana', last_name: 'Reyes', email: 'a.reyes@hiusa.edu', role: 'student', is_member: true },
  { id: 3, school_id: '2024-00088', first_name: 'Kiko', last_name: 'Manalo', email: 'k.manalo@hiusa.edu', role: 'student', is_member: true },
  { id: 4, school_id: '2024-00209', first_name: 'Bea', last_name: 'Torres', email: 'b.torres@hiusa.edu', role: 'student', is_member: true },
  { id: 5, school_id: '2024-00334', first_name: 'Luis', last_name: 'Garcia', email: 'l.garcia@hiusa.edu', role: 'student', is_member: true },
  { id: 6, school_id: '2024-00271', first_name: 'Rina', last_name: 'Lim', email: 'r.lim@hiusa.edu', role: 'student', is_member: true },
  { id: 7, school_id: '2024-00410', first_name: 'Carlo', last_name: 'Mendoza', email: 'c.mendoza@hiusa.edu', role: 'officer', is_member: true },
  { id: 8, school_id: '2024-00193', first_name: 'Mika', last_name: 'Tan', email: 'm.tan@hiusa.edu', role: 'student', is_member: true },
  { id: 9, school_id: '2024-00055', first_name: 'Ryan', last_name: 'Santos', email: 'r.santos@hiusa.edu', role: 'student', is_member: true },
  { id: 10, school_id: '2024-00302', first_name: 'Lena', last_name: 'Cruz', email: 'l.cruz@hiusa.edu', role: 'student', is_member: true },
  { id: 11, school_id: '2024-00118', first_name: 'Mark', last_name: 'Dela Rosa', email: 'm.delarosa@hiusa.edu', role: 'student', is_member: true },
  { id: 12, school_id: '2024-00247', first_name: 'Gian', last_name: 'Villanueva', email: 'g.villanueva@hiusa.edu', role: 'student', is_member: true },
];

// Helper
export const getUserName = (userId) => {
  const u = MOCK_USERS.find((u) => u.id === userId);
  return u ? `${u.first_name} ${u.last_name}` : 'Unknown';
};

// ── Partylists ──────────────────────────────────────────────────────────────
export const MOCK_PARTYLISTS = [
  { id: 1, name: 'Alab', acronym: 'ALAB', description: 'Unity through service and passion', created_at: '2025-06-15T08:00:00', updated_at: '2025-06-15T08:00:00' },
  { id: 2, name: 'Sigla', acronym: 'SIGLA', description: 'Progress through innovation and integrity', created_at: '2025-06-15T08:00:00', updated_at: '2025-06-15T08:00:00' },
  { id: 3, name: 'Lakas', acronym: 'LKS', description: 'Strength in service for all students', created_at: '2024-06-10T08:00:00', updated_at: '2024-06-10T08:00:00' },
];

// ── Elections ───────────────────────────────────────────────────────────────
export const MOCK_ELECTIONS = [
  {
    id: 1,
    title: 'HIUSA General Elections 2025',
    start_time: '2025-06-21T08:00:00',
    end_time: '2025-06-23T17:00:00',
    status: 'active',
    created_at: '2025-06-10T10:00:00',
    updated_at: '2025-06-21T08:00:00',
  },
  {
    id: 2,
    title: 'HIUSA General Elections 2024',
    start_time: '2024-06-18T08:00:00',
    end_time: '2024-06-20T17:00:00',
    status: 'closed',
    created_at: '2024-06-05T10:00:00',
    updated_at: '2024-06-20T17:00:00',
  },
  {
    id: 3,
    title: 'Mid-Year By-Elections 2024',
    start_time: '2024-01-15T08:00:00',
    end_time: '2024-01-16T17:00:00',
    status: 'closed',
    created_at: '2024-01-05T10:00:00',
    updated_at: '2024-01-16T17:00:00',
  },
  {
    id: 4,
    title: 'SSC Representative Election 2025',
    start_time: '2025-08-10T08:00:00',
    end_time: '2025-08-12T17:00:00',
    status: 'upcoming',
    created_at: '2025-06-25T14:00:00',
    updated_at: '2025-06-25T14:00:00',
  },
];

// ── Election Positions ──────────────────────────────────────────────────────
export const MOCK_POSITIONS = [
  // Election 1
  { id: 1, election_id: 1, title: 'President', max_winners: 1 },
  { id: 2, election_id: 1, title: 'Vice President', max_winners: 1 },
  { id: 3, election_id: 1, title: 'Secretary', max_winners: 1 },
  { id: 4, election_id: 1, title: 'Treasurer', max_winners: 1 },
  { id: 5, election_id: 1, title: 'PRO', max_winners: 1 },
  { id: 6, election_id: 1, title: 'Auditor', max_winners: 1 },
  // Election 2
  { id: 7, election_id: 2, title: 'President', max_winners: 1 },
  { id: 8, election_id: 2, title: 'Vice President', max_winners: 1 },
  { id: 9, election_id: 2, title: 'Secretary', max_winners: 1 },
  { id: 10, election_id: 2, title: 'Treasurer', max_winners: 1 },
  // Election 3
  { id: 11, election_id: 3, title: 'Treasurer', max_winners: 1 },
  { id: 12, election_id: 3, title: 'PRO', max_winners: 1 },
  // Election 4
  { id: 13, election_id: 4, title: 'Representative', max_winners: 3 },
];

// ── Candidates ──────────────────────────────────────────────────────────────
export const MOCK_CANDIDATES = [
  // Election 1 — President
  { id: 1, election_id: 1, user_id: 2, position_id: 1, partylist_id: 1, platform: 'Inclusive governance and academic support', image_url: null },
  { id: 2, election_id: 1, user_id: 9, position_id: 1, partylist_id: 2, platform: 'Student welfare and scholarship advocacy', image_url: null },
  // Election 1 — Vice President
  { id: 3, election_id: 1, user_id: 4, position_id: 2, partylist_id: 1, platform: 'Transparency in financial operations', image_url: null },
  { id: 4, election_id: 1, user_id: 1, position_id: 2, partylist_id: 2, platform: 'Digital innovation in student services', image_url: null },
  // Election 1 — Secretary
  { id: 5, election_id: 1, user_id: 10, position_id: 3, partylist_id: 1, platform: 'Efficient documentation and communication', image_url: null },
  { id: 6, election_id: 1, user_id: 6, position_id: 3, partylist_id: 2, platform: 'Digital records and transparency', image_url: null },
  // Election 1 — Treasurer
  { id: 7, election_id: 1, user_id: 5, position_id: 4, partylist_id: 2, platform: 'Fiscal responsibility and open budgeting', image_url: null },
  { id: 8, election_id: 1, user_id: 8, position_id: 4, partylist_id: 1, platform: 'Community-first budgeting', image_url: null },
  // Election 1 — PRO
  { id: 9, election_id: 1, user_id: 7, position_id: 5, partylist_id: 1, platform: 'Strengthened org branding and outreach', image_url: null },
  { id: 10, election_id: 1, user_id: 4, position_id: 5, partylist_id: 2, platform: 'Social media innovation', image_url: null },
  // Election 1 — Auditor
  { id: 11, election_id: 1, user_id: 5, position_id: 6, partylist_id: 2, platform: 'Full financial audit transparency', image_url: null },
  { id: 12, election_id: 1, user_id: 11, position_id: 6, partylist_id: 1, platform: 'Rigorous financial oversight', image_url: null },
  // Election 2
  { id: 13, election_id: 2, user_id: 3, position_id: 7, partylist_id: 3, platform: 'Strong student welfare programs', image_url: null },
  { id: 14, election_id: 2, user_id: 10, position_id: 7, partylist_id: null, platform: 'Unity through dedicated service', image_url: null },
  { id: 15, election_id: 2, user_id: 2, position_id: 8, partylist_id: 3, platform: 'Transparent governance', image_url: null },
  { id: 16, election_id: 2, user_id: 9, position_id: 9, partylist_id: 3, platform: 'Efficient documentation', image_url: null },
  { id: 17, election_id: 2, user_id: 5, position_id: 10, partylist_id: null, platform: 'Financial accountability', image_url: null },
  // Election 3
  { id: 18, election_id: 3, user_id: 8, position_id: 11, partylist_id: null, platform: 'Fiscal responsibility and transparency', image_url: null },
  { id: 19, election_id: 3, user_id: 12, position_id: 11, partylist_id: null, platform: 'Open book budgeting for all members', image_url: null },
  { id: 20, election_id: 3, user_id: 10, position_id: 12, partylist_id: null, platform: 'Strong communication and digital presence', image_url: null },
  { id: 21, election_id: 3, user_id: 11, position_id: 12, partylist_id: null, platform: 'Grassroots outreach and community media', image_url: null },
];

// ── Votes ───────────────────────────────────────────────────────────────────
export const MOCK_VOTES = [
  // Election 1 votes (active — partial voting)
  { id: 1, election_id: 1, position_id: 1, candidate_id: 1, voter_id: 1, vote_hash: 'a1b2c3d4e5', cast_at: '2025-06-21T09:12:00' },
  { id: 2, election_id: 1, position_id: 1, candidate_id: 2, voter_id: 3, vote_hash: 'f6g7h8i9j0', cast_at: '2025-06-21T09:25:00' },
  { id: 3, election_id: 1, position_id: 1, candidate_id: 1, voter_id: 7, vote_hash: 'k1l2m3n4o5', cast_at: '2025-06-21T09:40:00' },
  { id: 4, election_id: 1, position_id: 1, candidate_id: 1, voter_id: 9, vote_hash: 'p6q7r8s9t0', cast_at: '2025-06-21T10:05:00' },
  { id: 5, election_id: 1, position_id: 1, candidate_id: 2, voter_id: 11, vote_hash: 'u1v2w3x4y5', cast_at: '2025-06-21T10:18:00' },
  { id: 6, election_id: 1, position_id: 2, candidate_id: 3, voter_id: 1, vote_hash: 'z6a7b8c9d0', cast_at: '2025-06-21T09:12:00' },
  { id: 7, election_id: 1, position_id: 2, candidate_id: 4, voter_id: 3, vote_hash: 'e1f2g3h4i5', cast_at: '2025-06-21T09:25:00' },
  { id: 8, election_id: 1, position_id: 2, candidate_id: 3, voter_id: 7, vote_hash: 'j6k7l8m9n0', cast_at: '2025-06-21T09:40:00' },
  { id: 9, election_id: 1, position_id: 2, candidate_id: 3, voter_id: 9, vote_hash: 'o1p2q3r4s5', cast_at: '2025-06-21T10:05:00' },
  { id: 10, election_id: 1, position_id: 2, candidate_id: 4, voter_id: 11, vote_hash: 't6u7v8w9x0', cast_at: '2025-06-21T10:18:00' },
  { id: 11, election_id: 1, position_id: 3, candidate_id: 5, voter_id: 1, vote_hash: 'y1z2a3b4c5', cast_at: '2025-06-21T09:12:00' },
  { id: 12, election_id: 1, position_id: 3, candidate_id: 5, voter_id: 3, vote_hash: 'd6e7f8g9h0', cast_at: '2025-06-21T09:25:00' },
  { id: 13, election_id: 1, position_id: 3, candidate_id: 5, voter_id: 7, vote_hash: 'i1j2k3l4m5', cast_at: '2025-06-21T09:40:00' },
  { id: 14, election_id: 1, position_id: 3, candidate_id: 6, voter_id: 9, vote_hash: 'n6o7p8q9r0', cast_at: '2025-06-21T10:05:00' },
  { id: 15, election_id: 1, position_id: 4, candidate_id: 7, voter_id: 1, vote_hash: 's1t2u3v4w5', cast_at: '2025-06-21T09:12:00' },
  { id: 16, election_id: 1, position_id: 4, candidate_id: 7, voter_id: 3, vote_hash: 'x6y7z8a9b0', cast_at: '2025-06-21T09:25:00' },
  { id: 17, election_id: 1, position_id: 4, candidate_id: 8, voter_id: 7, vote_hash: 'c1d2e3f4g5', cast_at: '2025-06-21T09:40:00' },
  { id: 18, election_id: 1, position_id: 5, candidate_id: 9, voter_id: 1, vote_hash: 'h6i7j8k9l0', cast_at: '2025-06-21T09:12:00' },
  { id: 19, election_id: 1, position_id: 5, candidate_id: 10, voter_id: 3, vote_hash: 'm1n2o3p4q5', cast_at: '2025-06-21T09:25:00' },
  { id: 20, election_id: 1, position_id: 5, candidate_id: 9, voter_id: 7, vote_hash: 'r6s7t8u9v0', cast_at: '2025-06-21T09:40:00' },
  { id: 21, election_id: 1, position_id: 6, candidate_id: 11, voter_id: 1, vote_hash: 'w1x2y3z4a5', cast_at: '2025-06-21T09:12:00' },
  { id: 22, election_id: 1, position_id: 6, candidate_id: 12, voter_id: 3, vote_hash: 'b6c7d8e9f0', cast_at: '2025-06-21T09:25:00' },
  { id: 23, election_id: 1, position_id: 6, candidate_id: 11, voter_id: 7, vote_hash: 'g1h2i3j4k5', cast_at: '2025-06-21T09:40:00' },
  // Election 2 votes (closed — many)
  ...Array.from({ length: 10 }, (_, i) => ({
    id: 100 + i,
    election_id: 2,
    position_id: 7,
    candidate_id: i < 6 ? 13 : 14,
    voter_id: (i % 12) + 1,
    vote_hash: `e2p7v${i}`,
    cast_at: '2024-06-19T10:00:00',
  })),
  ...Array.from({ length: 8 }, (_, i) => ({
    id: 200 + i,
    election_id: 2,
    position_id: 8,
    candidate_id: 15,
    voter_id: (i % 12) + 1,
    vote_hash: `e2p8v${i}`,
    cast_at: '2024-06-19T11:00:00',
  })),
];

// ── Helpers for resolving relationships ─────────────────────────────────────

export const getPositionsForElection = (electionId) =>
  MOCK_POSITIONS.filter((p) => p.election_id === electionId);

export const getCandidatesForElection = (electionId) =>
  MOCK_CANDIDATES.filter((c) => c.election_id === electionId);

export const getVotesForElection = (electionId) =>
  MOCK_VOTES.filter((v) => v.election_id === electionId);

export const getVotesForCandidate = (candidateId) =>
  MOCK_VOTES.filter((v) => v.candidate_id === candidateId).length;

export const getPartylistName = (partylistId) => {
  if (!partylistId) return 'Independent';
  const p = MOCK_PARTYLISTS.find((pl) => pl.id === partylistId);
  return p ? p.name : 'Independent';
};

export const getPartylistAcronym = (partylistId) => {
  if (!partylistId) return null;
  const p = MOCK_PARTYLISTS.find((pl) => pl.id === partylistId);
  return p ? p.acronym : null;
};

export const getPositionTitle = (positionId) => {
  const p = MOCK_POSITIONS.find((pos) => pos.id === positionId);
  return p ? p.title : 'Unknown';
};

export const getUniqueVoterCount = (electionId) => {
  const votes = getVotesForElection(electionId);
  return new Set(votes.map((v) => v.voter_id)).size;
};

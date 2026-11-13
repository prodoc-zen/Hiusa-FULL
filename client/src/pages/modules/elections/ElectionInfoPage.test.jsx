import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ElectionInfoPage from './ElectionInfoPage';

const services = vi.hoisted(() => ({
  getElectionDetails: vi.fn(),
  getMyApplications: vi.fn(),
  fileApplication: vi.fn(),
  updateApplication: vi.fn(),
  submitApplication: vi.fn(),
  withdrawApplication: vi.fn(),
  createSlate: vi.fn(),
  updateSlate: vi.fn(),
  addSlateMember: vi.fn(),
  submitSlate: vi.fn(),
  applicationFileUrl: vi.fn((id, applicationId, kind) => `/elections/${id}/applications/${applicationId}/files/${kind}`),
}));
const { openProtectedFile } = vi.hoisted(() => ({ openProtectedFile: vi.fn().mockResolvedValue(undefined) }));
const outlet = vi.hoisted(() => ({ election: null, refreshElection: vi.fn().mockResolvedValue(undefined) }));

vi.mock('../../../services/electionService', () => services);
vi.mock('../../../utils/openProtectedFile', () => ({ openProtectedFile }));
vi.mock('../../../components/elections/electionFlow', () => ({ electionStatusChip: () => ({ label: 'Filing open', tone: 'success' }) }));
vi.mock('react-router-dom', async (importOriginal) => ({ ...(await importOriginal()), useOutletContext: () => outlet }));

const photo = new File(['p'], 'photo.png', { type: 'image/png' });
const coc = new File(['c'], 'coc.pdf', { type: 'application/pdf' });
const credentials = new File(['d'], 'credentials.pdf', { type: 'application/pdf' });

const filingElection = {
  id: 5,
  title: 'Council Election',
  status: 'upcoming',
  phase: 'filing',
  open_round: null,
  filing_starts_at: '2026-11-01T00:00:00Z',
  filing_ends_at: '2026-11-05T00:00:00Z',
  screening_starts_at: '2026-11-06T00:00:00Z',
  screening_ends_at: '2026-11-08T00:00:00Z',
  campaign_starts_at: '2026-11-09T00:00:00Z',
  campaign_ends_at: '2026-11-14T00:00:00Z',
  start_time: '2026-11-15T00:00:00Z',
  end_time: '2026-11-16T00:00:00Z',
  results_publish_at: '2026-11-17T00:00:00Z',
  rules: 'Candidates must file in person.',
  rules_version: 2,
  min_units: 10,
  min_gpa: 2.5,
  positions: [
    { id: 1, title: 'President', max_winners: 1, is_executive: true, is_active: true, eligible_year_levels: [1, 2, 3] },
    { id: 2, title: 'Treasurer', max_winners: 1, is_executive: false, is_active: true, eligible_year_levels: null },
    { id: 3, title: 'Auditor', max_winners: 1, is_executive: false, is_active: false },
  ],
  candidates: [],
};

function renderPage(election = filingElection) {
  outlet.election = election;
  return render(<MemoryRouter initialEntries={['/dashboard/elections/election-info?record=5']}><ElectionInfoPage /></MemoryRouter>);
}

async function acceptRules() {
  fireEvent.click(await screen.findByRole('checkbox', { name: 'I have read and accept the official rules' }));
}

function chooseFiles() {
  fireEvent.change(screen.getByLabelText('Formal photo'), { target: { files: [photo] } });
  fireEvent.change(screen.getByLabelText('Certificate of Candidacy'), { target: { files: [coc] } });
  fireEvent.change(screen.getByLabelText('Credentials'), { target: { files: [credentials] } });
}

const applicationOf = (overrides = {}) => ({
  id: 8,
  status: 'pending_review',
  position: { id: 1, title: 'President' },
  platform: 'Open books.',
  photo_url: '/uploads/candidates/a.png',
  has_coc: true,
  has_credentials: true,
  review_notes: null,
  user: { name: 'Ana Reyes', school_id: 900001 },
  ...overrides,
});

describe('ElectionInfoPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('user', JSON.stringify({ role: 'STUDENT', school_id: 900001 }));
    services.getMyApplications.mockResolvedValue({ application: null, slate: null });
  });

  it('opens with the title, phase chip, dates, qualifications and the rules with their version', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Council Election' })).toBeInTheDocument();
    expect(screen.getByText('Filing open')).toBeInTheDocument();
    ['Filing', 'Screening', 'Campaign', 'Voting', 'Results'].forEach((label) => expect(screen.getByText(label, { selector: 'dt' })).toBeInTheDocument());

    const qualifications = screen.getByRole('region', { name: 'Qualifications' });
    expect(within(qualifications).getByText(/Minimum units: 10/)).toBeInTheDocument();
    expect(within(qualifications).getByText(/Minimum GPA: 2.5/)).toBeInTheDocument();
    expect(within(qualifications).getByText(/Fourth year students cannot run for executive positions/)).toBeInTheDocument();
    expect(within(qualifications).getByText(/formal photo, Certificate of Candidacy/i)).toBeInTheDocument();
    expect(within(qualifications).getByText(/President/)).toHaveTextContent('1 seat');
    expect(within(qualifications).getByText(/President/)).toHaveTextContent('Executive');
    expect(within(qualifications).getByText(/President/)).toHaveTextContent('1, 2, 3');
    expect(within(qualifications).getByText(/Treasurer/)).toHaveTextContent('All year levels');
    expect(within(qualifications).queryByText(/Auditor/)).not.toBeInTheDocument();

    const rules = screen.getByRole('region', { name: 'Official rules' });
    expect(within(rules).getByText('Candidates must file in person.')).toBeInTheDocument();
    expect(within(rules).getByText('Version 2')).toBeInTheDocument();
  });

  it('keeps the filing buttons disabled until the rules are accepted', async () => {
    renderPage();
    const individual = await screen.findByRole('button', { name: 'File as an individual' });
    const slate = screen.getByRole('button', { name: 'File a party list' });
    expect(individual).toBeDisabled();
    expect(slate).toBeDisabled();
    await acceptRules();
    expect(individual).toBeEnabled();
    expect(slate).toBeEnabled();
  });

  it('saves an individual draft with the rules accepted and the files under their field names', async () => {
    services.fileApplication.mockResolvedValue(applicationOf({ status: 'draft' }));
    renderPage();
    await acceptRules();
    fireEvent.click(screen.getByRole('button', { name: 'File as an individual' }));
    fireEvent.change(screen.getByLabelText('Position'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/Campaign platform/), { target: { value: 'Open books.' } });
    chooseFiles();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(services.fileApplication).toHaveBeenCalledWith(5, {
      position_id: 1,
      platform: 'Open books.',
      rules_accepted: true,
      submit: false,
      photoFile: photo,
      cocFile: coc,
      credentialsFile: credentials,
    }));
    expect(services.submitApplication).not.toHaveBeenCalled();
  });

  it('files an individual candidacy straight to screening with Submit', async () => {
    services.fileApplication.mockResolvedValue(applicationOf());
    services.getMyApplications.mockResolvedValueOnce({ application: null, slate: null }).mockResolvedValue({ application: applicationOf(), slate: null });
    renderPage();
    await acceptRules();
    fireEvent.click(screen.getByRole('button', { name: 'File as an individual' }));
    fireEvent.change(screen.getByLabelText('Position'), { target: { value: '2' } });
    chooseFiles();
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(services.fileApplication).toHaveBeenCalledWith(5, expect.objectContaining({ position_id: 2, rules_accepted: true, submit: true, photoFile: photo, cocFile: coc, credentialsFile: credentials })));
    expect(await screen.findByText('Pending review')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'File as an individual' })).not.toBeInTheDocument();
  });

  it('shows the server message as returned, such as the fourth year refusal', async () => {
    services.fileApplication.mockRejectedValue(Object.assign(new Error('refused'), { response: { status: 422, data: { message: 'Fourth year students cannot run for an executive position.' } } }));
    renderPage();
    await acceptRules();
    fireEvent.click(screen.getByRole('button', { name: 'File as an individual' }));
    fireEvent.change(screen.getByLabelText('Position'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Fourth year students cannot run for an executive position.')).toBeInTheDocument();
  });

  it('creates a party list, then adds a member to a position and leaves the other vacant', async () => {
    const created = { id: 6, name: 'Unity', motto: 'Together', color: '#112233', members: [] };
    const withMember = { ...created, members: [applicationOf({ id: 21, status: 'draft', position: { id: 1, title: 'President' }, user: { name: 'Ben Cruz', school_id: 900002 } })] };
    services.createSlate.mockResolvedValue(created);
    services.addSlateMember.mockResolvedValue(withMember.members[0]);
    services.getMyApplications
      .mockResolvedValueOnce({ application: null, slate: null })
      .mockResolvedValueOnce({ application: null, slate: created })
      .mockResolvedValue({ application: null, slate: withMember });

    renderPage();
    await acceptRules();
    fireEvent.click(screen.getByRole('button', { name: 'File a party list' }));
    fireEvent.change(screen.getByLabelText('Party list name'), { target: { value: 'Unity' } });
    fireEvent.change(screen.getByLabelText('Motto'), { target: { value: 'Together' } });
    fireEvent.change(screen.getByLabelText('Color'), { target: { value: '#112233' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create party list' }));
    await waitFor(() => expect(services.createSlate).toHaveBeenCalledWith(5, expect.objectContaining({ name: 'Unity', motto: 'Together', color: '#112233', rules_accepted: true })));

    const president = await screen.findByRole('listitem', { name: 'President' });
    expect(within(screen.getByRole('listitem', { name: 'Treasurer' })).getByText('Vacant')).toBeInTheDocument();
    fireEvent.click(within(president).getByRole('button', { name: 'Add member' }));
    fireEvent.change(screen.getByLabelText('School ID'), { target: { value: '900002' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add member' }).find((button) => !button.closest('li')));

    await waitFor(() => expect(services.addSlateMember).toHaveBeenCalledWith(5, 6, expect.objectContaining({ user_id: 900002, position_id: 1 })));
    expect(await within(await screen.findByRole('listitem', { name: 'President' })).findByText('Ben Cruz')).toBeInTheDocument();
  });

  it('submits the party list', async () => {
    const slate = { id: 6, name: 'Unity', motto: 'Together', color: '#112233', members: [applicationOf({ id: 21, status: 'draft', user: { name: 'Ben Cruz', school_id: 900002 } })] };
    services.getMyApplications.mockResolvedValue({ application: null, slate });
    services.submitSlate.mockResolvedValue({});
    renderPage();
    const submit = await screen.findByRole('button', { name: 'Submit party list' });
    expect(submit).toBeDisabled();
    await acceptRules();
    fireEvent.click(submit);
    await waitFor(() => expect(services.submitSlate).toHaveBeenCalledWith(5, 6));
  });

  it('shows the notes and only the three file inputs for a candidacy that needs a correction', async () => {
    services.getMyApplications.mockResolvedValue({ application: applicationOf({ status: 'for_revision', review_notes: 'The COC is blurry.' }), slate: null });
    services.updateApplication.mockResolvedValue({});
    renderPage({ ...filingElection, phase: 'screening' });

    const mine = await screen.findByRole('region', { name: 'My candidacy' });
    expect(within(mine).getByText('For revision')).toBeInTheDocument();
    expect(within(mine).getByText('The COC is blurry.')).toBeInTheDocument();
    expect(within(mine).queryByLabelText('Position')).not.toBeInTheDocument();
    expect(within(mine).getAllByLabelText(/Formal photo|Certificate of Candidacy|Credentials/)).toHaveLength(3);
    expect(within(mine).getByRole('button', { name: 'Replace documents' })).toBeDisabled();

    fireEvent.change(within(mine).getByLabelText('Certificate of Candidacy'), { target: { files: [coc] } });
    fireEvent.click(within(mine).getByRole('button', { name: 'Replace documents' }));
    await waitFor(() => expect(services.updateApplication).toHaveBeenCalledWith(5, 8, { photoFile: null, cocFile: coc, credentialsFile: null }));
  });

  it('shows the reason for a rejection and the plain word for each status', async () => {
    services.getMyApplications.mockResolvedValue({ application: applicationOf({ status: 'rejected', review_notes: 'Not enrolled this term.' }), slate: null });
    renderPage({ ...filingElection, phase: 'screening' });
    const mine = await screen.findByRole('region', { name: 'My candidacy' });
    expect(within(mine).getByText('Rejected')).toBeInTheDocument();
    expect(within(mine).getByText('Not enrolled this term.')).toBeInTheDocument();
    expect(within(mine).queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
  });

  it('withdraws after a confirm dialog', async () => {
    services.getMyApplications.mockResolvedValue({ application: applicationOf(), slate: null });
    services.withdrawApplication.mockResolvedValue({});
    renderPage({ ...filingElection, phase: 'screening' });

    const mine = await screen.findByRole('region', { name: 'My candidacy' });
    fireEvent.click(within(mine).getByRole('button', { name: 'Withdraw' }));
    expect(services.withdrawApplication).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(services.withdrawApplication).toHaveBeenCalledWith(5, 8));
  });

  it('offers no withdraw once voting has opened', async () => {
    services.getMyApplications.mockResolvedValue({ application: applicationOf({ status: 'approved' }), slate: null });
    renderPage({ ...filingElection, phase: 'voting' });
    const mine = await screen.findByRole('region', { name: 'My candidacy' });
    expect(within(mine).getByText('Approved')).toBeInTheDocument();
    expect(within(mine).queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
  });

  it('shows each member of a party list with their own status to the representative', async () => {
    const slate = {
      id: 6,
      name: 'Unity',
      motto: 'Together',
      color: '#112233',
      members: [
        applicationOf({ id: 21, status: 'approved', user: { name: 'Ben Cruz', school_id: 900002 } }),
        applicationOf({ id: 22, status: 'for_revision', position: { id: 2, title: 'Treasurer' }, review_notes: 'Upload a clearer photo.', user: { name: 'Cara Dizon', school_id: 900003 } }),
      ],
    };
    services.getMyApplications.mockResolvedValue({ application: null, slate });
    renderPage({ ...filingElection, phase: 'screening' });

    const mine = await screen.findByRole('region', { name: 'My candidacy' });
    const ben = within(mine).getByRole('listitem', { name: 'Ben Cruz' });
    expect(within(ben).getByText('Approved')).toBeInTheDocument();
    const cara = within(mine).getByRole('listitem', { name: 'Cara Dizon' });
    expect(within(cara).getByText('For revision')).toBeInTheDocument();
    expect(within(cara).getByText('Upload a clearer photo.')).toBeInTheDocument();
    expect(within(cara).getByLabelText('Credentials')).toBeInTheDocument();
  });

  it('opens a private document through the protected file helper', async () => {
    services.getMyApplications.mockResolvedValue({ application: applicationOf(), slate: null });
    renderPage({ ...filingElection, phase: 'screening' });
    const mine = await screen.findByRole('region', { name: 'My candidacy' });
    fireEvent.click(within(mine).getByRole('button', { name: 'Open Certificate of Candidacy' }));
    await waitFor(() => expect(openProtectedFile).toHaveBeenCalledWith('/elections/5/applications/8/files/coc'));
  });

  it('lists the official candidates by position in the campaign phase, with independents named', async () => {
    const candidates = [
      { id: 1, position_id: 1, image_url: '/uploads/candidates/a.png', platform: 'Open books.', user: { first_name: 'Ana', last_name: 'Reyes' }, partylist: { name: 'Unity', motto: 'Together', color: '#112233', banner_url: '/uploads/partylists/u.png' } },
      { id: 2, position_id: 1, platform: null, user: { first_name: 'Ben', last_name: 'Cruz' }, partylist: null },
      { id: 3, position_id: 2, platform: null, user: { first_name: 'Cara', last_name: 'Dizon' }, partylist: null },
    ];
    renderPage({ ...filingElection, phase: 'campaign', candidates });

    const list = await screen.findByRole('region', { name: 'Official candidates' });
    const president = within(list).getByRole('group', { name: 'President' });
    expect(within(president).getByText('Ana Reyes')).toBeInTheDocument();
    expect(within(president).getByText('Unity')).toBeInTheDocument();
    expect(within(president).getByText('Together')).toBeInTheDocument();
    expect(within(president).getByText('Open books.')).toBeInTheDocument();
    expect(within(president).getByAltText('Unity banner')).toBeInTheDocument();
    expect(within(president).getByText('Ben Cruz')).toBeInTheDocument();
    expect(within(president).getByText('Independent')).toBeInTheDocument();
    expect(within(list).getByRole('group', { name: 'Treasurer' })).toHaveTextContent('Cara Dizon');
  });

  it('offers nothing to file outside the filing phase and lists no candidates before the campaign', async () => {
    renderPage({ ...filingElection, phase: 'screening' });
    expect(await screen.findByRole('heading', { name: 'Council Election' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'File as an individual' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'File a party list' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'I have read and accept the official rules' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Official candidates' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'My candidacy' })).not.toBeInTheDocument();
  });

  it.each(['ADMIN', 'SBO_OFFICER'])('lets a %s file a candidacy too', async (role) => {
    localStorage.setItem('user', JSON.stringify({ role, school_id: 900001 }));
    renderPage();
    await acceptRules();
    expect(screen.getByRole('button', { name: 'File as an individual' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'File a party list' })).toBeEnabled();
  });

  it('loads the election itself when the workspace has not supplied it', async () => {
    outlet.election = null;
    services.getElectionDetails.mockResolvedValue(filingElection);
    render(<MemoryRouter initialEntries={['/dashboard/elections/election-info?record=5']}><ElectionInfoPage /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Council Election' })).toBeInTheDocument();
    expect(services.getElectionDetails).toHaveBeenCalledWith('5');
    expect(services.getMyApplications).toHaveBeenCalledWith(5);
  });
});

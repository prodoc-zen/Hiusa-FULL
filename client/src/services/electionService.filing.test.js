import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, put, patch } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn() }));
vi.mock('./api', () => ({ default: { get, post, put, patch, delete: vi.fn() } }));

import * as elections from './electionService';
import * as transition from './officerTransitionService';

beforeEach(() => {
  vi.clearAllMocks();
  [get, post, put, patch].forEach((fn) => fn.mockResolvedValue({ data: { ok: true } }));
});

describe('castVotes', () => {
  it('posts the selections, one entry per position, empty list for a skipped one', async () => {
    const selections = [{ position_id: 1, candidate_ids: [4, 5] }, { position_id: 2, candidate_ids: [] }];
    await elections.castVotes(9, selections);
    expect(post).toHaveBeenCalledWith('/elections/9/vote', { selections });
  });
});

describe('election create and update', () => {
  it('sends JSON when there is no file and no positions', async () => {
    await elections.createElection({ title: 'Draft', draft: true });
    expect(post).toHaveBeenCalledWith('/elections', { title: 'Draft', draft: true });
    await elections.updateElection(3, { status: 'active' });
    expect(put).toHaveBeenCalledWith('/elections/3', { status: 'active' });
  });

  it('sends FormData with every new schedule, rule and position field when positions are present', async () => {
    await elections.createElection({
      title: 'Council',
      draft: false,
      filing_starts_at: '2026-12-01T00:00:00.000Z',
      rules: 'Rules',
      tie_break_rule: 'Longest membership',
      min_units: 10,
      min_gpa: 2.5,
      positions: [{
        title: 'President',
        max_winners: 1,
        description: 'Leads',
        is_executive: true,
        vote_limit: 1,
        other_qualifications: 'None',
        is_active: false,
        eligible_year_levels: [1, 2],
      }],
    });
    const fd = post.mock.calls[0][1];
    expect(fd).toBeInstanceOf(FormData);
    expect(fd.get('draft')).toBe('0');
    expect(fd.get('filing_starts_at')).toBe('2026-12-01T00:00:00.000Z');
    expect(fd.get('tie_break_rule')).toBe('Longest membership');
    expect(fd.get('min_units')).toBe('10');
    expect(fd.get('min_gpa')).toBe('2.5');
    expect(fd.get('positions[0][title]')).toBe('President');
    expect(fd.get('positions[0][max_winners]')).toBe('1');
    expect(fd.get('positions[0][description]')).toBe('Leads');
    expect(fd.get('positions[0][is_executive]')).toBe('1');
    expect(fd.get('positions[0][is_active]')).toBe('0');
    expect(fd.get('positions[0][vote_limit]')).toBe('1');
    expect(fd.get('positions[0][other_qualifications]')).toBe('None');
    expect(fd.getAll('positions[0][eligible_year_levels][]')).toEqual(['1', '2']);
  });

  it('sends a short form position with only its title and seats', async () => {
    await elections.createElection({ title: 'Demo', positions: [{ title: 'Representative', max_winners: 1 }] });
    const fd = post.mock.calls[0][1];
    expect([...fd.keys()].sort()).toEqual(['positions[0][max_winners]', 'positions[0][title]', 'title']);
  });

  it('updates through POST with _method PUT when positions are present', async () => {
    await elections.updateElection(4, { title: 'Council', positions: [{ title: 'Auditor', max_winners: 1 }] });
    expect(post.mock.calls[0][0]).toBe('/elections/4');
    expect(post.mock.calls[0][1].get('_method')).toBe('PUT');
    expect(put).not.toHaveBeenCalled();
  });
});

describe('election lifecycle calls', () => {
  it('uses the contract paths', async () => {
    await elections.submitElection(2);
    await elections.suspendElection(2, 'Room closed');
    await elections.resumeElection(2);
    await elections.cancelElection(2, 'No quorum');
    await elections.getApprovalHistory(2);
    expect(post.mock.calls).toEqual([
      ['/elections/2/submit'],
      ['/elections/2/suspend', { reason: 'Room closed' }],
      ['/elections/2/resume'],
      ['/elections/2/cancel', { reason: 'No quorum' }],
    ]);
    expect(get).toHaveBeenCalledWith('/elections/2/approval-history');
  });
});

describe('filing and screening calls', () => {
  it('lists applications and the ones of the viewer', async () => {
    await elections.getApplications(2);
    await elections.getMyApplications(2);
    expect(get).toHaveBeenNthCalledWith(1, '/elections/2/applications', { params: {} });
    expect(get).toHaveBeenNthCalledWith(2, '/elections/2/applications/mine');
  });

  it('hands the screening page the rows the server sends, with the nested shape it reads', async () => {
    get.mockResolvedValueOnce({
      data: {
        applications: [{
          id: 7, school_id: 2100142, user_name: 'Juan Dela Vega', year_level: '1st Year', position_id: 4, position_title: 'Representative', partylist_id: 3, partylist_name: 'Unity', status: 'pending_review',
          open_urls: { coc: '/elections/2/applications/7/files/coc', credentials: null },
        }],
        counts: { pending_review: 1 },
      },
    });
    const result = await elections.getApplications(2);
    expect(result.counts).toEqual({ pending_review: 1 });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      id: 7,
      user: { name: 'Juan Dela Vega', school_id: 2100142, year_level: '1st Year' },
      position: { id: 4, title: 'Representative' },
      partylist: { id: 3, name: 'Unity' },
      coc_open_url: '/elections/2/applications/7/files/coc',
      credentials_open_url: null,
    });
  });

  it('maps file keys to the server field names', async () => {
    const photo = new File(['p'], 'p.png');
    const coc = new File(['c'], 'c.pdf');
    const credentials = new File(['x'], 'x.pdf');
    await elections.fileApplication(2, { position_id: 5, platform: 'Plan', rules_accepted: true, submit: false, photoFile: photo, cocFile: coc, credentialsFile: credentials });
    const [url, fd] = post.mock.calls[0];
    expect(url).toBe('/elections/2/applications');
    expect(fd.get('position_id')).toBe('5');
    expect(fd.get('rules_accepted')).toBe('1');
    expect(fd.get('submit')).toBe('0');
    expect(fd.get('photo')).toBeInstanceOf(File);
    expect(fd.get('coc')).toBeInstanceOf(File);
    expect(fd.get('credentials')).toBeInstanceOf(File);
    expect(fd.has('photoFile')).toBe(false);
  });

  it('edits an application through POST with _method PUT, and leaves out an empty file', async () => {
    await elections.updateApplication(2, 8, { platform: 'New', photoFile: null });
    const [url, fd] = post.mock.calls[0];
    expect(url).toBe('/elections/2/applications/8');
    expect(fd.get('_method')).toBe('PUT');
    expect(fd.has('photo')).toBe(false);
  });

  it('submits, withdraws and reviews an application', async () => {
    await elections.submitApplication(2, 8);
    await elections.withdrawApplication(2, 8);
    await elections.reviewApplication(2, 8, { decision: 'correction', notes: 'Upload the COC again.' });
    expect(post).toHaveBeenNthCalledWith(1, '/elections/2/applications/8/submit');
    expect(post).toHaveBeenNthCalledWith(2, '/elections/2/applications/8/withdraw');
    expect(patch).toHaveBeenCalledWith('/elections/2/applications/8/review', { decision: 'correction', notes: 'Upload the COC again.' });
  });

  it('builds the private file path', () => {
    expect(elections.applicationFileUrl(2, 8, 'coc')).toBe('/elections/2/applications/8/files/coc');
  });

  it('files a slate and its members, with the banner under its server name', async () => {
    await elections.createSlate(2, { name: 'Unity', motto: 'Together', color: '#112233', rules_accepted: true, bannerFile: new File(['b'], 'b.png') });
    expect(post.mock.calls[0][0]).toBe('/elections/2/slates');
    expect(post.mock.calls[0][1].get('banner')).toBeInstanceOf(File);
    await elections.updateSlate(2, 6, { name: 'Unity 2' });
    expect(post.mock.calls[1][0]).toBe('/elections/2/slates/6');
    expect(post.mock.calls[1][1].get('_method')).toBe('PUT');
    await elections.addSlateMember(2, 6, { user_id: 900002, position_id: 5, cocFile: new File(['c'], 'c.pdf') });
    expect(post.mock.calls[2][0]).toBe('/elections/2/slates/6/members');
    expect(post.mock.calls[2][1].get('coc')).toBeInstanceOf(File);
    await elections.submitSlate(2, 6);
    expect(post).toHaveBeenLastCalledWith('/elections/2/slates/6/submit');
  });
});

describe('runoff, tie and report calls', () => {
  it('uses the contract paths', async () => {
    await elections.scheduleRunoff(2, { runoff_starts_at: 'a', runoff_ends_at: 'b', runoff_publish_at: 'c' });
    await elections.resolveTie(2, 5, { winner_candidate_ids: [9], explanation: 'Longest membership' });
    await elections.getElectionReport(2, 'participation');
    expect(post).toHaveBeenNthCalledWith(1, '/elections/2/runoff', { runoff_starts_at: 'a', runoff_ends_at: 'b', runoff_publish_at: 'c' });
    expect(post).toHaveBeenNthCalledWith(2, '/elections/2/positions/5/tie-resolution', { winner_candidate_ids: [9], explanation: 'Longest membership' });
    expect(get).toHaveBeenCalledWith('/elections/2/reports/participation', { params: { format: 'json' } });
    expect(elections.electionReportPdfUrl(2, 'results')).toBe('/elections/2/reports/results?format=pdf');
  });
});

describe('officer transition service', () => {
  it('reads officers, handover and renewal', async () => {
    await transition.getOfficers({ status: 'active' });
    await transition.getHandover();
    await transition.getRenewalTracker();
    expect(get).toHaveBeenNthCalledWith(1, '/officer-transition/officers', { params: { status: 'active' } });
    expect(get).toHaveBeenNthCalledWith(2, '/officer-transition/handover');
    expect(get).toHaveBeenNthCalledWith(3, '/officer-transition/renewal');
  });

  it('prepares a handover item with the attachment, and acknowledges one', async () => {
    await transition.prepareHandover(4, { remarks: 'Ready', reference_url: '/dashboard/finance', attachmentFile: new File(['a'], 'a.pdf') });
    const [url, fd] = post.mock.calls[0];
    expect(url).toBe('/officer-transition/handover/4');
    expect(fd.get('_method')).toBe('PUT');
    expect(fd.get('remarks')).toBe('Ready');
    expect(fd.get('attachment')).toBeInstanceOf(File);
    await transition.acknowledgeHandover(4);
    expect(post).toHaveBeenLastCalledWith('/officer-transition/handover/4/acknowledge');
    expect(transition.handoverAttachmentUrl(4)).toBe('/officer-transition/handover/4/attachment');
  });
});

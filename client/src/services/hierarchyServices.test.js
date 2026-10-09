import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from './api';
import { deleteClearancePeriod } from './clearanceService';
import { deleteRequirementType, getComplianceDocuments } from './complianceService';
import { getCollegeOrganizations, getRegistrationRequirements, registerOrganization, resubmitOrganization } from './collegeOrganizationService';
import { downloadFinancialReportDocument } from './financeService';
import { deleteGrievance } from './grievanceService';
import {
  archiveSystemOrganization,
  deleteAcademicSemester,
  deleteGlobalAnnouncement,
  getSystemAgency,
  getSystemOrganizationOverview,
  restoreSystemOrganization,
  reviewSystemOrganization,
} from './systemAdministrationService';

vi.mock('./api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

describe('hierarchy services', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.values(api).forEach((method) => method.mockResolvedValue({ data: {} }));
  });

  it('reads the agency overview and one organization snapshot', async () => {
    await getSystemAgency();
    await getSystemOrganizationOverview(9);
    expect(api.get).toHaveBeenCalledWith('/system/agency');
    expect(api.get).toHaveBeenCalledWith('/system/organizations/9/overview');
  });

  it('reviews, archives and restores an organization through the lifecycle routes', async () => {
    await reviewSystemOrganization(4, { decision: 'return', remarks: 'Missing charter', submitted_at: '2026-10-09T01:00:00+08:00' });
    await archiveSystemOrganization(4, { reason: 'Inactive' });
    await restoreSystemOrganization(4);
    expect(api.patch).toHaveBeenCalledWith('/system/organizations/4/review', { decision: 'return', remarks: 'Missing charter', submitted_at: '2026-10-09T01:00:00+08:00' });
    expect(api.post).toHaveBeenCalledWith('/system/organizations/4/archive', { reason: 'Inactive' });
    expect(api.post).toHaveBeenCalledWith('/system/organizations/4/restore');
  });

  it('calls the delete routes for semesters, announcements, clearance periods, grievances and requirement types', async () => {
    await deleteAcademicSemester(2);
    await deleteGlobalAnnouncement(3);
    await deleteClearancePeriod(5);
    await deleteGrievance(6);
    await deleteRequirementType(7);
    expect(api.delete.mock.calls.map(([url]) => url)).toEqual([
      '/system/academic-semesters/2',
      '/system/announcements/3',
      '/clearance-periods/5',
      '/grievances/6',
      '/compliance/requirement-types/7',
    ]);
  });

  it('lists compliance documents with filters and opens a supporting document as a blob', () => {
    getComplianceDocuments({ organization_id: 1, source: 'compliance' });
    downloadFinancialReportDocument(12, 0);
    expect(api.get).toHaveBeenCalledWith('/compliance/documents', { params: { organization_id: 1, source: 'compliance' } });
    expect(api.get).toHaveBeenCalledWith('/financial-reports/12/documents/0', { responseType: 'blob' });
  });

  it('lists a college and its registration requirements', () => {
    getCollegeOrganizations({ lifecycle_status: 'pending' });
    getRegistrationRequirements();
    expect(api.get).toHaveBeenCalledWith('/college/organizations', { params: { lifecycle_status: 'pending' } });
    expect(api.get).toHaveBeenCalledWith('/college/organizations/requirements');
  });

  it('registers an organization as multipart data with one file per requirement', () => {
    const charter = new File(['pdf'], 'charter.pdf', { type: 'application/pdf' });
    registerOrganization({ name: 'Robotics Guild', acronym: 'ROBO', description: null, color: '#1A2B3C' }, { 12: charter });
    const [url, data] = api.post.mock.calls[0];
    expect(url).toBe('/college/organizations');
    expect(data.get('name')).toBe('Robotics Guild');
    expect(data.get('color')).toBe('#1A2B3C');
    expect(data.has('description')).toBe(false);
    expect(data.get('files[12]')).toBe(charter);
  });

  it('resubmits a returned organization through a spoofed PUT because multipart PUT is not parsed', () => {
    resubmitOrganization(8, { name: 'Robotics Guild' }, {});
    const [url, data] = api.post.mock.calls[0];
    expect(url).toBe('/college/organizations/8');
    expect(data.get('_method')).toBe('PUT');
  });
});

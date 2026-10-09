const ACCREDITATION = {
  accredited: { label: 'Accredited', tone: 'success' },
  pending_review: { label: 'Pending review', tone: 'warning' },
  incomplete: { label: 'Incomplete', tone: 'danger' },
  returned: { label: 'Returned', tone: 'danger' },
  not_applicable: { label: 'Not applicable', tone: 'neutral' },
};

export function accreditationBadge(status) {
  return ACCREDITATION[status] || ACCREDITATION.not_applicable;
}

export function organizationOverviewPath(organizationId) {
  return `/dashboard/super-admin/organizations/${organizationId}`;
}

export const APPLICATION_LABELS = {
  pending_dean: 'With the Department Head',
  pending_sao: 'With the SAO',
  returned: 'Returned',
  approved: 'Approved',
  rejected: 'Not approved',
  pending_verification: 'Not verified',
  expired: 'Expired',
};

const RETURNED_BY = { DEPARTMENT_HEAD: 'Your Department Head', SUPER_ADMIN: 'The SAO' };

export function applicantStatusLine(application) {
  switch (application.status) {
    case 'pending_dean':
      return 'Your Department Head is reviewing it.';
    case 'pending_sao':
      return 'Your Department Head endorsed it. The SAO decides next.';
    case 'returned':
      return `${RETURNED_BY[application.returned_by_role] || 'A reviewer'} returned it. Fix what is listed below, then send it again.`;
    case 'approved':
      return `Approved. You are now ${application.position_title} of ${application.name}. Switch to it from the account menu.`;
    case 'rejected':
      return 'The SAO did not approve this application.';
    default:
      return '';
  }
}

export const REVIEW_STAGE_LABEL = { dean: 'Department Head', sao: 'SAO' };

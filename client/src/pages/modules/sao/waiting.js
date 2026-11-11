// What each organization has waiting for the SAO, so the by-organization lists can put the work first.
export const submissionsWaiting = (org) => org.awaiting_review_count ?? (org.requirements || []).filter((item) => item.status === 'submitted').length;

export const reportsWaiting = (org) => org.awaiting_financial_report_count ?? 0;

export const waitingFirst = (count) => (a, b) => count(b) - count(a)
  || String(a.organization_name).localeCompare(String(b.organization_name))
  || a.organization_id - b.organization_id;

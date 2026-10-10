// The SAO decides several queues; the briefing carries each as attention items (docs/api/dashboard-briefing.md).
// Order is the order the SAO should work: registrations lead because everything else waits on a registered organization.
const AREAS = [
  { key: 'registrations', label: 'Registrations awaiting review', action: 'Review registrations', noun: ['registration', 'registrations'], match: (item) => item.type === 'registrations_pending' },
  { key: 'compliance', label: 'Compliance submissions awaiting review', action: 'Review compliance', noun: ['compliance submission', 'compliance submissions'], match: (item) => item.type === 'compliance_submissions_pending' },
  { key: 'financial-reports', label: 'Financial reports to approve', action: 'Review financial reports', noun: ['financial report', 'financial reports'], match: (item) => item.type === 'approval' && /[?&]tab=financial\b/.test(item.href || '') },
  { key: 'reports-overdue', label: 'Organizations with overdue financial reports', action: 'Open financial reports', noun: ['overdue report', 'overdue reports'], match: (item) => item.type === 'financial_report_due' },
  { key: 'event-files', label: 'Event files to approve', action: 'Review event files', noun: ['event file', 'event files'], match: (item) => item.type === 'approval' && /[?&]tab=events\b/.test(item.href || '') },
  { key: 'budgets', label: 'Budgets to approve', action: 'Review budgets', noun: ['budget', 'budgets'], match: (item) => item.type === 'approval' },
  { key: 'venues', label: 'Venue bookings awaiting review', action: 'Review venue bookings', noun: ['venue booking', 'venue bookings'], match: (item) => item.type === 'venue_bookings_pending' },
  { key: 'grievances', label: 'Urgent grievances unresolved', action: 'Answer grievances', noun: ['urgent grievance', 'urgent grievances'], match: (item) => item.type === 'grievances_urgent' },
  { key: 'clearances', label: 'Clearances awaiting your signature', action: 'Sign clearances', noun: ['clearance', 'clearances'], match: (item) => item.type === 'clearance_sao_pending' },
];

/**
 * One row per review area that has work, in working order. An item counts as many records as its
 * `count` (a queue item) or one; a full attention type also carries `type_total`, so a count that
 * the 8-row cap cut short is marked as "N+" instead of being under-reported.
 */
export function buildReviewAreas(attention = []) {
  const claimed = new Set();
  const areas = [];

  for (const area of AREAS) {
    const items = attention.filter((item) => !claimed.has(item) && area.match(item));
    items.forEach((item) => claimed.add(item));
    if (items.length === 0) continue;

    const count = items.reduce((sum, item) => sum + (item.count ?? 1), 0);
    const type = items[0].type;
    const shownOfType = attention.filter((item) => item.type === type).length;
    const typeTotal = Math.max(...items.map((item) => item.type_total ?? 0));
    const truncated = typeTotal > shownOfType;

    areas.push({
      key: area.key,
      label: area.label,
      action: area.action,
      noun: area.noun,
      count,
      truncated,
      href: items[0].href || null,
      severity: items[0].severity,
    });
  }

  return areas;
}

export function reviewHeadline(areas) {
  const total = areas.reduce((sum, area) => sum + area.count, 0);
  const parts = areas.map((area) => `${area.count}${area.truncated ? '+' : ''} ${area.count === 1 ? area.noun[0] : area.noun[1]}`);
  return `${total} ${total === 1 ? 'item needs' : 'items need'} your attention: ${parts.join(', ')}.`;
}

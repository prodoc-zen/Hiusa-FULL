import { peso } from '../../lib/format';
import { roleLabel } from '../../lib/lifecycle';

// Times are shown in Manila time whatever the browser's clock says, so a request made at 3:51 AM
// in Manila does not read 7:51 PM the day before.
const MANILA = 'Asia/Manila';

export function formatDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: MANILA });
}

export function formatDateTime(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: MANILA });
}

export function fullName(person) {
  return person ? `${person.first_name || ''} ${person.last_name || ''}`.trim() : '';
}

export function summaryLine(entityType, summary) {
  if (!summary) return null;

  if (entityType === 'event') {
    return `${formatDate(summary.start_time)} - ${formatDate(summary.end_time)}${summary.location ? ` | ${summary.location}` : ''}`;
  }

  if (entityType === 'budget') {
    return `Allocation: ${peso(summary.allocated_amount)}${summary.event_title ? ` | ${summary.event_title}` : ''}`;
  }

  if (entityType === 'election') {
    return `Voting ${formatDateTime(summary.start_time)} to ${formatDateTime(summary.end_time)}`;
  }

  if (entityType === 'announcement') {
    // The row already carries a status badge, so the status is left off; the audience and category
    // are shown as words, not as the stored codes.
    const audience = !summary.target_role || summary.target_role === 'all' ? 'Everyone' : roleLabel(String(summary.target_role).toUpperCase()) || 'Everyone';
    const category = String(summary.category || 'general');
    return `Audience: ${audience} | Category: ${category.charAt(0).toUpperCase()}${category.slice(1)}`;
  }

  if (entityType === 'payment') {
    return `${summary.item || 'Merchandise'} | Buyer: ${summary.buyer || 'Unknown'} | ${peso(summary.total_price)}${summary.payment_reference ? ` | Ref: ${summary.payment_reference}` : ''}`;
  }

  if (entityType === 'financial_report') {
    const advances = Number(summary.cash_advances_released) > 0 || Number(summary.cash_advance_repayments) > 0
      ? ` | Cash advances released ${peso(summary.cash_advances_released)} | Cash advance repayments ${peso(summary.cash_advance_repayments)}`
      : '';
    return `${summary.organization?.acronym || 'Organization'} | ${formatDate(summary.period_start)} - ${formatDate(summary.period_end)} | Inflows ${peso(summary.total_income)} | Outflows ${peso(summary.total_expense)}${advances}`;
  }

  return null;
}

const plural = (count, word) => `${count} ${word}${Number(count) === 1 ? '' : 's'}`;

function windowText(start, end) {
  if (start && end) return `${formatDateTime(start)} to ${formatDateTime(end)}`;
  return formatDateTime(start || end);
}

// What the reviewer reads before deciding on an election: the dates in the order they happen, each
// position's rules, and the requirements. A field the proposal does not have is left out, so an election
// where the Admin adds the candidates still shows its voting window and positions.
export function electionProposal(summary) {
  const s = summary ?? {};
  const schedule = [
    ['Filing', windowText(s.filing_starts_at, s.filing_ends_at), s.filing_starts_at || s.filing_ends_at],
    ['Screening', windowText(s.screening_starts_at, s.screening_ends_at), s.screening_starts_at || s.screening_ends_at],
    ['Campaign', windowText(s.campaign_starts_at, s.campaign_ends_at), s.campaign_starts_at || s.campaign_ends_at],
    ['Voting', windowText(s.start_time, s.end_time), s.start_time || s.end_time],
    ['Results published', formatDateTime(s.results_publish_at), s.results_publish_at],
  ].filter(([, , raw]) => Boolean(raw)).map(([label, value]) => ({ label, value }));

  const positions = (s.positions ?? []).map((position) => {
    const seats = Number(position.max_winners ?? 1);
    const choices = Number(position.vote_limit ?? seats);
    const levels = Array.isArray(position.eligible_year_levels) ? position.eligible_year_levels : [];
    return {
      title: position.title,
      details: [
        plural(seats, 'seat'),
        position.is_executive ? 'Executive' : 'Not executive',
        `${plural(choices, 'choice')} allowed`,
        levels.length > 0 ? `Year ${[...levels].sort().join(', ')}` : 'All year levels',
        ...(position.is_active === false ? ['Not on the ballot'] : []),
      ],
      description: position.description || null,
      qualifications: position.other_qualifications || null,
    };
  });

  const requirements = [
    ...(s.min_units !== null && s.min_units !== undefined ? [`Minimum units: ${s.min_units}`] : []),
    ...(s.min_gpa !== null && s.min_gpa !== undefined ? [`Minimum GPA: ${s.min_gpa}`] : []),
  ];

  return { schedule, positions, requirements, rules: s.rules || null, tieBreakRule: s.tie_break_rule || null };
}

import { reviewSubmission } from '../../../services/complianceService';
import { getApiErrorMessage } from '../../../utils/apiError';
import notify from '../../../lib/notify';

// Approve selected for compliance submissions: the same single SAO review call, one submission after another,
// so one refusal never stops the rest. items is [{ id, submittedAt, label }]. Says how many went through and,
// when some did not, the first reason. Resolves to the ids that could not be approved, so the caller can keep them ticked.
export default async function approveSelected(items, toast = {}) {
  const failed = [];
  let firstReason = '';
  for (const item of items) {
    try {
      await reviewSubmission(item.id, { status: 'approved', submitted_at: item.submittedAt });
    } catch (error) {
      failed.push(item.id);
      firstReason ||= getApiErrorMessage(error, 'Could not update this submission.');
    }
  }

  const approved = items.length - failed.length;
  if (failed.length === 0) {
    notify.success(`Approved ${approved} submission${approved === 1 ? '' : 's'}.`, toast);
  } else {
    const reason = firstReason.endsWith('.') ? firstReason : `${firstReason}.`;
    notify.error(`Approved ${approved} of ${items.length} submissions. ${failed.length} could not be approved: ${reason} The list is up to date, so you can try the rest again.`, toast);
  }
  return failed;
}

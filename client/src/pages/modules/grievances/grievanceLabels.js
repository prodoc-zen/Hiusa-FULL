import { grievanceLifecycle } from '../../../lib/lifecycle';

// Shared vocabulary for the confidential grievances screens. Kept out of the
// shared components/ui/statusTones.js map on purpose: urgency is a severity
// scale, not a lifecycle status, and "resolved"/"dismissed" need a tone this
// module owns rather than one shared with every other status in the app.

export const URGENCY_ORDER = ['Critical', 'High', 'Medium', 'Low'];

// Mirrors GrievanceController::CATEGORY_KEYWORDS plus its "General" default -
// the categories the classifier (AI service or PHP fallback) can ever assign.
export const CATEGORIES = ['Safety & Security', 'Financial Integrity', 'Facilities & Maintenance', 'Academic / Faculty', 'General'];

const URGENCY_TONE = {
  Critical: 'danger',
  High: 'warning',
  Medium: 'info',
  Low: 'neutral',
};

export function urgencyTone(urgency) {
  return URGENCY_TONE[urgency] || 'neutral';
}

export function urgencyRank(urgency) {
  const index = URGENCY_ORDER.indexOf(urgency);
  return index === -1 ? URGENCY_ORDER.length : index;
}

// Overrides for the two grievance statuses statusTones.js does not carry
// (it only defines "submitted" and "under_review" for this lifecycle).
const GRIEVANCE_STATUS_TONE = {
  resolved: 'success',
  dismissed: 'neutral',
};

export function grievanceStatusTone(status) {
  return GRIEVANCE_STATUS_TONE[status];
}

export const GRIEVANCE_STATUS_LABEL = {
  submitted: 'Submitted',
  under_review: 'Under review',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
};

export const ALLOWED_TRANSITIONS = {
  submitted: ['under_review', 'resolved', 'dismissed'],
  under_review: ['resolved', 'dismissed'],
};

export const TRANSITION_ACTION_LABEL = {
  under_review: 'Move to under review',
  resolved: 'Resolve',
  dismissed: 'Dismiss',
};

export function addressedToLabel(grievance) {
  return grievance.organization_id ? (grievance.organization?.name || 'Organization') : 'Student Affairs Office';
}

// The server stores no addressed_to column on a grievance: a null organization_id means it went to the SAO.
export function addressedToKey(grievance) {
  return grievance.organization_id ? 'organization' : 'sao';
}

export function grievanceStage(grievance, viewerRole) {
  return grievanceLifecycle({ ...grievance, addressed_to: addressedToKey(grievance) }, viewerRole);
}

// Read as the filer, so the student's row and the reviewer's row for one grievance print the same sentence.
export function grievanceStageText(grievance) {
  return grievanceStage(grievance, 'STUDENT').nextAction.title;
}

export function filerDisplayName(grievance) {
  if (!('submitted_by' in grievance)) {
    return null;
  }

  const submitter = grievance.submitter;
  const name = submitter ? `${submitter.first_name || ''} ${submitter.last_name || ''}`.trim() : '';
  return name || `Student ${grievance.submitted_by}`;
}

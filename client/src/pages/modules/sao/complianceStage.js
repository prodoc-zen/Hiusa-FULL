import { complianceRenewalLifecycle } from '../../../lib/lifecycle';

// Accepts a requirement row (remarks sit on its submission) or a submission shaped like
// { status, remarks, requirement_name }.
export function complianceStage(requirement, viewerRole = 'ADMIN') {
  return complianceRenewalLifecycle({ ...requirement, remarks: requirement.remarks ?? requirement.submission?.remarks }, viewerRole);
}

// Read as the organization, so its requirement row and the SAO's queue row for the same submission print
// the same sentence. Before anything is submitted there is nothing to wait for, so the row says so plainly.
export function complianceStageText(requirement) {
  if (requirement.status === 'not_submitted') return 'Not submitted';
  return complianceStage(requirement).nextAction.title;
}

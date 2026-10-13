import { openProtectedFile } from './openProtectedFile';

export function openRequirementSample(requirement, { publicRegistration = false } = {}) {
  if (requirement.template_url) {
    const url = new URL(requirement.template_url);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid sample link.');
    window.open(url.href, '_blank', 'noopener,noreferrer');
    return Promise.resolve();
  }
  const id = requirement.requirement_type_id || requirement.id;
  const path = publicRegistration
    ? `/organization-applications/requirements/${id}/template`
    : `/compliance/requirement-types/${id}/template`;
  return openProtectedFile(path);
}

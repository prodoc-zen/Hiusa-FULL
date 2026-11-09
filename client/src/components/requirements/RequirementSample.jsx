export default function RequirementSample({ requirement, onOpen }) {
  const available = requirement.template_url || requirement.template_original_name;
  if (!available) return null;
  return <span className="my-2 block text-xs">
    <span className="block break-all text-ink-muted">Sample format: {requirement.template_original_name || 'Publisher-provided link'}</span>
    <button type="button" onClick={() => onOpen(requirement)} className="inline-flex min-h-11 items-center font-semibold text-brand-700 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">View sample format</button>
  </span>;
}

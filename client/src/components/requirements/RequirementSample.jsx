export default function RequirementSample({ requirement, onOpen }) {
  const available = requirement.template_url || requirement.template_original_name;
  return <span className="my-2 block text-xs">
    {available ? <>
      <span className="block break-all text-ink-muted">Sample format: {requirement.template_original_name || 'Publisher-provided link'}</span>
      <button type="button" onClick={() => onOpen(requirement)} className="inline-flex min-h-11 items-center font-semibold text-[#0878B7] underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B8ED0]">View sample format</button>
    </> : <span className="block font-medium text-danger-strong">Sample format not provided. SAO must attach a file or link to this requirement.</span>}
  </span>;
}

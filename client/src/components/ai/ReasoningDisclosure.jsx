function thoughtLabel(seconds) {
  const count = Math.round(Number(seconds));
  if (!Number.isFinite(count) || count <= 0) return 'How this was answered';
  return `Thought for ${count} ${count === 1 ? 'second' : 'seconds'}`;
}

function latestLabel(reasoning) {
  if (typeof reasoning?.label === 'string' && reasoning.label.trim()) return reasoning.label.trim();
  const steps = Array.isArray(reasoning?.steps) ? reasoning.steps : [];
  return steps.length > 0 ? String(steps[steps.length - 1]) : '';
}

export default function ReasoningDisclosure({ reasoning, live = false, seconds }) {
  if (live) {
    const label = latestLabel(reasoning);
    return (
      <p role="status" className="flex items-center gap-2 text-xs font-medium text-ink-muted-strong">
        <span aria-hidden="true" className="flex gap-0.5">
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="h-1 w-1 rounded-full bg-ink-soft animate-pulse motion-reduce:animate-none"
              style={{ animationDelay: `${index * 160}ms` }}
            />
          ))}
        </span>
        <span>Thinking</span>
        {label && <span className="min-w-0 truncate font-normal text-ink-muted">{label}</span>}
      </p>
    );
  }

  const steps = Array.isArray(reasoning?.steps) ? reasoning.steps.filter(Boolean) : [];
  const summary = typeof reasoning?.summary === 'string' ? reasoning.summary.trim() : '';
  if (steps.length === 0 && !summary) return null;

  return (
    <details className="group text-xs">
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-control font-medium text-ink-muted-strong hover:text-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="inline-block transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none">
          &rsaquo;
        </span>
        {thoughtLabel(seconds ?? reasoning?.seconds)}
      </summary>
      <div className="mt-1.5 space-y-2 border-l-2 border-line pl-3">
        {steps.length > 0 && (
          <ol className="list-decimal space-y-1 pl-4 leading-5 text-ink-muted-strong">
            {steps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
        )}
        {summary && <p className="whitespace-pre-line leading-5 text-ink-muted">{summary}</p>}
      </div>
    </details>
  );
}

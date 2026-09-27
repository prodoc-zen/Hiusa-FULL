export default function SegmentedControl({ options, value, onChange, className = '' }) {
  return (
    <div role="radiogroup" className={`inline-flex items-center gap-0.5 rounded-control border border-line bg-subtle p-1 ${className}`}>
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(option.value)}
            className={`h-8 rounded-[4px] px-3 text-xs font-bold transition-colors duration-150 ${isActive ? 'bg-surface text-ink shadow-card' : 'text-ink-muted hover:text-ink'}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

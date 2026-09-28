const SIZES = { sm: 36, md: 48, lg: 64 };

export default function DrawnCheck({ label = 'Success', size = 'md', className = '' }) {
  const dimension = SIZES[size] || SIZES.md;

  return (
    <span role="img" aria-label={label} className={`inline-flex shrink-0 ${className}`}>
      <svg width={dimension} height={dimension} viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <circle cx="24" cy="24" r="22" className="fill-success-tint stroke-success-strong" strokeWidth="2" />
        <path
          d="M14 24.5l7 7 13-14"
          pathLength={1}
          className="drawn-check-path text-success-strong"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </span>
  );
}

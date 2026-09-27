export function Skeleton({ className = '' }) {
  return <div className={`skeleton-shimmer rounded-control ${className}`} aria-hidden="true" />;
}

export function SkeletonText({ lines = 3, className = '' }) {
  return (
    <div className={`flex flex-col gap-2 ${className}`} role="status" aria-label="Loading content">
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton key={index} className={`h-3 ${index === lines - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  );
}

export function SkeletonCard({ className = '' }) {
  return (
    <div className={`rounded-card border border-line bg-surface p-5 ${className}`} role="status" aria-label="Loading card">
      <Skeleton className="h-4 w-1/3" />
      <div className="mt-4"><SkeletonText lines={2} /></div>
    </div>
  );
}

export function SkeletonStat({ className = '' }) {
  return (
    <div className={`rounded-card border border-line bg-surface p-5 ${className}`} role="status" aria-label="Loading stat">
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="mt-3 h-7 w-2/3" />
      <Skeleton className="mt-2 h-3 w-1/3" />
    </div>
  );
}

export function SkeletonTable({ rows = 5, columns = 4, className = '' }) {
  return (
    <div className={`overflow-hidden rounded-card border border-line ${className}`} role="status" aria-label="Loading table">
      <div className="flex gap-4 border-b border-line bg-subtle px-4 py-3">
        {Array.from({ length: columns }).map((_, index) => <Skeleton key={index} className="h-3 flex-1" />)}
      </div>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-4 border-b border-line-soft px-4 py-4 last:border-b-0">
          {Array.from({ length: columns }).map((_, colIndex) => <Skeleton key={colIndex} className="h-3 flex-1" />)}
        </div>
      ))}
    </div>
  );
}

export default Skeleton;

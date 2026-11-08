// A still, table-shaped placeholder: the page title line, then a few rows. No shimmer.
export default function RouteLoadingFallback() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading page">
      <div className="h-6 w-48 rounded bg-line-soft" />
      <div className="divide-y divide-line rounded-card border border-line bg-white">
        {[1, 2, 3, 4, 5].map((item) => (
          <div key={item} className="flex items-center gap-4 px-4 py-3">
            <div className="h-3 flex-1 rounded bg-line-soft" />
            <div className="h-3 w-24 rounded bg-line-soft" />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading page...</span>
    </div>
  );
}

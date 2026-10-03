export default function RouteLoadingFallback() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading page">
      <div className="h-24 animate-pulse rounded-lg border border-[#DDE7EF] bg-white" />
      <div className="grid gap-4 sm:grid-cols-2">
        {[1, 2, 3, 4].map((item) => <div key={item} className="h-36 animate-pulse rounded-lg border border-[#DDE7EF] bg-white" />)}
      </div>
      <span className="sr-only">Loading page...</span>
    </div>
  );
}

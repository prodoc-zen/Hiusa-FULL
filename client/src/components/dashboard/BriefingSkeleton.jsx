import { Skeleton } from '../ui/Skeleton';

/**
 * Shared loading state for the briefing block (intro + attention + insights),
 * shaped like the layout it replaces per WAVE_B_CONTRACT's S-02 (animated
 * skeleton, never "Loading..." text).
 */
export default function BriefingSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading your briefing">
      <div className="space-y-2 border-b border-line pb-5">
        <Skeleton className="h-3 w-72 max-w-full" />
        <Skeleton className="h-7 w-56 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {[1, 2].map((panel) => (
          <div key={panel} className="rounded-card border border-line bg-surface p-5">
            <Skeleton className="h-4 w-36" />
            <div className="mt-5 flex items-center gap-3">
              <Skeleton className="h-6 w-14 rounded-control" />
              <Skeleton className="h-4 flex-1" />
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-card border border-line bg-surface p-5"><Skeleton className="h-4 w-44" /></div>
      <span className="sr-only">Loading your briefing</span>
    </div>
  );
}

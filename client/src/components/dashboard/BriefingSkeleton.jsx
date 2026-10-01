import { Skeleton } from '../ui/Skeleton';

/**
 * Shared loading state for the briefing block (header + attention + pulse),
 * shaped like the layout it replaces per WAVE_B_CONTRACT's S-02 (animated
 * skeleton, never "Loading..." text).
 */
export default function BriefingSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading your briefing">
      <div className="rounded-card border border-line bg-navy-950 p-6">
        <div className="flex items-start gap-4">
          <Skeleton className="h-16 w-16 shrink-0 rounded-full bg-white/10" />
          <div className="flex-1 space-y-2.5">
            <Skeleton className="h-3 w-40 bg-white/10" />
            <Skeleton className="h-7 w-64 bg-white/10" />
            <Skeleton className="h-3 w-80 max-w-full bg-white/10" />
          </div>
        </div>
      </div>
      <div className="rounded-card border border-line bg-surface p-5">
        {[1, 2, 3].map((row) => (
          <div key={row} className="flex items-center gap-3 border-b border-line-soft py-3 last:border-b-0">
            <Skeleton className="h-6 w-14 rounded-full" />
            <Skeleton className="h-4 flex-1" />
          </div>
        ))}
      </div>
      <div className="rounded-card border border-line bg-surface p-5">
        {[1, 2, 3].map((row) => (
          <div key={row} className="flex items-center gap-3 border-b border-line-soft py-4 last:border-b-0">
            <Skeleton className="h-10 w-10 rounded-control" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
        ))}
      </div>
      <span className="sr-only">Loading your briefing</span>
    </div>
  );
}

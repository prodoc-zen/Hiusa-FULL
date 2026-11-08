import { Skeleton } from '../ui/Skeleton';

/**
 * Shared loading state for the briefing block (headline + attention),
 * shaped like the layout it replaces per WAVE_B_CONTRACT's S-02 (skeleton
 * rows, never "Loading..." text).
 */
export default function BriefingSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading your briefing">
      <div className="border-b border-line pb-4">
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="rounded-card border border-line bg-surface p-5">
        <Skeleton className="h-4 w-36" />
        <div className="mt-5 space-y-3">
          {[1, 2, 3].map((row) => <Skeleton key={row} className="h-4 w-full" />)}
        </div>
      </div>
      <span className="sr-only">Loading your briefing</span>
    </div>
  );
}

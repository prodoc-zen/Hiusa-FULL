import { useSyncExternalStore } from 'react';

// Whether a process tracker is on screen right now. The briefing below it reads this to leave out its own
// first-run checklist, so one page never shows two progress widgets that can disagree.
let shown = false;
const listeners = new Set();

export function setTrackerShown(next) {
  if (shown === next) return;
  shown = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTrackerShown() {
  return useSyncExternalStore(subscribe, () => shown, () => false);
}

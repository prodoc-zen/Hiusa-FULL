import { useEffect, useRef } from 'react';

export function useRefetchOnReturn(refetch, { intervalMs = 30000, minGapMs = 8000 } = {}) {
  const latest = useRef(refetch);

  useEffect(() => { latest.current = refetch; });

  useEffect(() => {
    let inFlight = false;
    let lastRun = Date.now();

    function run() {
      if (document.visibilityState !== 'visible' || inFlight || Date.now() - lastRun < minGapMs) return;
      lastRun = Date.now();
      let pending;
      try {
        pending = latest.current();
      } catch {
        return;
      }
      if (typeof pending?.then !== 'function') return;
      inFlight = true;
      pending.then(() => {}, () => {}).then(() => { inFlight = false; });
    }

    document.addEventListener('visibilitychange', run);
    window.addEventListener('focus', run);
    const timer = window.setInterval(run, intervalMs);
    return () => {
      document.removeEventListener('visibilitychange', run);
      window.removeEventListener('focus', run);
      window.clearInterval(timer);
    };
  }, [intervalMs, minGapMs]);
}

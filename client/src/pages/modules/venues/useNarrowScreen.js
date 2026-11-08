import { useEffect, useState } from 'react';

const QUERY = '(max-width: 767px)';

function matches() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches;
}

// True below the md breakpoint. A browser without matchMedia, and the test DOM, count as wide.
export default function useNarrowScreen() {
  const [narrow, setNarrow] = useState(matches);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(QUERY);
    const update = () => setNarrow(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return narrow;
}

import { useCallback, useEffect, useState } from 'react';
import useRecordParam from '../../../lib/useRecordParam';
import { getGrievance } from '../../../services/grievanceService';
import notify from '../../../lib/notify';

// The grievance open in the drawer, addressable as ?record=<id>. A row click hands over the row it
// already has; a deep link fetches the one grievance, so it opens even when it is not on this page.
export default function useGrievanceRecord() {
  const [recordId, setRecordId] = useRecordParam();
  const [loaded, setLoaded] = useState(null);

  useEffect(() => {
    if (!recordId || String(loaded?.id) === recordId) return undefined;
    let cancelled = false;
    getGrievance(recordId)
      .then((response) => { if (!cancelled) setLoaded(response.data); })
      .catch(() => {
        if (cancelled) return;
        notify.error('That grievance is not available to you.');
        setRecordId(null);
      });
    return () => { cancelled = true; };
  }, [recordId, loaded, setRecordId]);

  const open = useCallback((row) => {
    setLoaded(row);
    setRecordId(row.id);
  }, [setRecordId]);

  const close = useCallback(() => setRecordId(null), [setRecordId]);

  const selected = recordId && loaded && String(loaded.id) === recordId ? loaded : null;
  return { selected, open, close, replace: setLoaded };
}

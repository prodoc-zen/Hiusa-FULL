import { useCallback } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

const OPENED_FROM_LIST = 'recordOpenedFromList';

// Reads and writes the `record` query parameter that makes a drawer addressable. Opening pushes a
// history entry so Back closes the drawer. Closing steps back when this hook pushed that entry, so
// the list is not followed by a second identical entry; on a deep link there is nothing to step
// back to, so it replaces the entry instead. Switching from one record to another replaces, so
// closing still needs a single step.
export default function useRecordParam() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const recordId = searchParams.get('record') || null;
  const openedFromList = location.state?.[OPENED_FROM_LIST] === true;

  const setRecordId = useCallback((id) => {
    const next = new URLSearchParams(searchParams);
    const clearing = id === null || id === undefined || id === '';

    if (clearing) {
      if (!next.has('record')) return;
      if (openedFromList) {
        navigate(-1);
        return;
      }
      next.delete('record');
      setSearchParams(next, { replace: true });
      return;
    }

    if (String(id) === recordId) return;
    next.set('record', String(id));
    const switching = recordId !== null;
    setSearchParams(next, { replace: switching, state: { [OPENED_FROM_LIST]: switching ? openedFromList : true } });
  }, [navigate, openedFromList, recordId, searchParams, setSearchParams]);

  return [recordId, setRecordId];
}

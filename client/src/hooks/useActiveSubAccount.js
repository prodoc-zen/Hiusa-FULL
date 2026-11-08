import { useCallback, useEffect, useState } from 'react';
import { clearApiCache } from '../services/api';
import { SUB_ACCOUNT_EVENT, readActiveSubAccount, writeActiveSubAccount } from '../utils/subAccountStore';

// The one reader of the Department Head's open organization space. Pages that used to parse
// sessionStorage and listen for the switch event themselves call this instead.
export default function useActiveSubAccount() {
  const [subAccount, setSubAccount] = useState(readActiveSubAccount);

  useEffect(() => {
    const onSwitched = (event) => setSubAccount(event.detail || null);
    window.addEventListener(SUB_ACCOUNT_EVENT, onSwitched);
    return () => window.removeEventListener(SUB_ACCOUNT_EVENT, onSwitched);
  }, []);

  const enter = useCallback((organization) => {
    clearApiCache();
    writeActiveSubAccount(organization);
  }, []);

  const leave = useCallback(() => {
    clearApiCache();
    writeActiveSubAccount(null);
  }, []);

  return { subAccount, subAccountId: subAccount?.id ? Number(subAccount.id) : null, enter, leave };
}

import { useEffect, useState } from 'react';
import { getApprovalRequests } from '../services/approvalService';
import { listMeta } from '../services/pagination';

// How many approval requests wait on this reviewer (the dean or the dean's office staff), the same number the
// approvals page shows beside its Pending tab. null until it loads, and again if it cannot, so a page shows
// no tile rather than a wrong zero.
export default function usePendingApprovalCount() {
  const [count, setCount] = useState(null);

  useEffect(() => {
    let active = true;
    getApprovalRequests({ status: 'pending', per_page: 1 })
      .then((response) => { if (active) setCount(listMeta(response.data).total); })
      .catch(() => { if (active) setCount(null); });
    return () => { active = false; };
  }, []);

  return count;
}

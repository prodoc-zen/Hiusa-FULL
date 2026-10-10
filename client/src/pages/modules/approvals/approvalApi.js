import { getApprovalRequests } from '../../../services/approvalService';
import { listMeta, unwrapList } from '../../../services/pagination';

const PAGE_SIZE = 100;
const MAX_PAGES = 10;

// The server has no endpoint that returns one approval request and the list has no id filter, so a
// link to ?record=<id> that is not on the page the person is looking at is found by walking the
// scopes that can contain it, newest first, until the id turns up. Returns null when it is in none
// of them, which is also what a request belonging to another organization looks like.
export async function findApprovalRequest(id, scopes) {
  const wanted = String(id);

  for (const scope of scopes) {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const { data } = await getApprovalRequests({ ...scope, status: 'all', page, per_page: PAGE_SIZE });
      const found = unwrapList(data).find((request) => String(request.id) === wanted);
      if (found) return found;
      if (page >= listMeta(data).lastPage) break;
    }
  }

  return null;
}

import { getApprovalRequest } from '../../../services/approvalService';

// A link to ?record=<id> that is not on the page the person is looking at is read straight from the
// server. A 404 means the request does not exist or is not visible to this person (another
// organization's, say), and is answered with null; any other failure is left for the caller.
export async function findApprovalRequest(id) {
  try {
    const { data } = await getApprovalRequest(id);
    return data;
  } catch (error) {
    if (error?.response?.status === 404) return null;
    throw error;
  }
}

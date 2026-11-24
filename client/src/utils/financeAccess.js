import { effectiveRole, storedUser } from './collegeIdentity';

// Who may change the organization's finances: an Admin always, and an officer only while their position carries the
// "Can handle finance" switch (user.can_handle_finance). The flag must be exactly true, so a user stored before it
// existed stays view only. Admin-only steps (verifying a collection, cash advances, closing an invoice, deleting or
// submitting a budget, submitting a report) check the role itself and do not use this.
export function canHandleFinance(user) {
  const role = effectiveRole(user);
  return role === 'ADMIN' || (role === 'SBO_OFFICER' && user?.can_handle_finance === true);
}

export function readCanHandleFinance() {
  return canHandleFinance(storedUser());
}

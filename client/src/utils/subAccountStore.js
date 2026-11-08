export const SUB_ACCOUNT_KEY = 'hiusa_active_subaccount';
export const SUB_ACCOUNT_EVENT = 'hiusa-subaccount-switched';

export function readActiveSubAccount() {
  try {
    const stored = sessionStorage.getItem(SUB_ACCOUNT_KEY);
    const parsed = stored ? JSON.parse(stored) : null;
    return parsed?.id ? parsed : null;
  } catch {
    return null;
  }
}

export function writeActiveSubAccount(organization) {
  const entry = organization?.id ? { id: organization.id, name: organization.name, acronym: organization.acronym } : null;
  try {
    if (entry) sessionStorage.setItem(SUB_ACCOUNT_KEY, JSON.stringify(entry));
    else sessionStorage.removeItem(SUB_ACCOUNT_KEY);
  } catch {
    // The space still opens for this page view when browser storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(SUB_ACCOUNT_EVENT, { detail: entry }));
}

// Autosaves an in-progress evaluation response to localStorage so a refresh
// or an accidental tab close does not lose a partially filled questionnaire.
// Keyed by user and window so different windows (or different people sharing
// a browser) never see each other's drafts.

function draftKey(userId, windowId) {
  return `hiusa:evaluation-draft:${userId ?? 'anon'}:${windowId}`;
}

export function loadDraft(userId, windowId) {
  try {
    const raw = localStorage.getItem(draftKey(userId, windowId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveDraft(userId, windowId, draft) {
  try {
    localStorage.setItem(draftKey(userId, windowId), JSON.stringify(draft));
  } catch {
    // Storage can be full or blocked (private browsing); autosave is a
    // convenience, not a requirement, so failing silently is correct here.
  }
}

export function clearDraft(userId, windowId) {
  try {
    localStorage.removeItem(draftKey(userId, windowId));
  } catch {
    // Nothing to do if storage is unavailable.
  }
}

export const SESSION_LIFETIME_SECONDS = 4 * 60 * 60;

export function startAuthSession(data) {
  const lifetime = Number(data.session_expires_in_seconds) || SESSION_LIFETIME_SECONDS;
  localStorage.setItem('auth_token', data.access_token);
  localStorage.setItem('user', JSON.stringify(data.user));
  localStorage.setItem('auth_expires_at', String(Date.now() + lifetime * 1000));
  window.dispatchEvent(new Event('hiusa:session-started'));
}

export function clearAuthSession() {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('user');
  localStorage.removeItem('auth_expires_at');
}

// The page a sign out lands on shows why, once: a full page load in between keeps this in the tab and nowhere else.
export function rememberSignOutNotice(message) {
  if (message) sessionStorage.setItem('sign_out_notice', String(message));
}

export function takeSignOutNotice() {
  const message = sessionStorage.getItem('sign_out_notice');
  sessionStorage.removeItem('sign_out_notice');
  return message;
}

export function sessionHasExpired() {
  const expiresAt = Number(localStorage.getItem('auth_expires_at'));
  return Boolean(localStorage.getItem('auth_token')) && expiresAt > 0 && Date.now() >= expiresAt;
}

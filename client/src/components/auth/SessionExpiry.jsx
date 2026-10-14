import { useEffect } from 'react';
import { clearAuthSession, sessionHasExpired } from '../../utils/authSession';

export default function SessionExpiry() {
  useEffect(() => {
    let timer;
    function checkSession() {
      window.clearTimeout(timer);
      if (sessionHasExpired()) {
        clearAuthSession();
        if (!window.location.pathname.startsWith('/register-organization')) {
          window.location.assign('/?session=expired');
        }
        return;
      }
      const expiresAt = Number(localStorage.getItem('auth_expires_at'));
      if (localStorage.getItem('auth_token') && expiresAt > 0) {
        timer = window.setTimeout(checkSession, Math.min(Math.max(expiresAt - Date.now(), 0), 60_000));
      }
    }
    checkSession();
    window.addEventListener('hiusa:session-started', checkSession);
    window.addEventListener('storage', checkSession);
    document.addEventListener('visibilitychange', checkSession);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('hiusa:session-started', checkSession);
      window.removeEventListener('storage', checkSession);
      document.removeEventListener('visibilitychange', checkSession);
    };
  }, []);

  return null;
}

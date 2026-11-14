import { useEffect } from 'react';
import { storedUser } from '../utils/collegeIdentity';

const SIGN_IN_KEYS = ['user', 'auth_token'];

const signature = () => `${localStorage.getItem('auth_token') ?? ''}|${storedUser()?.role ?? ''}|${storedUser()?.organization_id ?? ''}`;

// The sign-in lives in storage that every tab shares. When another tab switches profile, signs in as someone else or
// signs out, this tab would show a mix of the old menu and the new person, so it reloads and starts from the stored sign-in.
export default function useProfileSync() {
  useEffect(() => {
    let known = signature();
    const onStorage = (event) => {
      if (event.key !== null && !SIGN_IN_KEYS.includes(event.key)) return;
      const next = signature();
      if (next === known) return;
      known = next;
      window.location.reload();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
}

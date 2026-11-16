import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from '../Modal';
import PrivacyAgreement from '../auth/PrivacyAgreement';
import { Button } from '../ui';
import { acceptPrivacyNotice, logout } from '../../services/authService';
import { storedUser } from '../../utils/collegeIdentity';
import { getApiErrorMessage } from '../../utils/apiError';
import { PRIVACY_CONSENT_EVENT, PRIVACY_NOTICE_VERSION } from '../../utils/privacyNotice';

// Accounts made before the notice, and accounts someone else made for the person, have no agreement on record, and
// an agreement to an older version of the notice no longer counts. The person agrees after signing in or signs out;
// there is no way to close this and carry on. The dialog also opens when the server refuses an AI request for want of
// an agreement. A forced password change comes first, and the server refuses the agreement until then.
export default function PrivacyConsentDialog() {
  const navigate = useNavigate();
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [refused, setRefused] = useState(false);

  useEffect(() => {
    const open = () => {
      setRecorded(false);
      setRefused(true);
    };
    window.addEventListener(PRIVACY_CONSENT_EVENT, open);
    return () => window.removeEventListener(PRIVACY_CONSENT_EVENT, open);
  }, []);

  const user = storedUser();
  if (!user || user.must_change_password) return null;
  // No time on record, including a stored sign in from before the notice, or an agreement to another version.
  const needsAgreement = user.privacy_accepted_at == null || user.privacy_notice_version !== PRIVACY_NOTICE_VERSION || refused;
  if (recorded || !needsAgreement) return null;

  async function agree() {
    if (!agreed) {
      setError('Read the Data Privacy Notice and tick the box to agree.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await acceptPrivacyNotice();
      localStorage.setItem('user', JSON.stringify({ ...user, ...response.data.data }));
      setRecorded(true);
      setRefused(false);
      setAgreed(false);
      setBusy(false);
    } catch (cause) {
      setError(getApiErrorMessage(cause, 'We could not record your agreement. Try again.'));
      setBusy(false);
    }
  }

  async function signOut() {
    setSigningOut(true);
    try {
      await logout();
    } finally {
      navigate('/login');
    }
  }

  return (
    <Modal
      open
      title="Before you continue"
      description="HIUSA keeps school records about you, such as your name, school ID and activity in your organizations."
      maxWidth="max-w-lg"
      closeOnBackdrop={false}
      closeOnEscape={false}
      footer={(
        <>
          <Button variant="secondary" onClick={signOut} loading={signingOut} disabled={busy}>Sign out</Button>
          <Button onClick={agree} loading={busy} disabled={signingOut}>Agree and continue</Button>
        </>
      )}
    >
      <div className="space-y-3">
        <p className="text-sm text-ink-muted">
          The Data Privacy Act of 2012 asks us to tell you what we collect, why, and who sees it. Read the notice, then agree to keep using HIUSA. You can sign out instead.
        </p>
        <PrivacyAgreement id="privacy-consent-agree" checked={agreed} onChange={(value) => { setAgreed(value); setError(''); }} error={error} />
      </div>
    </Modal>
  );
}

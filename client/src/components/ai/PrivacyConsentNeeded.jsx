import { Button } from '../ui';
import { PRIVACY_CONSENT_EVENT } from '../../utils/privacyNotice';

// Shown where an Ask AI request was refused for want of the privacy agreement. Trying again cannot work until the
// person agrees, so the action opens the same consent dialog the server's refusal opens.
export default function PrivacyConsentNeeded({ className = '' }) {
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface px-3.5 py-2.5 ${className}`}>
      <p className="min-w-0 flex-1 text-sm font-medium text-ink-muted-strong">
        Agree to the Data Privacy Notice first. Ask AI reads your school records, so it stays off until you do.
      </p>
      <Button size="sm" onClick={() => window.dispatchEvent(new Event(PRIVACY_CONSENT_EVENT))} className="max-sm:h-[42px]">Read and agree</Button>
    </div>
  );
}

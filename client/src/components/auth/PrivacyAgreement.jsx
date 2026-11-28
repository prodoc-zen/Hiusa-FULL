import { Link } from 'react-router-dom';

// The required agreement on every form that makes an account, and in the consent dialog. The notice opens in a new
// tab so what was typed in the form is kept.
export default function PrivacyAgreement({ id, checked, onChange, error }) {
  const errorId = `${id}-error`;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-2.5 text-sm font-medium text-ink">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          aria-required="true"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="h-5 w-5 shrink-0 accent-brand-700"
        />
        <span>
          I have read the{' '}
          <Link to="/privacy" target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-700 underline hover:text-brand-800">Data Privacy Notice</Link>
          {' '}and agree to the processing of my personal data
        </span>
      </label>
      {error && <p id={errorId} role="alert" className="text-xs font-semibold text-danger-strong">{error}</p>}
    </div>
  );
}

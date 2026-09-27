import { AlertTriangle } from 'lucide-react';
import Button from './Button';

export default function ErrorState({ title = 'Something went wrong', description, onRetry, retryLabel = 'Try again', className = '' }) {
  return (
    <div className={`flex flex-col items-center gap-3 px-6 py-12 text-center ${className}`}>
      <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-danger-tint text-danger-strong">
        <AlertTriangle size={26} strokeWidth={1.75} aria-hidden="true" />
      </div>
      <div>
        <p className="text-base font-bold text-ink">{title}</p>
        {description && <p className="mx-auto mt-1 max-w-sm text-sm font-medium text-ink-muted">{description}</p>}
      </div>
      {onRetry && <Button variant="secondary" onClick={onRetry}>{retryLabel}</Button>}
    </div>
  );
}

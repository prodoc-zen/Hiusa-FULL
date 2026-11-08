import Button from './Button';

export default function ErrorState({ title = 'Something went wrong', description, onRetry, retryLabel = 'Try again', icon: Icon, className = '' }) {
  return (
    <div className={`flex flex-col items-start gap-2 py-8 ${className}`}>
      {Icon && <Icon size={24} strokeWidth={1.75} className="text-ink-muted" aria-hidden="true" />}
      <div>
        <p className="text-sm font-semibold text-ink">{title}</p>
        {description && <p className="mt-1 max-w-prose text-sm font-normal text-ink-muted">{description}</p>}
      </div>
      {onRetry && <Button variant="secondary" onClick={onRetry}>{retryLabel}</Button>}
    </div>
  );
}

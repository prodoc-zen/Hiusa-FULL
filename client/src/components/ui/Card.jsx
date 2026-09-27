export default function Card({ title, description, actions, footer, children, className = '', bodyClassName = '' }) {
  const hasHeader = Boolean(title || description || actions);

  return (
    <section className={`rounded-card border border-line bg-surface shadow-card ${className}`}>
      {hasHeader && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-base font-bold text-ink">{title}</h2>}
            {description && <p className="mt-1 text-sm font-medium text-ink-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={`p-5 ${bodyClassName}`}>{children}</div>
      {footer && <footer className="border-t border-line bg-subtle px-5 py-4">{footer}</footer>}
    </section>
  );
}

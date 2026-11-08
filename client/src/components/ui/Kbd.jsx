export default function Kbd({ children, className = '' }) {
  return (
    <kbd className={`inline-flex h-6 min-w-6 items-center justify-center rounded border border-line bg-subtle px-1.5 font-mono text-xs font-semibold text-ink-muted ${className}`}>
      {children}
    </kbd>
  );
}

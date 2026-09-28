export default function Kbd({ children, className = '' }) {
  return (
    <kbd className={`inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-subtle px-1.5 font-mono text-[11px] font-semibold text-ink-muted ${className}`}>
      {children}
    </kbd>
  );
}

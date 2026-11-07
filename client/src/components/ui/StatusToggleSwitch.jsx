export default function StatusToggleSwitch({
  checked = false,
  onChange,
  disabled = false,
  label = 'Toggle status',
  activeText = 'Active',
  inactiveText = 'Inactive',
  showText = true,
  className = '',
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={Boolean(checked)}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange?.(!checked)}
      className={`inline-flex items-center gap-2 rounded-full px-2 py-1 text-xs font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B8ED0] disabled:cursor-not-allowed disabled:opacity-50 ${className}`.trim()}
    >
      <span
        aria-hidden="true"
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 ${
          checked ? 'bg-emerald-600' : 'bg-rose-500/85'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition-transform duration-200 ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </span>
      {showText && (
        <span className={checked ? 'text-emerald-700' : 'text-slate-600'}>
          {checked ? activeText : inactiveText}
        </span>
      )}
    </button>
  );
}

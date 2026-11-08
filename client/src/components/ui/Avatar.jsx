const SIZES = { sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-14 w-14 text-lg' };

function initialsFrom(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

// One tone for everyone. A color per person would read as a status.
export default function Avatar({ name, src, size = 'md', className = '' }) {
  if (src) {
    return <img src={src} alt={name || ''} className={`shrink-0 rounded-full object-cover ${SIZES[size]} ${className}`} />;
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-brand-700 font-semibold text-white ${SIZES[size]} ${className}`}
      role={name ? 'img' : undefined}
      aria-label={name || undefined}
      aria-hidden={name ? undefined : true}
    >
      {initialsFrom(name)}
    </span>
  );
}

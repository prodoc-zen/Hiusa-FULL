const PALETTE = ['bg-brand-600', 'bg-navy-800', 'bg-success-strong', 'bg-warning-strong', 'bg-danger-strong'];
const SIZES = { sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-14 w-14 text-lg' };

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function initialsFrom(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export default function Avatar({ name, src, size = 'md', className = '' }) {
  if (src) {
    return <img src={src} alt={name || ''} className={`shrink-0 rounded-full object-cover ${SIZES[size]} ${className}`} />;
  }

  const tone = PALETTE[hashString(name || '?') % PALETTE.length];

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white ${tone} ${SIZES[size]} ${className}`}
      role={name ? 'img' : undefined}
      aria-label={name || undefined}
      aria-hidden={name ? undefined : true}
    >
      {initialsFrom(name)}
    </span>
  );
}

const SIZES = { sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-14 w-14 text-lg' };

function abbreviate(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'ORG';
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
  return parts.map((part) => part[0]).slice(0, 3).join('').toUpperCase();
}

export default function OrgMark({ name, logoUrl, acronym, size = 'md', className = '' }) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={name || 'Organization logo'}
        className={`shrink-0 rounded-control border border-line object-cover ${SIZES[size]} ${className}`}
      />
    );
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-control border border-line bg-navy-950 font-extrabold text-white ${SIZES[size]} ${className}`}
      role="img"
      aria-label={name || 'Organization'}
    >
      {acronym || abbreviate(name)}
    </span>
  );
}

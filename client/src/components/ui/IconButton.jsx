import { forwardRef } from 'react';

const SIZES = { sm: 'h-9 w-9', md: 'h-11 w-11', lg: 'h-12 w-12' };
const ICON_SIZE = { sm: 16, md: 18, lg: 20 };

const VARIANTS = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700',
  secondary: 'border border-line bg-surface text-ink-muted hover:bg-subtle hover:text-ink',
  ghost: 'text-ink-muted hover:bg-subtle hover:text-ink',
  danger: 'text-danger hover:bg-danger-tint',
};

const IconButton = forwardRef(function IconButton(
  { icon: Icon, label, variant = 'ghost', size = 'md', className = '', type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type || 'button'}
      aria-label={label}
      title={label}
      className={`inline-flex shrink-0 items-center justify-center rounded-control transition-[transform,background-color,color] duration-[120ms] ease-out active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      <Icon size={ICON_SIZE[size]} aria-hidden="true" />
    </button>
  );
});

export default IconButton;

import { forwardRef } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

const SIZES = {
  sm: 'h-9 px-3 text-xs',
  md: 'h-11 px-4 text-sm',
  lg: 'h-12 px-5 text-base',
};

const GAP = {
  sm: 'gap-1.5',
  md: 'gap-2',
  lg: 'gap-2',
};

const ICON_SIZE = { sm: 14, md: 16, lg: 18 };

const VARIANTS = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800',
  secondary: 'border border-line bg-surface text-ink hover:bg-subtle',
  danger: 'bg-danger text-white hover:bg-danger-strong',
  ghost: 'text-ink hover:bg-subtle',
};

const Button = forwardRef(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    leftIcon: LeftIcon,
    rightIcon: RightIcon,
    to,
    disabled,
    className = '',
    children,
    type,
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;
  const iconSize = ICON_SIZE[size];
  const classes = `relative inline-flex items-center justify-center rounded-control font-bold transition-[transform,background-color,color,border-color] duration-[120ms] ease-out active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 ${SIZES[size]} ${VARIANTS[variant]} ${className}`;

  const content = (
    <>
      <span className={`inline-flex items-center ${GAP[size]} ${loading ? 'opacity-0' : ''}`}>
        {LeftIcon && <LeftIcon size={iconSize} aria-hidden="true" />}
        {children}
        {RightIcon && <RightIcon size={iconSize} aria-hidden="true" />}
      </span>
      {loading && (
        <span className="absolute inset-0 grid place-items-center">
          <Loader2 size={iconSize} className="animate-spin" aria-hidden="true" />
        </span>
      )}
    </>
  );

  if (to && !isDisabled) {
    return (
      <Link ref={ref} to={to} className={classes} {...rest}>
        {content}
      </Link>
    );
  }

  return (
    <button
      ref={ref}
      type={type || 'button'}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={classes}
      {...rest}
    >
      {content}
    </button>
  );
});

export default Button;

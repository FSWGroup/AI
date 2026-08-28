import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

/* ===========================================================================
   FSW People UI kit — server-friendly primitives.
   Interactive primitives (Modal, Drawer, menus) live in ./client.tsx.
   =========================================================================== */

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

const buttonVariants = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-300',
  secondary: 'bg-white text-ink-800 border border-ink-200 hover:bg-ink-50 disabled:text-ink-300',
  ghost: 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
  danger: 'bg-danger-500 text-white hover:opacity-90',
  dangerGhost: 'text-danger-500 border border-danger-100 bg-white hover:bg-danger-100',
} as const;

const buttonSizes = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-9 px-4 text-sm',
  lg: 'h-11 px-5 text-sm',
} as const;

export type ButtonVariant = keyof typeof buttonVariants;

export function buttonClass(variant: ButtonVariant = 'primary', size: keyof typeof buttonSizes = 'md') {
  return cx(
    'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors select-none whitespace-nowrap disabled:cursor-not-allowed',
    buttonVariants[variant],
    buttonSizes[size],
  );
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ComponentProps<'button'> & { variant?: ButtonVariant; size?: keyof typeof buttonSizes }) {
  return <button {...props} className={cx(buttonClass(variant, size), className)} />;
}

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: keyof typeof buttonSizes }) {
  return <Link {...props} className={cx(buttonClass(variant, size), className)} />;
}

// ---------------------------------------------------------------------------
// Cards & layout
// ---------------------------------------------------------------------------

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cx('rounded-card border border-ink-200/70 bg-white shadow-card', className)}>{children}</div>
  );
}

export function CardHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
      <div>
        <h2 className="text-[15px] font-semibold text-ink-900">{title}</h2>
        {description ? <p className="mt-0.5 text-[13px] text-ink-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('px-5 py-4', className)}>{children}</div>;
}

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
}) {
  return (
    <div className="mb-6">
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav aria-label="Breadcrumb" className="mb-1.5 flex items-center gap-1.5 text-[13px] text-ink-400">
          {breadcrumbs.map((b, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span aria-hidden>/</span>}
              {b.href ? (
                <Link className="hover:text-brand-600" href={b.href}>
                  {b.label}
                </Link>
              ) : (
                <span className="text-ink-500">{b.label}</span>
              )}
            </span>
          ))}
        </nav>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">{title}</h1>
          {description ? <p className="mt-1 max-w-2xl text-sm text-ink-500">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  href,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  href?: string;
  tone?: 'default' | 'warn' | 'danger' | 'ok';
}) {
  const valueColor =
    tone === 'warn' ? 'text-warn-500' : tone === 'danger' ? 'text-danger-500' : tone === 'ok' ? 'text-ok-500' : 'text-ink-900';
  const inner = (
    <div className="rounded-card border border-ink-200/70 bg-white px-4 py-3.5 shadow-card transition-shadow hover:shadow-pop">
      <div className="text-[12px] font-medium tracking-wide text-ink-500 uppercase">{label}</div>
      <div className={cx('mt-1 text-2xl font-semibold tabular-nums', valueColor)}>{value}</div>
      {hint ? <div className="mt-0.5 text-[12px] text-ink-400">{hint}</div> : null}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

// ---------------------------------------------------------------------------
// Badges & status
// ---------------------------------------------------------------------------

const badgeTones = {
  gray: 'bg-ink-100 text-ink-600',
  blue: 'bg-brand-100 text-brand-700',
  green: 'bg-ok-100 text-ok-500',
  amber: 'bg-warn-100 text-warn-500',
  red: 'bg-danger-100 text-danger-500',
  navy: 'bg-ink-800 text-white',
} as const;

export function Badge({ tone = 'gray', children }: { tone?: keyof typeof badgeTones; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap', badgeTones[tone])}>
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, keyof typeof badgeTones> = {
  ACTIVE: 'green', COMPLETED: 'green', APPROVED: 'green', SENT: 'green', ENROLLED: 'green', OPEN: 'blue',
  SIGNED: 'green', PAID: 'green', HIRED: 'green', SUCCEEDED: 'green', CONFIGURED: 'green', RESOLVED: 'green',
  PRE_START: 'blue', ONBOARDING: 'blue', IN_PROGRESS: 'blue', SUBMITTED: 'blue', SCHEDULED: 'blue',
  PENDING: 'amber', PENDING_APPROVAL: 'amber', ON_HOLD: 'amber', ON_LEAVE: 'amber', OVERDUE: 'red',
  BLOCKED: 'amber', DRAFT: 'gray', REVIEW: 'amber', MONITORING: 'amber', WAIVED: 'gray', OUTBOX: 'blue',
  OFFBOARDING: 'amber', TERMINATED: 'gray', DENIED: 'red', REJECTED: 'red', FAILED: 'red', CANCELED: 'gray',
  CLOSED: 'gray', EXPIRED: 'red', DECLINED: 'red', WITHDRAWN: 'gray', FILLED: 'green', LOST: 'red',
  IN_STOCK: 'green', ASSIGNED: 'blue', IN_REPAIR: 'amber', RETIRED: 'gray', ELIGIBLE: 'blue',
  QUEUED: 'amber', INVITED: 'amber', SUSPENDED: 'red', DEACTIVATED: 'gray', NOT_CONFIGURED: 'gray',
  NOT_STARTED: 'gray', SHARED: 'green', RUNNING: 'blue', SKIPPED: 'gray', READY: 'blue', VALIDATING: 'amber',
  CRITICAL: 'red', HIGH: 'amber', NORMAL: 'gray', LOW: 'gray', UNDER_REVIEW: 'amber', RETIRED_RULE: 'gray',
};

export function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONES[status] ?? 'gray';
  const label = status.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  return <Badge tone={tone}>{label}</Badge>;
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label {...props} className={cx('mb-1 block text-[13px] font-medium text-ink-700', className)} />;
}

export const inputClass =
  'block w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-300 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:bg-ink-50 disabled:text-ink-400';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input {...props} className={cx(inputClass, 'h-9', className)} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea {...props} className={cx(inputClass, 'min-h-20', className)} />;
}

export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <select {...props} className={cx(inputClass, 'h-9 pr-8', className)}>
      {children}
    </select>
  );
}

export function Field({
  label,
  htmlFor,
  required,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="ml-0.5 text-danger-500">*</span> : null}
      </Label>
      {children}
      {hint && !error ? <p className="mt-1 text-[12px] text-ink-400">{hint}</p> : null}
      {error ? (
        <p role="alert" className="mt-1 text-[12px] text-danger-500">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-md border border-danger-100 bg-danger-100/60 px-3 py-2 text-[13px] text-danger-500">
      {message}
    </div>
  );
}

export function FormSuccess({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div role="status" className="rounded-md border border-ok-100 bg-ok-100/60 px-3 py-2 text-[13px] text-ok-500">
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('fsw-scroll overflow-x-auto', className)}>
      <table className="w-full min-w-max border-collapse text-sm">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-ink-100 text-left text-[12px] font-semibold tracking-wide text-ink-500 uppercase">
        {children}
      </tr>
    </thead>
  );
}

export function TH({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cx('px-4 py-2.5 whitespace-nowrap', className)}>{children}</th>;
}

export function TRow({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={cx('border-b border-ink-100/80 last:border-0 hover:bg-brand-50/40', className)}>{children}</tr>;
}

export function TD({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cx('px-4 py-2.5 align-middle', className)}>{children}</td>;
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function Avatar({
  name,
  photoUrl,
  size = 32,
}: {
  name: string;
  photoUrl?: string | null;
  size?: number;
}) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  if (photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={photoUrl} alt={name} width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-ink-800 font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-ink-100 text-lg text-ink-400" aria-hidden>
        ◇
      </div>
      <h3 className="text-sm font-semibold text-ink-800">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-[13px] text-ink-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function DeniedState({ message }: { message?: string }) {
  return (
    <EmptyState
      title="You don't have access to this"
      description={message ?? 'Ask an HR Admin if you believe you should be able to see this page.'}
    />
  );
}

export function Pagination({
  page,
  pageCount,
  hrefFor,
}: {
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
}) {
  if (pageCount <= 1) return null;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between border-t border-ink-100 px-4 py-3 text-[13px] text-ink-500">
      <span>
        Page {page} of {pageCount}
      </span>
      <div className="flex gap-1">
        {page > 1 && (
          <Link className={buttonClass('secondary', 'sm')} href={hrefFor(page - 1)}>
            Previous
          </Link>
        )}
        {page < pageCount && (
          <Link className={buttonClass('secondary', 'sm')} href={hrefFor(page + 1)}>
            Next
          </Link>
        )}
      </div>
    </nav>
  );
}

export function DescriptionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
      {items.map((item, i) => (
        <div key={i}>
          <dt className="text-[12px] font-medium tracking-wide text-ink-400 uppercase">{item.label}</dt>
          <dd className="mt-0.5 text-sm text-ink-900">{item.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Callout({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'danger'; children: ReactNode }) {
  const styles =
    tone === 'warn'
      ? 'border-warn-500/30 bg-warn-100/50 text-warn-500'
      : tone === 'danger'
        ? 'border-danger-500/30 bg-danger-100/50 text-danger-500'
        : 'border-brand-200 bg-brand-50 text-brand-700';
  return <div className={cx('rounded-md border px-3.5 py-2.5 text-[13px] leading-relaxed', styles)}>{children}</div>;
}

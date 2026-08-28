'use client';

import { useActionState, useEffect, useRef, useState, type ReactNode, type ComponentProps } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { X, Search } from 'lucide-react';
import { Button, buttonClass, cx, inputClass, type ButtonVariant } from './index';

/** Submit button that shows a pending state inside <form action={...}>. */
export function SubmitButton({
  children,
  variant = 'primary',
  size = 'md',
  className,
  pendingLabel,
  ...props
}: ComponentProps<'button'> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      {...props}
      type="submit"
      disabled={pending || props.disabled}
      className={cx(buttonClass(variant, size), className)}
    >
      {pending ? (
        <>
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
          {pendingLabel ?? 'Working…'}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/** Slide-over panel (right side) for detail/edit surfaces. */
export function Drawer({
  title,
  open,
  onClose,
  children,
  wide,
}: {
  title: ReactNode;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink-950/40" onClick={onClose} aria-hidden />
      <div
        className={cx(
          'absolute inset-y-0 right-0 flex w-full flex-col bg-white shadow-pop',
          wide ? 'sm:max-w-2xl' : 'sm:max-w-lg',
        )}
      >
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <h2 className="text-[15px] font-semibold text-ink-900">{title}</h2>
          <button onClick={onClose} aria-label="Close panel" className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
            <X size={18} />
          </button>
        </div>
        <div className="fsw-scroll flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/** Centered modal for confirmations / small forms. */
export function Modal({
  title,
  open,
  onClose,
  children,
}: {
  title: ReactNode;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink-950/40" onClick={onClose} aria-hidden />
      <div className="relative w-full max-w-md rounded-card bg-white p-5 shadow-pop">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-ink-900">{title}</h2>
          <button onClick={onClose} aria-label="Close dialog" className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Button that opens a confirm dialog before submitting the given action. */
export function ConfirmSubmit({
  action,
  title,
  description,
  confirmLabel,
  variant = 'danger',
  size = 'sm',
  children,
  hiddenFields,
  requireReason,
}: {
  action: (formData: FormData) => void | Promise<void>;
  title: string;
  description?: string;
  confirmLabel?: string;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
  hiddenFields?: Record<string, string>;
  requireReason?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <Modal title={title} open={open} onClose={() => setOpen(false)}>
        {description ? <p className="mb-4 text-[13px] leading-relaxed text-ink-600">{description}</p> : null}
        <form
          action={async (fd) => {
            await action(fd);
            setOpen(false);
          }}
          className="space-y-3"
        >
          {Object.entries(hiddenFields ?? {}).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          {requireReason ? (
            <div>
              <label className="mb-1 block text-[13px] font-medium text-ink-700" htmlFor="confirm-reason">
                Reason
              </label>
              <input id="confirm-reason" name="reason" required className={cx(inputClass, 'h-9')} />
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton variant={variant} size="sm">
              {confirmLabel ?? 'Confirm'}
            </SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}

/** Debounced search box that updates the `q` search param (server filtering). */
export function SearchBox({ placeholder, param = 'q' }: { placeholder?: string; param?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlValue = searchParams.get(param) ?? '';
  const [value, setValue] = useState(urlValue);
  // Re-sync the input when the URL changes from outside (back button, a
  // cleared filter). Adjusting state during render is React's recommended
  // pattern here — an effect would cause a cascading second render.
  const [lastUrlValue, setLastUrlValue] = useState(urlValue);
  if (urlValue !== lastUrlValue) {
    setLastUrlValue(urlValue);
    setValue(urlValue);
  }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onChange(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (next) params.set(param, next);
      else params.delete(param);
      params.delete('page');
      router.replace(`${pathname}?${params.toString()}`);
    }, 300);
  }

  return (
    <div className="relative">
      <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-300" aria-hidden />
      <input
        type="search"
        role="searchbox"
        aria-label={placeholder ?? 'Search'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'Search…'}
        className={cx(inputClass, 'h-9 w-56 pl-9 md:w-72')}
      />
    </div>
  );
}

/** Select that updates a search param on change (server-side filtering). */
export function FilterSelect({
  param,
  options,
  allLabel,
  ariaLabel,
}: {
  param: string;
  options: { value: string; label: string }[];
  allLabel: string;
  ariaLabel?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <select
      aria-label={ariaLabel ?? param}
      value={searchParams.get(param) ?? ''}
      onChange={(e) => {
        const params = new URLSearchParams(searchParams.toString());
        if (e.target.value) params.set(param, e.target.value);
        else params.delete(param);
        params.delete('page');
        router.replace(`${pathname}?${params.toString()}`);
      }}
      className={cx(inputClass, 'h-9 w-auto pr-8')}
    >
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Warn about unsaved changes when navigating away from a dirty form. */
export function UnsavedChangesGuard({ formId }: { formId: string }) {
  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    let dirty = false;
    const markDirty = () => (dirty = true);
    const clear = () => (dirty = false);
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    form.addEventListener('input', markDirty);
    form.addEventListener('submit', clear);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      form.removeEventListener('input', markDirty);
      form.removeEventListener('submit', clear);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [formId]);
  return null;
}

/** Generic form wrapper around a server action returning {error?, success?}. */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
  onSuccess,
  id,
}: {
  action: (prev: { error?: string; success?: string } | void, formData: FormData) => Promise<{ error?: string; success?: string } | void>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  /** Called once after the action reports success — e.g. to close a drawer. */
  onSuccess?: () => void;
  id?: string;
}) {
  const [state, formAction] = useActionState(action, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  // Kept in a ref so an inline arrow callback does not re-run the effect on
  // every render. Assigned inside an effect — refs are not written during
  // render.
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);
  useEffect(() => {
    if (state && 'success' in state && state.success) {
      if (resetOnSuccess) formRef.current?.reset();
      onSuccessRef.current?.();
    }
  }, [state, resetOnSuccess]);
  return (
    <form ref={formRef} id={id} action={formAction} className={className}>
      {state && 'error' in state && state.error ? (
        <div role="alert" className="mb-3 rounded-md border border-danger-100 bg-danger-100/60 px-3 py-2 text-[13px] text-danger-500">
          {state.error}
        </div>
      ) : null}
      {state && 'success' in state && state.success ? (
        <div role="status" className="mb-3 rounded-md border border-ok-100 bg-ok-100/60 px-3 py-2 text-[13px] text-ok-500">
          {state.success}
        </div>
      ) : null}
      {children}
    </form>
  );
}
